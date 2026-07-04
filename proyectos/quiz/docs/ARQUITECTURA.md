# Arquitectura del proyecto Quiz

**Fecha:** 2026-07-03 / actualizado 2026-07-04
**Estado:** Implementado y probado de punta a punta (categorías → preguntas → submit → ranking) contra Floci, con navegador headless real.

---

## 1. Objetivo

Página web de un quiz de tecnología con categorías **AWS Cloud Practitioner**, **Python** y **Linux** (estas dos últimas solo visibles en la página de categorías, sin preguntas todavía). El usuario ingresa un nombre de usuario (sin contraseña, solo para fines de ranking), responde preguntas de una categoría, y su puntaje queda registrado en un ranking compartido.

## 2. Decisión: estático vs. dinámico

- El **ranking es estado compartido entre usuarios** → requiere sí o sí un backend + base de datos; no es algo que se pueda resolver solo con JavaScript en el navegador, independientemente del framework de frontend que se use.
- Lo que sí es una decisión real es **cómo se sirve el frontend**: se optó por **frontend estático** (HTML/CSS/JS ya compilado, sin servidor Node corriendo 24/7) que consume una **API serverless** (Lambda) para todo lo dinámico. Este es el patrón estándar en arquitecturas AWS reales (SPA + API serverless) y se mantiene 100% dentro de la nube emulada por Floci.
- Se descartó explícitamente un frontend con SSR (ej. Next.js en modo servidor), ya que requeriría un servicio de cómputo persistente (ECS/EC2) sin aportar nada a un quiz de preguntas y respuestas.

## 3. Servicios AWS (emulados por Floci)

| Servicio | Rol | Tipo en Floci |
|---|---|---|
| **S3** | Hosting estático del frontend (bucket con `website-configuration`) | Mock/en memoria — **verificado funcionando**: `put-bucket-website` + endpoint `http://<bucket>.s3-website.us-east-1.localhost:4566/` responden 200 OK |
| **API Gateway (HTTP API)** | Punto de entrada único de la API: `/categories`, `/questions/{categoria}`, `/submit`, `/ranking` | Mock/en memoria |
| **Lambda** | Una función por endpoint (ver sección 4) | Real — contenedor Docker `public.ecr.aws/lambda/nodejs:22`, igual que el proyecto Hello World |
| **RDS (Postgres)** | Base de datos relacional: categorías, preguntas, opciones, ranking | Real — motor Postgres real vía Docker |
| **IAM** | Un rol de ejecución por Lambda | Mock/en memoria |

Se descartó deliberadamente **Cognito** (no se necesitan cuentas reales) y **CloudFront** (sin valor en un entorno local de un solo usuario detrás de túnel SSH).

## 4. Estructura de la API (una Lambda por endpoint)

| Función | Ruta | Responsabilidad |
|---|---|---|
| `categories` | `GET /categories` | Lista las 3 categorías, indicando cuáles tienen preguntas cargadas (vía `COUNT(*)` en `preguntas`, no un flag manual) |
| `questions` | `GET /questions/{categoria}` | Devuelve las preguntas y opciones de una categoría — **sin** incluir cuál opción es la correcta ni la explicación |
| `submit` | `POST /submit` | Recibe username + respuestas, **calcula el puntaje en el servidor** (nunca confiar en el cliente), guarda en `ranking`, devuelve puntaje + respuestas correctas + explicaciones |
| `ranking` | `GET /ranking` | Devuelve el leaderboard (top N por puntaje) |

Cada Lambda tendrá su propio rol IAM, como practicamos en el Hello World.

## 5. Modelo de datos (implementado, ver `db/schema.sql`)

```
categorias (id, nombre, slug)
preguntas (id, categoria_id -> categorias.id, enunciado, enunciado_en, es_multiple)
opciones (id, pregunta_id -> preguntas.id, texto, es_correcta, orden)
explicaciones (pregunta_id -> preguntas.id, explicacion, tip, pistas JSONB, glosario JSONB)
respuestas_detalladas (pregunta_id -> preguntas.id, contenido_md)   -- solo para un subconjunto de preguntas
ranking (id, username, puntaje, categoria_id -> categorias.id, fecha)
```

