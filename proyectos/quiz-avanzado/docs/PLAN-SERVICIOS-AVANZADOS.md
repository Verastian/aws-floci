# Plan de trabajo: Servicios avanzados de AWS para el Quiz Avanzado

> **Este documento es el plan vigente**, movido/adaptado desde el `PLAN-SERVICIOS-AVANZADOS.md` del
> Quiz original el 2026-07-05 al crear este fork (ese archivo ya no existe ahí, para no tener dos
> copias de la misma verdad — ver "Contexto de este fork" más abajo). Las Fases 2-8 se implementan **aquí**, contra `quiz-avanzado`
> (su propia RDS, Lambdas, API y bucket — ver "Contexto de este fork" más abajo), nunca contra el
> Quiz original, que ya está público y en uso real. Para entender el diseño de la aplicación en sí
> (modelo de datos, puntaje, medallas, tema claro/oscuro, etc. — es el mismo código, sin cambios),
> ver [`proyectos/quiz/docs/ARQUITECTURA.md`](../../quiz/docs/ARQUITECTURA.md) del proyecto
> original; aquí solo se documenta lo específico de este fork y de los servicios avanzados.

**Fecha:** 2026-07-04, actualizado 2026-07-05
**Estado:** Fase 1 heredada del original (ver abajo, no requiere trabajo aquí). El resto sigue planificado.
**Documento hermano:** [`GUIA-SERVICIOS-AVANZADOS.md`](./GUIA-SERVICIOS-AVANZADOS.md) — ahí se explica el concepto de cada servicio y se irá documentando cómo quedó implementado, fase por fase.

---

## Contexto de este fork (2026-07-05)

