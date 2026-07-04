// API_BASE apunta al invoke URL de la API Gateway HTTP API en Floci, a traves del
// mismo tunel SSH (puerto 4566) que usamos para el resto de la nube emulada.
// Patron descubierto empiricamente: /restapis/{api_id}/{stage}/_user_request_/{ruta}
const API_ID = "f3744ef7e3";
const API_BASE = `http://localhost:4566/restapis/${API_ID}/$default/_user_request_`;

const NIVELES = [
  { n: 10, nombre: "Rápido", desc: "~3 min", color: "#6366f1" },
  { n: 20, nombre: "Clásico", desc: "~6 min", color: "#22c55e" },
  { n: 30, nombre: "Maratón", desc: "~10 min", color: "#f59e0b" },
];

// Debe coincidir con AVATARES_VALIDOS en lambda/submit/index.js
const AVATARES = ["🚀", "🤖", "🐍", "🐧", "☁️", "🔥", "⚡", "🎯", "🧠", "💡", "🛰️", "🔐", "📦", "🌐", "🎮", "🦾"];
// Debe coincidir con COLORES_VALIDOS en lambda/submit/index.js
const COLORES = ["#f59e0b", "#0ea5e9", "#ec4899", "#22c55e", "#8b5cf6", "#ef4444", "#14b8a6", "#6366f1"];

const CATEGORIA_ICONOS = { "aws-cloud-practitioner": "☁️", python: "🐍", linux: "🐧" };
const CATEGORIA_COLORES = { "aws-cloud-practitioner": "#f59e0b", python: "#22c55e", linux: "#0ea5e9" };
const LETRAS = ["A", "B", "C", "D", "E"];

// Debe coincidir con MEDALLAS_INFO en lambda/badges/index.js y lambda/submit/index.js
const MEDALLAS_INFO = [
  { id: "aprobado", nombre: "Aprobado", icono: "✓" },
  { id: "sin_fallos", nombre: "Sin fallos", icono: "★" },
  { id: "en_racha", nombre: "En racha", icono: "🔥" },
  { id: "remontada", nombre: "Remontada", icono: "⬆" },
  { id: "podio", nombre: "Podio", icono: "🏅" },
  { id: "campeon", nombre: "Campeón", icono: "👑" },
  { id: "maraton", nombre: "Maratón", icono: "∞" },
];

const root = document.getElementById("screen-root");

let state = {
  username: "",
  avatar: AVATARES[0],
  color: COLORES[0],
  nivel: NIVELES[0].n,
  categorias: [],
  categoriaActual: null,
  preguntas: [],
  indice: 0,
  respuestas: [],
  seleccionActual: [],
  feedbackActual: null,
  puntaje: 0,
  racha: 0,
};