Semilla inicial de `categorias`: `aws-cloud-practitioner`, `python`, `linux`. Poblado real: **169 preguntas**, **697 opciones**, **169 explicaciones**, **11 respuestas_detalladas** — todas en `aws-cloud-practitioner`; `python` y `linux` quedan sin preguntas (se muestran como "Próximamente" en el frontend, calculado dinámicamente con `COUNT(*)`).

**Correcciones aplicadas (2026-07-04), directamente en la base de datos vía `UPDATE`:**
- Pregunta **53**: la opción duplicada "Foro de AWS Support." se reemplazó por "AWS re:Post." (distractor real y distinto).
- Pregunta **122**: la opción duplicada "AWS Trusted Advisor" se reemplazó por "AWS Config".
- **Formato de explicaciones estandarizado**: se eliminó el uso de `respuestas_detalladas` (el contenido markdown extenso — tablas, encabezados, análisis largo — que solo existía para 11 de las 169 preguntas y hacía que esas preguntas se vieran con un formato distinto al resto). Ahora **todas** las preguntas muestran exactamente el mismo formato: explicación corta (188-292 caracteres) + tip + glosario. El Lambda `submit` ya no consulta esa tabla ni la incluye en la respuesta; el frontend eliminó el renderizador de Markdown que la mostraba (`renderMarkdown`, `esFilaTabla`, etc., y el CSS `.detalle-md`). La tabla `respuestas_detalladas` sigue existiendo en la base de datos (no se borró contenido), simplemente ya no se usa.

## 5.1 Hallazgos técnicos importantes durante la implementación

- **Conectividad a RDS**: el endpoint que devuelve `aws rds create-db-instance` (`172.22.0.2:7001`) es una dirección interna de la red Docker `floci_default` — no está publicada al host del VPS. Sí es alcanzable **desde el propio host del VPS** (Docker permite esto en redes bridge), pero no desde tu equipo local ni a través del túnel SSH existente (que solo reenvía el puerto 4566). Por eso, tanto la carga inicial de datos (`db/seed.js`) como cualquier tarea administrativa directa contra Postgres se ejecutan **en el VPS**, dentro de un contenedor efímero conectado a `--network floci_default` (usamos imágenes `postgres:17-alpine` y `node:22-alpine` para esto, sin instalar nada permanente en el host). Los Lambdas no tienen este problema: Floci los conecta automáticamente a `floci_default`, así que llegan a RDS de forma directa usando las variables de entorno `PGHOST=172.22.0.2` / `PGPORT=7001`.
- **URL de invocación de API Gateway**: la URL con subdominio al estilo `{api-id}.execute-api.{region}.localhost:4566` (que sí funciona para Lambda Function URLs) **no funciona** para API Gateway en Floci — devuelve un error de S3 (`NoSuchBucket`), señal de que el router interno no reconoce ese patrón para este servicio. El patrón correcto (estilo LocalStack) es:
  ```
  http://localhost:4566/restapis/{api_id}/{stage}/_user_request_/{ruta}
  ```
  Con `{stage}` = `$default` en nuestro caso. Este es el valor de `API_BASE` en `frontend/app.js`.
- **CORS en la ruta `_user_request_`**: el navegador dispara un *preflight* `OPTIONS` en cualquier `fetch` con `Content-Type: application/json`. La ruta interna `_user_request_` de Floci no responde ese preflight con los headers CORS necesarios (aunque la API se creó con `--cors-configuration`), y el navegador bloquea la petición real. Workaround aplicado: el frontend envía el `POST /submit` con `Content-Type: text/plain` (que el navegador considera una petición "simple", sin preflight) — el Lambda igual parsea el body como JSON sin mirar ese header. Esto **no sería necesario contra AWS real**, es una limitación puntual de esta ruta de invocación en Floci.
- **Verificación real, no solo por curl**: la API respondía bien con `curl`, pero el flujo fallaba en un navegador real por el punto anterior (CORS). Se detectó recién al probar con un navegador headless (Playwright) haciendo clic en la UI real — por eso el flujo se validó así antes de darlo por bueno, y no solo con llamadas directas a la API.

