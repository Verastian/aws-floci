# Guía paso a paso: Servicios avanzados de AWS para el Quiz Avanzado

**Nivel:** continuación de [`proyectos/quiz/docs/GUIA-PASO-A-PASO.md`](../../quiz/docs/GUIA-PASO-A-PASO.md) (el original — este fork no tiene su propia copia, es el mismo código) — se asume que ya conoces Lambda, API Gateway, RDS, IAM básico y S3.

**Estado de este documento:** movido desde el `quiz` original el 2026-07-05 al crear este fork (ese archivo ya no existe ahí, para no tener dos copias de la misma verdad) — es el documento vigente para **toda** la documentación de servicios avanzados, de ambos proyectos. La sección 1 (nginx) documenta una implementación que ocurrió una sola vez, contra el `quiz` original, antes de que este fork existiera; las secciones 2-8 se completan **aquí**, contra `quiz-avanzado`, a medida que se ejecuta cada fase del [`PLAN-SERVICIOS-AVANZADOS.md`](./PLAN-SERVICIOS-AVANZADOS.md) de este proyecto.

---

## Índice

0. [Arquitectura inicial (punto de partida)](#0-arquitectura-inicial-punto-de-partida)
1. [nginx + DNS: exposición pública controlada](#1-nginx--dns-exposición-pública-controlada)
2. [CloudWatch: logs y métricas](#2-cloudwatch-logs-y-métricas)
3. [Secrets Manager + KMS: gestión de credenciales](#3-secrets-manager--kms-gestión-de-credenciales)
4. [CloudTrail: auditoría](#4-cloudtrail-auditoría)
5. [SNS + EventBridge/Scheduler: mensajería y eventos](#5-sns--eventbridgescheduler-mensajería-y-eventos)
6. [WAF: seguridad perimetral](#6-waf-seguridad-perimetral)
7. [CloudFormation: infraestructura como código](#7-cloudformation-infraestructura-como-código)
8. [Cognito: autenticación real](#8-cognito-autenticación-real)

---

## 0. Arquitectura inicial (punto de partida)

Antes de agregar cualquier servicio avanzado, así quedó `quiz-avanzado` el 2026-07-05, al crear el fork (ver "Contexto de este fork" en `PLAN-SERVICIOS-AVANZADOS.md`) — la misma arquitectura que el Quiz original, sin ningún servicio de este documento todavía:

![Arquitectura inicial de quiz-avanzado](./imgs/AWS-FLOCI%20-%20Arquitectura%20inicial%20quiz-avanzado.png)

Cinco piezas nada más: el bucket S3 sirve el sitio estático, la API Gateway enruta cada pedido a la Lambda que corresponde, y las 6 Lambdas hacen el trabajo real consultando RDS.

Cada Lambda tiene su propio rol IAM — pero, en este punto, ese rol solo tiene **Trust Policy** (define quién puede *asumir* el rol; en este caso, el servicio Lambda) y **ninguna Permission Policy** (qué puede *hacer* una vez asumido). Floci no la exigía para leer/escribir en RDS o S3. Ese detalle importa: es el "antes" que la sección 2 (CloudWatch) viene a cambiar.

Cada sección de este documento, a partir de acá, parte de esta misma arquitectura y le va agregando una pieza — no son diagramas aislados por servicio, sino capas sobre este mismo dibujo.

---

## 1. nginx + DNS: exposición pública controlada

### Concepto

Un error común al aprender la nube es pensar que un servicio de DNS (como Route 53) "expone" tu aplicación a internet. **No es así.**

Route 53 (o cualquier proveedor de DNS) solo administra un mapa de "el nombre `X` corresponde a la dirección IP `Y`" — es una guía telefónica, no una recepcionista. Quien **atiende** la petición cuando alguien realmente visita ese nombre es otra pieza completamente distinta: un servidor web, un balanceador de carga, un CDN, etc.

En este proyecto, esa pieza ya existe en tu VPS: `nginx-proxy-manager`, corriendo fuera de Floci, escuchando en los puertos 80/443.

Su trabajo es recibir la petición pública y decidir hacia dónde reenviarla (*reverse proxy*), además de manejar el certificado TLS (HTTPS).

> Dato curioso: Route 53 **sí** figura como `"running"` en el health check de Floci, así que se puede practicar la API (`aws route53 create-hosted-zone`, etc.). Pero esa emulación no tiene ningún efecto en el DNS público real — sirve para practicar comandos o probar plantillas de infraestructura, no para publicar nada.

### Por qué hay que tener cuidado

Floci **no implementa autenticación real** — acepta cualquier credencial de AWS. Mientras el puerto 4566 solo sea alcanzable por el túnel SSH, esto es seguro.

Si `nginx-proxy-manager` reenvía ese puerto **completo** hacia el público, cualquier persona en internet tendría control total sobre tu nube emulada (podría borrar el bucket S3, leer toda la base de datos vía las APIs de RDS Data, etc.).

**La mitigación:** nginx debe reenviar **solo** las rutas exactas que la aplicación necesita (el *website endpoint* de S3 y el path de la API Gateway), no el puerto completo. Cualquier otra ruta no configurada devuelve 404 directamente en nginx, sin llegar nunca a Floci.

### Cómo quedó implementado

✅ **Implementado el 2026-07-05, contra el Quiz original** (antes de que existiera este fork) — se documenta aquí porque, desde ese momento, `proyectos/quiz-avanzado/` es donde vive toda la documentación de servicios avanzados (ver nota de estado al inicio del documento). El Quiz original quedó accesible públicamente, con HTTPS real, sin depender del túnel SSH, en:

- Frontend: `https://floci.devera.cloud/site/quiz-frontend/`
- API: `https://floci.devera.cloud/restapis/f3744ef7e3/$default/_user_request_/{ruta}`

**Diseño elegido — genérico, no solo para un proyecto puntual.** En vez de reenviar únicamente las rutas exactas de un bucket/API concretos, se reenviaron dos **patrones** que sirven para cualquier servicio construido con la misma arquitectura (S3 estático + API Gateway), sin tener que volver a tocar la config de nginx cada vez:

| Patrón público | Reenvía a (dentro de Floci) | Cubre |
|---|---|---|
| `https://floci.devera.cloud/site/<bucket>/<ruta>` | `http://floci-floci-1:4566/<ruta>` con `Host: <bucket>.s3-website.us-east-1.localhost:4566` | Cualquier bucket S3 con *static website hosting* habilitado |
| `https://floci.devera.cloud/restapis/<api_id>/<stage>/_user_request_/<ruta>` | `http://floci-floci-1:4566/restapis/...` (path intacto) | Cualquier HTTP API de API Gateway creada en Floci |

Cualquier otra ruta (por ejemplo `https://floci.devera.cloud/` a secas, o intentar pegarle a la API de gestión de Lambda/IAM/CloudFormation) cae en un destino "trampa" que nunca responde, y nginx devuelve `502` — **nunca** llega a Floci.

Así se cumple la regla de la sección anterior: se expone el patrón de *lo que uno mismo decide publicar* (un sitio estático, una API con rutas propias), nunca el puerto 4566 completo ni las APIs de administración de AWS.

Diagrama de secuencia completo (navegador → nginx → Floci → API Gateway → Lambda → RDS):

![Flujo de acceso público al Quiz](./imgs/AWS-FLOCI%20-%20Flujo%20de%20acceso%20publico%20al%20Quiz.png)

**Piezas involucradas:**

- **DNS**: `floci.devera.cloud` (subdominio nuevo sobre un dominio propio ya existente, `devera.cloud`) apunta por A record a la IP del VPS.

- **Red Docker**: `nginx-proxy-manager` (que corre en su propia red, `nginx-proxy`) se conectó además a `floci_default` (`docker network connect floci_default nginx-proxy-manager-...`) para poder alcanzar el contenedor `floci-floci-1` directamente por nombre.
  Floci solo publica su puerto en `127.0.0.1` del host, así que sin esto `nginx-proxy-manager` no tenía forma de llegar a él.

- **Certificado**: Let's Encrypt real, emitido por `nginx-proxy-manager` (HTTP-01, automático, sin intervención manual).

- **Config de nginx**: `plataforma/nginx/floci-advanced.conf` (committeado) — los dos `location` genéricos de la tabla de arriba, cargados en el "Advanced" tab del Proxy Host.

- **Script de aplicación**: `plataforma/scripts/npm-configure-floci-host.py` (committeado, idempotente) — usa la API de `nginx-proxy-manager` para crear/actualizar el certificado y el proxy host.

  Se ejecuta **en el VPS**, con las credenciales de administrador de `nginx-proxy-manager` pasadas por variable de entorno (nunca se guardan en ningún archivo):
  ```bash
  NPM_EMAIL=admin@tu-correo \
  NPM_PASS='tu-contraseña' \
  FLOCI_PUBLIC_DOMAIN=floci.devera.cloud \
  NPM_API_PORT=$(docker port nginx-proxy-manager-q62k-nginx-proxy-manager-1 81/tcp | cut -d: -f2) \
  python3 plataforma/scripts/npm-configure-floci-host.py
  ```

- **Frontend**: `frontend/app.js` elige `API_BASE` según el hostname (`window.location.hostname.endsWith(".localhost")` → modo túnel con URL absoluta; si no → ruta relativa).
  Frontend y API quedan bajo el mismo origen público, lo que además elimina CORS de raíz para el acceso público.

**Qué NO cambió**: el túnel SSH (`floci-tunnel.service`, ver [`proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §2](../../quiz/docs/GUIA-PASO-A-PASO.md#2-cómo-levantar-el-entorno-y-qué-hacer-si-no-arranca)) sigue siendo necesario para todo lo administrativo — desplegar una Lambda nueva, crear un bucket, correr `aws` en general. Lo único que dejó de depender del túnel es que **otras personas jueguen el Quiz** (o usen cualquier futuro servicio publicado con el mismo patrón).

**Incidente encontrado y resuelto de paso**: al probar el flujo completo, `/restapis/.../categories` devolvía `502` incluso por el túnel (o sea, un problema preexistente, no causado por este cambio).

La causa: la imagen Docker `public.ecr.aws/lambda/nodejs:22` (la que Floci usa para ejecutar cualquier Lambda Node.js 22) había desaparecido del caché de Docker del VPS — `docker lambda invoke` fallaba con `Lambda.InitError: No such image`. Se resolvió con `docker pull public.ecr.aws/lambda/nodejs:22` en el VPS.

Si esto vuelve a pasar (por ejemplo, tras una limpieza de imágenes con `docker image prune`), el síntoma es el mismo: cualquier Lambda Node 22 devuelve 502/`Lambda.InitError`, y el arreglo es el mismo `docker pull`.

**(2026-07-18) Efectivamente volvió a pasar** — esta vez tumbó el Quiz original de forma real y visible, no solo como hallazgo incidental.

Se identificó la causa raíz (un cron de limpieza de Docker preexistente en el VPS, ajeno a este repo, que borra cualquier imagen sin contenedor activo con más de 24h) y se instaló una prevención: un timer de `systemd` que restaura la imagen automáticamente si el prune vuelve a borrarla. Como la imagen es compartida, esto protege por igual a este fork y al original.

Detalle completo del incidente y del fix: [`proyectos/quiz/docs/ARQUITECTURA.md` §15](../../quiz/docs/ARQUITECTURA.md#15-incidente-caída-completa-del-quiz-por-pérdida-de-la-imagen-del-runtime-de-lambda-2026-07-18).

### Extensión automática a este fork (2026-07-05)

Al crear `quiz-avanzado` (ver `PLAN-SERVICIOS-AVANZADOS.md`, "Contexto de este fork"), su bucket (`quiz-avanzado-frontend`) y su API (`quiz-avanzado-api`, id `a7f3682d91`) quedaron públicamente accesibles **de inmediato, sin tocar nginx**, gracias a que el patrón de arriba es genérico:

- Frontend: `https://floci.devera.cloud/site/quiz-avanzado-frontend/`
- API: `https://floci.devera.cloud/restapis/a7f3682d91/$default/_user_request_/{ruta}`

**Seguridad pendiente de tu parte**: la contraseña de administrador de `nginx-proxy-manager` se compartió en texto plano durante la sesión en que se implementó esto — conviene rotarla desde su propia interfaz (usuario actual → Edit → Change Password) si todavía no se hizo.

---

## 2. <img src="./imgs/Icono%20-%20Amazon%20CloudWatch.png" width="48" valign="middle"> CloudWatch: logs y métricas

✅ **Implementado y probado el 2026-07-23**, contra `quiz-avanzado`.

### 2.1 En una frase

**Amazon CloudWatch** es la "libreta de bitácora" de tu nube: cada vez que un programa (una Lambda, en este proyecto) escribe algo con `console.log` o falla con un error, CloudWatch lo anota con fecha y hora, sin que tengas que pedirlo. Después puedes abrir esa libreta y ver exactamente qué pasó, incluso si el programa ya terminó de correr hace rato.

### 2.2 Por qué hace falta (el problema que resuelve)

Con un servidor tradicional, si algo falla, uno se conecta por SSH y mira directamente qué está pasando "ahí adentro". Una Lambda no tiene ningún "adentro" al que conectarse: aparece, corre un par de segundos, y desaparece. Sin un lugar externo que guarde lo que escribió mientras vivía, cualquier pista sobre un error se perdería para siempre en el momento en que la Lambda termina. CloudWatch es exactamente ese lugar externo — y en AWS real es **automático**: no hay que instalar nada ni configurar un "agente de logs" como harías con un servidor propio.

### 2.3 La analogía, en dibujo

Antes de nombrar nada de AWS, la idea completa cabe en una analogía sin ninguna jerga técnica — un cuaderno de bitácora:

![Analogía: el cuaderno de bitácora](./imgs/AWS-FLOCI%20-%20Analogia%20bitacora%20de%20logs.png)

Alguien (tu código) anota algo en un cuaderno (uno por cada cosa que se vigila); ese cuaderno tiene páginas (se abre una nueva de vez en cuando); cada página junta líneas escritas (una por cada anotación, con fecha); y tú, más tarde, hojeas el cuaderno cuando necesitas entender qué pasó. Nada de esto es específico de AWS — es la misma idea detrás de cualquier sistema de registro, en cualquier tecnología.

### 2.4 De la analogía a CloudWatch Logs

CloudWatch Logs es, literalmente, esa misma idea con otro nombre para cada pieza:

![Mapeo: la analogía del cuaderno vs. CloudWatch Logs](./imgs/AWS-FLOCI%20-%20Mapeo%20analogia%20CloudWatch.png)

- **Log Group** = el cuaderno. Uno por función. En este proyecto hay 6, uno por cada Lambda (`/aws/lambda/quiz-avanzado-categories`, `.../questions`, etc.).
- **Log Stream** = una página del cuaderno. Agrupa los eventos de una misma "tanda" de ejecuciones (en la práctica, se abre una página nueva por día y por versión de la función).
- **Log Event** = una línea escrita. El mensaje concreto, con timestamp y el id de la invocación que lo generó — lo que efectivamente escribiste con `console.log`.

CloudWatch también tiene un segundo servicio hermano pero **independiente**, **CloudWatch Metrics** (números a lo largo del tiempo: cuántas invocaciones, cuántos errores, cuánto tardó cada una) — en el catálogo de servicios de Floci aparecen listados por separado (`logs` y `monitoring`), igual que en el portal oficial de Floci. La sección 2.5 muestra qué tan bien emula cada uno.

### 2.5 Cómo funciona en este proyecto (`quiz-avanzado`)

Sobre la [arquitectura inicial](#0-arquitectura-inicial-punto-de-partida) (S3 + API Gateway + 6 Lambdas + RDS), esta fase agrega la rama de CloudWatch:

![Arquitectura: las 6 Lambdas, CloudWatch Logs y CloudWatch Metrics](./imgs/AWS-FLOCI%20-%20Arquitectura%20CloudWatch%20quiz-avanzado.png)

**Hallazgo 1 — los logs sí son automáticos en Floci, igual que en AWS real.**

Antes de esta fase, ninguna de las 6 Lambdas de `quiz-avanzado` escribía nada con `console.log` (el código solo devolvía errores al cliente, nunca los registraba). Se agregó una línea de log al entrar a cada handler y un `console.error` en cada bloque `catch` — un cambio mínimo, sin lógica nueva, solo para tener algo que observar.

Tras redesplegar y volver a invocar las 6 funciones, el log apareció en CloudWatch sin ninguna configuración adicional, con el mismo formato que en AWS real (`timestamp` + `request id` + `INFO`/`ERROR` + mensaje):

```
2026-07-23T20:05:47.811Z  8153bb2f-d020-44a0-8cc7-c3946dc0116b  INFO  categories: listando categorias
```

**Hallazgo 2 — CloudWatch Metrics es un servicio real e independiente en Floci, y ya está implementado en las 6 Lambdas.**

El health check interno de Floci (`curl http://localhost:4566/health`) lista `logs` y `monitoring` como dos servicios separados, ambos `"running"` — coincide con que el propio portal de Floci los presenta como "CloudWatch Logs" y "CloudWatch Metrics" por separado, no como una sola cosa.

Al confirmar que el servicio funciona de verdad (probado primero con datos manuales, namespace descartable), se decidió aprovecharlo a fondo en vez de dejarlo solo documentado: las 6 Lambdas ahora publican sus propias métricas en cada invocación, con el SDK de AWS (`@aws-sdk/client-cloudwatch`), namespace `QuizAvanzado/Lambda`, dimensión `FunctionName`:

- **Invocations** (`Count`): 1 por cada ejecución que llega a consultar la base de datos.
- **Errors** (`Count`): 1 cuando el bloque `catch` atrapa una excepción, 0 en el camino exitoso.
- **Duration** (`Milliseconds`): tiempo desde que empieza la consulta a la base de datos hasta que termina (no incluye el *cold start* de la Lambda en sí).

Confirmado con una invocación real de `categories`:

```bash
aws cloudwatch get-metric-statistics --namespace "QuizAvanzado/Lambda" --metric-name Invocations \
  --dimensions Name=FunctionName,Value=quiz-avanzado-categories \
  --start-time "$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
  --period 60 --statistics Sum --profile floci
# → Datapoints: [{ "Sum": 1.0, ... }]
```

Esto fue, además, **el primer permiso IAM real que recibió un rol de este proyecto** (`cloudwatch:PutMetricData`, política inline `PublishCloudWatchMetrics` en cada uno de los 6 roles).

Hasta ahora todos los roles solo tenían la *trust policy* de la [arquitectura inicial](#0-arquitectura-inicial-punto-de-partida), sin ninguna *permission policy* adjunta. La Fase 3 (Secrets Manager) iba a reclamar ese honor; queda anotado en el plan que en realidad fue esta fase.

Vale la pena detenerse acá porque es la primera vez que este proyecto usa la diferencia entre estos dos tipos de política — un concepto que suele confundir a quien recién aprende IAM:

![El mismo rol IAM, antes y después del primer permiso](./imgs/AWS-FLOCI%20-%20IAM%20antes%20y%20despues%20del%20permiso.png)

- La **Trust Policy** nunca cambió: sigue diciendo "el servicio Lambda puede asumir este rol", exactamente igual que en la arquitectura inicial.
- Lo nuevo es la **Permission Policy** (`PublishCloudWatchMetrics`): una vez asumido el rol, ahora sí puede hacer algo con él (llamar a `cloudwatch:PutMetricData`).

#### Cómo se configuró, en la práctica

El permiso se agrega como una política **inline** (vive pegada al rol, no es un recurso separado reutilizable) sobre un documento JSON estándar de IAM:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "cloudwatch:PutMetricData",
      "Resource": "*"
    }
  ]
}
```

Ese mismo documento se adjuntó a los 6 roles con `put-role-policy` (acá, el rol de `categories`; el comando se repitió cambiando solo `--role-name`):

```bash
aws iam put-role-policy --role-name quiz-avanzado-categories-role \
  --policy-name "PublishCloudWatchMetrics" \
  --policy-document file:///tmp/cloudwatch-metrics-policy.json \
  --profile floci
```

**Sintaxis:** `put-role-policy` no devuelve nada en la salida estándar cuando sale bien (sin JSON, sin confirmación) — el silencio *es* el éxito. Para confirmar que quedó bien, hay que pedirlo de vuelta explícitamente:

```bash
aws iam get-role-policy \
  --role-name quiz-avanzado-categories-role \
  --policy-name PublishCloudWatchMetrics \
  --profile floci
```

Salida real:

```json
{
    "RoleName": "quiz-avanzado-categories-role",
    "PolicyName": "PublishCloudWatchMetrics",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": "cloudwatch:PutMetricData",
                "Resource": "*"
            }
        ]
    }
}
```

**Qué mirar:** `PolicyDocument` es exactamente el JSON que se envió — IAM no lo transforma. Antes de esta fase, el mismo comando hubiera fallado con `NoSuchEntity`, porque esa política todavía no existía sobre el rol (confirmado pidiendo una política inexistente: `An error occurred (NoSuchEntity) when calling the GetRolePolicy operation: Policy ... not found for role ...`).

Y así se usan las dos juntas en tiempo de ejecución, en cada invocación real de `categories`:

![Flujo de autorización: asumir el rol y usar el permiso](./imgs/AWS-FLOCI%20-%20Flujo%20de%20autorizacion%20IAM.png)

Primero se resuelve **quién es** la Lambda: la Trust Policy, al arrancar, entrega credenciales temporales. Después, en cada llamada a una API de AWS, se resuelve **qué puede hacer** con esa identidad: la Permission Policy, evaluada en el momento de la llamada.

Son dos preguntas distintas, respondidas por dos políticas distintas — de ahí que agregar el permiso no tocara la *trust policy* para nada.

Lo que **sigue sin ocurrir** es la parte 100% automática de AWS real: ahí, cualquier Lambda publica sola sus métricas estándar bajo el namespace `AWS/Lambda`, sin que el código tenga que llamar a ningún SDK.

Floci no emula ese cableado interno — `get-metric-statistics` sobre `AWS/Lambda` sigue devolviendo siempre vacío, sin importar cuánto se invoquen las funciones. La diferencia con lo de arriba: `QuizAvanzado/Lambda` lo publica *nuestro propio código*, explícitamente; `AWS/Lambda` lo publicaría el motor de Lambda *sin que nuestro código haga nada*, y eso es justamente lo que Floci no tiene implementado.

**Hallazgo 3 — bug de `aws-cli` al usar `logs tail` contra Floci.**

El comando más cómodo para seguir logs en vivo, `aws logs tail /aws/lambda/<funcion> --profile floci`, falla con `aws: [ERROR]: 'logStreamName'` contra este emulador (la respuesta de Floci a la llamada interna que usa `tail` le falta un campo que el cliente de AWS espera).

Alternativa que sí funciona siempre, usada para verificar todo lo anterior: `describe-log-streams` para encontrar el stream más reciente + `get-log-events` para leer su contenido (comandos exactos en "Cómo verificarlo tú mismo").

### 2.6 Dos formas de ver los mismos logs: CloudWatch vs. Docker directo en el VPS

Esta es la diferencia que vale la pena tener clara al leer logs en este entorno particular (no existe en AWS real, donde solo hay un camino posible):

![Dos caminos para ver los mismos logs](./imgs/AWS-FLOCI%20-%20Dos%20caminos%20para%20ver%20logs.png)

- **Método A — por CloudWatch** (`aws logs ...` con `--profile floci`, a través del túnel SSH): es el camino "de AWS", el que se documenta en la sección anterior y en la verificación de abajo.
  Funciona exactamente igual si esto corriera contra una cuenta de AWS real — es portátil, no necesitas saber nada de Docker para usarlo.

- **Método B — por Docker, directo en el VPS**: cada Lambda de Floci corre como un contenedor Docker real (ver `CLAUDE.md` raíz de este repo), con nombre `floci-quiz-avanzado-<función>-<hash>` (ej. `floci-quiz-avanzado-categories-949c8d34`), reutilizado entre invocaciones mientras se mantiene "caliente" (el mismo comportamiento de *warm start* de Lambda real).
  Con acceso SSH directo al VPS (no alcanza con el túnel al puerto 4566, que solo abre la API de Floci, no el Docker del host), `docker logs <contenedor>` muestra el `stdout`/`stderr` crudo del proceso — la misma información que CloudWatch, pero sin pasar por su capa de emulación.
  Esto **no** tiene equivalente en AWS real (ahí no hay ningún `docker ps` al que asomarse); es una herramienta de depuración exclusiva de este entorno.

### 2.7 CloudWatch Alarms: qué funciona y qué no

Una **alarma** vigila una métrica y cambia de estado cuando cruza un umbral que tú defines — el "vigilante automático" de CloudWatch:

![El core de CloudWatch Alarms](./imgs/AWS-FLOCI%20-%20Core%20de%20CloudWatch%20Alarms.png)

Se probó de punta a punta contra `quiz-avanzado`, sobre la métrica `Errors` de `categories` (umbral: más de 0 en 60 segundos), y el resultado es una mezcla clara de lo que sí y lo que no está emulado:

- ✅ **Crear la alarma funciona** (`put-metric-alarm`): queda registrada con estado inicial `INSUFFICIENT_DATA`, igual que en AWS real antes de tener datos suficientes.
- ❌ **La evaluación automática no ocurre**: se publicó manualmente un datapoint que debía cruzar el umbral (`Errors = 1`), y tras esperar más de 2 minutos (dos períodos completos) el estado seguía en `INSUFFICIENT_DATA` — nunca pasó a `ALARM`. En AWS real, esa transición sería automática y ocurriría en cuestión de minutos.
- ❌ **El historial no está implementado**: `describe-alarm-history` devuelve directamente `UnsupportedOperation`, no una lista vacía — confirma que esta pieza ni siquiera se intenta emular.
- ✅ **El control manual sí funciona**: `set-alarm-state` (el comando que existe en AWS real justamente para *probar* una alarma sin esperar a que se cumpla la condición) cambió el estado a `ALARM` al instante.
- ⚠️ **Hallazgo 4 — bug del `aws-cli` con `--dimensions` en `put-metric-data`** (no de Floci, de la interacción entre ambos):

  - El atajo `--dimensions Name=FunctionName,Value=quiz-avanzado-categories` funciona perfecto en `get-metric-statistics` y `list-metrics`.
  - Pero en `put-metric-data` contra Floci guarda dos dimensiones basura — `{"Name": "Name", "Value": "FunctionName"}` y `{"Name": "Value", "Value": "quiz-avanzado-categories"}` — en vez de la única dimensión esperada. Se confirmó reproduciéndolo dos veces.
  - La forma que sí funciona es la sintaxis JSON completa con `--metric-data` (ver paso 11 de la verificación).
  - Esto **no** afecta a las 6 Lambdas del proyecto: publican con el SDK de JavaScript, no con `aws-cli`, y ahí las dimensiones siempre se vieron correctas (confirmado en el paso 7).
  - Por las dudas, se **repitió la prueba del hallazgo anterior con datos garantizados correctos** (una alarma sobre `Invocations`, poblada por una invocación real de la app en vez de `put-metric-data` a mano): mismo resultado, `INSUFFICIENT_DATA` después de 2 minutos. El hallazgo de que la evaluación automática no ocurre queda confirmado independientemente de este bug de sintaxis.

**Conclusión práctica:**

En este entorno, Alarms sirve para **definir** alarmas y para **probar acciones** conectadas a ellas empujando el estado a mano con `set-alarm-state` — pero no sirve como vigilancia automática real de una métrica en producción, porque el motor que hace esa vigilancia periódica no está implementado.

La alarma de prueba se creó, se verificó y se borró en el mismo momento (no quedó como parte permanente de la infraestructura de este proyecto). Cuando en la Fase 5 exista SNS, se construye ahí la alarma real con una acción de notificación con propósito de negocio, reutilizando lo aprendido acá.

### 2.8 Cómo verificarlo tú mismo

Requiere el túnel SSH activo (`systemctl status floci-tunnel.service`) y el perfil `floci` de `aws-cli` configurado — ver [`proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §2](../../quiz/docs/GUIA-PASO-A-PASO.md#2-cómo-levantar-el-entorno-y-qué-hacer-si-no-arranca) si no los tienes listos. Los pasos 6-7 (Método B) además requieren acceso SSH directo al VPS (`ssh <tu-usuario>@<TU-HOSTNAME-VPS>`, ver `plataforma/.env`), no solo el túnel.

Cada paso incluye la salida real que devolvió al ejecutarlo contra `quiz-avanzado`, qué campos vale la pena mirar, y una línea de sintaxis para los flags que no se explican solos.

Antes de los pasos, así se conecta todo el circuito de punta a punta — desde la línea de código hasta la respuesta del comando que la verifica:

![Trazabilidad: del código a la respuesta del comando](./imgs/AWS-FLOCI%20-%20Trazabilidad%20codigo%20a%20respuesta.png)

El `message` que aparece en la respuesta del paso 4 no es un dato que CloudWatch "inventa" ni transforma — es, carácter por carácter, el string que `lambda/categories/index.js:23` le pasó a `console.log`.

Tener claro este circuito completo (path del archivo → línea de código → comando → estructura de la respuesta) es lo que permite, ante cualquier otro mensaje que aparezca en logs a futuro, ir directo al `grep` en el código en vez de adivinar de dónde salió.

**Método A — CloudWatch (portátil, funciona igual contra AWS real):**

1. **Generar una invocación real** (cualquiera de las 6 rutas sirve; esta usa `categories`, la más simple):
   ```bash
   curl -s "http://localhost:4566/restapis/a7f3682d91/\$default/_user_request_/categories"
   ```
   Salida real:
   ```json
   [{"slug":"aws-cloud-practitioner","nombre":"AWS Cloud Practitioner","tiene_preguntas":true},{"slug":"python","nombre":"Python","tiene_preguntas":false},{"slug":"linux","nombre":"Linux","tiene_preguntas":false}]
   ```
   Esto es la respuesta normal del endpoint — no tiene nada de CloudWatch todavía, solo genera la actividad que los pasos siguientes van a observar.

2. **Confirmar que existe el Log Group** (el "cuaderno" de la analogía — uno por función, creado automáticamente):
   ```bash
   aws logs describe-log-groups --log-group-name-prefix /aws/lambda/quiz-avanzado --profile floci
   ```
   **Sintaxis:** `--log-group-name-prefix` filtra para no traer también los grupos de `quiz-*` o `hello-world` de los otros proyectos de este repo.

   Salida real (recortada a 2 de los 6 grupos — los otros 4 son idénticos, solo cambia el nombre):
   ```json
   {
       "logGroups": [
           {
               "logGroupName": "/aws/lambda/quiz-avanzado-answer",
               "metricFilterCount": 0,
               "arn": "arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/quiz-avanzado-answer",
               "storedBytes": 0
           },
           {
               "logGroupName": "/aws/lambda/quiz-avanzado-categories",
               "metricFilterCount": 0,
               "arn": "arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/quiz-avanzado-categories",
               "storedBytes": 0
           }
       ]
   }
   ```
   **Qué mirar:**
   - `logGroupName`: el "cuaderno" — es exactamente el Log Group del concepto de la sección 2.4, y el valor que vas a usar como `--log-group-name` en el paso siguiente.
   - `arn`: el identificador único del recurso en toda la cuenta/región — lo pedirías si tuvieras que darle permiso a otro rol para leer *este* grupo puntual (a diferencia de `cloudwatch:PutMetricData`, que en la Fase 2 no admitió restringir por recurso).
   - `storedBytes` en `0`: no es un error — Floci no lo mantiene actualizado en esta vista (compará con el `storedBytes` real que sí aparece por *stream*, en el paso 3).
   - `metricFilterCount`: cuántas *metric filters* tiene ese grupo (una funcionalidad de CloudWatch Logs para convertir patrones de texto en métricas — no se usa en este proyecto, por eso siempre da `0`).

3. **Encontrar el stream con contenido más reciente** (el Log Stream — "una página" — no uses `aws logs tail`, ver Hallazgo 3):
   ```bash
   aws logs describe-log-streams \
     --log-group-name /aws/lambda/quiz-avanzado-categories \
     --profile floci --output json \
     | python3 -c "import json,sys; d=json.load(sys.stdin); s=[x for x in d['logStreams'] if x.get('storedBytes',0)>0]; print(s[-1]['logStreamName'] if s else 'sin contenido aun')"
   ```
   **Sintaxis:** sin el `| python3 ...`, este comando por sí solo (`aws logs describe-log-streams --log-group-name ... --profile floci`) ya te muestra todos los streams — el `python3` solo automatiza "quedarme con el más reciente que tenga contenido", algo que a mano harías mirando la lista.

   Salida real sin filtrar (2 de los 6 streams que tenía este grupo — nota la diferencia entre uno vacío y uno con datos):
   ```json
   {
     "logStreamName": "2026/07/05/[$LATEST]0adfd648",
     "lastIngestionTime": 0,
     "arn": "arn:aws:logs:...:log-stream:2026/07/05/[$LATEST]0adfd648",
     "storedBytes": 0
   },
   {
     "logStreamName": "2026/07/24/[$LATEST]4975022a",
     "firstEventTimestamp": 1784840273939,
     "lastEventTimestamp": 1784840273939,
     "lastIngestionTime": 1784840273939,
     "storedBytes": 124
   }
   ```
   **Qué mirar:**
   - `logStreamName` trae codificada la fecha y la versión de la función (`$LATEST`, porque este proyecto no publica versiones numeradas) — por eso se abre uno nuevo por día, no uno por invocación.
   - `storedBytes` en `0` acá **sí** es real (a diferencia del paso 2): ese stream específico nunca recibió una línea.
   - `firstEventTimestamp`/`lastEventTimestamp` (epoch en milisegundos) solo aparecen si el stream tiene contenido — es la señal más rápida de "este es el que me interesa", que es justo lo que el filtro de Python aprovecha.

4. **Leer el contenido de ese stream** (cada elemento de `events` es un Log Event — "una línea escrita"; reemplaza `<stream>` por el valor del paso anterior):
   ```bash
   aws logs get-log-events \
     --log-group-name /aws/lambda/quiz-avanzado-categories \
     --log-stream-name '<stream>' --profile floci
   ```
   **Sintaxis:** las comillas simples alrededor de `<stream>` son obligatorias — el nombre real trae `[$LATEST]`, y sin comillas la shell intentaría expandir `$LATEST` como si fuera una variable de entorno (que no existe, así que el comando fallaría en silencio con un nombre de stream vacío).

   Salida real (de una invocación distinta a la del paso 1, para mostrar también el caso con "ruido"):
   ```json
   {
     "events": [
       {
         "timestamp": 1784856250259,
         "message": "2026-07-24T01:24:10.256Z\tf4ab934a-...\tINFO\tcategories: listando categorias",
         "ingestionTime": 1784856250259
       },
       {
         "timestamp": 1784856575530,
         "message": "[ERROR] [1784856575529] LAMBDA_RUNTIME Failed to get next invocation. No Response from endpoint",
         "ingestionTime": 1784856575530
       }
     ],
     "nextForwardToken": "f/3",
     "nextBackwardToken": "b/0"
   }
   ```
   **Qué mirar:**
   - `events[].message`: acá está tu `console.log`, con el formato estándar de Lambda (`timestamp` + `request id` + nivel + tu texto) — pero **no todo lo que aparece en un stream es tu propio código**. El segundo evento de este ejemplo es un mensaje interno del *runtime* de Lambda cuando el contenedor se apaga por inactividad (el mismo fenómeno de *warm/cold start* de la sección 2.6) — no es un error de la aplicación, aunque diga `[ERROR]`.
   - `nextForwardToken`/`nextBackwardToken`: para paginar si el stream tuviera miles de eventos — con el volumen de este proyecto nunca hace falta usarlos.

**Método B — Docker directo en el VPS (exclusivo de este entorno, ver sección 2.6):**

5. **Encontrar el contenedor real de la Lambda** (solo aparece si se invocó recientemente; si no, repite el paso 1 primero):
   ```bash
   ssh <tu-usuario>@<TU-HOSTNAME-VPS> "docker ps --format '{{.Names}}' | grep quiz-avanzado-categories"
   ```
   Salida real:
   ```
   floci-quiz-avanzado-categories-107b8e53
   ```
   El sufijo (`107b8e53`) cambia cada vez que Floci recicla el contenedor por inactividad — es normal que no coincida con ejecuciones anteriores.

6. **Leer su salida cruda, sin pasar por CloudWatch** (reemplaza `<contenedor>` por el nombre que imprimió el paso anterior):
   ```bash
   ssh <tu-usuario>@<TU-HOSTNAME-VPS> "docker logs <contenedor>"
   ```
   Salida real:
   ```
   2026-07-24T01:31:38.170Z	249b49b7-7676-4bf9-acea-78e7de06d384	INFO	categories: listando categorias
   ```
   Mismo formato que `events[].message` del paso 4 — es literalmente el mismo texto, solo que leído directo del proceso en vez de a través de la capa de CloudWatch (por eso acá no aparece el ruido del *runtime* del paso 4: ese mensaje lo agrega la capa de emulación, no el contenedor).

**Métricas — confirmar la implementación real (ver Hallazgo 2):**

7. **Generar una invocación** (si no lo hiciste ya en el paso 1) y **confirmar que la métrica propia existe**:
   ```bash
   aws cloudwatch list-metrics --namespace "QuizAvanzado/Lambda" --profile floci
   ```
   Salida real (2 de las 18 entradas — hay 6 funciones × 3 métricas cada una):
   ```json
   {
     "Metrics": [
       {
         "Namespace": "QuizAvanzado/Lambda",
         "MetricName": "Invocations",
         "Dimensions": [{ "Name": "FunctionName", "Value": "quiz-avanzado-categories" }]
       },
       {
         "Namespace": "QuizAvanzado/Lambda",
         "MetricName": "Duration",
         "Dimensions": [{ "Name": "FunctionName", "Value": "quiz-avanzado-categories" }]
       }
     ]
   }
   ```
   **Qué mirar:** en CloudWatch, una métrica se identifica por la combinación de **tres** campos — `Namespace` + `MetricName` + `Dimensions` — no por el nombre solo. Por eso `Invocations` de `categories` y `Invocations` de `questions` son dos métricas *distintas* que conviven en la misma lista, diferenciadas únicamente por su `Dimensions`. `list-metrics` solo confirma que la métrica *existe*; no trae ningún valor — para eso es el paso 8.

8. **Leer el valor real** (reemplaza `--metric-name` por `Errors` o `Duration` para ver las otras dos):
   ```bash
   aws cloudwatch get-metric-statistics --namespace "QuizAvanzado/Lambda" --metric-name Invocations \
     --dimensions Name=FunctionName,Value=quiz-avanzado-categories \
     --start-time "$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%S)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
     --period 60 --statistics Sum --profile floci
   ```
   **Sintaxis:** `--period 60` agrupa los datapoints en baldes de 60 segundos; `--statistics Sum` dice cómo agregar los valores dentro de cada balde (`Sum`, `Average`, `Maximum`... — para `Invocations`/`Errors` interesa `Sum`, para `Duration` normalmente `Average`); `--start-time`/`--end-time` van en UTC, por eso el `date -u`.

   Salida real (dos invocaciones en momentos distintos cayeron en baldes de 60s diferentes):
   ```json
   {
     "Label": "Invocations",
     "Datapoints": [
       { "Timestamp": "2026-07-23T21:24:00-04:00", "Sum": 1.0, "Unit": "Count" },
       { "Timestamp": "2026-07-23T21:31:00-04:00", "Sum": 1.0, "Unit": "Count" }
     ]
   }
   ```
   **Qué mirar:** `Datapoints` es un arreglo, **no un solo número** — un elemento por cada balde de `--period` segundos que tuvo al menos un dato en el rango pedido. Si invocas la función varias veces dentro del mismo minuto, vas a ver un solo datapoint con `Sum` mayor a 1, no varios datapoints de `Sum: 1`.

9. **Confirmar que el namespace automático de AWS real sigue vacío en Floci** (esperado, no es un error tuyo):
   ```bash
   aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations \
     --dimensions Name=FunctionName,Value=quiz-avanzado-categories \
     --start-time "$(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%S)" \
     --end-time "$(date -u +%Y-%m-%dT%H:%M:%S)" \
     --period 300 --statistics Sum --profile floci
   ```
   Salida real:
   ```json
   { "Label": "Invocations", "Datapoints": [] }
   ```
   Mismo comando que el paso 8, cambiando solo `--namespace` a `AWS/Lambda` — `Datapoints: []` (arreglo vacío, no un error) es exactamente el hallazgo: la estructura de la respuesta es válida, simplemente no hay ningún dato porque nadie lo publicó ahí.

**Alarms — reproducir los hallazgos de la sección 2.7 (opcional, se puede borrar después con `delete-alarms`):**

10. **Crear una alarma de prueba y confirmar el estado inicial**:
    ```bash
    aws cloudwatch put-metric-alarm --alarm-name "mi-alarma-de-prueba" \
      --namespace "QuizAvanzado/Lambda" --metric-name "Invocations" \
      --dimensions Name=FunctionName,Value=quiz-avanzado-categories \
      --statistic Sum --period 60 --evaluation-periods 1 --threshold 0 \
      --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
      --profile floci
    aws cloudwatch describe-alarms --alarm-names "mi-alarma-de-prueba" --profile floci
    ```
    **Sintaxis:** `--comparison-operator GreaterThanThreshold` + `--threshold 0` = "dispará cuando la suma sea mayor que 0"; `--evaluation-periods 1` = "con un solo balde de `--period` que cumpla ya alcanza" (con `2` pediría dos baldes seguidos); `--treat-missing-data notBreaching` evita que la alarma pase a `ALARM` solo por falta de datos.

    Salida real:
    ```json
    {
        "MetricAlarms": [{
            "AlarmName": "mi-alarma-de-prueba",
            "AlarmArn": "arn:aws:cloudwatch:us-east-1:000000000000:alarm:mi-alarma-de-prueba",
            "StateValue": "INSUFFICIENT_DATA",
            "MetricName": "Invocations",
            "Namespace": "QuizAvanzado/Lambda",
            "Statistic": "Sum",
            "Period": 60,
            "Threshold": 0.0,
            "ComparisonOperator": "GreaterThanThreshold"
        }]
    }
    ```
    **Qué mirar:** `StateValue` es el campo que vas a revisar en cada paso siguiente — sus tres valores posibles son `OK`, `ALARM` e `INSUFFICIENT_DATA` (este último, "todavía no tengo suficientes datos para decidir", es el estado inicial normal, también en AWS real).

11. **Publicar un datapoint que cruce el umbral y esperar 2-3 minutos** — usa la sintaxis JSON completa con `--metric-data`, **no** el atajo `--dimensions` (ver Hallazgo 4: ese atajo guarda mal la dimensión en `put-metric-data`, aunque funcione perfecto en los pasos 7-9):
    ```bash
    aws cloudwatch put-metric-data --namespace "QuizAvanzado/Lambda" \
      --metric-data '[{"MetricName":"Invocations","Value":1,"Dimensions":[{"Name":"FunctionName","Value":"quiz-avanzado-categories"}]}]' \
      --profile floci
    ```
    El estado de la alarma (`describe-alarms` del paso anterior) va a seguir en `INSUFFICIENT_DATA` incluso después de esperar — esa es la confirmación del hallazgo de la sección 2.7, no una falla tuya. (Si prefieres no depender de recordar esta sintaxis distinta, alcanza con esperar a que una invocación real de la app publique el dato — el resultado es el mismo, ver el reintento con `Invocations` descrito en el Hallazgo 4.)

12. **Confirmar que el control manual sí funciona**, y limpiar la alarma de prueba:
    ```bash
    aws cloudwatch set-alarm-state --alarm-name "mi-alarma-de-prueba" --state-value ALARM --state-reason "prueba manual" --profile floci
    aws cloudwatch describe-alarms --alarm-names "mi-alarma-de-prueba" --profile floci --query "MetricAlarms[0].StateValue"
    aws cloudwatch delete-alarms --alarm-names "mi-alarma-de-prueba" --profile floci
    ```
    **Sintaxis:** `--query` (JMESPath) filtra la respuesta a un solo valor en vez de imprimir el JSON completo — útil cuando, como acá, solo te interesa confirmar un campo puntual.

    Salida real del `--query`: `"ALARM"` — cambia al instante, sin esperar ningún período de evaluación, porque `set-alarm-state` fuerza el estado directamente en vez de calcularlo.

### 2.9 Qué cambió en el código

Cada una de las 6 Lambdas (`lambda/{categories,questions,answer,submit,ranking,badges}/index.js`) ganó tres cosas. Los fragmentos de abajo son el código real de `lambda/categories/index.js` (la más simple de las 6) — las otras cinco tienen exactamente la misma estructura, cambiando solo el mensaje del log y qué parámetro de negocio miden (`categoria`, `username`, etc.).

**1. Logging — un `console.log` al entrar, un `console.error` en el `catch`.** No requirió ninguna dependencia nueva: el runtime `nodejs22.x` ya expone `console` globalmente, y Floci se encarga de reenviarlo a CloudWatch por sí solo (Hallazgo 1).

```js
exports.handler = async () => {
  console.log("categories: listando categorias");   // ← nuevo
  const inicio = Date.now();                          // ← nuevo (también lo usan las métricas)
  const client = new Client();
  await client.connect();
  try {
    const { rows } = await client.query(`...`);
    // ...
  } catch (err) {
    console.error("categories: error consultando categorias", err);   // ← nuevo
    // ...
  }
};
```

**2. Métricas — una función `publicarMetricas`, repetida en cada archivo** (igual que ya pasa con el helper `respond()` — cada Lambda es independiente, sin librería compartida), que llama a `PutMetricDataCommand` del paquete `@aws-sdk/client-cloudwatch`:

```js
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");

const cw = new CloudWatchClient({});
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;

async function publicarMetricas(errores, duracionMs) {
  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: "QuizAvanzado/Lambda",
      MetricData: [
        { MetricName: "Invocations", Value: 1, Unit: "Count", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
        { MetricName: "Errors", Value: errores, Unit: "Count", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
        { MetricName: "Duration", Value: duracionMs, Unit: "Milliseconds", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
      ],
    }));
  } catch (err) {
    console.error(`${FUNCTION_NAME}: no se pudo publicar metricas en CloudWatch`, err);
  }
}
```

Se agregó como dependencia real (`npm install @aws-sdk/client-cloudwatch`) porque el runtime `nodejs22.x` de Floci **no** trae ningún cliente de `@aws-sdk` preinstalado (se confirmó intentando `require.resolve` dentro del contenedor real de una Lambda — falló también para `@aws-sdk/client-s3`) — queda respondida la pregunta que el plan original dejaba abierta para la Fase 3.

**3. La llamada a `publicarMetricas`, en los dos únicos lugares donde el handler termina** (éxito y error), reusando el mismo `inicio` que ya marcaba el `console.log`:

```js
    await publicarMetricas(0, Date.now() - inicio);   // ← nuevo, justo antes del éxito
    return respond(200, rows);
  } catch (err) {
    console.error("categories: error consultando categorias", err);
    await publicarMetricas(1, Date.now() - inicio);   // ← nuevo, dentro del catch
    return respond(500, { error: err.message });
```

Así, la duración medida es "tiempo de trabajo real" (la consulta a la base de datos), sin incluir la conexión inicial ni el *cold start* de la Lambda.

Además, cada uno de los 6 roles IAM (`quiz-avanzado-<función>-role`) recibió una política inline nueva, `PublishCloudWatchMetrics`, con el único permiso `cloudwatch:PutMetricData` sobre `Resource: "*"` (es el único *scope* que CloudWatch acepta para esta acción, también en AWS real — no admite restringir por recurso; ver diagramas de la sección 2.5).

---

## 3. Secrets Manager + KMS: gestión de credenciales

### Concepto

Hasta ahora, la contraseña de la base de datos vive en texto plano en la configuración de cada Lambda (`PGPASSWORD=...` como variable de entorno). Esto funciona, pero tiene un problema: cualquiera con permiso para *ver la configuración* de la Lambda (no para ejecutarla, solo para leerla) ve la contraseña en texto plano.

**AWS Secrets Manager** guarda credenciales de forma cifrada, y las entrega solo a quien tenga el permiso IAM específico (`secretsmanager:GetSecretValue`) — separando "quién puede desplegar/configurar" de "quién puede ver la contraseña real". También permite **rotar** la credencial automáticamente sin tener que volver a desplegar cada Lambda.

**AWS KMS (Key Management Service)** es el servicio que genera y administra las claves de cifrado que usan Secrets Manager (y muchos otros servicios) por debajo. Por defecto, Secrets Manager usa una clave administrada por AWS; se puede usar una clave propia (*customer-managed key*) para tener control sobre quién puede usarla y poder revocarla independientemente.

### Un permiso real más: lectura de secretos

Desde la Fase 2 (ver [sección 2.5](#25-cómo-funciona-en-este-proyecto-quiz-avanzado)), los roles IAM de este proyecto (`quiz-avanzado-categories-role`, etc.) ya no son solo *trust policy* — cada uno tiene además una *permission policy* real (`cloudwatch:PutMetricData`).

Esta fase repite ese mismo patrón con un permiso distinto (`secretsmanager:GetSecretValue`), y es una buena oportunidad para reforzar la diferencia entre ambos conceptos con un segundo ejemplo — esta vez de **lectura** en vez de **escritura**.

### Cómo quedó implementado

🔜 Pendiente (Fase 3 del plan).

---

## 4. CloudTrail: auditoría

### Concepto

**AWS CloudTrail** registra **quién hizo qué** en tu cuenta de AWS: cada llamada a la API (crear un bucket, borrar una función Lambda, cambiar un permiso) queda guardada con quién la hizo, cuándo, y desde dónde. Es la herramienta de auditoría de seguridad por excelencia en AWS — en el examen de Cloud Practitioner aparece constantemente asociada a la pregunta "¿cómo audito qué pasó en mi cuenta?".

Los "eventos de administración" (crear/borrar/modificar recursos) se registran por defecto en todas las cuentas de AWS reales durante 90 días, gratis, consultables desde la consola. Para retenerlos más tiempo o analizarlos con herramientas propias, se crea un **trail**, que los entrega continuamente a un bucket S3.

### Cómo quedó implementado

🔜 Pendiente (Fase 4 del plan).

---

## 5. SNS + EventBridge/Scheduler: mensajería y eventos

### Concepto

**Amazon SNS (Simple Notification Service)** es un servicio de mensajería *pub/sub* (publicador/suscriptor): algo "publica" un mensaje en un **tópico**, y todos los que estén "suscritos" a ese tópico lo reciben (por email, SMS, una cola SQS, otra Lambda, etc.) — el publicador no necesita saber quién está escuchando. Es el patrón detrás de casi cualquier sistema de notificaciones en AWS.

**Amazon EventBridge** (y su función de **Scheduler**) permite reaccionar a eventos — ya sea algo que pasó en AWS (ej. "se creó un objeto en S3"), algo externo, o simplemente **el paso del tiempo** (una regla programada, como un cron job, pero administrado por AWS en vez de un servidor corriendo 24/7).

En este proyecto: SNS para notificar puntajes altos (patrón pub/sub), EventBridge Scheduler para una tarea programada de ejemplo (arquitectura orientada a eventos, sin mantener un proceso corriendo todo el tiempo).

### Cómo quedó implementado

🔜 Pendiente (Fase 5 del plan).

---

## 6. WAF: seguridad perimetral

### Concepto

**AWS WAF (Web Application Firewall)** filtra el tráfico HTTP **antes** de que llegue a tu API Gateway (o CloudFront/ALB): reglas como *rate limiting* (bloquear una IP que hace demasiadas peticiones por segundo), bloqueo por país, o detección de patrones típicos de ataques (SQL injection, XSS) a nivel de request HTTP, sin que tu código tenga que preocuparse por eso.

Tiene sentido pleno recién cuando el API Gateway es alcanzable desde internet (ver sección 1) — mientras solo se acceda vía túnel SSH, no hay tráfico público del que protegerse.

### Cómo quedó implementado

🔜 Pendiente (Fase 6 del plan).

---

## 7. CloudFormation: infraestructura como código

### Concepto

Hasta ahora, cada pieza de este proyecto (RDS, cada Lambda, cada ruta de API Gateway, el bucket S3) se creó con un comando de `aws cli` distinto, ejecutado a mano, uno por uno. Esto funciona, pero tiene problemas: si quisieras recrear todo desde cero (por ejemplo, en otra cuenta o otra región), tendrías que recordar y re-ejecutar decenas de comandos en el orden correcto.

**AWS CloudFormation** resuelve esto: describes **toda** tu infraestructura en un archivo (JSON o YAML) declarativo — "quiero una RDS así, una Lambda asá, una API Gateway con estas rutas" — y CloudFormation se encarga de crear todo en el orden correcto, y de saber qué cambió si vuelves a aplicar el archivo después de editarlo (actualiza solo lo necesario). Esto se llama **Infrastructure as Code (IaC)**, y es una de las prácticas más valoradas en roles de nube/DevOps: la infraestructura queda versionada en Git igual que el código de la aplicación, no solo en la cabeza de quien la creó.

### Cómo quedó implementado

🔜 Pendiente (Fase 7 del plan).

---

## 8. Cognito: autenticación real

### Concepto

Hasta ahora, "identificarse" en el quiz es solo escribir un nombre — no hay contraseña, cualquiera puede jugar con el nombre de otro. **Amazon Cognito** es el servicio de AWS para autenticación y gestión de usuarios real: registro, inicio de sesión, verificación de email, recuperación de contraseña, tokens de sesión (JWT) — todo lo que normalmente te tomaría semanas construir a mano de forma segura.

Esta es, con diferencia, la fase que más cambia el proyecto: pasa de "un nombre libre para el ranking" a "cuentas reales". Por eso se deja para el final y con una conversación de alcance aparte antes de tocar código (ver el plan).

### Cómo quedó implementado

🔜 Pendiente (Fase 8 del plan — sujeta a definir alcance primero).
