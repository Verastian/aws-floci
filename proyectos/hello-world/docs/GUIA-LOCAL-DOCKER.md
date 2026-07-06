# Guía paso a paso: AWS 100% local con Floci + Lambda "Hello World"

**Nivel:**  sin experiencia previa en AWS.
**Objetivo de este documento:** que puedas instalar un emulador de AWS **en tu propia máquina** (con
Docker Desktop o Docker Engine, sin ningún servidor remoto) y desplegar tu primera función Lambda
con una página "Hello World", entendiendo **qué hace cada paso y por qué**, no solo copiando
comandos.

**¿Por qué no necesitás un servidor remoto?** Floci es un contenedor Docker como cualquier otro —
no le importa si corre en un VPS o en tu laptop. Todo lo que sigue funciona igual, pero sin túnel
SSH, sin depender de la conexión de otra persona, y sin ningún concepto de "servidor compartido".
Si más adelante querés desplegar esto mismo en un servidor remoto (por ejemplo para compartirlo con
otras personas), la guía [`GUIA-PASO-A-PASO.md`](./GUIA-PASO-A-PASO.md) cubre exactamente esa
diferencia — pero para aprender y practicar, este documento te alcanza solo.

---

## Índice

1. [Conceptos previos que necesitas entender](#1-conceptos-previos-que-necesitas-entender)
2. [Arquitectura de la solución](#2-arquitectura-de-la-solución)
3. [Prerrequisitos](#3-prerrequisitos)
4. [ETAPA 1 — Instalar Floci con Docker en tu máquina](#etapa-1--instalar-floci-con-docker-en-tu-máquina)
5. [ETAPA 2 — Lambda "Hello World"](#etapa-2--lambda-hello-world)
6. [ETAPA 3 — Limpieza](#etapa-3--limpieza)
7. [Problemas comunes y cómo resolverlos](#7-problemas-comunes-y-cómo-resolverlos)
8. [Qué aprendiste](#8-qué-aprendiste)
9. [Glosario](#9-glosario)
10. [Próximos pasos](#10-próximos-pasos)

---

## 1. Conceptos previos que necesitas entender

Antes de tocar un solo comando, es importante que entiendas el "por qué" detrás de cada pieza. Si
ya conoces algo de esto, puedes saltarlo.

### 1.1 ¿Qué es "la nube" y qué es AWS?

Cuando una empresa usa "la nube", en el fondo está alquilando computadoras, almacenamiento y
servicios ya construidos (bases de datos, colas de mensajes, ejecución de código) en los centros de
datos de un proveedor — en vez de comprar y mantener sus propios servidores. **AWS (Amazon Web
Services)** es el proveedor de nube más grande, y ofrece cientos de "servicios" (S3 para archivos,
Lambda para ejecutar código, RDS para bases de datos, etc.), cada uno con su propia API.

Para usar AWS real necesitas: una cuenta, una tarjeta de crédito (te cobran por uso), y credenciales
(claves) para autenticarte. Eso es una barrera de entrada grande para aprender — **por eso usamos
un emulador**.

### 1.2 ¿Qué es un "emulador de nube" y por qué usamos Floci?

Un emulador de nube es un programa que **imita el comportamiento de los servicios de AWS** en tu
propia máquina, respondiendo exactamente igual que la AWS real a las mismas llamadas de API, pero
sin cuenta, sin costo, y sin tocar infraestructura real.

**Floci** es uno de estos emuladores (de código abierto y gratuito). Lo importante que debes saber:

- Corre como un contenedor Docker, escuchando en el puerto **4566**.
- Cuando le hablas con el AWS CLI real (el mismo que usarías contra AWS de verdad), Floci responde
  imitando el servicio que le pediste.
- Para algunos servicios (Lambda, RDS, ECS, entre otros), Floci no "finge" la respuesta: **levanta
  contenedores Docker reales** que ejecutan el motor real (por ejemplo, la imagen oficial de AWS
  Lambda para Node.js). Esto se llama **Docker-out-of-Docker**: el contenedor de Floci usa el
  Docker de tu propia máquina para crear contenedores hermanos (no anidados).

![Patrón Docker-out-of-Docker](./imgs/Floci%20-%20Patron%20Docker-out-of-Docker.png)

- Para otros servicios (S3, DynamoDB, SNS, SQS, IAM), Floci reimplementa el protocolo en memoria —
  es una imitación fiel, pero no el motor real.

Esta distinción importa porque **para aprender Lambda de verdad, Floci te da el motor real** — el
mismo container runtime que usa AWS en producción.

### 1.3 ¿Qué es Docker y Docker Compose? (repaso rápido)

- Una **imagen Docker** es un paquete con todo lo necesario para correr un programa (código,
  dependencias, sistema de archivos mínimo).
- Un **contenedor** es una instancia en ejecución de una imagen — aislado del resto del sistema,
  pero compartiendo el kernel del sistema operativo del host (más liviano que una máquina virtual
  completa).
- **Docker Compose** es una herramienta para describir, en un archivo `docker-compose.yml`, uno o
  más contenedores (servicios), sus puertos, volúmenes y variables de entorno, y levantarlos todos
  juntos con un solo comando.
- En tu máquina, "Docker" puede ser **Docker Desktop** (Mac/Windows, con interfaz gráfica) o
  **Docker Engine** (Linux/WSL2, solo línea de comandos) — para todo lo que hacemos acá, da lo
  mismo cuál uses: ambos hablan el mismo Docker CLI/Compose.

### 1.4 AWS CLI y el concepto de "endpoint"

El **AWS CLI** es la herramienta de línea de comandos oficial de Amazon para hablar con cualquier
servicio de AWS. Normalmente, cuando ejecutas `aws s3 ls`, el CLI construye una petición HTTP y la
envía a una URL real de Amazon (por ejemplo `https://s3.us-east-1.amazonaws.com`).

El truco para usar un emulador es decirle al CLI: **"en vez de hablarle a Amazon de verdad, habla
con esta otra URL"** — eso se llama sobreescribir el **endpoint**. Como Floci escucha en
`http://localhost:4566`, configuramos el CLI para que apunte ahí. El CLI no sabe (ni le importa)
que no es la AWS real: manda exactamente las mismas peticiones.

### 1.5 Credenciales, perfiles y por qué usamos claves "falsas"

AWS real exige un `AWS_ACCESS_KEY_ID` y un `AWS_SECRET_ACCESS_KEY` (como un usuario y contraseña)
para cada petición. Floci **no valida credenciales reales** — acepta cualquier valor no vacío (por
convención, se usa la palabra `test` para ambas). Aun así, hay que configurarlas, porque el CLI se
niega a funcionar sin ellas.

Un **perfil** de AWS CLI (`~/.aws/config` y `~/.aws/credentials`) es un conjunto de configuración
con nombre (región, credenciales, endpoint) que puedes seleccionar con `--profile nombre`, sin
pisar tu configuración real de AWS si algún día la tienes.

### 1.6 ¿Qué es AWS Lambda?

Lambda es el servicio de **"serverless computing"** (cómputo sin servidor) de AWS: le das tu código
(una función) y AWS se encarga de todo lo demás — levantar el entorno de ejecución, escalar, y
cobrarte solo por el tiempo que tu código corrió.

Conceptos clave de Lambda que vas a usar en este documento:

- **Handler**: la función específica de tu código que Lambda invoca cuando llega un evento. En
  Node.js se ve así: `exports.handler = async (event, context) => {...}`.
- **Runtime**: el entorno de ejecución (por ejemplo `nodejs22.x`, `python3.13`). Determina qué
  lenguaje/versión ejecuta tu función.
- **Event**: el objeto de entrada que recibe tu función (por ejemplo, los datos de una petición
  HTTP si viene de una Function URL o API Gateway).
- **Execution Role (rol de ejecución)**: un rol de IAM que Lambda "asume" para ejecutar tu función
  con ciertos permisos (por ejemplo, permiso para escribir logs, leer de una base de datos, etc.).
  Toda función Lambda necesita uno, aunque no use ningún otro servicio.
- **Cold start (arranque en frío)**: la primera vez que se invoca una función (o después de un
  tiempo sin uso), Lambda tiene que levantar el contenedor desde cero, lo que toma más tiempo que
  invocaciones posteriores ("warm").

![Cold start vs Warm start](./imgs/Floci%20-%20Cold%20start%20vs%20Warm%20start.png)

### 1.7 IAM: roles y políticas (lo mínimo que necesitas saber)

**IAM (Identity and Access Management)** es el servicio de permisos de AWS. Dos conceptos que vas a
usar:

- **Rol (Role)**: una identidad que no es una persona, sino que la "asume" un servicio (en nuestro
  caso, Lambda) para actuar en tu cuenta. Un rol tiene una **política de confianza** (trust policy)
  que dice *quién* puede asumirlo (`"Principal": {"Service": "lambda.amazonaws.com"}` = "el
  servicio Lambda puede asumir este rol").
- **Política (Policy)**: un documento JSON que dice *qué* acciones están permitidas o denegadas
  sobre qué recursos. Hay dos "sabores" que vas a ver en este documento:
  - **Basada en identidad**: se adjunta a un usuario/rol ("este rol puede hacer X").
  - **Basada en recurso**: se adjunta al recurso mismo ("este recurso permite que X lo invoque") —
    esto es exactamente lo que usamos para permitir que cualquiera invoque nuestra Function URL sin
    credenciales.

![Delegación de permisos IAM](./imgs/Floci%20-%20Delegacion%20de%20permisos%20IAM.png)

### 1.8 Function URL: la forma más simple de exponer una Lambda en HTTP

Una **Function URL** es una URL HTTPS pública que invoca directamente tu función Lambda, sin
necesidad de configurar un API Gateway completo (que es más potente pero también más complejo:
rutas, stages, autorización, etc.). Es la forma más simple de decir "quiero que mi función responda
a peticiones HTTP".

- `AuthType NONE`: cualquiera con la URL puede invocar la función (lo que usamos para nuestro Hello
  World).
- `AuthType AWS_IAM`: solo quien tenga credenciales AWS válidas y permiso puede invocarla (lo normal
  en producción para endpoints privados).

---

## 2. Arquitectura de la solución

![Arquitectura 100% local (sin VPS)](./imgs/Floci%20-%20Arquitectura%20local%20(sin%20VPS).png)

Diagrama editable en Lucid: [Floci - Arquitectura 100% local (sin VPS)](https://lucid.app/lucidchart/59f302ea-53ba-4e44-bf9c-1ca9e2cf1466/edit)

El diagrama muestra el flujo completo, **todo dentro de tu propia máquina**: tu AWS CLI y tu
navegador hablan directo a `http://localhost:4566` (sin túnel, sin servidor remoto), Floci recibe
esa petición, usa el Docker de tu máquina (vía `/var/run/docker.sock`) para levantar el contenedor
real de Lambda bajo demanda, la función Lambda asume su rol de IAM, y la respuesta vuelve por el
mismo camino hasta tu navegador.

---

## 3. Prerrequisitos

- **Docker Desktop** (Windows o Mac) o **Docker Engine + Docker Compose** (Linux/WSL2) instalado y
  corriendo. Verificalo con `docker --version` y `docker compose version`.
  - **Windows**: se recomienda usar Docker Desktop con el backend de WSL2 habilitado (Settings →
    General → "Use the WSL 2 based engine"), y correr todos los comandos de esta guía **dentro** de
    una distro WSL2 (por ejemplo Ubuntu), no en PowerShell/CMD directamente — evita problemas de
    rutas y de finales de línea.
  - **Mac**: Docker Desktop funciona directo, sin pasos extra.
  - **Linux/WSL2 nativo**: podés usar Docker Engine sin Docker Desktop; asegurate de que tu usuario
    esté en el grupo `docker` (`sudo usermod -aG docker $USER`, y volvé a iniciar sesión) para no
    tener que anteponer `sudo` a cada comando.
- Al menos ~4 GB de RAM disponibles para Docker (Docker Desktop permite ajustar el límite en
  Settings → Resources) — Floci más el contenedor de Lambda no son pesados, pero si Docker Desktop
  tiene poca memoria asignada, la Lambda puede fallar al arrancar en vez de dar un error claro.
- **AWS CLI v2** instalado (instrucciones oficiales de Amazon según tu sistema operativo).
- Conocimientos mínimos de terminal/bash.
- Git, para clonar este repositorio.

---

## ETAPA 1 — Instalar Floci con Docker en tu máquina

<img src="./imgs/Icono%20-%20Docker.png" alt="Docker" width="140">

En qué parte de la arquitectura estamos configurando ahora — el Docker Engine y el contenedor de
Floci arriba, todavía sin ninguna función Lambda ni rol IAM (eso viene en la ETAPA 2):

![Etapa 1.1-1.4: Floci corriendo](./imgs/Floci%20-%20Etapa%201.1-1.4%20-%20Floci%20corriendo.png)

### 1.1 Crear el archivo `docker-compose.yml`

Primero, creá una carpeta para el proyecto en tu máquina y entrá en ella (podés usar
`proyectos/hello-world/` de este mismo repo clonado, o cualquier otra ubicación):

```bash
mkdir -p ~/floci-hello-world
cd ~/floci-hello-world
```

Ahora creá el archivo `docker-compose.yml` con ese contenido. Podés abrirlo con tu editor de
preferencia, o crearlo directo desde la terminal con un heredoc (todo el bloque `cat <<'EOF' ... EOF`
se pega junto, tal cual, en la terminal):

```bash
cat > docker-compose.yml <<'EOF'
name: floci-hello-world

services:
  floci:
    image: floci/floci:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:4566:4566"
    volumes:
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      FLOCI_SERVICES_DOCKER_NETWORK: floci-hello-world_default
EOF
```

**Explicación línea por línea:**

| Línea | Qué hace | Por qué importa |
|---|---|---|
| `name: floci-hello-world` | Fija el nombre del proyecto Compose | Docker Compose prefija este nombre a la red que crea (ver más abajo) — fijarlo evita sorpresas si corrés esto desde carpetas con nombres distintos |
| `image: floci/floci:latest` | Descarga la imagen oficial de Floci desde Docker Hub | Es el emulador en sí |
| `restart: unless-stopped` | Si Docker se reinicia (por ejemplo, al reiniciar tu máquina), vuelve a levantar el contenedor solo | Comodidad — opcional en un entorno de aprendizaje, no hace daño dejarlo |
| `ports: "127.0.0.1:4566:4566"` | Mapea el puerto 4566 del contenedor al puerto 4566 de tu máquina, solo accesible desde `127.0.0.1` | Buena práctica aunque estés en local: evita que otro dispositivo de tu misma red Wi-Fi pueda hablarle a tu Floci si tu firewall no lo bloquea de otra forma |
| `volumes: ./data:/app/data` | Guarda los datos de Floci (buckets S3, tablas DynamoDB, etc.) en una carpeta de tu máquina | Así los datos sobreviven si el contenedor se reinicia |
| `volumes: /var/run/docker.sock:/var/run/docker.sock` | Le da a Floci acceso a tu propio Docker (Docker-out-of-Docker) | **Imprescindible** para que Lambda, RDS y otros servicios "reales" funcionen |
| `environment: FLOCI_SERVICES_DOCKER_NETWORK` | Le dice a Floci en qué red Docker debe conectar los contenedores que crea (Lambda, etc.) | Ver la nota de red más abajo — si no coincide con la red real, Lambda falla en silencio |

> ⚠️ **Nota de seguridad**: montar `docker.sock` le da al contenedor de Floci control total sobre tu
> Docker (equivalente a acceso root en tu máquina). Es razonable para aprender en tu propia laptop,
> pero es exactamente la razón por la que el puerto 4566 nunca debe exponerse a otras máquinas.

> ⚠️ **Nota sobre conflicto de puerto con el túnel SSH al VPS**: si en esta misma máquina también
> tenés activo el túnel SSH persistente hacia el VPS de este repo (`floci-tunnel.service`, ver
> `GUIA-PASO-A-PASO.md`), ese túnel **ya está usando el puerto 4566 en `127.0.0.1`** de tu máquina —
> vas a chocar contra él al intentar levantar este Floci local (en Windows, el error se ve como
> `Only one usage of each socket address...`; en Linux/Mac, `address already in use`). No hace falta
> tocar el túnel: simplemente usá otro puerto de tu lado para este Floci local, por ejemplo `4567`
> (el contenedor sigue escuchando `4566` puertas adentro, sólo cambia el mapeo hacia afuera):
> ```yaml
> ports:
>   - "127.0.0.1:4567:4566"
> ```
> y de ahí en adelante reemplazá `4566` por `4567` en el resto de esta guía (`endpoint_url`, `curl`,
> la Function URL que te devuelva Lambda, etc.).
>
> **Ojo con un detalle no obvio**: el `endpoint_url` de tu perfil (`floci-local`) sí tenés que
> cambiarlo vos a `4567` — pero **cualquier URL que Floci te *devuelva*** (como la Function URL del
> paso 2.6) va a seguir diciendo `:4566`, porque el contenedor, puertas adentro, sigue escuchando en
> `4566` y no tiene forma de saber que vos lo remapeaste a `4567` del lado de afuera. Esto **no**
> significa que la URL sea la del VPS ni de otro Floci — es tu Floci local, solo que el string trae
> el puerto "de fábrica". Tenés que reemplazar `:4566` por `:4567` a mano en esa URL antes de
> usarla con `curl` o el navegador (ver la nota en 2.6).

> ⚠️ **Nota sobre el nombre de la red Docker**: Docker Compose arma el nombre de sus redes como
> `<nombre-del-proyecto>_default`, donde el nombre del proyecto es el que fijaste en `name:` (o, si
> no lo fijás, el nombre de la carpeta donde está el `docker-compose.yml`). Esto es distinto al
> `floci_default` que se usa en el VPS (ver `GUIA-PASO-A-PASO.md`), porque ahí el nombre de carpeta
> es otro. Si no fijás `name:` explícitamente, **verificá el nombre real antes de seguir**:
> ```bash
> docker compose up -d
> docker network ls | grep default
> ```
> y ajustá `FLOCI_SERVICES_DOCKER_NETWORK` para que coincida exactamente — si no coincide, Floci no
> tira un error claro: simplemente Lambda va a fallar al arrancar el contenedor real más adelante.

### 1.2 Pre-descargar la imagen de Lambda Node.js (recomendado)

Antes de levantar Floci, descargá de antemano la imagen que Lambda va a necesitar la primera vez
que invoques una función:

```bash
docker pull public.ecr.aws/lambda/nodejs:22
```

Esto evita el error más común la primera vez (`Lambda.InitError: No such image`, ver sección de
problemas comunes) — Floci no la descarga por vos automáticamente si tu conexión es lenta o si hay
un problema de red la primera vez que la necesita.

### 1.3 Levantar el contenedor

Desde la carpeta donde está el `docker-compose.yml`:

```bash
docker compose up -d
```

`-d` significa *detached*: corre en segundo plano y te devuelve la terminal.

> 💡 **Alternativa/nota**: si en vez de esto corriste `docker compose up -d --build`, no pasa nada
> raro — `--build` solo agrega el paso de "reconstruir la imagen antes de levantar" (relevante
> cuando el `docker-compose.yml` tiene una sección `build:`, que el nuestro no tiene, porque usamos
> una imagen ya publicada con `image:`). El `up -d` de todas formas se ejecuta igual después, así
> que el contenedor debería quedar levantado de la misma forma. Si tenés dudas de si quedó
> corriendo, el paso 1.4 (`docker ps`) te lo confirma; si no aparece, simplemente repetí
> `docker compose up -d`.

### 1.4 Verificar que está corriendo

```bash
docker ps --filter "name=floci"
```

Deberías ver un contenedor en estado `Up ... (healthy)`.

Luego, probamos el **health check** (endpoint que reporta el estado de cada servicio emulado):

```bash
curl http://localhost:4566/_localstack/health
```

La respuesta es un JSON con una lista de servicios y su estado (`"running"`). Si ves `"lambda":
"running"`, el socket de Docker quedó bien configurado.

Ejemplo de salida
```json

    "version": "1.5.30",
    "original_edition": "floci-always-free",
    "edition": "community",
    "services": {
        "ssm": "running",
        "sqs": "running",
        "s3": "running",
        "dynamodb": "running",
        "sns": "running",
        "lambda": "running",
        "apigateway": "running",
        "iam": "running",
        "kafka": "running",
        "mq": "running",
        "elasticache": "running",
        "memorydb": "running",
        "rds": "running",
       ...
    }
}
```

### 1.5 Configurar el perfil de AWS CLI

<img src="./imgs/Icono%20-%20AWS%20CLI.png" alt="AWS CLI" width="140">

![Etapa 1.5-1.6: AWS CLI configurado](./imgs/Floci%20-%20Etapa%201.5-1.6%20-%20CLI%20configurado.png)

A diferencia de un despliegue en VPS, **no hace falta ningún túnel** — tu AWS CLI habla directo a
`http://localhost:4566` (o el puerto que hayas elegido en 1.1 si tuviste el conflicto de la nota de
esa sección), porque Floci corre en tu propia máquina.

> 💡 Si ya usás el AWS CLI contra el proyecto del VPS (`GUIA-PASO-A-PASO.md`), es el **mismo
> programa** — no hay nada que reinstalar. Lo que sí cambia es el **perfil**: acá usamos
> `floci-local` (no `floci`) a propósito, para no pisar el perfil `floci` que ya apunta al túnel del
> VPS. Así podés tener los dos configurados en paralelo y elegir uno u otro con `--profile`, sin
> reconfigurar nada cada vez que alternás entre aprender en local y usar el VPS real.

```bash
aws configure set aws_access_key_id test --profile floci-local
aws configure set aws_secret_access_key test --profile floci-local
aws configure set region us-east-1 --profile floci-local
aws configure set endpoint_url http://localhost:4566 --profile floci-local
```

Esto crea/edita `~/.aws/config` y `~/.aws/credentials` con un perfil llamado `floci-local`.

> ⚠️ **Verificación importante si usaste otro puerto (nota de 1.1)**: el comando de arriba deja el
> `endpoint_url` en `4566` a propósito, para que copies/pegues sin pensar — pero si tuviste el
> conflicto de puerto (por ejemplo con el túnel al VPS) y tu Floci local en realidad escucha en otro
> puerto (`4567` en el ejemplo de esa nota), **tenés que ajustar este último comando** con tu puerto
> real. Confirmá antes de seguir:
> ```bash
> aws configure get endpoint_url --profile floci-local
> ```
> Si ese valor no coincide *exactamente* con el puerto de tu `docker-compose.yml`, tu AWS CLI le va a
> estar hablando a otra cosa sin que te enteres (por ejemplo, al túnel del VPS si ese sigue vivo en
> el 4566) — una señal clara de esto es ver recursos que no creaste vos (buckets de otro proyecto,
> por ejemplo) al listar. Corregilo con tu puerto real:
> ```bash
> aws configure set endpoint_url http://localhost:4567 --profile floci-local
> aws s3 ls --profile floci-local
> ```
> Si mientras tanto llegaste a crear algo por error del lado equivocado (por ejemplo un bucket de
> prueba que terminó en el Floci del VPS en vez del local), lo podés borrar usando el perfil `floci`
> (el del VPS, no el `floci-local`):
> ```bash
> aws s3 rb s3://floci-smoke-test --profile floci
> ```

### 1.6 Prueba de humo

<img src="./imgs/Icono%20-%20Amazon%20S3.png" alt="Amazon S3" width="140">

Este es el primer momento en que tu AWS CLI le habla a un **servicio real de AWS** (S3, aunque
emulado por Floci) en vez de solo chequear que el contenedor esté vivo. Dos comandos, dos llamadas
de API distintas:

```bash
aws s3 mb s3://floci-smoke-test --profile floci-local
aws s3 ls --profile floci-local
```

Desglosando cada parte de `aws s3 mb s3://floci-smoke-test --profile floci-local`:

- **`aws`** — el binario del AWS CLI en sí. Es el programa que sabe hablar el protocolo de AWS
  (autenticación, formato de las peticiones, etc.), sin importar contra qué servicio ni contra qué
  endpoint lo apuntes.
- **`s3`** — el **servicio** de AWS que querés usar. Cada servicio de AWS (`s3`, `lambda`, `iam`,
  `dynamodb`, etc.) es un subcomando distinto del CLI, con sus propias acciones.
- **`mb`** — la **acción** dentro de ese servicio: "make bucket". Es el mismo comando que usarías
  contra la AWS real, y por debajo dispara la misma llamada de API (`CreateBucket`) que dispararía
  contra Amazon.
- **`s3://floci-smoke-test`** — el **recurso** sobre el que actúa el comando: el nombre del bucket
  que querés crear, con el prefijo `s3://` que indica que es una ruta de S3 (no un archivo local).
- **`--profile floci-local`** — le dice al CLI **qué configuración usar** (credenciales, región, y
  sobre todo el `endpoint_url`). Es lo que hace que esta petición vaya a tu Floci local en vez de a
  la AWS real o al Floci del VPS.

Como tu perfil `floci-local` tiene el `endpoint_url` apuntando a tu Floci local, la petición nunca
sale a internet: la recibe tu contenedor Docker, que crea el bucket en el volumen `./data` que
definiste en el `docker-compose.yml`.

> 🔀 **Diferencia con AWS real**
>
> | | Floci (lo que acabás de correr) | AWS real |
> |---|---|---|
> | Comando | `aws s3 mb s3://floci-smoke-test --profile floci-local` | `aws s3 mb s3://floci-smoke-test` |
> | ¿Qué cambió? | se agregó `--profile floci-local` | sin `--profile` (o el de tu cuenta real, si manejás varias) |
> | ¿A dónde va la petición? | a tu Floci local (`endpoint_url` = `localhost`) | a Amazon, de verdad |
>
> Esta va a ser la única diferencia real en **todos** los comandos de esta guía (salvo un par de
> casos puntuales que sí vamos a marcar aparte, como el número de cuenta en 2.3): cada comando es
> 100% AWS CLI real, y lo único "de más" es el `--profile floci-local`. De acá en más no lo vamos a
> repetir en cada paso — asumí que sacando ese flag, tenés el comando exacto de una cuenta real.

El segundo comando, `aws s3 ls --profile floci-local`, reusa las primeras dos partes (`aws`, `s3`) y
cambia la acción:

- **`ls`** — lista. Sin nombre de bucket después, lista **todos** los buckets que existen en esa
  "cuenta" (la cuenta dummy `000000000000` de Floci) — es la llamada `ListBuckets`.
- **`--profile floci-local`** — de nuevo, define a qué Floci le estás preguntando.

Acá es donde vas a ver reflejado cualquier bucket que hayas creado antes en esa misma instancia de
Floci — y **solo** esa instancia: si tenés más de un Floci corriendo (por ejemplo, este local y el
del VPS a través de un túnel), cada uno tiene su propio conjunto de buckets, completamente aislado
del otro. Si acá ves buckets que no creaste vos (por ejemplo de otro proyecto), es señal de que el
`endpoint_url` de tu perfil apunta al Floci equivocado — ver la nota de arriba y la tabla de
problemas comunes.

Si ves solo `floci-smoke-test` listado (y nada más), **Floci está funcionando de punta a punta** en
tu propia máquina, de forma completamente aislada de cualquier otro Floci que tengas dando vueltas.

*(Un "bucket" en S3 es, en términos simples, una carpeta raíz de almacenamiento de archivos. `mb` =
"make bucket".)*

---

## ETAPA 2 — Lambda "Hello World"

Esta es la parte más rica en conceptos. Vamos a crear, paso a paso, una función Lambda real
(ejecutándose en un contenedor Docker auténtico de AWS Lambda) que responde "Hello World" por HTTP.

### 2.1 Escribir el código de la función

Creá una carpeta `lambda/` dentro de la carpeta del proyecto (en el repo, `proyectos/hello-world/
lambda/`; si armaste tu propia carpeta en el paso 1.1, creála ahí adentro) y entrá en ella:

```bash
mkdir lambda
cd lambda
```

Dentro, creá el archivo `index.js` — de nuevo, con tu editor de preferencia o directo por terminal:

```bash
cat > index.js <<'EOF'
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: "<html><body><h1>Hello World</h1><p>Servido desde Lambda emulado por Floci.</p></body></html>"
  };
};
EOF
```

**¿Por qué la respuesta tiene esta forma exacta (`statusCode`, `headers`, `body`)?**

Cuando una Lambda se invoca a través de HTTP (Function URL o API Gateway), AWS espera que el objeto
devuelto tenga esta estructura específica, para poder traducirlo en una respuesta HTTP real. Si
solo devolvieras un string o un objeto sin esta forma, el navegador recibiría un error o una
respuesta mal formada. Este patrón se llama **Lambda Proxy Integration**.

### 2.2 Empaquetar el código en un `.zip`

AWS Lambda no recibe el código como una carpeta suelta: espera un **paquete de despliegue**,
normalmente un `.zip` con el código y sus dependencias.

```bash
# seguís dentro de la carpeta lambda/ del paso anterior
zip -r function.zip index.js
```

### 2.3 Crear el rol de IAM que la función va a "asumir"

<img src="./imgs/Icono%20-%20AWS%20IAM.png" alt="AWS IAM" width="140">

![Etapa 2.3: Rol IAM creado](./imgs/Floci%20-%20Etapa%202.3%20-%20Rol%20IAM.png)

Toda función Lambda necesita un rol de ejecución, aunque no toque ningún otro servicio de AWS (es
un requisito del propio servicio Lambda: necesita saber "en nombre de quién" corre).

```bash
aws iam create-role \
  --role-name lambda-hello-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }' \
  --profile floci-local
```

> 💡 **¿Te tiró a una pantalla tipo vim?** Es normal — el AWS CLI manda las respuestas largas a un
> **pager** (`less`, casi siempre; se comporta parecido a `vim` porque también es modal y no
> devuelve la terminal hasta que salís). Para salir: apretá **`q`**. Si preferís que nunca haga esto
> y te devuelva el JSON directo en la terminal, agregá `--no-cli-pager` a cualquier comando, o
> desactivalo una sola vez para todo el perfil:
> ```bash
> aws configure set cli_pager "" --profile floci-local
> ```

**Explicación del JSON (la "trust policy"):**

- `"Effect": "Allow"` + `"Action": "sts:AssumeRole"`: se permite la acción de "asumir este rol".
- `"Principal": {"Service": "lambda.amazonaws.com"}`: **quién** puede asumirlo — en este caso,
  específicamente el servicio Lambda (no un usuario, no otra cuenta). Esto es lo que hace que este
  rol sea "para Lambda" y no para cualquier otra cosa.

El resultado incluye un **ARN** (Amazon Resource Name), un identificador único con el formato
`arn:aws:iam::000000000000:role/lambda-hello-role` — el `000000000000` es el "número de cuenta" que
usa Floci por defecto para credenciales dummy. Vas a necesitar este ARN en el siguiente paso.

> 🔀 **Diferencia con AWS real**
>
> | | Floci (lo que acabás de correr) | AWS real |
> |---|---|---|
> | Número de cuenta | `000000000000` (fijo, siempre igual) | tus 12 dígitos únicos (`aws sts get-caller-identity`) |
> | ARN resultante | `arn:aws:iam::000000000000:role/lambda-hello-role` | `arn:aws:iam::123456789012:role/lambda-hello-role` |
> | El resto del comando | idéntico | idéntico |

### Verificar que el rol se creó

Si el pager te tapó la salida o simplemente querés confirmarlo después, estos comandos te sirven
(y de paso son útiles para IAM en general, no solo hoy):

```bash
# Ver el detalle completo del rol (incluye ARN, trust policy, fecha de creación)
aws iam get-role --role-name lambda-hello-role --profile floci-local

# Traer solo el ARN, listo para copiar/pegar en el paso 2.4 (sin --no-cli-pager no hace falta, es una línea corta)
aws iam get-role --role-name lambda-hello-role --profile floci-local \
  --query 'Role.Arn' --output text

# Listar todos los roles que existen (útil para ver qué tenés creado, o si te olvidaste el nombre exacto)
aws iam list-roles --profile floci-local --query 'Roles[].RoleName' --output table

# Ver qué políticas tiene adjuntas el rol (en este punto, ninguna todavía — no le dimos ninguna)
aws iam list-attached-role-policies --role-name lambda-hello-role --profile floci-local
```

`--query` es una forma de decirle al CLI "de toda esta respuesta JSON, mostrame solo esta parte" —
muy útil para no tener que leer un JSON entero cuando solo necesitás un dato (como el ARN).
`--output table`/`--output text` cambian el formato de salida (tabla legible vs. texto plano, en vez
del JSON por defecto).

### 2.4 Publicar (crear) la función Lambda

<img src="./imgs/Icono%20-%20AWS%20Lambda.png" alt="AWS Lambda" width="140">

![Etapa 2.4-2.5: Lambda creada e invocada](./imgs/Floci%20-%20Etapa%202.4-2.5%20-%20Lambda%20invocada.png)

```bash
aws lambda create-function \
  --function-name hello-world \
  --runtime nodejs22.x \
  --role arn:aws:iam::000000000000:role/lambda-hello-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --profile floci-local
```

**Parámetros clave:**

| Parámetro | Qué significa |
|---|---|
| `--function-name` | Nombre lógico de tu función dentro de la cuenta/región |
| `--runtime nodejs22.x` | Qué motor de ejecución usar (determina la imagen de contenedor que se usará por debajo) |
| `--role` | El ARN del rol que creamos en el paso anterior |
| `--handler index.handler` | `archivo.función` — le dice a Lambda que busque la función exportada `handler` dentro de `index.js` |
| `--zip-file fileb://...` | El paquete de código. El prefijo `fileb://` indica "archivo binario" |

### Verificar que la función se creó correctamente

```bash
# Detalle completo: configuración + de dónde vino el código
aws lambda get-function --function-name hello-world --profile floci-local

# Solo la configuración (más liviano si no te interesa el código)
aws lambda get-function-configuration --function-name hello-world --profile floci-local

# Listar todas las funciones que tenés creadas en este Floci
aws lambda list-functions --profile floci-local --query 'Functions[].FunctionName' --output table
```

### 2.5 Invocar la función directamente (sin HTTP) para probar

Antes de exponerla por HTTP, conviene probarla con una invocación directa:

```bash
aws lambda invoke --function-name hello-world --profile floci-local salida.json
cat salida.json
```

Esto es una **invocación síncrona**: el CLI espera a que la función termine y guarda la respuesta
en `salida.json`. Si revisas los contenedores en ese momento (`docker ps`), vas a ver aparecer
brevemente un contenedor con imagen `public.ecr.aws/lambda/nodejs:22` — **esa es la prueba de que
Floci no está simulando nada: está usando el runtime real de Lambda**, la misma imagen que usa AWS
en producción, corriendo en tu propia máquina.

**Para ver el cold start vs. warm start (concepto de 1.6) con tus propios ojos**, medí el tiempo de
la primera invocación contra una segunda:

```bash
time aws lambda invoke --function-name hello-world --profile floci-local salida.json
time aws lambda invoke --function-name hello-world --profile floci-local salida.json
```

La primera corrida (cold start) va a tardar notablemente más — ahí Floci todavía tiene que levantar
el contenedor de Lambda. La segunda (warm start) debería ser bastante más rápida, porque el
contenedor ya estaba arriba.

### 2.6 Crear la Function URL (exponerla por HTTP)

![Etapa 2.6-2.7: Function URL + permiso](./imgs/Floci%20-%20Etapa%202.6-2.7%20-%20Function%20URL.png)

```bash
aws lambda create-function-url-config \
  --function-name hello-world \
  --auth-type NONE \
  --profile floci-local
```

`--auth-type NONE` significa "cualquiera con la URL puede invocarla, sin necesidad de credenciales
AWS". El comando devuelve un JSON con el campo `FunctionUrl`, algo como:

```
http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

> 🔀 **Diferencia con AWS real** — acá el comando es idéntico; lo que cambia es la URL resultante:
>
> | | Floci | AWS real |
> |---|---|---|
> | Dominio | `lambda-url.us-east-1.localhost:4566` | `lambda-url.us-east-1.on.aws` |
> | Protocolo | `http://` | `https://` (siempre) |
> | Ejemplo completo | `http://<id>.lambda-url.us-east-1.localhost:4566/` | `https://<id>.lambda-url.us-east-1.on.aws/` |
>
> El `.localhost:4566` es pura convención de Floci para poder resolver la URL en tu propia máquina
> sin configurar DNS (ver 2.8).

> ⚠️ **Si cambiaste el puerto host en 1.1** (por el conflicto con el túnel SSH): esta URL va a decir
> `:4566` **siempre**, sin importar qué puerto host hayas elegido — Floci, puertas adentro, no sabe
> que lo remapeaste. No es un error ni es la URL de otro Floci: reemplazá `:4566` por tu puerto real
> (`:4567` en el ejemplo de esa nota) antes de usarla en el paso 2.8.

### Verificar la Function URL sin tener que recrearla

Si necesitás volver a ver la URL o el `AuthType` configurado (por ejemplo, si cerraste la terminal y
perdiste la salida del comando anterior), no hace falta correr `create-function-url-config` de
nuevo:

```bash
aws lambda get-function-url-config --function-name hello-world --profile floci-local
```

O, si solo te interesa la URL (sin el resto del JSON) para copiarla directo al `curl` del 2.8:

```bash
aws lambda get-function-url-config --function-name hello-world --profile floci-local \
  --query FunctionUrl --output text
```

### 2.7 Dar permiso explícito de invocación pública

Aunque configuraste `AuthType: NONE`, Lambda todavía requiere un **permiso basado en recurso** que
autorice explícitamente la invocación pública (esta es una capa de seguridad separada,
deliberadamente redundante en el diseño real de AWS):

```bash
aws lambda add-permission \
  --function-name hello-world \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --profile floci-local
```

`--principal "*"` = "cualquier identidad puede invocar". Esto es exactamente el segundo tipo de
política que mencionamos en la sección de conceptos (1.7): una política **basada en el recurso**
(se adjunta a la función, no a un usuario).

### Verificar el permiso

La política basada en recurso que acabás de agregar se puede consultar en cualquier momento — muy
útil si `add-permission` te tira `ResourceConflictException` (ver tabla de problemas comunes) y
querés confirmar si el permiso ya existía de una corrida anterior:

```bash
aws lambda get-policy --function-name hello-world --profile floci-local
```

Te devuelve un JSON donde el campo `Policy` es, a su vez, un string con la política completa
(`Effect`, `Principal`, `Action`, el `Sid` que le pusiste con `--statement-id`, etc.) — el mismo
formato de política basada en recurso que mencionamos en el concepto 1.7.

### 2.8 Probar el Hello World

Abre en el navegador (o con `curl`) la URL que te devolvió el paso 2.6:

```bash
curl http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

Deberías ver el HTML "Hello World" devuelto por tu función. El dominio `.localhost` al final es
clave: la mayoría de sistemas operativos y navegadores modernos resuelven automáticamente cualquier
subdominio de `.localhost` hacia `127.0.0.1`, así que no necesitas configurar DNS ni ningún túnel —
todo esto vive en tu propia máquina.

### Verificar la respuesta completa (no solo el body)

Si querés confirmar que también el `statusCode` y los `headers` que definiste en el `index.js`
(paso 2.1) llegaron bien — no solo el HTML — pedile a `curl` que muestre también la respuesta HTTP
completa:

```bash
curl -i http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

`-i` (*include*) agrega el status line y los headers de respuesta antes del body. Deberías ver
`HTTP/1.1 200 OK` y `Content-Type: text/html; charset=utf-8` — exactamente lo que devuelve tu
`exports.handler`, viajando intacto a través de Floci hasta `curl`.

**Felicitaciones: acabas de desplegar e invocar tu primera función Lambda, expuesta por HTTP,
corriendo en un runtime real de AWS, sin gastar un centavo, sin cuenta de AWS, y sin salir de tu
propia computadora.**

---

## ETAPA 3 — Limpieza

Dejar el entorno limpio después de practicar te permite repetir el ejercicio desde cero las veces
que quieras, sin arrastrar recursos de una corrida anterior que puedan confundirte.

```bash
# Borrar el permiso y la Function URL no hace falta explícitamente: se van con la función
aws lambda delete-function --function-name hello-world --profile floci-local
aws iam delete-role --role-name lambda-hello-role --profile floci-local
```

Y para apagar Floci por completo (borra también los datos del volumen `./data`):

```bash
docker compose down -v
```

Si en cambio solo querés pausarlo para retomar después sin perder los datos (buckets, funciones ya
creadas), usá `docker compose stop` en vez de `down -v`.

---

## 7. Problemas comunes y cómo resolverlos

| Síntoma | Causa probable | Solución |
|---|---|---|
| `command not found: aws` | AWS CLI no instalado | Instalar AWS CLI v2 oficial |
| `command not found: docker` | Docker Desktop no instalado, o no agregado al PATH de tu shell (típico en WSL2 si Docker Desktop no tiene la integración con tu distro habilitada) | Instalar Docker Desktop y habilitar "WSL Integration" para tu distro en Settings → Resources → WSL Integration |
| Puerto 4566 ya está en uso, `docker compose up` falla con `ports are not available` / `Only one usage of each socket address...` (Windows) o `address already in use` (Linux/Mac) | Otro proceso local ya lo está usando — revisá primero `docker ps -a` (¿otro contenedor Floci/LocalStack de otro proyecto?) y, muy probable si trabajás con este repo, **el túnel SSH persistente hacia el VPS** (`floci-tunnel.service`), que también reserva `127.0.0.1:4566` en tu máquina | Si es el túnel al VPS: no lo toques, cambiá el puerto de este Floci local (ver nota en 1.1, ej. `4567:4566`). Si es otro contenedor: `docker ps -a` para identificarlo y `lsof -i :4566` / `ss -tlnp \| grep 4566` (Linux/Mac) o `netstat -ano \| findstr :4566` (PowerShell) para confirmar qué proceso lo tiene |
| `aws s3 ls --profile floci-local` (o cualquier otro comando) muestra recursos que vos no creaste (ej. buckets de otro proyecto) | El `endpoint_url` del perfil `floci-local` quedó en `4566` en vez del puerto real de tu Docker local (ver nota de verificación en 1.5) — como el túnel al VPS también vive en `4566`, tu CLI termina hablándole al Floci del VPS sin que te des cuenta | `aws configure get endpoint_url --profile floci-local` para confirmar, y `aws configure set endpoint_url http://localhost:<tu-puerto> --profile floci-local` para corregirlo. Cualquier recurso que hayas creado por error mientras tanto quedó en el Floci del VPS, no en el local — se puede borrar con `--profile floci` (el del VPS) si hace falta prolijidad |
| `Lambda.InitError: No such image` | Docker no tiene en caché `public.ecr.aws/lambda/nodejs:22` | `docker pull public.ecr.aws/lambda/nodejs:22` (ver paso 1.2, que lo previene desde el inicio) |
| Lambda nunca arranca / se queda colgada, sin mensaje de error claro | Docker Desktop tiene muy poca memoria asignada | Settings → Resources → subí el límite de RAM (4 GB o más recomendado) |
| `aws lambda invoke` falla pero Floci está `healthy` | El nombre de la red Docker en `FLOCI_SERVICES_DOCKER_NETWORK` no coincide con la red real que creó Compose | `docker network ls` y ajustar la variable de entorno para que coincida exactamente (ver nota en 1.1), luego `docker compose up -d` de nuevo |
| Descarga de imágenes muy lenta o falla | Proxy/firewall corporativo bloqueando Docker Hub o `public.ecr.aws` | Configurar el proxy de Docker Desktop (Settings → Resources → Proxies), o probar desde una red sin restricciones |
| En Windows, los volúmenes no se montan o Docker tira error de permisos | La carpeta del proyecto no está compartida con Docker Desktop, o estás corriendo los comandos fuera de WSL2 | Verificar en Settings → Resources → File sharing que la unidad esté habilitada, y preferir correr todo dentro de una distro WSL2 en vez de PowerShell/CMD |
| `curl: (7) Failed to connect` al probar Floci | El contenedor no está corriendo, o se cayó | `docker ps --filter "name=floci"` y revisar `docker compose logs floci` |
| `docker ps` no muestra nada, pero `docker ps -a` sí muestra el contenedor en estado `Created` (nunca `Up`, sin logs) | El `docker compose up` anterior se interrumpió antes de llegar a arrancarlo (terminal cerrada, Ctrl+C, corte de red bajando la imagen, etc.) — quedó creado pero nunca se ejecutó `start` | `docker compose down` (borra el contenedor a medio crear) y `docker compose up -d` de nuevo |
| `An error occurred (AccessDenied)` al invocar la Function URL | Falta el `add-permission` del paso 2.7 | Ejecutar el comando de permiso de nuevo |
| `An error occurred (ResourceConflictException)` al correr `add-permission` | Ya existe un permiso con ese mismo `--statement-id` (por ejemplo, corriste el paso 2.7 dos veces) | No es un error real — el permiso ya está puesto. Confirmalo con `aws lambda get-policy --function-name hello-world --profile floci-local` en vez de reintentar `add-permission` |
| No copiaste/perdiste la Function URL del paso 2.6 y no sabés cómo probar el 2.8 | Cerraste la terminal, se scrolleó la salida, etc. | No hace falta recrearla: `aws lambda get-function-url-config --function-name hello-world --profile floci-local --query FunctionUrl --output text` te la devuelve tal cual, lista para pegar en el `curl` |
| La Function URL dice `:4566` aunque configuraste otro puerto host (ej. `4567`) — parece la URL de "otro" Floci | Cambiaste el puerto host en 1.1, pero Floci (puertas adentro del contenedor) sigue escuchando en `4566` y no sabe del remapeo — genera la URL con su propio puerto, no con el tuyo | No es un error: reemplazá `:4566` por tu puerto host real en la URL antes de usarla (`endpoint_url` del perfil sí queda en tu puerto real, esto solo afecta URLs que Floci te devuelve) |

---

## 8. Qué aprendiste

Al completar esta guía, ya manejas (a nivel práctico) estos conceptos de AWS:

- [x] Qué es un servicio en la nube y por qué existen los emuladores para aprender/desarrollar.
- [x] Cómo funciona el AWS CLI y el concepto de "endpoint" y "perfil".
- [x] Qué es IAM: roles, políticas de confianza, políticas basadas en recurso vs. identidad.
- [x] Qué es Lambda: handler, runtime, packaging, invocación síncrona.
- [x] Qué es una Function URL y la diferencia entre `AuthType NONE` y `AWS_IAM`.
- [x] El patrón de respuesta HTTP de una Lambda (Proxy Integration): `statusCode`/`headers`/`body`.
- [x] Nociones de Docker/Docker Compose y el patrón Docker-out-of-Docker, todo en tu propia máquina.

---

## 9. Glosario

- **ARN (Amazon Resource Name)**: identificador único de cualquier recurso en AWS, con formato
  `arn:aws:servicio:región:cuenta:recurso`.
- **Bucket**: unidad de almacenamiento de nivel superior en S3 (similar a una carpeta raíz).
- **Cold start**: demora inicial al invocar una Lambda que no tenía un contenedor "tibio" listo.
- **Endpoint**: URL a la que un cliente (SDK/CLI) envía sus peticiones para un servicio.
- **Handler**: función de entrada de una Lambda.
- **IAM**: servicio de gestión de identidades y permisos de AWS.
- **Perfil (AWS CLI profile)**: conjunto de configuración con nombre (credenciales, región,
  endpoint).
- **Policy (política)**: documento JSON que define permisos.
- **Role (rol)**: identidad no humana que un servicio puede "asumir".
- **Runtime**: entorno de ejecución de una función Lambda (lenguaje + versión).
- **Trust policy (política de confianza)**: define quién puede asumir un rol.

---

## 10. Próximos pasos

- **Si querés compartir esto con otras personas** (que puedan acceder sin tener Docker instalado
  ellos mismos), el siguiente paso es desplegar este mismo proyecto en un servidor remoto (VPS) —
  ver [`GUIA-PASO-A-PASO.md`](./GUIA-PASO-A-PASO.md), que asume que ya entendiste los conceptos de
  esta guía y se enfoca solo en la diferencia (túnel SSH, exposición pública).
- **Si querés seguir aprendiendo AWS con este mismo entorno local**, el siguiente nivel es construir
  el **Quiz con sistema de ranking** (aprovisionar una base de datos RDS emulada, conectar Lambdas a
  ella, exponer un frontend) — el mismo enfoque didáctico de esta guía se aplica ahí, con conceptos
  nuevos como RDS y diseño de esquemas.