## 6. Estructura de carpetas del proyecto

```
proyectos/quiz/
├── docs/            # Esta documentación
├── data/            # JSON de preguntas/respuestas que aportará el usuario (se elimina tras poblar la BD)
├── db/              # Script(s) SQL de esquema + carga de datos
├── lambda/
│   ├── categories/
│   ├── questions/
│   ├── submit/
│   └── ranking/
└── frontend/         # Se sube a S3: index.html, style.css (compilado), app.js
    ├── src/input.css  # Fuente de Tailwind (no se sube a S3)
    ├── package.json   # Build de Tailwind (no se sube a S3)
    └── node_modules/  # Dependencia de build, local (no se sube a S3)
```

> **Importante**: `frontend/` ahora tiene un paso de build para el CSS. `src/`, `package.json`, `package-lock.json` y `node_modules/` son herramientas de desarrollo — **no se despliegan a S3**, solo `index.html`, `style.css` (ya compilado) y `app.js`. El despliegue usa `aws s3 cp` de esos 3 archivos puntuales, no `aws s3 sync` de toda la carpeta.

## 7. Checklist de implementación

- [x] Archivos JSON de AWS Cloud Practitioner recibidos y analizados (`data/`).
- [x] Esquema definido y aplicado (`db/schema.sql`): `categorias`, `preguntas`, `opciones`, `explicaciones`, `respuestas_detalladas`, `ranking`.
- [x] Datos cargados (`db/seed.js`): 169 preguntas, 697 opciones, 169 explicaciones, 11 respuestas detalladas.
- [x] Instancia RDS Postgres creada en Floci (`quiz-db`, engine postgres 17).
- [x] 4 Lambdas implementadas y desplegadas (`quiz-categories`, `quiz-questions`, `quiz-submit`, `quiz-ranking`), cada una con su rol IAM.
- [x] API Gateway HTTP API (`quiz-api`, id `f3744ef7e3`) con las 4 rutas y CORS configurado.
- [x] Frontend estático construido (HTML/CSS/JS vanilla, sin framework ni build step).
- [x] Bucket S3 (`quiz-frontend`) con hosting estático, frontend desplegado.
- [x] Flujo completo probado con navegador headless (Playwright): categorías → username → 10 preguntas aleatorias → resultado con explicaciones/tips/glosario/respuesta detallada (incluyendo tablas markdown) → ranking. Sin errores de consola.
- [x] Carpeta `data/` (los JSON originales) eliminada tras confirmar la carga exitosa, según lo autorizado.

## 8. Cómo volver a acceder (para tu día a día)

Con el túnel SSH activo (`ssh -f -N -L 4566:localhost:4566 root@147.93.10.106`) y usando el perfil `floci` de AWS CLI:

- **Frontend**: `http://quiz-frontend.s3-website.us-east-1.localhost:4566/`
- **API** (si necesitas probarla directo): `http://localhost:4566/restapis/f3744ef7e3/$default/_user_request_/categories` (o `/questions/{categoria}`, `/ranking`, `POST /submit`)
- **Base de datos** (solo desde el VPS, ver 5.1): `172.22.0.2:7001`, usuario `quizadmin`, base `quiz`.

## 9. Cambios posteriores (2026-07-04, segunda ronda)

- **Niveles seleccionables**: en la pantalla inicial se puede elegir cuántas preguntas responder (10, 20 o 30), con un selector tipo píldora. El valor se guarda en `state.nivel` y se usa en `iniciarQuiz()` en vez de un valor fijo.
- **Aleatoriedad de preguntas y opciones**: ya estaba implementada desde el principio (`shuffle()` se aplica tanto al elegir el subconjunto de preguntas como a las opciones de cada una, cada vez que se inicia un intento) — se verificó explícitamente con una prueba automatizada que confirma que `shuffle()` genera órdenes distintos en llamadas sucesivas.

## 10. Cambios posteriores (2026-07-04, tercera ronda): avatares + TailwindCSS + GSAP

