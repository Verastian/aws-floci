# Guía paso a paso: Servicios avanzados de AWS para el Quiz

**Nivel:** continuación de [`GUIA-PASO-A-PASO.md`](./GUIA-PASO-A-PASO.md) — se asume que ya conoces Lambda, API Gateway, RDS, IAM básico y S3.

**Estado de este documento:** es un documento vivo. Los conceptos de cada servicio ya están escritos (no dependen de que esté implementado), pero las secciones **"Cómo quedó implementado"** dicen "🔜 Pendiente" hasta que se ejecute esa fase del [`PLAN-SERVICIOS-AVANZADOS.md`](./PLAN-SERVICIOS-AVANZADOS.md) — se van completando con comandos y resultados reales a medida que se avanza, igual que se hizo con la guía anterior.

---

## Índice

1. [nginx + DNS: exposición pública controlada](#1-nginx--dns-exposición-pública-controlada)
2. [CloudWatch: logs y métricas](#2-cloudwatch-logs-y-métricas)
3. [Secrets Manager + KMS: gestión de credenciales](#3-secrets-manager--kms-gestión-de-credenciales)
4. [CloudTrail: auditoría](#4-cloudtrail-auditoría)
5. [SNS + EventBridge/Scheduler: mensajería y eventos](#5-sns--eventbridgescheduler-mensajería-y-eventos)
6. [WAF: seguridad perimetral](#6-waf-seguridad-perimetral)
7. [CloudFormation: infraestructura como código](#7-cloudformation-infraestructura-como-código)
8. [Cognito: autenticación real](#8-cognito-autenticación-real)

---

## 1. nginx + DNS: exposición pública controlada

### Concepto

Un error común al aprender la nube es pensar que un servicio de DNS (como Route 53) "expone" tu aplicación a internet. **No es así.** Route 53 (o cualquier proveedor de DNS) solo administra un mapa de "el nombre `X` corresponde a la dirección IP `Y`" — es una guía telefónica, no una recepcionista. Quien **atiende** la petición cuando alguien realmente visita ese nombre es otra pieza completamente distinta: un servidor web, un balanceador de carga, un CDN, etc.

En este proyecto, esa pieza ya existe en tu VPS: `nginx-proxy-manager`, corriendo fuera de Floci, escuchando en los puertos 80/443. Su trabajo es recibir la petición pública y decidir hacia dónde reenviarla (*reverse proxy*), además de manejar el certificado TLS (HTTPS).

> Dato curioso: Route 53 **sí** figura como `"running"` en el health check de Floci, así que se puede practicar la API (`aws route53 create-hosted-zone`, etc.). Pero esa emulación no tiene ningún efecto en el DNS público real — sirve para practicar comandos o probar plantillas de infraestructura, no para publicar nada.

### Por qué hay que tener cuidado

Floci **no implementa autenticación real** — acepta cualquier credencial de AWS. Mientras el puerto 4566 solo sea alcanzable por el túnel SSH, esto es seguro. Si `nginx-proxy-manager` reenvía ese puerto **completo** hacia el público, cualquier persona en internet tendría control total sobre tu nube emulada (podría borrar el bucket S3, leer toda la base de datos vía las APIs de RDS Data, etc.).

La mitigación: nginx debe reenviar **solo** las rutas exactas que la aplicación necesita (el *website endpoint* de S3 y el path de la API Gateway), no el puerto completo. Cualquier otra ruta no configurada devuelve 404 directamente en nginx, sin llegar nunca a Floci.

### Cómo quedó implementado

🔜 Pendiente (Fase 1 del plan).

---

## 2. CloudWatch: logs y métricas

### Concepto

**Amazon CloudWatch** es el servicio central de observabilidad de AWS: recolecta **logs** (texto que tu código escribe, ej. con `console.log`) y **métricas** (números a lo largo del tiempo: cuántas veces se invocó una Lambda, cuántos errores tuvo, cuánto tardó).

Cuando una Lambda corre en AWS real, **todo lo que escribas con `console.log` termina automáticamente en un grupo de logs de CloudWatch** con el nombre `/aws/lambda/<nombre-de-la-funcion>` — no tienes que configurar nada para que esto pase, es el comportamiento por defecto. Es la forma estándar de debuggear una Lambda en producción: no tienes acceso a una terminal "dentro" de la función como con un servidor tradicional, así que los logs son tu principal ventana a lo que está pasando.

### Cómo quedó implementado

🔜 Pendiente (Fase 2 del plan) — incluyendo la verificación de si Floci reenvía esto automáticamente o si requiere configuración adicional.

---

## 3. Secrets Manager + KMS: gestión de credenciales

### Concepto

Hasta ahora, la contraseña de la base de datos vive en texto plano en la configuración de cada Lambda (`PGPASSWORD=...` como variable de entorno). Esto funciona, pero tiene un problema: cualquiera con permiso para *ver la configuración* de la Lambda (no para ejecutarla, solo para leerla) ve la contraseña en texto plano.

**AWS Secrets Manager** guarda credenciales de forma cifrada, y las entrega solo a quien tenga el permiso IAM específico (`secretsmanager:GetSecretValue`) — separando "quién puede desplegar/configurar" de "quién puede ver la contraseña real". También permite **rotar** la credencial automáticamente sin tener que volver a desplegar cada Lambda.

**AWS KMS (Key Management Service)** es el servicio que genera y administra las claves de cifrado que usan Secrets Manager (y muchos otros servicios) por debajo. Por defecto, Secrets Manager usa una clave administrada por AWS; se puede usar una clave propia (*customer-managed key*) para tener control sobre quién puede usarla y poder revocarla independientemente.

### Un cambio de fondo: roles con permisos reales

Hasta ahora, cada rol IAM de este proyecto (`quiz-categories-role`, etc.) solo tiene una **trust policy** (quién puede *asumir* el rol — en este caso, el servicio Lambda) pero **ninguna política de permisos** (qué puede *hacer* una vez asumido el rol). Floci no lo exige para que la Lambda pueda leer/escribir en RDS o S3. Esta fase es la primera vez que un rol necesita un permiso real adjunto (`secretsmanager:GetSecretValue`) — una buena oportunidad para entender la diferencia entre ambos conceptos.

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
