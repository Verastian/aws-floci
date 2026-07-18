# Plan de implementación: Emulador AWS (Floci) en VPS Hostinger

**Fecha:** 2026-07-03
**Fuente de la investigación:** documentación oficial [floci.io](https://floci.io/), [floci.io/aws](https://floci.io/aws/), [floci.io/floci/getting-started/quick-start](https://floci.io/floci/getting-started/quick-start/), [floci.io/floci/configuration/docker](https://floci.io/floci/configuration/docker/) y repositorio [github.com/floci-io/floci](https://github.com/floci-io/floci).
**Estado:** Implementado hasta Fase 4 inclusive (Hello World funcionando de punta a punta). Pendiente: Fase 5 (endurecimiento) y Fase 6 (Quiz, a futuro).

---

## 1. Resumen ejecutivo

**Sí es técnicamente factible** desplegar Floci en Docker en tu VPS de Hostinger, acceder vía AWS CLI desde tu equipo local (mediante túnel SSH, según lo definiste) y desplegar un "Hello World" con Lambda + Function URL, con una ruta clara de crecimiento hacia el Quiz con base de datos (RDS emulado).

Con un matiz importante que no hay que perder de vista: Floci **no es una réplica 1:1 de AWS**, es un emulador de alta fidelidad para un subconjunto grande de servicios (66+), donde algunos (Lambda, RDS, ECS, ElastiCache, EKS, OpenSearch, MSK, Athena, EC2, CodeBuild) corren motores **reales** dentro de contenedores Docker hermanos, y otros (S3, SQS, SNS, DynamoDB, IAM, KMS, API Gateway, Step Functions, CloudFormation, etc.) son implementaciones de protocolo en memoria/proceso. Para tu caso de uso (Lambda + Function URL, y luego RDS Postgres) caes justo en los servicios con **ejecución real**, que es la mejor fidelidad posible sin usar la nube real.

Decisiones ya confirmadas contigo:

- **Acceso "local"**: túnel SSH (`ssh -L 4566:localhost:4566 ...`), el puerto 4566 **no** se expone a internet.
- **Ejecución de comandos**: acceso SSH directo como `root` al VPS para que yo ejecute los pasos (con confirmación previa en pasos riesgosos).
- **Arquitectura del Hello World**: Lambda + Function URL.
- **Specs del VPS (confirmadas vía API de Hostinger)**: Hostinger KVM 4 — Ubuntu 24.04 con Docker ya instalado, 4 vCPU / 16 GB RAM, 200 GB disco, IP pública `<TU-IP-VPS>`, hostname `<TU-HOSTNAME-VPS>`, data center São Paulo, creado 2025-10-27. **Sobran recursos** para Lambda + RDS + ECS emulados simultáneamente vía Docker-out-of-Docker.
- **El VPS ya está "en ejecución" con otros proyectos activos** (ver sección 3.10) — el plan se ajustó para no interferir con ellos y para reutilizar el `nginx-proxy-manager` ya desplegado cuando llegue la fase de exposición pública del Hello World/Quiz.
- **Pendiente**: verificar conectividad SSH efectiva (hubo una alerta de cambio de host key, ver sección 3.11 — ya explicada y no bloqueante) y lenguaje de la Lambda del Hello World (Node.js o Python).

---

## 2. Qué es Floci (según su documentación)

- Conjunto de emuladores de nube open source (licencia MIT, "always free", sin cuenta ni token de licencia) para AWS, Azure y GCP. Nuestro foco es el emulador **AWS**, expuesto en el puerto **4566**.
- Se distribuye como imagen Docker (`floci/floci:latest`, variante nativa GraalVM Mandrel — arranque ~24ms, ~13MiB en idle) o `floci/floci:latest-jvm` (más compatible entre plataformas, más pesada).
- Es "drop-in replacement" de LocalStack: mismos SDKs, misma AWS CLI, mismo Terraform/CDK, apuntando el endpoint a `http://localhost:4566` con credenciales dummy (`AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`).
- Soporta **66+ servicios AWS**. Los que requieren fidelidad real (Lambda, RDS, ElastiCache, ECS, EKS, OpenSearch, MSK/Kafka vía Redpanda, Athena vía DuckDB, EC2, CodeBuild, DocumentDB, Amazon MQ, Batch) **orquestan contenedores Docker reales** desde dentro del contenedor de Floci — para eso necesita acceso al **socket de Docker del host** (`/var/run/docker.sock`).
- Sin ese socket montado: Lambda, RDS y ElastiCache **no funcionan**; en cambio S3, SQS, SNS, DynamoDB, IAM, STS y KMS sí funcionan igual (son in-process).
- Persistencia configurable vía `FLOCI_STORAGE_MODE` (memoria / persistente / híbrida / WAL) + volumen montado (`./data:/app/data`).

---

## 3. Análisis de factibilidad técnica detallado

### 3.1 Docker en el VPS — Factible

Requiere Docker 20.10+ y Docker Compose v2 (plugin, no standalone). Cualquier VPS Linux moderno de Hostinger (Ubuntu 22.04/24.04 recomendado) lo soporta sin problema.

### 3.2 Ejecución de Lambda/RDS/ECS vía socket de Docker (Docker-out-of-Docker) — Factible, con implicancia de seguridad relevante

Floci no usa Docker-in-Docker anidado; monta el socket del **host** dentro del contenedor de Floci (`-v /var/run/docker.sock:/var/run/docker.sock`), y desde ahí lanza contenedores **hermanos** en el propio Docker del VPS. Esto es un patrón estándar y funciona bien en un VPS, pero:

> **Montar `docker.sock` da al contenedor de Floci control equivalente a root sobre todo el Docker del host.** Es aceptable para un VPS personal de desarrollo (no compartido con otros usuarios/servicios críticos), siempre que **no expongamos el puerto 4566 a internet** — que es justamente la decisión que tomaste (solo vía túnel SSH). Si en el futuro decides exponerlo públicamente, este riesgo se vuelve crítico porque Floci **no implementa autenticación real** (acepta cualquier credencial).

### 3.3 Recursos del VPS — Confirmado, sobran recursos

Aunque Floci en sí es liviano (~13 MiB idle gracias a compilación nativa), **cada servicio Docker-backed que uses (Lambda al invocar, RDS mientras la BD esté "levantada", ElastiCache, ECS) suma contenedores reales corriendo en paralelo** (ej. un Postgres real, un Redis real, contenedores de runtime de Lambda). Para el Hello World (solo Lambda + Function URL) el consumo es mínimo. Para el Quiz con RDS Postgres persistente, hay que sumar el consumo normal de un Postgres real (~100-300MB de RAM en reposo).

**Piso técnico recomendado:** 2 vCPU / 4GB RAM / 40GB+ disco como mínimo cómodo. **VPS confirmado:** Hostinger KVM 4, 4 vCPU / 16 GB RAM / 200 GB disco, Ubuntu 24.04, Docker ya instalado — muy por encima del piso recomendado, con margen amplio para correr Lambda + RDS + ElastiCache + ECS simultáneamente sin problemas de recursos.

### 3.4 Acceso "local" vía túnel SSH — Factible, es el enfoque correcto para tu caso

No se abre ningún puerto de Floci en el firewall público del VPS. Desde tu equipo:

```bash
ssh -N -L 4566:localhost:4566 usuario@tu-vps
```

Y tu AWS CLI local apunta a `http://localhost:4566` (tal como si Floci corriera en tu propia máquina). Esto es 100% consistente con la documentación (Floci no exige que el cliente y el servidor estén en la misma máquina, solo que el endpoint sea alcanzable).

### 3.5 AWS CLI real contra Floci — Factible

Se configura un perfil de AWS CLI local con:

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

Todos los comandos (`aws s3 mb`, `aws lambda create-function`, `aws dynamodb create-table`, etc.) funcionan igual que contra AWS real, apuntando al endpoint local (vía el túnel).

### 3.6 Hello World con Lambda + Function URL — Factible

Camino: crear función Lambda (Node.js o Python), publicarla con `aws lambda create-function` contra el endpoint de Floci, crear una **Function URL** pública (emulada) con `aws lambda create-function-url-config`, e invocarla con `curl`/navegador **a través del túnel SSH**. Esto requiere el socket de Docker montado (ver 3.2), porque Lambda corre en un contenedor Docker real.

### 3.7 Evolución al Quiz con usuarios/ranking y persistencia (RDS) — Factible, no se implementa aún

RDS (Postgres) en Floci también es Docker-backed (motor Postgres real). El mismo patrón de acceso (túnel SSH + AWS CLI + SDK apuntando al endpoint) aplica. La app del quiz (backend en Lambda o contenedor) se conectaría a la instancia RDS emulada. Se deja fuera del alcance de esta fase, pero la arquitectura elegida (Lambda + Function URL) es compatible y escala naturalmente agregando RDS después.

### 3.8 "¿Es completamente igual a trabajar con la nube real?" — Matizado, no absoluto

- **Para los servicios que usamos (Lambda, Function URL, y más adelante RDS)**: sí, alta fidelidad, motores reales, mismos SDK/CLI.
- **Servicios in-memory (S3, DynamoDB, SNS, SQS, IAM, API Gateway, CloudFormation, etc.)**: implementan el protocolo AWS pero son reimplementaciones, no el motor real — comportamiento equivalente en el 95% de los casos de uso de desarrollo, pero pueden existir diferencias de borde no documentadas (límites exactos de throttling, ciertos detalles de IAM policy evaluation, etc.).
- **Servicios explícitamente stub** (según el propio proyecto): Bedrock Runtime, Transcribe, entre otros — compatibles a nivel de API pero no funcionales de verdad. No están en el alcance de tu proyecto, así que no aplica.
- **Networking/VPC**: la documentación no detalla si hay emulación completa de VPC/subnets a nivel de red real; probablemente simplificada. No es relevante para Lambda+Function URL ni para RDS básico, pero lo señalo para que no se asuma paridad total si más adelante se quisiera emular arquitecturas de red complejas.

### 3.10 Estado actual real del VPS — Verificado vía API oficial de Hostinger (`developers.hostinger.com`, endpoints `/api/vps/v1/...`)

El VPS ya tiene **6 proyectos Docker Compose corriendo** en producción (gestionados vía el "Docker Manager" del panel de Hostinger):

| Proyecto                   | Imagen                             | Puerto(s) host    | Acción                                                                                 |
| -------------------------- | ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `n8n-10tp`                 | n8n                                | 5678              | no tocar                                                                               |
| `nginx-proxy-manager-q62k` | jc21/nginx-proxy-manager           | 80, 443, 32770→81 | **reutilizar** para exponer el Hello World/Quiz más adelante (decisión tomada contigo) |
| `ollama-581e`              | ollama                             | 32768→11434       | no tocar                                                                               |
| `postgres-pgvector`        | pgvector/pgvector:pg17             | 5433              | no tocar                                                                               |
| `postgresql-psf6`          | postgres:17                        | 32769→5432        | no tocar                                                                               |
| `restart-aws-labs`         | ghcr.io/verastian/restart-aws-labs | 8080              | **no relacionado, no tocar** (confirmado contigo)                                      |

Implicancias para el plan:

- Puerto **4566** (Floci) y los rangos **5000-5099** (ECR) y **9200-9299** (Lambda Runtime API) están libres, sin colisión con lo anterior.
- Al definir la red Docker de Floci, evitar cualquier solapamiento de nombre/red con los proyectos existentes.
- La exposición pública futura del Hello World/Quiz (Fase 6+) se hará agregando un _proxy host_ nuevo en `nginx-proxy-manager-q62k` en lugar de instalar un proxy adicional.

> Nota metodológica: esta verificación se hizo consultando la **API REST oficial de Hostinger** (`https://developers.hostinger.com/api/vps/v1/...`) con un token que me proporcionaste, en modo solo-lectura (`GET`), antes de tocar nada por SSH. Te recomendé (y recomiendo de nuevo) rotar ese token en hPanel una vez cerremos este trabajo, ya que quedó en texto plano en el historial de este chat.

### 3.11 Alerta de host key SSH — Investigada y explicada, no bloqueante

Al intentar la primera conexión SSH apareció una advertencia de "REMOTE HOST IDENTIFICATION HAS CHANGED". Se investigó el historial de acciones de la VPS vía la API de Hostinger (`GET /virtual-machines/{id}/actions`) y se encontraron eventos `ct_recreate` (2026-02-26) y `backup_restore` (2026-06-08) — ambas operaciones legítimas de la propia cuenta que regeneran/restauran las claves de host SSH. **No hay indicio de ataque; el cambio es explicable por el propio historial de la cuenta.** Queda pendiente actualizar `known_hosts` en el equipo local para continuar.

### 3.12 Veredicto

No hay ningún requerimiento tuyo que choque con lo documentado. **No se requieren soluciones inventadas ni fuera de lo soportado por Floci.** El único punto abierto es dimensionar el VPS y confirmar acceso SSH, ambos ítems de checklist, no bloqueadores de factibilidad.

---

## 4. Riesgos y consideraciones a monitorear

- **Docker socket = acceso root-equivalente**: mitigado al no exponer el puerto públicamente (ya decidido).
- **Sin autenticación real en Floci**: cualquiera que llegue al puerto 4566 tiene control total del "AWS" emulado y, transitivamente, del Docker del host. Mantener el túnel SSH como único canal.
- **Consumo de recursos acumulado**: si luego se agregan RDS + ElastiCache + Lambdas simultáneas, revisar RAM/CPU real del VPS con `docker stats`.
- **Persistencia**: usar `FLOCI_STORAGE_MODE=persistent` (o `hybrid`) + volumen nombrado o bind mount, y respaldar ese volumen periódicamente (no hay alta disponibilidad ni snapshotting automático).
- **Actualizaciones de imagen**: fijar una versión de tag (no solo `latest`) una vez estabilizado el entorno, para evitar cambios de comportamiento inesperados entre versiones.

---

## 5. Checklist del plan de trabajo

> Convención: `[ ]` pendiente, se irá marcando `[x]` a medida que se ejecute y verifique cada paso durante la implementación.

### Fase 0 — Prerrequisitos (bloqueante, antes de tocar el VPS)

- [x] Confirmar specs del VPS Hostinger: KVM 4, Ubuntu 24.04, 4 vCPU / 16 GB RAM, 200 GB disco, Docker ya instalado, IP `<TU-IP-VPS>` (`<TU-HOSTNAME-VPS>`). _(Verificado vía API oficial de Hostinger)_
- [x] Inventariar servicios ya corriendo en el VPS para no interferir (ver 3.10): n8n, nginx-proxy-manager, ollama, 2x postgres, restart-aws-labs.
- [x] Confirmar que puerto 4566 y rangos de ECR/Lambda Runtime API están libres (sin colisión con lo existente).
- [x] Investigar y explicar la alerta de cambio de host key SSH (ver 3.11) — resuelta, no bloqueante.
- [x] Confirmar conectividad SSH efectiva como `root` con la clave ya registrada (`verastian-wsl`) tras actualizar `known_hosts`. Docker 29.2.1 y Docker Compose v5.0.2 confirmados en el VPS.
- [ ] Definir el lenguaje de la función Lambda del Hello World (Node.js o Python — a definir contigo si no se indica).

### Fase 1 — Preparación del VPS

- [x] Verificar Docker Engine y Compose: **Docker 29.2.1**, **Docker Compose v5.0.2**, ya instalados.
- [x] Acceso confirmado como `root` (no se requiere gestión de grupo `docker`/`sudo` aparte).
- [x] Puerto 4566 mapeado únicamente a `127.0.0.1` (verificado con `ss -tlnp`: `127.0.0.1:4566`, no `0.0.0.0`) — no requirió cambios de firewall porque nunca se expuso públicamente.
- [x] Proyecto creado en `/docker/floci/` (convención nativa del Docker Manager de Hostinger) con subcarpeta `data/` para persistencia.

### Fase 2 — Despliegue de Floci

- [x] `docker-compose.yml` desplegado con imagen `floci/floci:latest`, puerto `127.0.0.1:4566:4566`, volumen `./data:/app/data`, y montaje de `/var/run/docker.sock`. Desplegado vía el endpoint nativo `POST /docker` de la API de Hostinger (queda visible/gestionable también desde hPanel).
- [x] Red Docker explícita (`floci_default`, vía `FLOCI_SERVICES_DOCKER_NETWORK`) para que los contenedores Docker-backed se resuelvan correctamente.
- [x] Stack levantado (`floci-floci-1`, estado `Up ... (healthy)`), sin errores en el log de build/deploy.
- [x] Prueba de salud: `GET http://127.0.0.1:4566/_localstack/health` → `200 OK`, versión `1.5.30`, edición `floci-always-free`, con **todos los servicios en estado `running`** (incluyendo `lambda`, `rds`, `ecr`, `apigateway`, `apigatewayv2`, `ecs`, `eks`).
- [ ] Fijar versión de imagen (evitar `latest`) — pendiente para Fase 5, una vez estabilizado el entorno.

### Fase 3 — Acceso "local" desde tu equipo

- [x] Túnel SSH activo en segundo plano (`ssh -f -N -L 4566:localhost:4566 root@<TU-IP-VPS>`).
- [x] AWS CLI v2 instalado (`aws-cli/2.35.15`).
- [x] Perfil dedicado `floci` creado con credenciales dummy (`test`/`test`), región `us-east-1` y `endpoint_url = http://localhost:4566`.
- [x] Prueba de humo exitosa: `aws s3 mb s3://floci-smoke-test --profile floci`, `aws s3 ls`, `aws dynamodb list-tables`, `aws lambda list-functions` — todos responden como en AWS real.
- [x] **(2026-07-04) Túnel convertido en servicio persistente**: el `ssh -f -N` manual se caía cada vez que se cerraba la sesión/se reiniciaba el equipo (causó una caída real del Quiz, ver `proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §2), sin que el contenedor de Floci en el VPS se viera afectado. Se reemplazó por `autossh` + una unidad de `systemd` (`Restart=always`) que reconecta solo ante cortes de red o caídas del proceso. Configuración: `plataforma/.env` (IP real del VPS y demás valores, **no versionado**, plantilla en `plataforma/.env.example`), `plataforma/scripts/floci-tunnel.sh` y `plataforma/systemd/floci-tunnel.service`. Probado matando el proceso ssh manualmente: `systemd` lo relanzó solo en ~5 segundos.

### Fase 4 — Hello World (Lambda + Function URL) — COMPLETADA

- [x] Función Lambda Node.js escrita en [`proyectos/hello-world/lambda/index.js`](../proyectos/hello-world/lambda/index.js).
- [x] Empaquetada y publicada: `aws lambda create-function --function-name hello-world --runtime nodejs22.x ...` (rol IAM `lambda-hello-role` creado antes).
- [x] Function URL pública creada + permiso `FunctionURLAllowPublicAccess`: `http://e84479a5e7313a7bacb73db1304d8e48.lambda-url.us-east-1.localhost:4566/`.
- [x] `aws lambda invoke` confirmó ejecución real en contenedor Docker `public.ecr.aws/lambda/nodejs:22` (imagen oficial de Lambda, no un mock).
- [x] `curl` a la Function URL a través del túnel SSH → `200 OK`, HTML "Hello World" servido correctamente. **Verificable en el navegador local con el túnel activo.**

### Fase 5 — Endurecimiento y mantenimiento

- [x] **(2026-07-18) Guard contra pérdida de la imagen del runtime de Lambda**: un cron preexistente del VPS, ajeno a este repo (`/etc/cron.d/docker-image-prune`, `docker image prune -af --filter "until=24h"`, diario 00:41 UTC), borra `public.ecr.aws/lambda/nodejs:22` en cuanto queda sin contenedores activos referenciándola — y como Floci destruye el contenedor de cada invocación de Lambda al terminar, eso pasa tarde o temprano. Causó una caída real y visible de las 13 Lambdas de los 3 proyectos (`hello-world`, `quiz`, `quiz-avanzado`), todas con `Lambda.InitError: No such image`. Se agregó un timer de `systemd` que restaura la imagen automáticamente si falta, mismo patrón autocurativo que el túnel de Fase 3 pero del lado del VPS: `plataforma/scripts/floci-lambda-runtime-guard.sh` + `plataforma/systemd/floci-lambda-runtime-guard.{service,timer}` (corre a las 00:45 UTC y en cada arranque), instalado en `/opt/floci/` y `/etc/systemd/system/` del VPS, habilitado con `systemctl enable --now floci-lambda-runtime-guard.timer`. Detalle completo del incidente: [`proyectos/quiz/docs/ARQUITECTURA.md` §15](../proyectos/quiz/docs/ARQUITECTURA.md#15-incidente-caída-completa-del-quiz-por-pérdida-de-la-imagen-del-runtime-de-lambda-2026-07-18).
- [ ] Fijar versión de imagen de Floci (evitar `latest` en el `docker-compose.yml` final).
- [ ] Documentar procedimiento de backup del volumen de datos.
- [ ] Documentar procedimiento de reinicio/actualización del stack.
- [ ] (Opcional) Configurar arranque automático de Floci al reiniciar el VPS (`restart: unless-stopped` en compose).

### Fase 6 — Evolución futura hacia el Quiz (no se ejecuta todavía, queda planificado)

- [ ] Definir stack del Quiz (backend Lambda/contenedor + frontend estático).
- [ ] Aprovisionar RDS Postgres emulado (Docker-backed) vía Floci para persistencia de usuarios/ranking.
- [ ] Diseñar esquema de datos (usuarios, puntajes, ranking).
- [ ] Conectar backend del Quiz a la instancia RDS emulada usando el mismo endpoint/túnel.
- [ ] Definir estrategia de exposición del frontend (Function URL, API Gateway, o contenedor ECS con reverse proxy).

---

## 6. Cómo reabrir el acceso local (para tu día a día)

**Desde 2026-07-04 esto ya no requiere acción manual**: el túnel corre como servicio de `systemd` (`floci-tunnel.service`, ver Fase 3) y se reconecta solo. Para confirmar que está activo:

```bash
systemctl status floci-tunnel.service
curl http://localhost:4566/_localstack/health
```

Si por algún motivo el servicio no está corriendo (por ejemplo, en un equipo nuevo donde todavía no se instaló, o en WSL si la instancia estuvo completamente apagada — ver el límite conocido en `proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §2.4), se puede levantar el túnel manualmente como antes:

```bash
ssh -f -N -L 4566:localhost:4566 root@<TU-IP-VPS>
```

Y usa el perfil ya configurado para cualquier comando de AWS CLI:

```bash
aws s3 ls --profile floci
aws lambda list-functions --profile floci
```

(El perfil `floci` en `~/.aws/config` ya apunta a `http://localhost:4566` con credenciales dummy `test`/`test`.)

Para volver a abrir el Hello World en el navegador (con el túnel activo):

```bash
http://e84479a5e7313a7bacb73db1304d8e48.lambda-url.us-east-1.localhost:4566/
```

## 7. Pendientes para continuar

- **Fase 5** (endurecimiento): fijar versión de imagen de Floci, documentar backup del volumen `./data`, decidir si se agrega `restart: unless-stopped` (ya incluido) para sobrevivir a reinicios del VPS.
- **Fase 6** (Quiz): cuando quieras avanzar, definimos esquema de datos, levantamos RDS Postgres emulado vía Floci, y conectamos el backend — reutilizando el mismo túnel/perfil y, para la exposición pública, el `nginx-proxy-manager` ya activo en tu VPS.
- **Seguridad**: recuerda rotar el token de API de Hostinger que compartiste en este chat, desde hPanel.