- **Avatares de usuario**: se agregó la columna `avatar` (TEXT, nullable) a `ranking`. En la pantalla inicial hay un selector de 16 emojis (constante `AVATARES` en `frontend/app.js`, debe coincidir con `AVATARES_VALIDOS` en `lambda/submit/index.js`, que valida el emoji recibido contra esa lista antes de guardarlo — cualquier valor fuera de la lista se guarda como `NULL`). El avatar se muestra junto al username en el header y en la tabla de ranking.
- **TailwindCSS (v4)**: se migró todo el HTML/CSS de `frontend/` de clases custom a utilidades de Tailwind. Requiere un paso de build:
  ```bash
  cd proyectos/quiz/frontend
  npm install        # una sola vez
  npm run build:css  # genera style.css desde src/input.css
  ```
  Tailwind v4 usa `@import "tailwindcss";` dentro de `src/input.css` en vez de `tailwind.config.js`; las fuentes de contenido a escanear se declaran con `@source` (necesario porque este proyecto no es un repo git, y Tailwind v4 auto-detecta contenido con heurísticas basadas en git). La paleta de colores es la de Tailwind por defecto (`slate`, `orange`, `green`, `red`), sin tema custom — coincide casi 1:1 con los colores que ya se habían elegido a mano.
- **GSAP (vía CDN, sin paso de build)**: se agregó `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js">` en `index.html`. Animaciones agregadas en `app.js`:
  - Transición de entrada (fade + slide) cada vez que se reemplaza la pantalla (`animarEntradaPantalla`).
  - Entrada escalonada (stagger) de los avatares y las tarjetas de categoría en la pantalla inicial.
  - Rebote al hacer click en un botón (avatar, nivel, "Siguiente").
  - Barra de progreso animada con `gsap.to(...)` en vez de solo CSS.
  - Contador animado del puntaje final (de 0% al puntaje real) con un rebote de celebración si el puntaje es ≥ 80%.
  - Todo el código de animación verifica `typeof gsap === "undefined"` antes de usarlo: si el CDN no carga (ej. sin internet), la app sigue funcionando igual, solo sin animaciones.
- **Nota de entorno de prueba**: al probar con navegador headless, los emojis se veían como cuadros vacíos — no era un bug, sino que este servidor de pruebas no tenía fuentes de emoji instaladas (`fonts-noto-color-emoji`). Se instaló para verificar visualmente; en el navegador real del usuario esto no debería ocurrir, ya que Windows/macOS/la mayoría de distros Linux de escritorio ya traen fuentes de emoji.

## 11. Fix (2026-07-04): selección de avatar y caché del navegador

- **Reporte**: "no me permite elegir avatar, solo mantiene el de la nube". Al probar el código directamente (clic en distintos avatares vía navegador headless) el selector funcionaba correctamente y sin errores — la hipótesis más probable es que el navegador del usuario tenía cacheado un `app.js` de una versión anterior, ya que los objetos en S3 no tenían ningún header `Cache-Control` (quedaba a criterio heurístico del navegador).
- **Corrección de raíz**: todos los despliegues a `s3://quiz-frontend/` ahora se suben con `--cache-control "no-cache"` (fuerza al navegador a revalidar con el servidor en cada carga en vez de asumir que el archivo cacheado sigue vigente — no es "no guardar nunca", es "siempre confirmar primero"). Recordar usar este flag en `aws s3 cp` para los 3 archivos (`index.html`, `style.css`, `app.js`) en cada despliegue futuro.
- **Mejora de UX solicitada**: se agregó un indicador en vivo "Jugando como: 🔥 sebastian" justo debajo del campo de nombre, que se actualiza al escribir el nombre o cambiar de avatar — así queda inmediatamente claro cuál está seleccionado, sin depender de fijarse en el anillo naranja alrededor del emoji.
- **Si el problema persiste** después de esto, probablemente sigue siendo caché: pedir al usuario recargar con Ctrl+Shift+R (o Cmd+Shift+R en Mac) o abrir en una ventana privada/incógnito.

## 12. Rediseño completo (2026-07-04, cuarta ronda): estilo "Reto Quiz"

