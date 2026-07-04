# Plan de trabajo: Servicios avanzados de AWS para el Quiz

**Fecha:** 2026-07-04
**Estado:** Planificado. Nada de esto está implementado todavía.
**Documento hermano:** [`GUIA-SERVICIOS-AVANZADOS.md`](./GUIA-SERVICIOS-AVANZADOS.md) — ahí se explica el concepto de cada servicio y se irá documentando cómo quedó implementado, fase por fase.

---

## Cómo leer este plan

- Cada fase indica si es **independiente** (se puede hacer en cualquier momento) o si tiene una **dependencia recomendada** con otra fase.
- Se pueden implementar de a una, o varias juntas, según convenga — no es obligatorio seguir el orden exacto en que están numeradas.
- Cada casillero se marca `[x]` recién cuando está implementado **y probado** (no al planificarlo).
- El detalle técnico exacto de "cómo se hizo" (comandos reales, código) se documenta en `GUIA-SERVICIOS-AVANZADOS.md` a medida que se ejecuta cada fase — algunos detalles finos (ej. si Floci reenvía automáticamente los logs de Lambda a su CloudWatch emulado) se confirman recién al implementar, no se inventan de antemano.

---

## Fase 0 — Control de versiones (git)

- [ ] `git init` en `AWS-FLOCI/`.
- [ ] `.gitignore` para `node_modules/`, `*.zip`, y el archivo `data/Reto Quiz.html` si se decide no versionarlo (pesa ~350KB y es un insumo de diseño, no código).
- [ ] Commit inicial con el estado actual completo (Hello World + Quiz con S3, API Gateway, 6 Lambdas, RDS, Tailwind/GSAP, medallas, tema claro/oscuro).
- [ ] Tag `v1-fundamentos-aws` sobre ese commit — punto de referencia fijo para compartir con quien recién empieza.
- [ ] (Opcional, más adelante) Subir a un remoto (GitHub/GitLab) cuando se decida.

## Fase 1 — nginx + DNS (acceso público controlado) — *independiente*

**Por qué es importante y por qué va aparte:** ningún servicio de AWS (ni Route 53 real) resuelve por sí solo "que la gente vea tu sitio" — eso siempre lo hace lo que esté escuchando en el puerto 80/443 de tu IP pública. En tu VPS eso ya es `nginx-proxy-manager`. Esta fase es sobre exposición pública controlada, no sobre un servicio de AWS en sí.

**Riesgo de seguridad a resolver (no opcional):** Floci no tiene autenticación real. Si nginx reenvía el puerto 4566 completo al público, cualquiera tendría control total del "AWS" emulado (borrar buckets, leer la RDS, etc.).

Checklist:
- [ ] Confirmar dominio a usar: se puede usar el hostname que ya viene con el VPS (`<TU-HOSTNAME-VPS>`, ya resuelve en DNS público por defecto de Hostinger) como punto de partida, sin necesidad de comprar un dominio nuevo.
- [ ] Configurar en `nginx-proxy-manager` un *proxy host* que reenvíe **solo** las rutas necesarias, no el puerto 4566 completo:
  - [ ] Un `location` para el *website endpoint* de S3 del frontend (con reescritura del header `Host` hacia `quiz-frontend.s3-website...`, ya que Floci enruta S3 por virtual-host).
  - [ ] Un `location` para el path exacto de la API Gateway (`/restapis/{api_id}/$default/_user_request_/*`).
  - [ ] Confirmar que cualquier otra ruta no configurada devuelve 404 en nginx (nunca llega a Floci).
- [ ] Configurar HTTPS (Let's Encrypt) en `nginx-proxy-manager` para ese dominio.
- [ ] Probar el acceso público real desde fuera del VPS (ej. datos móviles, no la misma red).
- [ ] (Opcional, para un "lanzamiento suave") restringir por IP en el firewall del VPS mientras se comparte solo con algunas personas.
- [ ] Documentar la configuración final en `GUIA-SERVICIOS-AVANZADOS.md`.

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

1. **Fase 0** (git) — primero que todo, para empezar a versionar desde ya.
2. **Fase 2 + Fase 3 juntas** — bajo riesgo, alta ganancia de aprendizaje, y la Fase 3 conviene resuelta antes de la Fase 7.
3. **Fase 4 + Fase 5 juntas** — independientes entre sí, encajan bien en la misma sesión de trabajo.
4. **Fase 1** (nginx) — cuando quieras exposición pública real.
5. **Fase 6** (WAF) — justo después de la Fase 1, ya que recién ahí tiene sentido pleno.
6. **Fase 7** (CloudFormation) — una vez estabilizado todo lo anterior, para capturarlo todo en una plantilla.
7. **Fase 8** (Cognito) — al final, con una conversación de alcance previa.