- **Motivo**: desarrollar los servicios avanzados de AWS de este plan (Secrets Manager, KMS, CloudTrail, SNS, EventBridge, WAF, CloudFormation, Cognito) sin arriesgar el Quiz original, que ya está en uso público real.
- **Recursos creados** (independientes de los del original): RDS `quiz-avanzado-db` (Postgres 17, endpoint interno `172.22.0.2:7002`, base `quiz_avanzado`); 6 Lambdas `quiz-avanzado-{categories,questions,answer,submit,ranking,badges}`, cada una con su rol IAM propio; API Gateway HTTP API `quiz-avanzado-api` (id `a7f3682d91`) con las mismas 6 rutas; bucket S3 `quiz-avanzado-frontend` con hosting estático.
- **Datos**: el esquema se aplicó desde cero (`db/schema.sql`); los datos reales (169 preguntas, 697 opciones, 169 explicaciones) se copiaron por `pg_dump`/`psql` directamente desde la RDS del Quiz original (`quiz-db`), ya que los JSON originales (`data/`) se habían eliminado tiempo atrás tras la carga inicial — no se volvió a correr `db/seed.js`. El `ranking` se dejó **vacío a propósito** (es un fork nuevo, no tiene sentido arrastrar puntajes del original).
- **Frontend**: único cambio de código respecto al original es `API_ID` en `frontend/app.js`, apuntando a `a7f3682d91`.
- **Acceso público**: confirmado funcionando de inmediato en `https://floci.devera.cloud/site/quiz-avanzado-frontend/` y `https://floci.devera.cloud/restapis/a7f3682d91/$default/_user_request_/...`, sin ningún cambio en `nginx-proxy-manager` (ver Fase 1 en `GUIA-SERVICIOS-AVANZADOS.md`).
- **Incidente encontrado de paso (no relacionado con este fork)**: durante las pruebas, `public.ecr.aws/lambda/nodejs:22` (la imagen Docker que Floci usa para correr cualquier Lambda Node 22, del original o de este fork) había desaparecido del caché de Docker del VPS, causando 502 (`Lambda.InitError: No such image`) en **todas** las Lambdas de ambos proyectos. Se resolvió con `docker pull public.ecr.aws/lambda/nodejs:22` en el VPS — si vuelve a pasar, el síntoma y el arreglo son los mismos.
- **Operación día a día** (levantar el túnel, diagnosticar caídas, mantenerlo persistente): es exactamente igual que en el original — ver [`proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §5](../../quiz/docs/GUIA-PASO-A-PASO.md#5-cómo-levantar-el-entorno-y-qué-hacer-si-no-arranca), no se duplica aquí.

---

## Cómo leer este plan

- Cada fase indica si es **independiente** (se puede hacer en cualquier momento) o si tiene una **dependencia recomendada** con otra fase.
- Se pueden implementar de a una, o varias juntas, según convenga — no es obligatorio seguir el orden exacto en que están numeradas.
- Cada casillero se marca `[x]` recién cuando está implementado **y probado** (no al planificarlo).
- El detalle técnico exacto de "cómo se hizo" (comandos reales, código) se documenta en `GUIA-SERVICIOS-AVANZADOS.md` a medida que se ejecuta cada fase — algunos detalles finos (ej. si Floci reenvía automáticamente los logs de Lambda a su CloudWatch emulado) se confirman recién al implementar, no se inventan de antemano.
- **Cada fase que se implemente debe documentarse de dos formas**, no solo una (convención establecida el 2026-07-05, ver [`proyectos/quiz/docs/AWS-PARA-PRINCIPIANTES.md`](../../quiz/docs/AWS-PARA-PRINCIPIANTES.md) como referencia del segundo formato):
  1. **Técnica**, acá y en `GUIA-SERVICIOS-AVANZADOS.md` — comandos reales, decisiones de Floci vs. AWS real, incidentes encontrados. Para quien va a operar/extender esto.
  2. **Simplificada, enfocada solo en AWS** — sin mencionar Floci/Docker/VPS/túnel, con analogías y diagramas, pensada para alguien que recién está aprendiendo el servicio en cuestión (ej. al implementar Secrets Manager, agregar una sección nueva a un documento tipo `AWS-PARA-PRINCIPIANTES.md` de este proyecto explicando *qué es* Secrets Manager y *por qué* importa, igual que se hizo para S3/Lambda/API Gateway/RDS/VPC en el del original).
- **Diagramas**: se usa Lucid liberalmente, no solo para arquitectura AWS — también para flujos de conexión (ej. diagramas de secuencia) y para diagramas abstractos/mentales que ayuden a entender un concepto en general (ej. la analogía del restaurante o el modelo cliente-servidor-base de datos del documento simplificado). Los diagramas de este proyecto viven en la carpeta de Lucid "AWS-FLOCI Diagramas".

---

## Fase 0 — Control de versiones (git)

✅ Ya resuelto a nivel de todo el repositorio (no por proyecto): `AWS-FLOCI/` ya es un repositorio git con historial de commits desde antes de crear este fork. No requiere acción aparte aquí.

## Fase 1 — nginx + DNS (acceso público controlado) — ✅ HEREDADA, sin trabajo pendiente aquí

Esto **no se implementa en este proyecto**: ya se hizo una sola vez, a nivel plataforma, contra el Quiz original — ver el detalle completo en [`GUIA-SERVICIOS-AVANZADOS.md`](./GUIA-SERVICIOS-AVANZADOS.md#1-nginx--dns-exposición-pública-controlada) §1. El diseño elegido ahí fue deliberadamente **genérico** (`/site/<bucket>/...` y `/restapis/...`, no atado a un bucket/api_id puntual), así que al crear este fork, `quiz-avanzado-frontend` y `quiz-avanzado-api` quedaron públicamente accesibles de inmediato **sin tocar nginx**. Confirmado funcionando: `https://floci.devera.cloud/site/quiz-avanzado-frontend/` y `https://floci.devera.cloud/restapis/a7f3682d91/$default/_user_request_/...`.

**Nota**: esto no reemplaza el túnel SSH (`floci-tunnel.service`) para tareas administrativas (desplegar Lambdas, crear buckets, `aws cli` en general) — sigue siendo necesario para eso, también en este proyecto.

## Fase 2 — Observabilidad: CloudWatch Logs + Monitoring — *independiente*

- [ ] Verificar si Floci ya envía automáticamente la salida de las Lambdas a su CloudWatch Logs emulado (comportamiento esperado, a confirmar): `aws logs tail /aws/lambda/quiz-submit --follow --profile floci`.
- [ ] Si no lo hace automáticamente, investigar si hace falta alguna configuración adicional.
- [ ] Probar consultando logs de una invocación real de cada una de las 6 Lambdas.
- [ ] (Opcional) Explorar `aws cloudwatch get-metric-statistics` para ver métricas de invocaciones/errores.

## Fase 3 — Gestión de secretos: Secrets Manager + KMS — *independiente, conviene antes de la Fase 7*

- [ ] Crear un secreto con las credenciales de RDS: `aws secretsmanager create-secret --name quiz/rds-credentials --secret-string '...'`.
- [ ] (Opcional, más didáctico) Crear una clave KMS propia (`aws kms create-key`) y usarla para cifrar el secreto, en vez de la clave por defecto.
- [ ] Modificar las 6 Lambdas para leer la contraseña desde Secrets Manager al arrancar (cold start), en vez de la variable de entorno `PGPASSWORD` en texto plano.
- [ ] Verificar si el runtime `nodejs22.x` ya trae el SDK de AWS incluido (los runtimes de Lambda para Node suelen traer `@aws-sdk/*` preinstalado) o si hay que empaquetarlo.
- [ ] Adjuntar permiso `secretsmanager:GetSecretValue` al rol IAM de cada Lambda — **primera vez que se le da una política de permisos real a un rol** en este proyecto (hasta ahora los roles solo tenían la *trust policy*, sin política de permisos, porque Floci no la exigía).
- [ ] Quitar `PGPASSWORD` de las variables de entorno una vez migrado.

## Fase 4 — Auditoría: CloudTrail — *independiente*

- [ ] Crear un bucket S3 para los logs de auditoría (o reusar uno existente con un prefijo distinto).
- [ ] Crear el trail: `aws cloudtrail create-trail --name quiz-trail --s3-bucket-name ...`.
- [ ] `aws cloudtrail start-logging`.
- [ ] Provocar algunas acciones (crear/borrar algo de prueba) y verificar que aparecen con `aws cloudtrail lookup-events`.

## Fase 5 — Mensajería y eventos: SNS + EventBridge/Scheduler — *independiente*

- [ ] Crear un tópico SNS (`quiz-high-scores`) y una suscripción (email o SQS).
- [ ] Modificar la Lambda `submit` para publicar un mensaje cuando el puntaje supere un umbral (ej. ≥ 500 puntos) — requiere permiso `sns:Publish` en su rol.
- [ ] Crear una regla programada (EventBridge Scheduler) que dispare una Lambda de mantenimiento periódica (ej. una que solo registre un log, a modo de demostración de *scheduled events*).

## Fase 6 — Seguridad perimetral: WAF — *depende de la Fase 1 para tener sentido pleno*

- [ ] Crear un Web ACL con una regla de *rate limiting* básica.
- [ ] Asociarlo a la API Gateway.
- [ ] Probar que efectivamente bloquea/limita tráfico excesivo.

## Fase 7 — Infraestructura como código: CloudFormation — *recomendado después de las Fases 2 a 5*

- [ ] Escribir una plantilla que capture: RDS, las 6 Lambdas + sus roles (ya con permisos reales de la Fase 3), API Gateway + rutas, bucket S3 + hosting estático, el secreto de Secrets Manager, el trail de CloudTrail, el tópico SNS y la regla de EventBridge.
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