El usuario aportó un HTML de ejemplo (`data/Reto Quiz.html`, un "bundle" autocontenido que se descomprime con JS al cargar — se inspeccionó sirviéndolo con `python3 -m http.server` y navegándolo con Playwright, ya que el HTML crudo no muestra el contenido real). Se replicó el diseño completo, manteniendo avatares (emoji) en vez de reemplazarlos por el selector de color del ejemplo, y agregando el selector de color **además** del avatar.

### Cambios de arquitectura/backend

- **Nueva Lambda `quiz-answer`** (`POST /answer`): permite la "respuesta inmediata" — revela si UNA pregunta puntual es correcta (+ explicación) apenas el usuario responde, sin esperar al final del quiz. Nunca revela las demás preguntas. Rol IAM propio (`quiz-answer-role`).
- **Lambda `submit` reescrita**: ya no calcula porcentaje, calcula **puntos + racha**: 100 puntos por respuesta correcta + bono de 20 puntos por cada acierto consecutivo adicional (racha). El puntaje, aciertos y mejor racha se recalculan siempre desde la base de datos en el orden en que llegaron las respuestas — igual que antes, nunca se confía en lo que afirme el cliente. También calcula y devuelve el **puesto** del jugador en el ranking de su categoría (`puesto`, `total_jugadores`), calculado con una subconsulta `COUNT(*) WHERE puntaje > X`.
- **Esquema `ranking` ampliado**: se agregaron columnas `color` (hex del color elegido), `aciertos`, `total`, `mejor_racha`. **Se vació la tabla ranking** (autorizado explícitamente, ya que el cambio de porcentaje→puntos hacía que los datos viejos no fueran comparables con los nuevos).
- **Lambda `ranking`**: ahora devuelve también `color`, `aciertos`, `total`, `mejor_racha` por fila.

### Cambios de frontend

- **Flujo de pantallas ampliado** para calzar con el ejemplo: Landing ("Reto Quiz") → Elige categoría (AWS/Python/Linux, nueva pantalla) → Elige tu reto (10 "Rápido" / 20 "Clásico" / 30 "Maratón") → Crea tu perfil (nombre + avatar + **color**, el avatar se muestra sobre un cuadro con el color elegido de fondo) → Preguntas con respuesta inmediata → Resultado (con tarjetas de Aciertos/Precisión/Mejor racha y "Puesto #N de M") → Clasificación.
- **Tema visual**: se cambió de tema oscuro a **tema claro** (fondo degradado lavanda/blanco, tarjetas blancas con sombra suave), con degradado `indigo-600 → violet-600` como color principal — extraído con precisión del ejemplo (`getComputedStyle` vía Playwright, no adivinado de la captura).
- **Paleta de 8 colores** para el perfil (`COLORES` en `app.js`): coincide exactamente con la paleta por defecto de Tailwind en el shade 500 (`amber, sky, pink, green, violet, red, teal, indigo`), igual que el ejemplo. Aplicado vía `style="background-color:..."` inline (no como clases de Tailwind), porque Tailwind v4 no puede detectar en tiempo de compilación colores que se arman dinámicamente en JS.
- **Respuesta inmediata**: opción correcta se resalta en verde con ✓, la seleccionada incorrecta en rojo con ✕, el resto se atenúa; aparece un panel con "¡Correcto!"/"¡Incorrecto!" + explicación + tip, y un botón "Siguiente pregunta" / "Ver resultados" (avance manual, no automático) — todo igual que el ejemplo.
- Preguntas de opción múltiple (`es_multiple`): en vez de auto-enviar al elegir, muestran un botón "Confirmar respuesta" que se habilita cuando hay al menos una opción marcada.

### Bug encontrado en pruebas (no de la app)

Al probar el flujo con Playwright, `input.check({force:true})` fallaba en las opciones porque los `<input>` de radio/checkbox están ocultos (`class="hidden"`, se interactúa haciendo clic en el `<label>` que los envuelve, como es el patrón visual). Se corrigió el *test*, no la app — clicks reales de usuario sobre el `<label>` siempre funcionaron bien.

### Referencia de diseño (no se implementó en esta ronda, ver sección 13 — ya se agregó después)