async function api(path, options) {
  const res = await fetch(API_BASE + path, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Error de red (${res.status})`);
  }
  return data;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function render(html) {
  root.innerHTML = html;
  animarEntradaPantalla();
}

// --- Tema claro / oscuro / sistema ---
// El boton vive en index.html, fuera de #screen-root, asi que sobrevive a
// cada render() sin necesidad de volver a engancharlo en cada pantalla.

const ICONOS_TEMA = { light: "☀️", dark: "🌙", system: "🖥️" };

function obtenerModoTema() {
  return localStorage.getItem("quiz-theme") || "system";
}

function aplicarTema(modo) {
  localStorage.setItem("quiz-theme", modo);
  const prefiereOscuro = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const oscuro = modo === "dark" || (modo === "system" && prefiereOscuro);
  document.documentElement.classList.toggle("dark", oscuro);
  const btn = document.getElementById("btn-tema");
  if (btn) btn.textContent = ICONOS_TEMA[modo];
}

function inicializarTema() {
  aplicarTema(obtenerModoTema());
  const btn = document.getElementById("btn-tema");
  btn.addEventListener("click", () => {
    const siguiente = { light: "dark", dark: "system", system: "light" }[obtenerModoTema()];
    aplicarTema(siguiente);
    animarClickBoton(btn);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (obtenerModoTema() === "system") aplicarTema("system");
  });
}

// --- Animaciones GSAP (si el CDN no cargo, la app sigue funcionando sin animar) ---

function animarEntradaPantalla() {
  if (typeof gsap === "undefined") return;
  gsap.fromTo(
    "#screen-root > *",
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.4, ease: "power2.out", stagger: 0.05 }
  );
}

function animarClickBoton(el) {
  if (typeof gsap === "undefined" || !el) return;
  gsap.fromTo(el, { scale: 0.94 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
}

function animarListaEscalonada(selector) {
  if (typeof gsap === "undefined") return;
  gsap.fromTo(selector, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.06, delay: 0.1 });
}

// Confeti de celebracion al terminar el quiz. Se arma con divs de colores de la
// paleta que caen y rotan con GSAP; se limpian solos al terminar la animacion.
function celebrarConfeti() {
  if (typeof gsap === "undefined") return;
  const contenedor = document.createElement("div");
  contenedor.className = "fixed inset-0 pointer-events-none z-50 overflow-hidden";
  document.body.appendChild(contenedor);

  const piezas = [];
  for (let i = 0; i < 70; i++) {
    const pieza = document.createElement("div");
    const color = COLORES[Math.floor(Math.random() * COLORES.length)];
    const tam = 6 + Math.random() * 6;
    pieza.style.cssText = `position:absolute;top:-20px;left:${Math.random() * 100}%;width:${tam}px;height:${tam}px;background:${color};border-radius:${Math.random() > 0.5 ? "50%" : "2px"};`;
    contenedor.appendChild(pieza);
    piezas.push(pieza);
  }

  gsap.to(piezas, {
    y: () => window.innerHeight + 60,
    x: () => (Math.random() - 0.5) * 250,
    rotation: () => Math.random() * 720 - 360,
    opacity: 0,
    duration: () => 1.8 + Math.random() * 1.2,
    ease: "power1.in",
    stagger: 0.008,
    onComplete: () => contenedor.remove(),
  });
}

// --- Medallas (mostradas en Crea tu perfil y en Resultado final) ---

function renderMedallasHtml(medallas) {
  const desbloqueadas = medallas.filter((m) => m.desbloqueada).length;
  const items = medallas
    .map(
      (m) => `
      <div class="flex flex-col items-center gap-1 ${m.desbloqueada ? "" : "opacity-40 grayscale"}">
        <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-xl ${
          m.desbloqueada
            ? "bg-gradient-to-br from-indigo-500 to-violet-500 text-white"
            : "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500"
        }">${m.icono}</div>
        <div class="text-[10px] font-semibold text-slate-500 dark:text-slate-400 text-center leading-tight">${escapeHtml(m.nombre)}</div>
      </div>`
    )
    .join("");

  return `
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs font-bold text-slate-400 tracking-wide">MIS MEDALLAS</div>
      <div class="text-xs font-bold text-indigo-600 dark:text-indigo-400">${desbloqueadas}/${medallas.length}</div>
    </div>
    <div class="grid grid-cols-4 gap-3">${items}</div>
  `;
}

let medallasDebounceTimer = null;
function programarActualizarMedallasPerfil() {
  clearTimeout(medallasDebounceTimer);
  if (!state.username) {
    const cont = document.getElementById("medallas-seccion");
    if (cont) cont.innerHTML = renderMedallasHtml(MEDALLAS_INFO.map((m) => ({ ...m, desbloqueada: false })));
    return;
  }
  medallasDebounceTimer = setTimeout(async () => {
    try {
      const medallas = await api(`/badges?username=${encodeURIComponent(state.username)}`);
      const cont = document.getElementById("medallas-seccion");
      if (cont) cont.innerHTML = renderMedallasHtml(medallas);
    } catch (err) {
      // silencioso: las medallas son un extra, no deben bloquear el flujo principal
    }
  }, 400);
}

// --- Pantalla 1: landing ---

function renderLanding() {
  render(`
    <div class="text-center pt-10">
      <span class="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-4 py-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 shadow-sm mb-6">
        <span class="w-2 h-2 rounded-full bg-amber-500"></span> AWS CLOUD PRACTITIONER
      </span>
      <div class="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-4xl font-extrabold text-white shadow-lg shadow-indigo-200 dark:shadow-indigo-950/60 mb-6">?</div>
      <h1 class="text-4xl font-extrabold mb-3">Reto Quiz</h1>
      <p class="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">Pon a prueba lo que sabes. Elige tu reto,<br>personaliza tu perfil y escala en la clasificación.</p>
      <button id="btn-jugar" class="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-2xl py-4 shadow-lg shadow-indigo-200 dark:shadow-indigo-950/60 mb-3">Jugar</button>
      <button id="btn-ver-clasificacion" class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 font-semibold text-slate-700 dark:text-slate-200">Clasificación</button>
    </div>
  `);

  document.getElementById("btn-jugar").addEventListener("click", (e) => {
    animarClickBoton(e.currentTarget);
    renderCategorias();
  });
  document.getElementById("btn-ver-clasificacion").addEventListener("click", () => {
    const disponible = state.categorias.find((c) => c.tiene_preguntas);
    renderRanking(disponible ? disponible.slug : "aws-cloud-practitioner");
  });
}

// --- Pantalla 2: elegir categoria ---

function renderCategorias() {
  const cards = state.categorias
    .map((c) => {
      const color = CATEGORIA_COLORES[c.slug] || "#94a3b8";
      const icono = CATEGORIA_ICONOS[c.slug] || "❓";
      return `
      <button class="categoria-card flex items-center gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm text-left transition hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm disabled:cursor-not-allowed" data-slug="${c.slug}" ${c.tiene_preguntas ? "" : "disabled"}>
        <span class="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style="background-color:${color}22">${icono}</span>
        <span class="flex-1">
          <span class="block font-bold">${escapeHtml(c.nombre)}</span>
          <span class="block text-sm text-slate-400">${c.tiene_preguntas ? "Disponible" : "Próximamente"}</span>
        </span>
        <span class="text-slate-300 dark:text-slate-600">→</span>
      </button>`;
    })
    .join("");

  render(`
    <div>
      <button id="btn-atras" class="text-slate-400 text-sm font-semibold mb-4">← Inicio</button>
      <h1 class="text-3xl font-extrabold mb-1">Elige tu categoría</h1>
      <p class="text-slate-500 dark:text-slate-400 mb-6">¿Sobre qué quieres que sean las preguntas?</p>
      <div class="flex flex-col gap-3">${cards}</div>
    </div>
  `);

  document.getElementById("btn-atras").addEventListener("click", renderLanding);
  root.querySelectorAll(".categoria-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.categoriaActual = btn.dataset.slug;
      renderNivel();
    });
  });
}

// --- Pantalla 3: elegir nivel (cantidad de preguntas) ---

function renderNivel() {
  const cards = NIVELES.map(
    (nv) => `
      <button class="nivel-card flex items-center gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm text-left transition hover:shadow-md hover:-translate-y-0.5" data-n="${nv.n}">
        <span class="w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-lg shrink-0" style="background-color:${nv.color}22;color:${nv.color}">${nv.n}</span>
        <span class="flex-1">
          <span class="block font-bold">${nv.nombre}</span>
          <span class="block text-sm text-slate-400">${nv.n} preguntas · ${nv.desc}</span>
        </span>
        <span class="text-slate-300 dark:text-slate-600">→</span>
      </button>`
  ).join("");

  render(`
    <div>
      <button id="btn-atras" class="text-slate-400 text-sm font-semibold mb-4">← Categoría</button>
      <h1 class="text-3xl font-extrabold mb-1">Elige tu reto</h1>
      <p class="text-slate-500 dark:text-slate-400 mb-6">¿Cuántas preguntas te atreves a responder?</p>
      <div class="flex flex-col gap-3">${cards}</div>
    </div>
  `);

  document.getElementById("btn-atras").addEventListener("click", renderCategorias);
  root.querySelectorAll(".nivel-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.nivel = Number(btn.dataset.n);
      renderPerfil();
    });
  });
}

// --- Pantalla 4: crea tu perfil (nombre + avatar + color + medallas) ---

function renderPerfil() {
  const avataresHtml = AVATARES.map(
    (a) => `
      <button type="button" class="avatar-btn w-11 h-11 flex items-center justify-center text-xl rounded-full bg-slate-100 dark:bg-slate-700 border-2 transition" style="border-color:${a === state.avatar ? state.color : "transparent"}" data-avatar="${a}">${a}</button>`
  ).join("");

  const coloresHtml = COLORES.map(
    (c) => `
      <button type="button" class="color-btn w-10 h-10 rounded-xl transition ${c === state.color ? "ring-2 ring-offset-2 dark:ring-offset-slate-900 ring-slate-400 scale-110" : ""}" style="background-color:${c}" data-color="${c}"></button>`
  ).join("");

  const medallasIniciales = MEDALLAS_INFO.map((m) => ({ ...m, desbloqueada: false }));

  render(`
    <div>
      <button id="btn-atras" class="text-slate-400 text-sm font-semibold mb-4">← Nivel</button>
      <h1 class="text-3xl font-extrabold mb-1 text-center">Crea tu perfil</h1>
      <p class="text-slate-500 dark:text-slate-400 mb-6 text-center">Así aparecerás en la clasificación.</p>

      <div class="flex justify-center mb-6">
        <div id="avatar-preview" class="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl shadow-lg transition" style="background-color:${state.color}">${state.avatar}</div>
      </div>

      <input id="username-input" type="text" placeholder="Tu nombre" maxlength="40" value="${escapeHtml(state.username)}"
        class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-4 text-center font-semibold text-lg shadow-sm mb-6 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500">

      <div class="mb-6">
        <div class="text-xs font-bold text-slate-400 tracking-wide mb-2">AVATAR</div>
        <div class="flex flex-wrap gap-2" id="avatar-grupo">${avataresHtml}</div>
      </div>

      <div class="mb-6">
        <div class="text-xs font-bold text-slate-400 tracking-wide mb-2">COLOR</div>
        <div class="flex flex-wrap gap-2" id="color-grupo">${coloresHtml}</div>
      </div>

      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-8" id="medallas-seccion">
        ${renderMedallasHtml(medallasIniciales)}
      </div>

      <button id="btn-empezar" class="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-2xl py-4 shadow-lg shadow-indigo-200 dark:shadow-indigo-950/60 disabled:opacity-40 disabled:shadow-none" ${state.username ? "" : "disabled"}>Empezar</button>
    </div>
  `);

  document.getElementById("btn-atras").addEventListener("click", renderNivel);

  const preview = document.getElementById("avatar-preview");
  const btnEmpezar = document.getElementById("btn-empezar");

  if (state.username) programarActualizarMedallasPerfil();

  document.getElementById("username-input").addEventListener("input", (e) => {
    state.username = e.target.value.trim();
    btnEmpezar.disabled = !state.username;
    programarActualizarMedallasPerfil();
  });

  root.querySelectorAll(".avatar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.avatar = btn.dataset.avatar;
      root.querySelectorAll(".avatar-btn").forEach((b) => (b.style.borderColor = "transparent"));
      btn.style.borderColor = state.color;
      preview.textContent = state.avatar;
      animarClickBoton(btn);
    });
  });

  root.querySelectorAll(".color-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.color = btn.dataset.color;
      root.querySelectorAll(".color-btn").forEach((b) => b.classList.remove("ring-2", "ring-offset-2", "ring-slate-400", "scale-110"));
      btn.classList.add("ring-2", "ring-offset-2", "ring-slate-400", "scale-110");
      preview.style.backgroundColor = state.color;
      root.querySelectorAll(".avatar-btn").forEach((b) => {
        if (b.dataset.avatar === state.avatar) b.style.borderColor = state.color;
      });
      animarClickBoton(btn);
    });
  });

  btnEmpezar.addEventListener("click", () => {
    if (!state.username) return;
    iniciarQuiz();
  });
}

// --- Pantalla 5: preguntas (con respuesta inmediata) ---

async function iniciarQuiz() {
  render(`<p class="text-slate-400 text-center py-10">Cargando preguntas...</p>`);
  try {
    const todas = await api(`/questions/${state.categoriaActual}`);
    state.preguntas = shuffle(todas)
      .slice(0, state.nivel)
      .map((p) => ({ ...p, opciones: shuffle(p.opciones) }));
    state.indice = 0;
    state.respuestas = [];
    state.puntaje = 0;
    state.racha = 0;
    state.feedbackActual = null;
    renderPregunta();
  } catch (err) {
    render(`<p class="text-red-500 text-center py-10">Error cargando preguntas: ${escapeHtml(err.message)}</p>`);
  }
}

function renderPregunta() {
  const p = state.preguntas[state.indice];
  const esUltima = state.indice === state.preguntas.length - 1;
  const progresoPct = Math.round((state.respuestas.length / state.preguntas.length) * 100);
  const feedback = state.feedbackActual;
  const categoria = state.categorias.find((c) => c.slug === state.categoriaActual);

  const opcionesHtml = p.opciones
    .map((o, i) => {
      const letra = LETRAS[i];
      let clase = "border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500";
      let letraClase = "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300";
      let textoClase = "text-slate-800 dark:text-slate-100";
      let icono = "";

      if (feedback) {
        const esCorrectaEsta = feedback.opciones_correctas.includes(o.id);
        const fueSeleccionada = state.seleccionActual.includes(o.id);
        if (esCorrectaEsta) {
          clase = "border-green-500 bg-green-50 dark:bg-green-500/10";
          letraClase = "bg-green-500 text-white";
          icono = '<span class="text-green-600 dark:text-green-400 font-bold text-lg">✓</span>';
        } else if (fueSeleccionada) {
          clase = "border-red-500 bg-red-50 dark:bg-red-500/10";
          letraClase = "bg-red-500 text-white";
          icono = '<span class="text-red-600 dark:text-red-400 font-bold text-lg">✕</span>';
        } else {
          clase = "border-slate-100 dark:border-slate-800 opacity-50";
          textoClase = "text-slate-400";
        }
      }

      const tipo = p.es_multiple ? "checkbox" : "radio";
      return `
        <label class="opcion-btn flex items-center gap-3 border-2 rounded-2xl px-4 py-3.5 mb-2.5 cursor-pointer transition ${clase} ${feedback ? "pointer-events-none" : ""}">
          <input type="${tipo}" name="opcion" value="${o.id}" class="hidden opcion-input" ${feedback ? "disabled" : ""}>
          <span class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${letraClase}">${letra}</span>
          <span class="flex-1 font-semibold ${textoClase}">${escapeHtml(o.texto)}</span>
          ${icono}
        </label>`;
    })
    .join("");

  const confirmarHtml =
    !feedback && p.es_multiple
      ? `<button id="btn-confirmar" class="w-full mt-1 bg-slate-800 text-white font-bold rounded-2xl py-3.5 disabled:opacity-30 disabled:cursor-not-allowed" disabled>Confirmar respuesta</button>`
      : "";

  const feedbackHtml = feedback
    ? `
    <div class="mt-5 rounded-2xl p-5 border-l-4 ${feedback.correcta ? "border-green-500 bg-green-50 dark:bg-green-500/10" : "border-red-500 bg-red-50 dark:bg-red-500/10"}">
      <div class="font-extrabold mb-1 ${feedback.correcta ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}">${feedback.correcta ? "¡Correcto!" : "¡Incorrecto!"}</div>
      ${feedback.explicacion ? `<p class="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">${escapeHtml(feedback.explicacion.explicacion)}</p>` : ""}
      ${feedback.explicacion && feedback.explicacion.tip ? `<p class="text-slate-400 text-xs mt-2 italic">${escapeHtml(feedback.explicacion.tip)}</p>` : ""}
    </div>
    <button id="btn-siguiente" class="w-full mt-4 bg-slate-900 text-white font-bold rounded-2xl py-4">${esUltima ? "Ver resultados" : "Siguiente pregunta"}</button>
  `
    : "";

  render(`
    <div>
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style="background-color:${state.color}">${state.avatar}</div>
          <div>
            <div class="font-bold leading-tight">${escapeHtml(state.username)}</div>
            <div class="text-xs text-slate-400">Pregunta ${state.indice + 1} de ${state.preguntas.length}</div>
          </div>
        </div>
        <div class="flex gap-2">
          <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-center shadow-sm min-w-[52px]">
            <div class="font-extrabold text-indigo-600 dark:text-indigo-400 leading-none" id="pts-display">${state.puntaje}</div>
            <div class="text-[10px] text-slate-400 font-bold">PTS</div>
          </div>
          <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-center shadow-sm min-w-[52px]">
            <div class="font-extrabold text-amber-500 leading-none" id="racha-display">🔥${state.racha}</div>
            <div class="text-[10px] text-slate-400 font-bold">RACHA</div>
          </div>
        </div>
      </div>
      <div class="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-5">
        <div id="progreso-relleno" class="progreso-relleno" style="width:0%"></div>
      </div>
      <div class="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
        <span class="inline-block bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-bold px-3 py-1 rounded-full mb-3">${escapeHtml(categoria ? categoria.nombre.toUpperCase() : "")}</span>
        <h2 class="text-xl font-extrabold mb-5 leading-snug">${escapeHtml(p.enunciado)}</h2>
        <form id="form-pregunta">${opcionesHtml}</form>
        ${confirmarHtml}
      </div>
      ${feedbackHtml}
    </div>
  `);

  if (typeof gsap !== "undefined") {
    gsap.to("#progreso-relleno", { width: `${progresoPct}%`, duration: 0.5, ease: "power2.out" });
  } else {
    document.getElementById("progreso-relleno").style.width = `${progresoPct}%`;
  }

  if (!feedback) {
    root.querySelectorAll(".opcion-input").forEach((input) => {
      input.addEventListener("change", () => {
        if (p.es_multiple) {
          const btnConfirmar = document.getElementById("btn-confirmar");
          const algunaMarcada = root.querySelectorAll(".opcion-input:checked").length > 0;
          btnConfirmar.disabled = !algunaMarcada;
        } else {
          responderPregunta([Number(input.value)]);
        }
      });
    });

    const btnConfirmar = document.getElementById("btn-confirmar");
    if (btnConfirmar) {
      btnConfirmar.addEventListener("click", (e) => {
        const ids = [...root.querySelectorAll(".opcion-input:checked")].map((i) => Number(i.value));
        animarClickBoton(e.currentTarget);
        responderPregunta(ids);
      });
    }
  } else {
    document.getElementById("btn-siguiente").addEventListener("click", (e) => {
      animarClickBoton(e.currentTarget);
      if (esUltima) {
        finalizarQuiz();
      } else {
        state.indice++;
        state.feedbackActual = null;
        state.seleccionActual = [];
        renderPregunta();
      }
    });
  }
}

async function responderPregunta(ids) {
  const p = state.preguntas[state.indice];
  state.seleccionActual = ids;
  try {
    const resultado = await api("/answer", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ pregunta_id: p.id, opciones_seleccionadas: ids }),
    });
    state.respuestas.push({ pregunta_id: p.id, opciones_seleccionadas: ids });
    if (resultado.correcta) {
      state.racha += 1;
      state.puntaje += 100 + 20 * (state.racha - 1);
    } else {
      state.racha = 0;
    }
    state.feedbackActual = resultado;
    renderPregunta();
  } catch (err) {
    alert("Error al comprobar la respuesta: " + err.message);
  }
}

// --- Pantalla 6: resultado final ---

async function finalizarQuiz() {
  render(`<p class="text-slate-400 text-center py-10">Calculando resultado...</p>`);
  try {
    const r = await api("/submit", {
      method: "POST",
      // Content-Type: text/plain (en vez de application/json) evita que el navegador
      // dispare un preflight OPTIONS, que la ruta interna de invocacion de Floci
      // (/restapis/.../_user_request_/) todavia no maneja. El Lambda igual parsea
      // el body como JSON sin mirar este header.
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        username: state.username,
        avatar: state.avatar,
        color: state.color,
        categoria: state.categoriaActual,
        respuestas: state.respuestas,
      }),
    });
    renderResultadoFinal(r);
  } catch (err) {
    render(`<p class="text-red-500 text-center py-10">Error al enviar el resultado: ${escapeHtml(err.message)}</p>`);
  }
}

function renderResultadoFinal(r) {
  const ratio = r.total > 0 ? r.aciertos / r.total : 0;
  let mensaje = "¡SIGUE PRACTICANDO!";
  if (ratio >= 0.9) mensaje = "¡CAMPEÓN!";
  else if (ratio >= 0.7) mensaje = "¡MUY BIEN!";
  else if (ratio >= 0.5) mensaje = "¡BIEN HECHO!";
  else if (ratio >= 0.3) mensaje = "¡BUEN INTENTO!";

  render(`
    <div class="text-center">
      <div class="w-24 h-24 mx-auto rounded-3xl flex items-center justify-center text-5xl shadow-lg mb-4" style="background-color:${state.color}">${state.avatar}</div>
      <div class="text-amber-500 font-extrabold tracking-wide mb-1">${mensaje}</div>
      <div id="puntaje-numero" class="text-6xl font-extrabold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent mb-1">0</div>
      <p class="text-slate-400 mb-6">puntos · Puesto #${r.puesto} de ${r.total_jugadores}</p>
      <div class="grid grid-cols-3 gap-3 mb-6">
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div class="text-2xl font-extrabold text-green-500">${r.aciertos}/${r.total}</div>
          <div class="text-xs text-slate-400 font-semibold mt-1">Aciertos</div>
        </div>
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div class="text-2xl font-extrabold text-amber-500">${Math.round(ratio * 100)}%</div>
          <div class="text-xs text-slate-400 font-semibold mt-1">Precisión</div>
        </div>
        <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
          <div class="text-2xl font-extrabold text-orange-500">🔥${r.mejor_racha}</div>
          <div class="text-xs text-slate-400 font-semibold mt-1">Mejor racha</div>
        </div>
      </div>
      <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-6 text-left">
        ${renderMedallasHtml(r.medallas || [])}
      </div>
      <button id="btn-ver-clasificacion" class="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold rounded-2xl py-4 shadow-lg shadow-indigo-200 dark:shadow-indigo-950/60 mb-3">Ver clasificación</button>
      <button id="btn-jugar-de-nuevo" class="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 font-semibold text-slate-700 dark:text-slate-200">Jugar de nuevo</button>
    </div>
  `);

  animarPuntaje(r.puntaje);
  celebrarConfeti();

  document.getElementById("btn-ver-clasificacion").addEventListener("click", () => renderRanking(state.categoriaActual));
  document.getElementById("btn-jugar-de-nuevo").addEventListener("click", renderLanding);
}

function animarPuntaje(puntajeFinal) {
  const el = document.getElementById("puntaje-numero");
  if (typeof gsap === "undefined") {
    el.textContent = `${puntajeFinal}`;
    return;
  }
  const contador = { valor: 0 };
  gsap.to(contador, {
    valor: puntajeFinal,
    duration: 1.1,
    ease: "power1.out",
    onUpdate: () => {
      el.textContent = `${Math.round(contador.valor)}`;
    },
    onComplete: () => {
      gsap.fromTo(el, { scale: 1 }, { scale: 1.12, duration: 0.25, yoyo: true, repeat: 3, ease: "power1.inOut" });
    },
  });
}

// --- Pantalla 7: clasificacion (ranking) ---

async function renderRanking(slug) {
  render(`<p class="text-slate-400 text-center py-10">Cargando clasificación...</p>`);
  try {
    const filas = await api(`/ranking?categoria=${slug}`);
    const categoria = state.categorias.find((c) => c.slug === slug);

    const filasHtml = filas
      .map(
        (f, i) => `
      <div class="flex items-center gap-3 bg-white dark:bg-slate-800 border ${i === 0 ? "border-amber-300 dark:border-amber-500/60" : "border-slate-200 dark:border-slate-700"} rounded-2xl p-3.5 shadow-sm">
        <div class="w-7 text-center font-extrabold ${i === 0 ? "text-amber-500" : "text-slate-300 dark:text-slate-600"}">${i + 1}</div>
        <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style="background-color:${f.color || "#e2e8f0"}">${f.avatar || "👤"}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold truncate">${escapeHtml(f.username)}</div>
          <div class="text-xs text-slate-400">${f.aciertos ?? "-"}/${f.total ?? "-"} · 🔥${f.mejor_racha ?? 0}</div>
        </div>
        <div class="font-extrabold text-indigo-600 dark:text-indigo-400">${f.puntaje}</div>
      </div>`
      )
      .join("");

    render(`
      <div>
        <button id="btn-atras" class="text-slate-400 text-sm font-semibold mb-4">← Inicio</button>
        <h1 class="text-3xl font-extrabold mb-1">Clasificación</h1>
        <p class="text-slate-500 dark:text-slate-400 mb-6">Los mejores jugadores en ${escapeHtml(categoria ? categoria.nombre : slug)}.</p>
        <div class="flex flex-col gap-2.5" id="lista-ranking">${filasHtml || '<p class="text-slate-400 text-center py-6">Aún no hay resultados en esta categoría.</p>'}</div>
      </div>
    `);
    animarListaEscalonada("#lista-ranking > div");
    document.getElementById("btn-atras").addEventListener("click", renderLanding);
  } catch (err) {
    render(`<p class="text-red-500 text-center py-10">Error cargando la clasificación: ${escapeHtml(err.message)}</p>`);
  }
}

// --- Arranque ---

async function init() {
  inicializarTema();
  try {
    state.categorias = await api("/categories");
    renderLanding();
  } catch (err) {
    render(`<p class="text-red-500 text-center py-10">No se pudo conectar con la API: ${escapeHtml(err.message)}</p>`);
  }
}

init();
