# Guía paso a paso: desplegar Floci + Lambda "Hello World" en un VPS remoto

**Para quién es este documento:** para quien ya hizo [`GUIA-LOCAL-DOCKER.md`](./GUIA-LOCAL-DOCKER.md)
(o ya conoce los conceptos de AWS/Docker/Lambda que ahí se explican) y ahora quiere desplegar el
mismo proyecto en un **servidor remoto compartido** en vez de su propia máquina — típicamente para
tener el emulador corriendo de forma persistente y accesible desde cualquier lugar, sin depender de
que tu laptop esté prendida.

Este documento **no repite los conceptos de AWS/Docker/Lambda/IAM** — esos ya están explicados con
calma en la guía local. Acá el foco es exclusivamente **la diferencia**: cómo cambia el mismo
procedimiento cuando Floci corre en un VPS en vez de en tu máquina, y el concepto nuevo que eso
introduce (el túnel SSH).

También acompaña a [`plataforma/PLAN.md`](../../../plataforma/PLAN.md), que registra el análisis de
factibilidad y el historial real de lo implementado a nivel de plataforma.

---

## Índice

1. [Qué cambia respecto a correr esto en local](#1-qué-cambia-respecto-a-correr-esto-en-local)
2. [Túnel SSH: cómo trabajar "en local" contra un servidor remoto](#2-túnel-ssh-cómo-trabajar-en-local-contra-un-servidor-remoto)
3. [Arquitectura de la solución](#3-arquitectura-de-la-solución)
4. [Prerrequisitos](#4-prerrequisitos)
5. [ETAPA 1 — Instalar Floci con Docker en el VPS](#etapa-1--instalar-floci-con-docker-en-el-vps)
6. [ETAPA 2 — Lambda "Hello World"](#etapa-2--lambda-hello-world)
7. [Problemas comunes específicos del VPS](#7-problemas-comunes-específicos-del-vps)
8. [Qué aprendiste](#8-qué-aprendiste)
9. [Próximos pasos](#9-próximos-pasos)

---

## 1. Qué cambia respecto a correr esto en local

Todo el contenido de la guía local — qué es Floci, Docker-out-of-Docker, AWS CLI/endpoint/perfiles,
Lambda (handler/runtime/cold start), IAM (roles/políticas), Function URL — es **idéntico** acá.
Floci no sabe ni le importa si corre en tu laptop o en un servidor: es el mismo contenedor Docker en
ambos casos.

Lo único que cambia es el **acceso**: en vez de hablarle a `http://localhost:4566` directamente
(porque Floci corre en la misma máquina que tu AWS CLI), acá Floci corre en un servidor remoto, así
que necesitamos un mecanismo para "traer" ese puerto a tu máquina de forma segura — un **túnel
SSH** — sin exponer el puerto 4566 a todo internet (Floci no tiene autenticación real, así que
exponerlo públicamente le daría a cualquiera control sobre tu Docker del servidor, ver la nota de
seguridad en la sección 5).

---

## 2. Túnel SSH: cómo trabajar "en local" contra un servidor remoto

Como Floci corre en un VPS (un servidor remoto) y no en tu propia laptop, pero queremos trabajar
"como si fuera local" **sin exponer el puerto 4566 a todo internet**, usamos un **túnel SSH**:

```
tu-computador:4566  ──(túnel cifrado por SSH)──►  VPS:4566 (donde vive Floci)
```

El comando `ssh -L 4566:localhost:4566 usuario@vps` le dice a SSH: "todo lo que llegue al puerto
4566 de mi computador, reenvíalo (de forma cifrada) al puerto 4566 del VPS". Así, tu AWS CLI local
habla con `http://localhost:4566` sin saber que en realidad está cruzando internet hasta el VPS.

---

## 3. Arquitectura de la solución

![Arquitectura: Floci (emulador AWS) + Lambda Hello World](./imgs/Arquitectura%20Floci%20+%20Lambda%20Hello%20World.png)

El diagrama muestra el flujo completo: tu computador (AWS CLI + navegador) conectando por túnel SSH
al VPS de Hostinger, el contenedor de Floci (con acceso a `/var/run/docker.sock`), la función Lambda
con su rol IAM, la Function URL como punto de entrada HTTP, y el contenedor real y efímero que
Lambda crea bajo demanda (`public.ecr.aws/lambda/nodejs:22`).

Versión editable en Lucidchart: [Arquitectura Floci + Lambda Hello World](https://lucid.app/lucidchart/7a80e71d-d0ea-489c-be55-ba8a28382175/edit)

---

## 4. Prerrequisitos

- Un VPS Linux con Docker y Docker Compose instalados (en nuestro caso, Ubuntu 24.04 con Docker,
  plan Hostinger KVM 4).
- Acceso SSH al VPS (usuario con permisos para administrar Docker).
- En tu computador: cliente SSH (viene por defecto en Linux/Mac/WSL; en Windows puedes usar el de
  OpenSSH o PuTTY).
- AWS CLI v2 instalado en tu computador.
- Conocimientos mínimos de terminal/bash.

---

## ETAPA 1 — Instalar Floci con Docker en el VPS

### 1.1 Crear el archivo `docker-compose.yml`

Crea una carpeta para el proyecto en el VPS (por ejemplo `/docker/floci/`) y dentro un archivo
`docker-compose.yml`:

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

Esto es lo mismo que en local, con dos diferencias a tener en cuenta:

- `restart: unless-stopped` importa más acá: si el VPS se reinicia, Docker vuelve a levantar el
  contenedor solo, sin que tengas que entrar a hacerlo a mano.
- `ports: "127.0.0.1:4566:4566"` es **crítico** en un VPS (no opcional como en local): el binding a
  `127.0.0.1` en vez de `0.0.0.0` significa que el puerto 4566 solo es alcanzable **desde el propio
  VPS**, nunca desde internet. Como Floci no tiene autenticación real, si esto fuera
  `0.0.0.0:4566:4566` cualquiera en internet tendría control total sobre el Docker del servidor.

> ⚠️ **Nota de seguridad importante**: montar `docker.sock` le da al contenedor de Floci control
> total sobre el Docker del host (equivalente a acceso root). Es razonable en un VPS personal de
> desarrollo, siempre que el puerto 4566 **nunca** se exponga públicamente.

### 1.2 Levantar el contenedor

Desde la carpeta donde está el `docker-compose.yml`:

```bash
docker compose up -d
```

### 1.3 Verificar que está corriendo

```bash
docker ps --filter "name=floci"
curl http://127.0.0.1:4566/_localstack/health
```

Si ves `"lambda": "running"` y `"rds": "running"`, el socket de Docker quedó bien configurado.

### 1.4 Configurar el túnel SSH desde tu computador

Desde tu computador (no desde el VPS):

```bash
ssh -f -N -L 4566:localhost:4566 usuario@ip-del-vps
```

- `-f`: corre en segundo plano.
- `-N`: no ejecutes ningún comando remoto, solo redirige el puerto.
- `-L 4566:localhost:4566`: redirige el puerto 4566 local hacia el puerto 4566 del VPS (visto desde
  el propio VPS, por eso `localhost`).

Verifica que el túnel esté escuchando:

```bash
ss -tlnp | grep 4566   # Linux
# o: lsof -i :4566      # Mac
```

### 1.5 Configurar el perfil de AWS CLI

```bash
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

### 1.6 Prueba de humo

```bash
aws s3 mb s3://floci-smoke-test --profile floci
aws s3 ls --profile floci
```

Si ves el bucket listado, **Floci está funcionando de punta a punta**: tu AWS CLI real, hablando con
un emulador en un VPS remoto, a través de un túnel cifrado, respondiendo igual que la AWS real.

---

## ETAPA 2 — Lambda "Hello World"

A partir de acá, el procedimiento es **idéntico** al de la guía local (crear el rol IAM, empaquetar
el código, publicar la función, invocarla, crear la Function URL, dar el permiso público) — la
única diferencia ya la hicimos: el túnel SSH activo hace que `http://localhost:4566` te lleve al
VPS en vez de a tu propia máquina, así que todos los comandos son literalmente los mismos.

### 2.1 Escribir el código de la función

Crea una carpeta `lambda/` dentro de la carpeta del proyecto (en nuestro caso
`proyectos/hello-world/lambda/`) con un archivo `index.js`:

```javascript
exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: "<html><body><h1>Hello World</h1><p>Servido desde Lambda emulado por Floci en el VPS.</p></body></html>"
  };
};
```

### 2.2 Empaquetar el código en un `.zip`

```bash
cd proyectos/hello-world/lambda
zip -r function.zip index.js
```

### 2.3 Crear el rol de IAM que la función va a "asumir"

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

El resultado incluye un **ARN** con el formato `arn:aws:iam::000000000000:role/lambda-hello-role` —
vas a necesitarlo en el siguiente paso.

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

### 2.5 Invocar la función directamente (sin HTTP) para probar

```bash
aws lambda invoke --function-name hello-world --profile floci salida.json
cat salida.json
```

Si revisas los contenedores del VPS en ese momento (`docker ps`), vas a ver aparecer brevemente un
contenedor con imagen `public.ecr.aws/lambda/nodejs:22` — la prueba de que Floci usa el runtime real
de Lambda.

### 2.6 Crear la Function URL (exponerla por HTTP)

```bash
aws lambda create-function-url-config \
  --function-name hello-world \
  --auth-type NONE \
  --profile floci
```

El comando devuelve un JSON con el campo `FunctionUrl`, algo como:

```
http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

### 2.7 Dar permiso explícito de invocación pública

```bash
aws lambda add-permission \
  --function-name hello-world \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --profile floci
```

### 2.8 Probar el Hello World

Con el túnel SSH activo, abre en el navegador (o con `curl`) la URL que te devolvió el paso 2.6:

```bash
curl http://<id-aleatorio>.lambda-url.us-east-1.localhost:4566/
```

Deberías ver el HTML "Hello World" devuelto por tu función — cruzando el túnel SSH hasta el VPS y
de vuelta.

**Felicitaciones: acabas de desplegar e invocar tu primera función Lambda en un servidor remoto,
expuesta por HTTP, corriendo en un runtime real de AWS, sin gastar un centavo ni tener cuenta de
AWS.**

---

## 7. Problemas comunes específicos del VPS

*(Para problemas de Docker/Lambda que no tienen que ver con el VPS en sí — puerto ocupado
localmente, memoria de Docker Desktop, imagen de Lambda faltante, etc. — ver la sección de
problemas comunes de [`GUIA-LOCAL-DOCKER.md`](./GUIA-LOCAL-DOCKER.md), que aplican igual acá.)*

| Síntoma | Causa probable | Solución |
|---|---|---|
| El túnel SSH se cierra solo | Conexión inestable o timeout | Agregar `-o ServerAliveInterval=30` al comando `ssh` |
| `curl: (7) Failed to connect` al probar Floci | El túnel no está activo, o Floci no está corriendo en el VPS | Verificar `docker ps` en el VPS y que el túnel siga vivo (`ss -tlnp \| grep 4566` en tu computador) |
| "REMOTE HOST IDENTIFICATION HAS CHANGED" al hacer SSH | El VPS fue reinstalado/restaurado desde backup (regenera las claves del host) | Verificar por un canal confiable (panel del proveedor) que el cambio es legítimo antes de aceptar la nueva clave |
| Lambda no arranca / RDS no funciona en el VPS | Falta el montaje de `/var/run/docker.sock` en el `docker-compose.yml` del VPS | Revisar el `docker-compose.yml` |
| Puerto 4566 ocupado en el VPS | Otro proceso usando ese puerto en el servidor | Verificar con `ss -tlnp \| grep 4566` en el VPS y detener el proceso conflictivo, o cambiar el puerto |

---

## 8. Qué aprendiste

Los conceptos de AWS (Lambda, IAM, Function URL, etc.) ya los aprendiste en
[`GUIA-LOCAL-DOCKER.md`](./GUIA-LOCAL-DOCKER.md#8-qué-aprendiste). Lo nuevo específico de este
documento:

- [x] Cómo exponer un servicio remoto de forma segura con un túnel SSH, sin abrir puertos a
      internet.
- [x] Por qué el binding `127.0.0.1` (no `0.0.0.0`) es crítico en un `docker-compose.yml` que corre
      en un servidor compartido.

---

## 9. Próximos pasos

- **Si todavía no pasaste por la guía local**, [`GUIA-LOCAL-DOCKER.md`](./GUIA-LOCAL-DOCKER.md)
  tiene la explicación completa de todos los conceptos de AWS usados acá (Lambda, IAM, Function
  URL, Docker-out-of-Docker), pensada para aprender sin depender de ningún servidor.
- Con Floci y tu primera Lambda funcionando (en local o en VPS), el siguiente nivel (documentado
  como Fase 6 en [`plataforma/PLAN.md`](../../../plataforma/PLAN.md)) es construir el **Quiz con
  sistema de ranking**, como un nuevo proyecto independiente en `proyectos/quiz/`:
  1. Aprovisionar una base de datos RDS (Postgres) emulada por Floci.
  2. Diseñar el esquema (usuarios, puntajes).
  3. Conectar una Lambda (o backend en contenedor) a esa base de datos.
  4. Exponer el frontend del Quiz, reutilizando la infraestructura ya montada.
