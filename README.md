# AWS-FLOCI

Espacio de trabajo para desarrollar y aprender AWS de forma local, usando [Floci](https://floci.io/) como emulador de la nube corriendo en Docker sobre un VPS.

## Estructura

```
AWS-FLOCI/
├── plataforma/              # Todo lo que es de la nube emulada en sí (no de un proyecto en particular)
│   └── PLAN.md              # Factibilidad, decisiones e historial de implementación de Floci en el VPS
└── proyectos/                # Un subdirectorio por cada proyecto desplegado sobre la nube emulada
    ├── hello-world/
    │   ├── docs/
    │   │   ├── GUIA-PASO-A-PASO.md
    │   │   └── imgs/
    │   └── lambda/
    ├── quiz/
    │   ├── docs/
    │   ├── db/
    │   ├── lambda/
    │   └── frontend/
    └── quiz-avanzado/           # Fork independiente de quiz/ para servicios avanzados de AWS
        ├── docs/
        ├── db/
        ├── lambda/
        └── frontend/
```

## Convención para nuevos proyectos

Cada proyecto nuevo que se despliegue sobre esta nube emulada (por ejemplo, el próximo: **Quiz**) debe vivir en `proyectos/<nombre-del-proyecto>/`, con al menos:

- `docs/` — documentación propia del proyecto (guías, diagramas en `docs/imgs/`, decisiones específicas).
- El código fuente del proyecto (por ejemplo `lambda/`, `src/`, etc., según corresponda).

Los cambios que afectan a la plataforma en sí (Floci, el VPS, la infraestructura compartida) se documentan en `plataforma/PLAN.md`, no dentro de un proyecto individual.

## Proyectos actuales

- [`proyectos/hello-world/`](proyectos/hello-world/) — Lambda "Hello World" con Function URL, primer proyecto de prueba sobre Floci. Ver [guía paso a paso](proyectos/hello-world/docs/GUIA-PASO-A-PASO.md).
- [`proyectos/quiz/`](proyectos/quiz/) — Quiz de tecnología (AWS Cloud Practitioner con 169 preguntas, Python y Linux "próximamente") con ranking, medallas, tema claro/oscuro y confeti. Implementado y probado de punta a punta (RDS + 6 Lambdas + API Gateway + frontend en S3 con Tailwind/GSAP), y **público** en `https://floci.devera.cloud/site/quiz-frontend/` (HTTPS real, sin túnel SSH, vía `nginx-proxy-manager`). Ver [historial de arquitectura](proyectos/quiz/docs/ARQUITECTURA.md) (con diagramas Lucid, incluyendo el símil de una cuenta de AWS real con VPC/Availability Zones), la [guía paso a paso, replicable en AWS real](proyectos/quiz/docs/GUIA-PASO-A-PASO.md), y — para quien recién está aprendiendo AWS, sin jerga técnica — [AWS para principiantes](proyectos/quiz/docs/AWS-PARA-PRINCIPIANTES.md).
- [`proyectos/quiz-avanzado/`](proyectos/quiz-avanzado/) — Fork completo e independiente del Quiz (propia RDS, Lambdas, API Gateway y bucket S3; también público, en `https://floci.devera.cloud/site/quiz-avanzado-frontend/`), creado el 2026-07-05 para desarrollar servicios avanzados de AWS (CloudWatch, Secrets Manager, KMS, CloudTrail, SNS, EventBridge, WAF, CloudFormation, Cognito) sin arriesgar el Quiz original. Ver [plan de trabajo](proyectos/quiz-avanzado/docs/PLAN-SERVICIOS-AVANZADOS.md) y su [guía dedicada](proyectos/quiz-avanzado/docs/GUIA-SERVICIOS-AVANZADOS.md).