El ejemplo incluía un sistema de **medallas/logros** ("MIS MEDALLAS", 0/7: Aprobado, Sin fallos, En racha, Remontada, Podio, Campeón, Maratón). No se implementó por no haber sido solicitado explícitamente — quedó como posible mejora futura si se pedía.

## 13. Medallas + tema claro/oscuro/sistema + confeti (2026-07-04, quinta ronda)

### Medallas/logros

- **Esquema**: se agregó `ranking.puesto_logrado` (INTEGER) — el puesto obtenido en el momento exacto de ese intento, guardado de forma permanente. Es necesario para medallas como "Podio"/"Campeón": si no se guardara, el logro cambiaría retroactivamente cada vez que alguien nuevo jugara y modificara el ranking.
- **Nueva Lambda `quiz-badges`** (`GET /badges?username=X`): calcula las 7 medallas evaluando **todo el historial** del username (todas las categorías, todos los intentos), no solo el intento actual. Reglas de desbloqueo (definidas por mí, ya que el ejemplo no especificaba la lógica exacta detrás de cada una):
  - **Aprobado**: algún intento con ≥ 50% de aciertos.
  - **Sin fallos**: algún intento con 100% de aciertos.
  - **En racha**: alguna racha de 5 o más aciertos consecutivos.
  - **Remontada**: algún intento con al menos 1 fallo pero igual terminó con ≥ 70% de aciertos.
  - **Podio**: algún intento terminó en el puesto 1-3 (`puesto_logrado <= 3`).
  - **Campeón**: algún intento terminó en el puesto 1.
  - **Maratón**: algún intento de 30 preguntas o más completado.
- **`submit`** ahora también guarda `puesto_logrado` y devuelve el estado de las 7 medallas en su respuesta (recalculado incluyendo el intento recién guardado), para mostrarlo de inmediato en la pantalla de resultado sin una llamada adicional.
- **Frontend**: la sección "MIS MEDALLAS X/7" aparece en dos lugares — en "Crea tu perfil" (consulta a `/badges` con debounce de 400ms mientras se escribe el nombre, igual que el ejemplo) y en el Resultado final (usa `medallas` de la respuesta de `/submit` directamente). Medallas bloqueadas se muestran en gris con opacidad reducida; desbloqueadas con ícono a color sobre degradado indigo→violeta.

### Tema claro / oscuro / sistema

- Botón fijo (`#btn-tema`, ☀️/🌙/🖥️) ubicado en `index.html`, **fuera** de `#screen-root` — así sobrevive a cada cambio de pantalla sin tener que re-engancharlo.
- Ciclo: claro → oscuro → sistema → claro. Se guarda en `localStorage["quiz-theme"]`.
- Tailwind v4 activa `dark:` por `prefers-color-scheme` por defecto; se sobreescribió con `@custom-variant dark (&:where(.dark, .dark *));` en `src/input.css` para que dependa de una clase `.dark` en `<html>`, controlada por JS (necesario para poder ofrecer un modo "claro" que ignore la preferencia del sistema).
- Un script inline en el `<head>` de `index.html` aplica la clase `.dark` **antes** de pintar la página (lee `localStorage` directo, sin esperar a `app.js`), para evitar un parpadeo del tema equivocado al cargar.
- En modo "sistema", se escucha el evento `change` de `matchMedia("(prefers-color-scheme: dark)")` para reaccionar si el usuario cambia el tema de su sistema operativo mientras la página está abierta.
- Se agregaron variantes `dark:` a las 7 pantallas (fondos, bordes, texto). Los colores "semánticos" (verde=correcto, rojo=incorrecto, degradado indigo/violeta de marca) se mantienen prácticamente iguales en ambos temas, solo se ajustó la opacidad de fondo (ej. `bg-green-50` → `dark:bg-green-500/10`).

### Confeti al finalizar

- `celebrarConfeti()` en `app.js`: crea ~70 elementos `<div>` de colores (tomados de la misma paleta `COLORES` del selector de perfil) y los anima cayendo con GSAP (posición, rotación y opacidad aleatorias), removiendo el contenedor al terminar. Se dispara automáticamente al mostrar la pantalla de Resultado final, sin condicionarlo al puntaje (celebra terminar el quiz, no solo un buen resultado).
