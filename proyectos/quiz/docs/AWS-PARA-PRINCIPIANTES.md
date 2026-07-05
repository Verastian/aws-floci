# AWS para principiantes: la arquitectura del Quiz, explicada sin jerga técnica

**¿Para quién es este documento?** Para cualquiera que quiera entender **qué es AWS y cómo funciona en la práctica**, usando el Quiz como ejemplo real — sin necesitar saber programar, sin mencionar Docker, VPS, túneles SSH, ni ninguna herramienta de este repositorio en particular. Si ya programás y querés el detalle técnico exacto de cómo está construido, ese documento es otro: [`ARQUITECTURA.md`](./ARQUITECTURA.md) y [`GUIA-PASO-A-PASO.md`](./GUIA-PASO-A-PASO.md). Este es el mapa conceptual — el "qué es y para qué sirve cada cosa", pensado para alguien que recién está aprendiendo AWS (por ejemplo, preparando la certificación **AWS Cloud Practitioner**, que es justo el tema del Quiz).

---

## Índice

1. [La idea más simple: Cliente, Servidor, Base de datos](#1-la-idea-más-simple-cliente-servidor-base-de-datos)
2. [La analogía del restaurante](#2-la-analogía-del-restaurante)
3. [Cada servicio de AWS, explicado](#3-cada-servicio-de-aws-explicado)
4. [El mapa completo: así se ve en una cuenta de AWS real](#4-el-mapa-completo-así-se-ve-en-una-cuenta-de-aws-real)
5. [Glosario rápido](#5-glosario-rápido)
6. [Cómo seguir aprendiendo](#6-cómo-seguir-aprendiendo)

---

## 1. La idea más simple: Cliente, Servidor, Base de datos

Antes de hablar de AWS, hay una idea que es la base de **cualquier** aplicación en internet — un banco, una red social, un quiz — y que no depende de ninguna nube en particular:

**Diagrama editable en Lucid**: [Modelo mental: Cliente, Servidor, Base de datos](https://lucid.app/lucidchart/c864bbdb-5ed0-46de-be1b-a591d34d8c6e/edit)

- **Cliente**: el programa que vos usás directamente — tu navegador, la app del celular. No hace el trabajo pesado, solo pide cosas y muestra resultados.
- **Servidor**: la computadora (o programa) que recibe el pedido, decide qué hacer, y responde. Es el "cerebro" de la operación.
- **Base de datos**: donde se guarda todo de forma permanente — usuarios, puntajes, productos. El servidor le pregunta y le pide guardar cosas; el cliente nunca le habla directo.

Todo lo que sigue en este documento es, en el fondo, **una forma específica de construir estas tres piezas usando servicios de AWS en vez de servidores propios**.

---

## 2. La analogía del restaurante

AWS ofrece decenas de servicios, y al principio es fácil perderse en los nombres. Una forma de recordarlos es pensar en un restaurante:

**Diagrama editable en Lucid**: [Analogía del restaurante](https://lucid.app/lucidchart/07512a7e-3405-453d-aa65-d28a18056de3/edit)

| En el restaurante | En AWS | Rol en el Quiz |
|---|---|---|
| El **cliente** que llega a comer | Vos, usando el Quiz | Pide cosas, nunca cocina ni guarda nada él mismo |
| El **menú impreso**, disponible sin pedir permiso | **Amazon S3** | Guarda y sirve el sitio web (HTML/CSS/JS) tal cual, como una hoja de papel — no "piensa", solo entrega lo que tiene guardado |
| El **mostrador de pedidos** | **Amazon API Gateway** | Punto único de entrada: recibe cada pedido (ej. "dame el ranking") y lo dirige a quien corresponda |
| El **cocinero**, que solo trabaja cuando hay un pedido | **AWS Lambda** | Ejecuta la lógica real (calcular el puntaje, validar una respuesta) — y cuando no hay pedidos, no está "prendido" cobrando de más, algo que ningún cocinero humano podría hacer, pero un programa sí |
| La **despensa**, donde están los ingredientes guardados | **Amazon RDS** | Guarda de forma permanente las preguntas, opciones y el ranking |

La pieza más importante para entender **por qué AWS es distinto a tener tu propio servidor**: el "cocinero" (Lambda) no existe todo el tiempo. Aparece exactamente cuando llega un pedido, hace su trabajo, y desaparece — no le pagás por estar ahí parado esperando. Esto se llama **serverless** ("sin servidor" — más preciso sería "sin que vos tengas que administrar un servidor"), y es una de las ideas centrales que se evalúan en la certificación AWS Cloud Practitioner.

---

## 3. Cada servicio de AWS, explicado

### Amazon S3 (Simple Storage Service)

Un lugar para guardar **archivos** (no filas de una tabla, archivos completos: imágenes, videos, HTML) de forma muy barata y muy confiable. AWS promete que un archivo guardado en S3 prácticamente nunca se pierde, porque internamente lo guarda copiado varias veces. En este proyecto, S3 guarda los 3 archivos que forman el sitio web del Quiz y los sirve directamente a cualquiera que los pida — como una hoja impresa que cualquiera puede leer, sin que nadie tenga que "atenderte" para dártela.

### Amazon API Gateway

La "puerta de entrada" única de una aplicación. En vez de que cada parte de tu sistema tenga su propia dirección suelta, todos los pedidos entran por un solo lugar, que decide a quién pasárselos según qué se pidió (ej. `GET /ranking` va para un lado, `POST /submit` va para otro). También se encarga de cosas transversales como validar el formato de la petición o aplicar límites de velocidad, sin que cada pieza interna tenga que reimplementarlo.

### AWS Lambda

Código que corre **solo cuando hace falta**, sin que vos tengas que mantener una computadora prendida 24/7 esperando pedidos. Le llega un pedido, hace su trabajo (leer la base de datos, calcular algo, devolver una respuesta) y termina. Si llegan 100 pedidos al mismo tiempo, AWS simplemente hace correr 100 copias en paralelo — vos no tenés que planificar esa capacidad de antemano. Es el servicio central del patrón "serverless".

### Amazon RDS (Relational Database Service)

Una base de datos **relacional** (tablas con filas y columnas, relacionadas entre sí — el mismo tipo de base de datos que usan un banco o una tienda online) administrada por AWS: vos no instalás ni parcheás el motor de base de datos, ni te encargás de los respaldos manualmente, AWS lo hace. En este proyecto guarda las preguntas, las opciones de cada pregunta y el ranking de jugadores.

### Amazon Route 53

El servicio de **DNS** de AWS — traduce nombres fáciles de recordar (`floci.devera.cloud`) a la dirección numérica real de un servidor en internet. Es exactamente lo mismo que hace una guía telefónica: te dice a qué número corresponde un nombre, pero no es quien te atiende del otro lado de la línea.

---

## 4. El mapa completo: así se ve en una cuenta de AWS real

Los servicios de la sección anterior no flotan sueltos — en una cuenta de AWS real, viven organizados dentro de una jerarquía geográfica y de red. Este es el mapa completo:

**Diagrama editable en Lucid**: [Arquitectura AWS real — Quiz](https://lucid.app/lucidchart/c4f12314-8380-4842-9325-4508233b6a52/edit)

Yendo de "afuera hacia adentro":

- **Región**: el nivel más alto — un lugar geográfico concreto donde AWS tiene centros de datos (ej. `us-east-1`, en Virginia, EE.UU.). Elegís una región según dónde estén tus usuarios (menos distancia = respuestas más rápidas) o por requisitos legales (algunos países exigen que ciertos datos no salgan del país).
- **Availability Zone (AZ)**: dentro de una región hay varias AZs — centros de datos físicamente separados entre sí (distinta energía, distinta red), pero conectados con enlaces muy rápidos. La idea: si un incendio o un corte eléctrico deja fuera de servicio una AZ entera, las otras siguen funcionando. Repartir tu aplicación entre AZs es lo que te da **alta disponibilidad** real.
- **VPC (Virtual Private Cloud)**: tu propia red privada dentro de la región — como tener tu propio edificio de oficinas en un barrio compartido, con paredes que nadie más puede atravesar sin permiso. Ahí adentro viven los recursos que necesitan estar "en tu red" (en este proyecto: Lambda y RDS). S3, API Gateway y Route 53 son distintos: son servicios que AWS ofrece a nivel de toda la región, no viven dentro de ninguna VPC en particular.
- **Subred pública vs. privada**: dentro de la VPC, se dividen los recursos según si necesitan ser alcanzables directamente desde internet (subred **pública**) o no (subred **privada**). La base de datos, en particular, casi nunca debería estar en una subred pública — no hay ninguna razón para que alguien en internet se conecte directo a ella; solo tu propio código (Lambda) necesita hablarle, y eso puede pasar completamente dentro de la red privada.
- **Internet Gateway**: la "puerta principal" de la VPC hacia internet — sin esto, nada dentro de la VPC podría comunicarse hacia afuera, ni nada de afuera podría entrar.
- **NAT Gateway**: pensalo como la "salida de personal" de un edificio de oficinas — permite que alguien adentro (ej. Lambda) inicie una conexión hacia afuera (ej. para llamar a una API externa), sin que eso signifique que cualquiera de afuera pueda entrar por ahí.
- **RDS Multi-AZ**: la base de datos primaria vive en una AZ, y AWS mantiene una copia "standby" sincronizada en otra AZ. Si la primera falla, se conmuta a la copia automáticamente, sin intervención manual.

**Por qué importa entender esto incluso si nunca configurás una VPC a mano**: en el examen de AWS Cloud Practitioner (y en cualquier conversación real sobre arquitectura en la nube), "región", "Availability Zone" y "VPC" aparecen constantemente como la forma en que se explica **dónde** vive algo y **qué tan protegido/disponible** está — no son detalles de implementación menores, son la base del vocabulario de AWS.

---

## 5. Glosario rápido

| Término | En una frase |
|---|---|
| **Nube (cloud)** | Usar computadoras de otra empresa (AWS, en este caso) en vez de comprar y mantener las tuyas propias |
| **Servicio administrado (managed service)** | Un servicio donde AWS se encarga del mantenimiento de fondo (parches, backups, hardware) — vos solo lo usás |
| **Serverless** | Un modelo donde no administrás ningún servidor propio; el proveedor lo hace, y a menudo solo pagás por el uso real, no por tener algo "prendido" |
| **API** | El "contrato" que define cómo un programa le pide cosas a otro (qué mandar, qué esperar de vuelta) |
| **Región (region)** | Ubicación geográfica de AWS donde corren tus recursos |
| **Availability Zone (AZ)** | Centro de datos físicamente independiente dentro de una región |
| **VPC (Virtual Private Cloud)** | Tu red privada aislada dentro de una región de AWS |
| **Alta disponibilidad** | Que la aplicación siga funcionando incluso si una parte de la infraestructura falla |
| **Escalar (scaling)** | Ajustar cuántos recursos usa tu aplicación según la demanda real (más pedidos → más capacidad, automáticamente) |

---

## 6. Cómo seguir aprendiendo

- **Jugá el Quiz de este proyecto** (`https://floci.devera.cloud/site/quiz-frontend/`) — está hecho justo sobre el temario de AWS Cloud Practitioner, así que es una forma directa de comprobar qué tan sólidos están estos conceptos.
- **Dibujá el diagrama de la sección 4 de memoria**, sin mirarlo, y después compará — es un ejercicio simple que expone rápido qué parte del mapa todavía no quedó clara.
- **Relacioná cada servicio con su "para qué sirve"**, no con su nombre — cuando puedas explicar S3, Lambda, API Gateway y RDS con tus propias palabras (sin repetir la definición de memoria), es señal de que el concepto ya es tuyo, no solo un dato memorizado.
- **Cuando aparezca un servicio nuevo de AWS que no conocés**, preguntate primero "¿esto guarda algo, ejecuta algo, o conecta cosas?" — la enorme mayoría de los ~200 servicios de AWS caen en una de esas tres categorías, y ubicarlo ahí primero hace mucho más fácil entender el resto.
- Si en algún momento este proyecto agrega servicios nuevos (hay un plan de "servicios avanzados" en marcha, ver [`proyectos/quiz-avanzado/`](../../quiz-avanzado/)), va a aparecer una sección nueva acá mismo (o un documento hermano) explicándolos con el mismo enfoque: sin jerga, con analogía, con diagrama.
