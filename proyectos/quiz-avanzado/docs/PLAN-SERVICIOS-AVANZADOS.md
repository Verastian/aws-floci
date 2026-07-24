# Plan de trabajo: Servicios avanzados de AWS para el Quiz Avanzado

> **Este documento es el plan vigente**, movido/adaptado desde el `PLAN-SERVICIOS-AVANZADOS.md` del
> Quiz original el 2026-07-05 al crear este fork (ese archivo ya no existe ahí, para no tener dos
> copias de la misma verdad — ver "Contexto de este fork" más abajo). Las Fases 2-8 se implementan **aquí**, contra `quiz-avanzado`
> (su propia RDS, Lambdas, API y bucket — ver "Contexto de este fork" más abajo), nunca contra el
> Quiz original, que ya está público y en uso real. Para entender el diseño de la aplicación en sí
> (modelo de datos, puntaje, medallas, tema claro/oscuro, etc. — es el mismo código, sin cambios),
> ver [`proyectos/quiz/docs/ARQUITECTURA.md`](../../quiz/docs/ARQUITECTURA.md) del proyecto
> original; aquí solo se documenta lo específico de este fork y de los servicios avanzados.

**Fecha:** 2026-07-04, actualizado 2026-07-23
**Estado:** Fase 1 heredada del original (ver abajo, no requiere trabajo aquí). Fase 2 (CloudWatch: Logs + Metrics + Alarms) implementada y probada a fondo el 2026-07-23. El resto sigue planificado.
**Documento hermano:** [`GUIA-SERVICIOS-AVANZADOS.md`](./GUIA-SERVICIOS-AVANZADOS.md) — ahí se explica el concepto de cada servicio y se irá documentando cómo quedó implementado, fase por fase.

---

## Contexto de este fork (2026-07-05)

