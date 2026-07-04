# Guía paso a paso: AWS local con Floci + Lambda "Hello World"

**Nivel:** Desarrollador Junior — sin experiencia previa en AWS.
**Objetivo de este documento:** que puedas instalar un emulador de AWS en un servidor (VPS) usando Docker, y desplegar tu primera función Lambda con una página "Hello World", entendiendo **qué hace cada paso y por qué**, no solo copiando comandos.

Este documento acompaña a [`plataforma/PLAN.md`](../../../plataforma/PLAN.md) (que registra el análisis de factibilidad y el historial real de lo implementado a nivel de plataforma). Aquí el foco es **enseñar**, paso a paso, como si fuera tu primer contacto con AWS.

---

## Índice

1. [Conceptos previos que necesitas entender](#1-conceptos-previos-que-necesitas-entender)
2. [Arquitectura de la solución](#2-arquitectura-de-la-solución)
3. [Prerrequisitos](#3-prerrequisitos)
4. [ETAPA 1 — Instalar Floci con Docker](#etapa-1--instalar-floci-con-docker)
5. [ETAPA 2 — Lambda "Hello World"](#etapa-2--lambda-hello-world)
6. [Problemas comunes y cómo resolverlos](#6-problemas-comunes-y-cómo-resolverlos)
7. [Qué aprendiste](#7-qué-aprendiste)
8. [Glosario](#8-glosario)
9. [Próximos pasos](#9-próximos-pasos)

---

## 1. Conceptos previos que necesitas entender

Antes de tocar un solo comando, es importante que entiendas el "por qué" detrás de cada pieza. Si ya conoces algo de esto, puedes saltarlo.

### 1.1 ¿Qué es "la nube" y qué es AWS?

Cuando una empresa usa "la nube", en el fondo está alquilando computadoras, almacenamiento y servicios ya construidos (bases de datos, colas de mensajes, ejecución de código) en los centros de datos de un proveedor — en vez de comprar y mantener sus propios servidores. **AWS (Amazon Web Services)** es el proveedor de nube más grande, y ofrece cientos de "servicios" (S3 para archivos, Lambda para ejecutar código, RDS para bases de datos, etc.), cada uno con su propia API.

Para usar AWS real necesitas: una cuenta, una tarjeta de crédito (te cobran por uso), y credenciales (claves) para autenticarte. Eso es una barrera de entrada grande para aprender — **por eso usamos un emulador**.

### 1.2 ¿Qué es un "emulador de nube" y por qué usamos Floci?

Un emulador de nube es un programa que **imita el comportamiento de los servicios de AWS** en tu propia máquina (o tu propio servidor), respondiendo exactamente igual que la AWS real a las mismas llamadas de API, pero sin cuenta, sin costo, y sin tocar infraestructura real.

**Floci** es uno de estos emuladores (de código abierto y gratuito). Lo importante que debes saber:

- Corre como un contenedor Docker, escuchando en el puerto **4566**.
- Cuando le hablas con el AWS CLI real (el mismo que usarías contra AWS de verdad), Floci responde imitando el servicio que le pediste.
- Para algunos servicios (Lambda, RDS, ECS, entre otros), Floci no "finge" la respuesta: **levanta contenedores Docker reales** que ejecutan el motor real (por ejemplo, la imagen oficial de AWS Lambda para Node.js). Esto se llama **Docker-out-of-Docker**: el contenedor de Floci usa el Docker del servidor "anfitrión" (host) para crear contenedores hermanos.
- Para otros servicios (S3, DynamoDB, SNS, SQS, IAM), Floci reimplementa el protocolo en memoria — es una imitación fiel, pero no el motor real.

Esta distinción importa porque **para aprender Lambda de verdad, Floci te da el motor real** — el mismo container runtime que usa AWS en producción.

### 1.3 ¿Qué es Docker y Docker Compose? (repaso rápido)

- Una **imagen Docker** es un paquete con todo lo necesario para correr un programa (código, dependencias, sistema de archivos mínimo).
- Un **contenedor** es una instancia en ejecución de una imagen — aislado del resto del sistema, pero compartiendo el kernel del sistema operativo del host (más liviano que una máquina virtual completa).
- **Docker Compose** es una herramienta para describir, en un archivo `docker-compose.yml`, uno o más contenedores (servicios), sus puertos, volúmenes y variables de entorno, y levantarlos todos juntos con un solo comando.

### 1.4 AWS CLI y el concepto de "endpoint"

El **AWS CLI** es la herramienta de línea de comandos oficial de Amazon para hablar con cualquier servicio de AWS. Normalmente, cuando ejecutas `aws s3 ls`, el CLI construye una petición HTTP y la envía a una URL real de Amazon (por ejemplo `https://s3.us-east-1.amazonaws.com`).

El truco para usar un emulador es decirle al CLI: **"en vez de hablarle a Amazon de verdad, habla con esta otra URL"** — eso se llama sobreescribir el **endpoint**. Como Floci escucha en `http://localhost:4566`, configuramos el CLI para que apunte ahí. El CLI no sabe (ni le importa) que no es la AWS real: manda exactamente las mismas peticiones.

### 1.5 Credenciales, perfiles y por qué usamos claves "falsas"

AWS real exige un `AWS_ACCESS_KEY_ID` y un `AWS_SECRET_ACCESS_KEY` (como un usuario y contraseña) para cada petición. Floci **no valida credenciales reales** — acepta cualquier valor no vacío (por convención, se usa la palabra `test` para ambas). Aun así, hay que configurarlas, porque el CLI se niega a funcionar sin ellas.

Un **perfil** de AWS CLI (`~/.aws/config` y `~/.aws/credentials`) es un conjunto de configuración con nombre (región, credenciales, endpoint) que puedes seleccionar con `--profile nombre`, sin pisar tu configuración real de AWS si algún día la tienes.

### 1.6 Túnel SSH: cómo trabajar "en local" contra un servidor remoto

Como Floci corre en un VPS (un servidor remoto) y no en tu propia laptop, pero queremos trabajar "como si fuera local" **sin exponer el puerto 4566 a todo internet** (Floci no tiene autenticación real, así que sería peligroso exponerlo), usamos un **túnel SSH**:

```
tu-computador:4566  ──(túnel cifrado por SSH)──►  VPS:4566 (donde vive Floci)
```

El comando `ssh -L 4566:localhost:4566 usuario@vps` le dice a SSH: "todo lo que llegue al puerto 4566 de mi computador, reenvíalo (de forma cifrada) al puerto 4566 del VPS". Así, tu AWS CLI local habla con `http://localhost:4566` sin saber que en realidad está cruzando internet hasta el VPS.

### 1.7 ¿Qué es AWS Lambda?

Lambda es el servicio de **"serverless computing"** (cómputo sin servidor) de AWS: le das tu código (una función) y AWS se encarga de todo lo demás — levantar el entorno de ejecución, escalar, y cobrarte solo por el tiempo que tu código corrió.

Conceptos clave de Lambda que vas a usar en este documento:

- **Handler**: la función específica de tu código que Lambda invoca cuando llega un evento. En Node.js se ve así: `exports.handler = async (event, context) => {...}`.
- **Runtime**: el entorno de ejecución (por ejemplo `nodejs22.x`, `python3.13`). Determina qué lenguaje/versión ejecuta tu función.
- **Event**: el objeto de entrada que recibe tu función (por ejemplo, los datos de una petición HTTP si viene de una Function URL o API Gateway).
- **Execution Role (rol de ejecución)**: un rol de IAM que Lambda "asume" para ejecutar tu función con ciertos permisos (por ejemplo, permiso para escribir logs, leer de una base de datos, etc.). Toda función Lambda necesita uno, aunque no use ningún otro servicio.
- **Cold start**: la primera vez que se invoca una función (o después de un tiempo sin uso), Lambda tiene que levantar el contenedor desde cero, lo que toma más tiempo que invocaciones posteriores ("warm").

### 1.8 IAM: roles y políticas (lo mínimo que necesitas saber)

**IAM (Identity and Access Management)** es el servicio de permisos de AWS. Dos conceptos que vas a usar:

- **Rol (Role)**: una identidad que no es una persona, sino que la "asume" un servicio (en nuestro caso, Lambda) para actuar en tu cuenta. Un rol tiene una **política de confianza** (trust policy) que dice *quién* puede asumirlo (`"Principal": {"Service": "lambda.amazonaws.com"}` = "el servicio Lambda puede asumir este rol").
- **Política (Policy)**: un documento JSON que dice *qué* acciones están permitidas o denegadas sobre qué recursos. Hay dos "sabores" que vas a ver en este documento:
  - **Basada en identidad**: se adjunta a un usuario/rol ("este rol puede hacer X").
  - **Basada en recurso**: se adjunta al recurso mismo ("este recurso permite que X lo invoque") — esto es exactamente lo que usamos para permitir que cualquiera invoque nuestra Function URL sin credenciales.

### 1.9 Function URL: la forma más simple de exponer una Lambda en HTTP

Una **Function URL** es una URL HTTPS pública que invoca directamente tu función Lambda, sin necesidad de configurar un API Gateway completo (que es más potente pero también más complejo: rutas, stages, autorización, etc.). Es la forma más simple de decir "quiero que mi función responda a peticiones HTTP".

- `AuthType NONE`: cualquiera con la URL puede invocar la función (lo que usamos para nuestro Hello World público).
- `AuthType AWS_IAM`: solo quien tenga credenciales AWS válidas y permiso puede invocarla (lo normal en producción para endpoints privados).

---

## 2. Arquitectura de la solución

![Arquitectura: Floci (emulador AWS) + Lambda Hello World](./imgs/Arquitectura%20Floci%20+%20Lambda%20Hello%20World.png)

El diagrama muestra el flujo completo: tu computador (AWS CLI + navegador) conectando por túnel SSH al VPS de Hostinger, el contenedor de Floci (con acceso a `/var/run/docker.sock`), la función Lambda con su rol IAM, la Function URL como punto de entrada HTTP, y el contenedor real y efímero que Lambda crea bajo demanda (`public.ecr.aws/lambda/nodejs:22`).

Versión editable en Lucidchart: [Arquitectura Floci + Lambda Hello World](https://lucid.app/lucidchart/7a80e71d-d0ea-489c-be55-ba8a28382175/edit)

---

## 3. Prerrequisitos

- Un VPS Linux con Docker y Docker Compose instalados (en nuestro caso, Ubuntu 24.04 con Docker, plan Hostinger KVM 4).
- Acceso SSH al VPS (usuario con permisos para administrar Docker).
- En tu computador: cliente SSH (viene por defecto en Linux/Mac/WSL; en Windows puedes usar el de OpenSSH o PuTTY).
- Conocimientos mínimos de terminal/bash.

---

## ETAPA 1 — Instalar Floci con Docker

### 1.1 Crear el archivo `docker-compose.yml`

Crea una carpeta para el proyecto en el VPS (por ejemplo `/docker/floci/`) y dentro un archivo `docker-compose.yml`:

```yaml
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
      FLOCI_SERVICES_DOCKER_NETWORK: floci_default
```

**Explicación línea por línea:**

| Línea | Qué hace | Por qué importa |
|---|---|---|
| `image: floci/floci:latest` | Descarga la imagen oficial de Floci desde Docker Hub | Es el emulador en sí |
| `restart: unless-stopped` | Si el VPS se reinicia, Docker vuelve a levantar el contenedor solo | Para no perder el entorno tras un reinicio del servidor |
| `ports: "127.0.0.1:4566:4566"` | Mapea el puerto 4566 del contenedor al puerto 4566 del VPS, **pero solo accesible desde el propio VPS** (`127.0.0.1`, no `0.0.0.0`) | **Seguridad**: Floci no tiene autenticación real: si esto fuera `0.0.0.0:4566:4566`, cualquiera en internet podría controlar tu Docker |
| `volumes: ./data:/app/data` | Guarda los datos de Floci (buckets S3, tablas DynamoDB, etc.) en una carpeta del VPS | Así los datos sobreviven si el contenedor se reinicia |
| `volumes: /var/run/docker.sock:/var/run/docker.sock` | Le da a Floci acceso al Docker del VPS (Docker-out-of-Docker) | **Imprescindible** para que Lambda, RDS y otros servicios "reales" funcionen |
| `environment: FLOCI_SERVICES_DOCKER_NETWORK` | Le dice a Floci en qué red Docker debe conectar los contenedores que crea (Lambda, etc.) | Para que esos contenedores puedan comunicarse correctamente con Floci |

> ⚠️ **Nota de seguridad importante**: montar `docker.sock` le da al contenedor de Floci control total sobre el Docker del host (equivalente a acceso root). Es razonable en un VPS personal de desarrollo, siempre que el puerto 4566 **nunca** se exponga públicamente.

### 1.2 Levantar el contenedor

Desde la carpeta donde está el `docker-compose.yml`:

```bash
docker compose up -d
```

`-d` significa *detached*: corre en segundo plano y te devuelve la terminal.

### 1.3 Verificar que está corriendo

```bash
docker ps --filter "name=floci"
```

Deberías ver un contenedor en estado `Up ... (healthy)`.

Luego, probamos el **health check** (endpoint que reporta el estado de cada servicio emulado):

```bash
curl http://127.0.0.1:4566/_localstack/health
```

La respuesta es un JSON con una lista de servicios y su estado (`"running"`). Si ves `"lambda": "running"` y `"rds": "running"`, el socket de Docker quedó bien configurado.

### 1.4 Configurar el túnel SSH desde tu computador

Desde tu computador (no desde el VPS):

```bash
ssh -f -N -L 4566:localhost:4566 usuario@ip-del-vps
```

- `-f`: corre en segundo plano.
- `-N`: no ejecutes ningún comando remoto, solo redirige el puerto.
- `-L 4566:localhost:4566`: redirige el puerto 4566 local hacia el puerto 4566 del VPS (visto desde el propio VPS, por eso `localhost`).

Verifica que el túnel esté escuchando:

```bash
ss -tlnp | grep 4566   # Linux
# o: lsof -i :4566      # Mac
```

### 1.5 Instalar y configurar AWS CLI en tu computador

Instala AWS CLI v2 (instrucciones oficiales de Amazon según tu sistema operativo). Luego crea un perfil dedicado para no mezclarlo con una cuenta AWS real que puedas tener:

```bash
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

Esto crea/edita `~/.aws/config` y `~/.aws/credentials` con un perfil llamado `floci`.

### 1.6 Prueba de humo

```bash
aws s3 mb s3://floci-smoke-test --profile floci
aws s3 ls --profile floci
```

Si ves el bucket listado, **Floci está funcionando de punta a punta**: tu AWS CLI real, hablando con un emulador en un VPS remoto, a través de un túnel cifrado, respondiendo igual que la AWS real.

*(Un "bucket" en S3 es, en términos simples, una carpeta raíz de almacenamiento de archivos. `mb` = "make bucket".)*

---

## ETAPA 2 — Lambda "Hello World"

Esta es la parte más rica en conceptos. Vamos a crear, paso a paso, una función Lambda real (ejecutándose en un contenedor Docker auténtico de AWS Lambda) que responde "Hello World" por HTTP.

### 2.1 Escribir el código de la función

Crea una carpeta `lambda/` dentro de la carpeta del proyecto (en nuestro caso `proyectos/hello-world/lambda/`) con un archivo `index.js`:

```javascript
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: "<html><body><h1>Hello World</h1><p>Servido desde Lambda emulado por Floci.</p></body></html>"
  };
};
```

**¿Por qué la respuesta tiene esta forma exacta (`statusCode`, `headers`, `body`)?**

Cuando una Lambda se invoca a través de HTTP (Function URL o API Gateway), AWS espera que el objeto devuelto tenga esta estructura específica, para poder traducirlo en una respuesta HTTP real. Si solo devolvieras un string o un objeto sin esta forma, el navegador recibiría un error o una respuesta mal formada. Este patrón se llama **Lambda Proxy Integration**.

### 2.2 Empaquetar el código en un `.zip`

AWS Lambda no recibe el código como una carpeta suelta: espera un **paquete de despliegue**, normalmente un `.zip` con el código y sus dependencias.

```bash
cd proyectos/hello-world/lambda
zip -r function.zip index.js
```

### 2.3 Crear el rol de IAM que la función va a "asumir"

Toda función Lambda necesita un rol de ejecución, aunque no toque ningún otro servicio de AWS (es un requisito del propio servicio Lambda: necesita saber "en nombre de quién" corre).

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
  --profile floci
```

**Explicación del JSON (la "trust policy"):**

- `"Effect": "Allow"` + `"Action": "sts:AssumeRole"`: se permite la acción de "asumir este rol".
- `"Principal": {"Service": "lambda.amazonaws.com"}`: **quién** puede asumirlo — en este caso, específicamente el servicio Lambda (no un usuario, no otra cuenta). Esto es lo que hace que este rol sea "para Lambda" y no para cualquier otra cosa.

El resultado incluye un **ARN** (Amazon Resource Name), un identificador único con el formato `arn:aws:iam::000000000000:role/lambda-hello-role` — el `000000000000` es el "número de cuenta" que usa Floci por defecto para credenciales dummy. Vas a necesitar este ARN en el siguiente paso.

### 2.4 Publicar (crear) la función Lambda

```bash
aws lambda create-function \
  --function-name hello-world \
  --runtime nodejs22.x \
  --role arn:aws:iam::000000000000:role/lambda-hello-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --profile floci
```

**Parámetros clave:**

| Parámetro | Qué significa |
|---|---|
| `--function-name` | Nombre lógico de tu función dentro de la cuenta/región |
| `--runtime nodejs22.x` | Qué motor de ejecución usar (determina la imagen de contenedor que se usará por debajo) |
| `--role` | El ARN del rol que creamos en el paso anterior |
| `--handler index.handler` | `archivo.función` — le dice a Lambda que busque la función exportada `handler` dentro de `index.js` |
| `--zip-file fileb://...` | El paquete de código. El prefijo `fileb://` indica "archivo binario" |

### 2.5 Invocar la función directamente (sin HTTP) para probar

Antes de exponerla por HTTP, conviene probarla con una invocación directa:

```bash
aws lambda invoke --function-name hello-world --profile floci salida.json
cat salida.json
```

Esto es una **invocación síncrona**: el CLI espera a que la función termine y guarda la respuesta en `salida.json`. Si revisas los contenedores del VPS en ese momento (`docker ps`), vas a ver aparecer brevemente un contenedor con imagen `public.ecr.aws/lambda/nodejs:22` — **esa es la prueba de que Floci no está simulando nada: está usando el runtime real de Lambda**, la misma imagen que usa AWS en producción.

### 2.6 Crear la Function URL (exponerla por HTTP)

```bash
aws lambda create-function-url-config \
  --function-name hello-world \
  --auth-type NONE \
  --profile floci
```

`--auth-type NONE` significa "cualquiera con la URL puede invocarla, sin necesidad de credenciales AWS". El comando devuelve un JSON con el campo `FunctionUrl`, algo como:

```
http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

### 2.7 Dar permiso explícito de invocación pública

Aunque configuraste `AuthType: NONE`, Lambda todavía requiere un **permiso basado en recurso** que autorice explícitamente la invocación pública (esta es una capa de seguridad separada, deliberadamente redundante en el diseño real de AWS):

```bash
aws lambda add-permission \
  --function-name hello-world \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --profile floci
```

`--principal "*"` = "cualquier identidad puede invocar". Esto es exactamente el segundo tipo de política que mencionamos en la sección de conceptos (1.8): una política **basada en el recurso** (se adjunta a la función, no a un usuario).

### 2.8 Probar el Hello World

Con el túnel SSH activo, abre en el navegador (o con `curl`) la URL que te devolvió el paso 2.6:

```bash
curl http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

Deberías ver el HTML "Hello World" devuelto por tu función. El dominio `.localhost` al final es clave: la mayoría de sistemas operativos y navegadores modernos resuelven automáticamente cualquier subdominio de `.localhost` hacia `127.0.0.1`, así que no necesitas configurar DNS — y como el túnel SSH ya está reenviando el puerto 4566, la petición llega hasta tu Lambda en el VPS.

**Felicitaciones: acabas de desplegar e invocar tu primera función Lambda, expuesta por HTTP, corriendo en un runtime real de AWS, sin gastar un centavo ni tener cuenta de AWS.**

---

## 6. Problemas comunes y cómo resolverlos

| Síntoma | Causa probable | Solución |
|---|---|---|
| `command not found: aws` | AWS CLI no instalado | Instalar AWS CLI v2 oficial |
| El túnel SSH se cierra solo | Conexión inestable o timeout | Agregar `-o ServerAliveInterval=30` al comando `ssh` |
| `curl: (7) Failed to connect` al probar Floci | El túnel no está activo, o Floci no está corriendo | Verificar `docker ps` en el VPS y que el túnel siga vivo |
| `An error occurred (AccessDenied)` al invocar la Function URL | Falta el `add-permission` del paso 2.7 | Ejecutar el comando de permiso de nuevo |
| Lambda no arranca / RDS no funciona | Falta el montaje de `/var/run/docker.sock` | Revisar el `docker-compose.yml` de Floci |
| "REMOTE HOST IDENTIFICATION HAS CHANGED" al hacer SSH | El VPS fue reinstalado/restaurado desde backup (regenera las claves del host) | Verificar por un canal confiable (panel del proveedor) que el cambio es legítimo antes de aceptar la nueva clave |
| Puerto 4566 ocupado | Otro proceso usando ese puerto | Verificar con `ss -tlnp \| grep 4566` y detener el proceso conflictivo, o cambiar el puerto |

---

## 7. Qué aprendiste

Al completar esta guía, ya manejas (a nivel práctico) estos conceptos de AWS:

- [x] Qué es un servicio en la nube y por qué existen los emuladores para aprender/desarrollar.
- [x] Cómo funciona el AWS CLI y el concepto de "endpoint" y "perfil".
- [x] Qué es IAM: roles, políticas de confianza, políticas basadas en recurso vs. identidad.
- [x] Qué es Lambda: handler, runtime, packaging, invocación síncrona.
- [x] Qué es una Function URL y la diferencia entre `AuthType NONE` y `AWS_IAM`.
- [x] El patrón de respuesta HTTP de una Lambda (Proxy Integration): `statusCode`/`headers`/`body`.
- [x] Cómo exponer un servicio remoto de forma segura con un túnel SSH, sin abrir puertos a internet.
- [x] Nociones de Docker/Docker Compose y el patrón Docker-out-of-Docker.

---

## 8. Glosario

- **ARN (Amazon Resource Name)**: identificador único de cualquier recurso en AWS, con formato `arn:aws:servicio:región:cuenta:recurso`.
- **Bucket**: unidad de almacenamiento de nivel superior en S3 (similar a una carpeta raíz).
- **Cold start**: demora inicial al invocar una Lambda que no tenía un contenedor "tibio" listo.
- **Endpoint**: URL a la que un cliente (SDK/CLI) envía sus peticiones para un servicio.
- **Handler**: función de entrada de una Lambda.
- **IAM**: servicio de gestión de identidades y permisos de AWS.
- **Perfil (AWS CLI profile)**: conjunto de configuración con nombre (credenciales, región, endpoint).
- **Policy (política)**: documento JSON que define permisos.
- **Role (rol)**: identidad no humana que un servicio puede "asumir".
- **Runtime**: entorno de ejecución de una función Lambda (lenguaje + versión).
- **Trust policy (política de confianza)**: define quién puede asumir un rol.

---

## 9. Próximos pasos

Con Floci y tu primera Lambda funcionando, el siguiente nivel (documentado como Fase 6 en [`plataforma/PLAN.md`](../../../plataforma/PLAN.md)) es construir el **Quiz con sistema de ranking**, como un nuevo proyecto independiente en `proyectos/quiz/` (con su propia carpeta `docs/`, siguiendo la misma convención que este proyecto):

1. Aprovisionar una base de datos RDS (Postgres) emulada por Floci.
2. Diseñar el esquema (usuarios, puntajes).
3. Conectar una Lambda (o backend en contenedor) a esa base de datos.
4. Exponer el frontend del Quiz, reutilizando la infraestructura ya montada.

Ese siguiente documento (en `proyectos/quiz/docs/`) profundizará en conceptos nuevos: RDS, conexión a bases de datos desde Lambda, y diseño de esquemas — con el mismo enfoque didáctico de esta guía.
