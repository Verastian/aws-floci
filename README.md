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
    └── quiz/
        ├── docs/
        ├── data/
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
- [`proyectos/quiz/`](proyectos/quiz/) — Quiz de tecnología (AWS Cloud Practitioner con 169 preguntas, Python y Linux "próximamente") con ranking, medallas, tema claro/oscuro y confeti. Implementado y probado de punta a punta (RDS + 6 Lambdas + API Gateway + frontend en S3 con Tailwind/GSAP). Ver [historial de arquitectura](proyectos/quiz/docs/ARQUITECTURA.md) y la [guía paso a paso, replicable en AWS real](proyectos/quiz/docs/GUIA-PASO-A-PASO.md).
  - En curso: ampliación con servicios avanzados (CloudWatch, Secrets Manager, KMS, CloudTrail, SNS, EventBridge, WAF, CloudFormation, Cognito) y exposición pública vía nginx — ver [plan de trabajo](proyectos/quiz/docs/PLAN-SERVICIOS-AVANZADOS.md) y su [guía dedicada](proyectos/quiz/docs/GUIA-SERVICIOS-AVANZADOS.md).