- **Motivo**: desarrollar los servicios avanzados de AWS de este plan (Secrets Manager, KMS, CloudTrail, SNS, EventBridge, WAF, CloudFormation, Cognito) sin arriesgar el Quiz original, que ya está en uso público real.
- **Recursos creados** (independientes de los del original): RDS `quiz-avanzado-db` (Postgres 17, endpoint interno `172.22.0.2:7002`, base `quiz_avanzado`); 6 Lambdas `quiz-avanzado-{categories,questions,answer,submit,ranking,badges}`, cada una con su rol IAM propio; API Gateway HTTP API `quiz-avanzado-api` (id `a7f3682d91`) con las mismas 6 rutas; bucket S3 `quiz-avanzado-frontend` con hosting estático.
- **Datos**: el esquema se aplicó desde cero (`db/schema.sql`); los datos reales (169 preguntas, 697 opciones, 169 explicaciones) se copiaron por `pg_dump`/`psql` directamente desde la RDS del Quiz original (`quiz-db`), ya que los JSON originales (`data/`) se habían eliminado tiempo atrás tras la carga inicial — no se volvió a correr `db/seed.js`. El `ranking` se dejó **vacío a propósito** (es un fork nuevo, no tiene sentido arrastrar puntajes del original).
- **Frontend**: único cambio de código respecto al original es `API_ID` en `frontend/app.js`, apuntando a `a7f3682d91`.
- **Acceso público**: confirmado funcionando de inmediato en `https://floci.devera.cloud/site/quiz-avanzado-frontend/` y `https://floci.devera.cloud/restapis/a7f3682d91/$default/_user_request_/...`, sin ningún cambio en `nginx-proxy-manager` (ver Fase 1 en `GUIA-SERVICIOS-AVANZADOS.md`).
- **Incidente encontrado de paso (no relacionado con este fork)**: durante las pruebas, `public.ecr.aws/lambda/nodejs:22` (la imagen Docker que Floci usa para correr cualquier Lambda Node 22, del original o de este fork) había desaparecido del caché de Docker del VPS, causando 502 (`Lambda.InitError: No such image`) en **todas** las Lambdas de ambos proyectos. Se resolvió con `docker pull public.ecr.aws/lambda/nodejs:22` en el VPS — si vuelve a pasar, el síntoma y el arreglo son los mismos.
- **(2026-07-18) Volvió a pasar, esta vez como caída real** — causa raíz encontrada (un cron ajeno al repo, `docker image prune`, borraba la imagen en cuanto Floci dejaba de tener un contenedor activo referenciándola) y prevención instalada (timer de `systemd` que la restaura automáticamente). Afecta por igual a este fork y al original, ya que comparten la misma imagen. Detalle completo: [`proyectos/quiz/docs/ARQUITECTURA.md` §15](../../quiz/docs/ARQUITECTURA.md#15-incidente-caída-completa-del-quiz-por-pérdida-de-la-imagen-del-runtime-de-lambda-2026-07-18) y [`plataforma/PLAN.md` Fase 5](../../../plataforma/PLAN.md#fase-5--endurecimiento-y-mantenimiento).
- **Operación día a día** (levantar el túnel, diagnosticar caídas, mantenerlo persistente): es exactamente igual que en el original — ver [`proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §2](../../quiz/docs/GUIA-PASO-A-PASO.md#2-cómo-levantar-el-entorno-y-qué-hacer-si-no-arranca), no se duplica aquí.

---

## Cómo leer este plan

- Cada fase indica si es **independiente** (se puede hacer en cualquier momento) o si tiene una **dependencia recomendada** con otra fase.
- Se pueden implementar de a una, o varias juntas, según convenga — no es obligatorio seguir el orden exacto en que están numeradas.
- Cada casillero se marca `[x]` recién cuando está implementado **y probado** (no al planificarlo).
- El detalle técnico exacto de "cómo se hizo" (comandos reales, código) se documenta en `GUIA-SERVICIOS-AVANZADOS.md` a medida que se ejecuta cada fase — algunos detalles finos (ej. si Floci reenvía automáticamente los logs de Lambda a su CloudWatch emulado) se confirman recién al implementar, no se inventan de antemano.
- **Cada fase que se implemente debe documentar ambas audiencias dentro de `GUIA-SERVICIOS-AVANZADOS.md`**, no en un archivo aparte (decisión 2026-07-23 — el borrador original de este plan pedía un segundo archivo estilo `AWS-PARA-PRINCIPIANTES.md`, pero eso choca con el límite de 2 archivos que fija `CLAUDE.md` para `quiz-avanzado/docs/`; se prefirió respetar ese límite antes que crear un tercer archivo). En la práctica, cada sección de la guía tiene capas explícitas, de la más simple a la más técnica:
  1. **En una frase / analogía**, con un diagrama de concepto — para alguien sin conocimiento previo del servicio.
  2. **Por qué hace falta / cómo funciona en general** — el concepto en AWS real, sin mencionar Floci/Docker/VPS/túnel todavía.
  3. **Cómo funciona en este proyecto** — comandos reales, decisiones de Floci vs. AWS real, incidentes encontrados, diagrama de arquitectura con los recursos reales de `quiz-avanzado`.
  4. **Cómo verificarlo tú mismo** — pasos manuales exactos y reproducibles para comprobar el servicio recién implementado.
- **Diagramas**: se usan liberalmente, no solo para arquitectura AWS — también para flujos de conexión (diagramas de secuencia) y para diagramas abstractos/mentales que ayuden a entender un concepto en general. Desde 2026-07-05 se construyen con **D2** (no Lucid, salvo el diagrama de arquitectura general de cada proyecto — ver `CLAUDE.md` raíz), con al menos: un ícono suelto para acompañar el título de cada sección, un diagrama de concepto para la analogía, y un diagrama de arquitectura técnico. Fuentes en `docs/diagramas/`, renders en `docs/imgs/`.
- **Arquitectura incremental, no diagramas sueltos por servicio** (decisión 2026-07-23, ver [`GUIA-SERVICIOS-AVANZADOS.md` §0](./GUIA-SERVICIOS-AVANZADOS.md#0-arquitectura-inicial-punto-de-partida)): la guía arranca con un diagrama de la arquitectura **antes** de cualquier servicio avanzado (S3 + API Gateway + 6 Lambdas + RDS, roles solo con *trust policy*). Cada fase que se implemente después debe presentar su diagrama de arquitectura como esa misma base **más** la pieza nueva agregada — no un diagrama aislado que solo muestre el servicio nuevo sin contexto — para que se vea, fase a fase, cómo fue creciendo la infraestructura completa.
- **Todo permiso IAM nuevo lleva su propio diagrama** (no solo mencionarlo en el texto): un "antes/después" del rol afectado (qué política tenía vs. qué política gana) y, si aplica, un diagrama de flujo de la autorización en tiempo de ejecución (Trust Policy al asumir el rol vs. Permission Policy al llamar a la API). Establecido al documentar el primer permiso real del proyecto (`cloudwatch:PutMetricData`, Fase 2) — las Fases 3 (`secretsmanager:GetSecretValue`), 5 (`sns:Publish`) y cualquier otra que agregue un permiso nuevo repiten este mismo tratamiento.

---

## Fase 0 — Control de versiones (git)

✅ Ya resuelto a nivel de todo el repositorio (no por proyecto): `AWS-FLOCI/` ya es un repositorio git con historial de commits desde antes de crear este fork. No requiere acción aparte aquí.

## Fase 1 — nginx + DNS (acceso público controlado) — ✅ HEREDADA, sin trabajo pendiente aquí

Esto **no se implementa en este proyecto**: ya se hizo una sola vez, a nivel plataforma, contra el Quiz original — ver el detalle completo en [`GUIA-SERVICIOS-AVANZADOS.md`](./GUIA-SERVICIOS-AVANZADOS.md#1-nginx--dns-exposición-pública-controlada) §1. El diseño elegido ahí fue deliberadamente **genérico** (`/site/<bucket>/...` y `/restapis/...`, no atado a un bucket/api_id puntual), así que al crear este fork, `quiz-avanzado-frontend` y `quiz-avanzado-api` quedaron públicamente accesibles de inmediato **sin tocar nginx**. Confirmado funcionando: `https://floci.devera.cloud/site/quiz-avanzado-frontend/` y `https://floci.devera.cloud/restapis/a7f3682d91/$default/_user_request_/...`.

**Nota**: esto no reemplaza el túnel SSH (`floci-tunnel.service`) para tareas administrativas (desplegar Lambdas, crear buckets, `aws cli` en general) — sigue siendo necesario para eso, también en este proyecto.

## Fase 2 — Observabilidad: CloudWatch Logs + Metrics + Alarms — *independiente* — ✅ implementada y probada (2026-07-23)

Alcance ampliado el 2026-07-23 respecto al original: no se quedó en "explorar si hay métricas", sino que se implementaron de verdad en las 6 Lambdas, y además se probó Alarms a fondo como diagnóstico (decisión tomada explícitamente: usar el máximo nivel de profundidad que Floci permite para este servicio, antes de avanzar a la Fase 3).

- [x] Verificar si Floci ya envía automáticamente la salida de las Lambdas a su CloudWatch Logs emulado — **sí**, confirmado: no requiere ninguna configuración adicional, igual que en AWS real (`aws logs tail` en sí tiene un bug contra Floci, ver hallazgo 3 en la guía — se verifica con `describe-log-streams` + `get-log-events` en su lugar).
- [x] Si no lo hace automáticamente, investigar si hace falta alguna configuración adicional — N/A, ya lo hace automáticamente.
- [x] Probar consultando logs de una invocación real de cada una de las 6 Lambdas — las 6 recibieron una línea de `console.log` (agregada en esta fase, antes no logueaban nada) y se confirmó que llegó a CloudWatch.
- [x] Implementar CloudWatch Metrics de verdad en las 6 Lambdas (namespace propio `QuizAvanzado/Lambda`: `Invocations`, `Errors`, `Duration`, vía `@aws-sdk/client-cloudwatch`) — confirmado que el servicio guarda y devuelve los datos correctamente. **Esta fue la primera vez que un rol de este proyecto recibió una política de permisos IAM real** (`cloudwatch:PutMetricData`), adelantando lo que la Fase 3 pensaba reclamar como propio (ver nota ahí). Se confirmó también que el runtime `nodejs22.x` **no** trae preinstalado ningún cliente de `@aws-sdk` (ni `client-cloudwatch` ni `client-s3`) — hubo que empaquetarlo con `npm install`, respondiendo de paso una pregunta que estaba pendiente para la Fase 3.
- [x] Confirmado el límite: el namespace automático `AWS/Lambda` (el que Lambda publicaría solo, sin código propio, en AWS real) sigue vacío en Floci — ese cableado interno no está emulado.
- [x] Probar CloudWatch Alarms como diagnóstico (no como feature final del proyecto): `put-metric-alarm` funciona y crea la alarma (`INSUFFICIENT_DATA` inicial); la evaluación automática del umbral **no ocurre** (se esperaron más de 2 minutos tras forzar un datapoint que debía dispararla, sin cambio de estado); `describe-alarm-history` devuelve `UnsupportedOperation`; `set-alarm-state` (control manual) funciona al instante. La alarma de prueba se borró al terminar — no quedó como infraestructura permanente. La Fase 5 construye la alarma real (con acción de notificación con propósito de negocio) reusando este hallazgo.
- [x] (2026-07-24) Al documentar ejemplos de salida real de cada comando para la guía, se encontró y confirmó un hallazgo adicional: el atajo `--dimensions Name=X,Value=Y` de `aws-cli` guarda la dimensión mal formada específicamente en `put-metric-data` contra Floci (funciona bien en `get-metric-statistics`/`list-metrics`) — no afecta a las 6 Lambdas (publican con el SDK, no con `aws-cli`). Se re-verificó el hallazgo de evaluación automática de Alarms con datos garantizados correctos (métrica poblada por una invocación real, no por `put-metric-data` a mano) para descartar que fuera un artefacto de este bug: mismo resultado, se confirma que el hallazgo original es válido.

Detalle completo (analogía, arquitectura, comandos de verificación manual): [`GUIA-SERVICIOS-AVANZADOS.md` §2](./GUIA-SERVICIOS-AVANZADOS.md#2-cloudwatch-logs-y-métricas).

## Fase 3 — Gestión de secretos: Secrets Manager + KMS — *independiente, conviene antes de la Fase 7*

- [ ] Crear un secreto con las credenciales de RDS: `aws secretsmanager create-secret --name quiz/rds-credentials --secret-string '...'`.
- [ ] (Opcional, más didáctico) Crear una clave KMS propia (`aws kms create-key`) y usarla para cifrar el secreto, en vez de la clave por defecto.
- [ ] Modificar las 6 Lambdas para leer la contraseña desde Secrets Manager al arrancar (cold start), en vez de la variable de entorno `PGPASSWORD` en texto plano.
- [x] Verificar si el runtime `nodejs22.x` ya trae el SDK de AWS incluido — **no**, respondido de paso en la Fase 2: hay que empaquetar cada cliente de `@aws-sdk` con `npm install` (confirmado que tampoco viene `@aws-sdk/client-s3`).
- [ ] Adjuntar permiso `secretsmanager:GetSecretValue` al rol IAM de cada Lambda — la Fase 2 ya adelantó el primer permiso real de este proyecto (`cloudwatch:PutMetricData`), así que esta ya no es la primera vez, pero sigue siendo la primera vez con un permiso de **lectura de secretos**.
- [ ] Quitar `PGPASSWORD` de las variables de entorno una vez migrado.

## Fase 4 — Auditoría: CloudTrail — *independiente*

- [ ] Crear un bucket S3 para los logs de auditoría (o reusar uno existente con un prefijo distinto).
- [ ] Crear el trail: `aws cloudtrail create-trail --name quiz-trail --s3-bucket-name ...`.
- [ ] `aws cloudtrail start-logging`.
- [ ] Provocar algunas acciones (crear/borrar algo de prueba) y verificar que aparecen con `aws cloudtrail lookup-events`.

## Fase 5 — Mensajería y eventos: EventBridge Scheduler + SNS — *independiente* — ⚙️ parcialmente implementada (2026-07-24)

Alcance adelantado el 2026-07-24: la parte de EventBridge Scheduler ya no es "una tarea programada de ejemplo, a modo de demostración" — surgió una necesidad real de producto (limpieza de jugadores inactivos del Quiz, ver `quiz/docs/ARQUITECTURA.md` §16) y se implementó con ese propósito real, en vez de con un ejemplo descartable. SNS sigue sin empezar.

- [x] Crear una regla programada (EventBridge Scheduler) que dispare una Lambda periódica — `quiz-avanzado-cleanup-diario`, `rate(1 day)`, invoca `quiz-avanzado-cleanup` (borra el historial de jugadores inactivos fuera del top 20). **Verificado que la evaluación automática sí funciona en Floci** (a diferencia de Alarms en la Fase 2): dos disparos automáticos consecutivos confirmados por logs, al intervalo esperado, con una schedule de prueba descartable antes de crear la real. Primer rol IAM de este proyecto asumido por un principal que no es `lambda.amazonaws.com`, y primer permiso acotado a un ARN puntual en vez de `Resource: "*"`. Detalle completo: [`GUIA-SERVICIOS-AVANZADOS.md` §5](./GUIA-SERVICIOS-AVANZADOS.md#5-eventbridge-scheduler--sns-mensajería-y-eventos).
- [ ] Crear un tópico SNS (`quiz-high-scores`) y una suscripción (email o SQS).
- [ ] Modificar la Lambda `submit` para publicar un mensaje cuando el puntaje supere un umbral (ej. ≥ 500 puntos) — requiere permiso `sns:Publish` en su rol.
- [ ] Construir la alarma real de CloudWatch que quedó pendiente de la Fase 2: sobre una de las métricas custom de `QuizAvanzado/Lambda` (ej. `Errors`), con una acción de notificación real conectada al tópico SNS de este ítem — recordar que la evaluación automática del umbral no funciona en Floci (ver hallazgo de la Fase 2), así que la demostración de "la alarma se disparó" tendrá que apoyarse en `set-alarm-state` en vez de esperar la evaluación real.

## Fase 6 — Seguridad perimetral: WAF — *depende de la Fase 1 para tener sentido pleno*

- [ ] Crear un Web ACL con una regla de *rate limiting* básica.
- [ ] Asociarlo a la API Gateway.
- [ ] Probar que efectivamente bloquea/limita tráfico excesivo.

## Fase 7 — Infraestructura como código: CloudFormation — *recomendado después de las Fases 2 a 5*

- [ ] Escribir una plantilla que capture: RDS, las 6 Lambdas + sus roles (ya con permisos reales desde la Fase 2 — CloudWatch Metrics — y la Fase 3 — Secrets Manager), API Gateway + rutas, bucket S3 + hosting estático, el secreto de Secrets Manager, el trail de CloudTrail, el tópico SNS y la regla de EventBridge.
- [ ] Desplegar con `aws cloudformation deploy` contra Floci.
- [ ] Comparar contra lo desplegado manualmente (debería quedar equivalente).

## Fase 8 — Autenticación real: Cognito — *el cambio más grande, requiere confirmación explícita antes de empezar*

Esta fase cambia el modelo actual ("solo escribe tu nombre") por cuentas reales con usuario/contraseña. Antes de tocar código hay que decidir juntos: ¿login simple usuario/contraseña, o también verificación de email? ¿Se conserva la opción de jugar sin cuenta? Se retoma en una conversación aparte cuando llegue el momento, no se implementa como parte de las fases anteriores.

- [ ] (Pendiente de alcance) Definir requisitos exactos antes de implementar.

---

## Orden sugerido (flexible, no obligatorio)

Fases 0 y 1 ya resueltas (ver arriba, no requieren trabajo en este proyecto):

1. **Fase 2 + Fase 3 juntas** — bajo riesgo, alta ganancia de aprendizaje, y la Fase 3 conviene resuelta antes de la Fase 7.
2. **Fase 4 + Fase 5 juntas** — independientes entre sí, encajan bien en la misma sesión de trabajo.
3. **Fase 6** (WAF) — tiene sentido pleno porque la Fase 1 (exposición pública) ya está resuelta.
4. **Fase 7** (CloudFormation) — una vez estabilizado todo lo anterior, para capturarlo todo en una plantilla.
5. **Fase 8** (Cognito) — al final, con una conversación de alcance previa.
