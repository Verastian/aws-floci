const { Client } = require("pg");
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");

const cw = new CloudWatchClient({});
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME;

async function publicarMetricas(errores, duracionMs) {
  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: "QuizAvanzado/Lambda",
      MetricData: [
        { MetricName: "Invocations", Value: 1, Unit: "Count", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
        { MetricName: "Errors", Value: errores, Unit: "Count", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
        { MetricName: "Duration", Value: duracionMs, Unit: "Milliseconds", Dimensions: [{ Name: "FunctionName", Value: FUNCTION_NAME }] },
      ],
    }));
  } catch (err) {
    console.error(`${FUNCTION_NAME}: no se pudo publicar metricas en CloudWatch`, err);
  }
}

// Deben coincidir con AVATARES / COLORES en frontend/app.js
const AVATARES_VALIDOS = new Set(["🚀", "🤖", "🐍", "🐧", "☁️", "🔥", "⚡", "🎯", "🧠", "💡", "🛰️", "🔐", "📦", "🌐", "🎮", "🦾"]);
const COLORES_VALIDOS = new Set(["#f59e0b", "#0ea5e9", "#ec4899", "#22c55e", "#8b5cf6", "#ef4444", "#14b8a6", "#6366f1"]);

const PUNTOS_BASE = 100;
const BONUS_POR_RACHA = 20;

// Debe coincidir con MULTIPLICADOR_DIFICULTAD en frontend/app.js. El bonus de
// racha queda plano (no escala con dificultad): premia consistencia, no dureza.
const MULTIPLICADOR_DIFICULTAD = { recordar: 1.0, aplicar: 1.5, analizar: 2.0 };

// Debe coincidir con lambda/badges/index.js
const MEDALLAS_QUERY = `
  SELECT
    BOOL_OR(aciertos::float / NULLIF(total, 0) >= 0.5) AS aprobado,
    BOOL_OR(aciertos = total) AS sin_fallos,
    BOOL_OR(mejor_racha >= 5) AS en_racha,
    BOOL_OR(aciertos < total AND aciertos::float / NULLIF(total, 0) >= 0.7) AS remontada,
    BOOL_OR(puesto_logrado <= 3) AS podio,
    BOOL_OR(puesto_logrado = 1) AS campeon,
    BOOL_OR(total >= 30) AS maraton
  FROM ranking
  WHERE username = $1
`;
const MEDALLAS_INFO = [
  { id: "aprobado", nombre: "Aprobado", icono: "✓" },
  { id: "sin_fallos", nombre: "Sin fallos", icono: "★" },
  { id: "en_racha", nombre: "En racha", icono: "🔥" },
  { id: "remontada", nombre: "Remontada", icono: "⬆" },
  { id: "podio", nombre: "Podio", icono: "🏅" },
  { id: "campeon", nombre: "Campeón", icono: "👑" },
  { id: "maraton", nombre: "Maratón", icono: "∞" },
];

// El puntaje SIEMPRE se recalcula aqui a partir de la base de datos, en el orden en
// que llegaron las respuestas. El frontend ya mostro correcto/incorrecto pregunta
// por pregunta via /answer (para la respuesta inmediata), pero este calculo final
// del puntaje y el guardado en el ranking nunca confia en lo que diga el cliente.
exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "body invalido, se esperaba JSON" });
  }

  const { username, categoria, respuestas } = body;
  const avatar = AVATARES_VALIDOS.has(body.avatar) ? body.avatar : null;
  const color = COLORES_VALIDOS.has(body.color) ? body.color : null;
  if (!username || !categoria || !Array.isArray(respuestas) || respuestas.length === 0) {
    return respond(400, { error: "username, categoria y respuestas son requeridos" });
  }
  console.log(`submit: cerrando intento de username=${username} categoria=${categoria} respuestas=${respuestas.length}`);
  const inicio = Date.now();

  const client = new Client();
  await client.connect();
  try {
    const catRes = await client.query("SELECT id FROM categorias WHERE slug = $1", [categoria]);
    if (catRes.rows.length === 0) {
      return respond(404, { error: "categoria no encontrada" });
    }
    const categoriaId = catRes.rows[0].id;

    const preguntaIds = respuestas.map((r) => r.pregunta_id);
    const opcionesRes = await client.query(
      "SELECT id, pregunta_id, es_correcta FROM opciones WHERE pregunta_id = ANY($1)",
      [preguntaIds]
    );
    const correctasPorPregunta = new Map();
    for (const o of opcionesRes.rows) {
      if (!correctasPorPregunta.has(o.pregunta_id)) correctasPorPregunta.set(o.pregunta_id, new Set());
      if (o.es_correcta) correctasPorPregunta.get(o.pregunta_id).add(o.id);
    }

    const dificultadRes = await client.query(
      "SELECT id, dificultad FROM preguntas WHERE id = ANY($1)",
      [preguntaIds]
    );
    const dificultadPorPregunta = new Map(dificultadRes.rows.map((p) => [p.id, p.dificultad]));

    let racha = 0;
    let mejorRacha = 0;
    let aciertos = 0;
    let puntaje = 0;

    for (const r of respuestas) {
      const esperadas = correctasPorPregunta.get(r.pregunta_id) || new Set();
      const seleccionadas = new Set(r.opciones_seleccionadas || []);
      const esCorrecta =
        esperadas.size === seleccionadas.size && [...esperadas].every((id) => seleccionadas.has(id));

      if (esCorrecta) {
        racha += 1;
        aciertos += 1;
        const mult = MULTIPLICADOR_DIFICULTAD[dificultadPorPregunta.get(r.pregunta_id)] ?? 1.0;
        puntaje += Math.round(PUNTOS_BASE * mult) + BONUS_POR_RACHA * (racha - 1);
        mejorRacha = Math.max(mejorRacha, racha);
      } else {
        racha = 0;
      }
    }

    const total = respuestas.length;
    // El nivel jugado (10/20/30/65 preguntas) nunca lo manda el cliente: se deriva de
    // "total", igual que el backfill de las filas historicas (ver migraciones/001-*.sql).
    const nivel = total;

    // El puesto se calcula ANTES de insertar (cuenta cuantos JUGADORES DISTINTOS ya
    // tienen un mejor puntaje en esta categoria+nivel -- no cuenta intentos repetidos
    // del mismo jugador), asi se puede guardar en la misma fila (puesto_logrado) para
    // medallas futuras como Podio/Campeon, que no deben cambiar retroactivamente si el
    // ranking se mueve despues.
    const { rows: mejoresRows } = await client.query(
      `SELECT COUNT(*)::int AS mejores FROM (
         SELECT username, MAX(puntaje) AS mejor
         FROM ranking
         WHERE categoria_id = $1 AND nivel = $2
         GROUP BY username
       ) t WHERE t.mejor > $3`,
      [categoriaId, nivel, puntaje]
    );
    const puesto = mejoresRows[0].mejores + 1;

    await client.query(
      `INSERT INTO ranking (username, puntaje, categoria_id, nivel, avatar, color, aciertos, total, mejor_racha, puesto_logrado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [username, puntaje, categoriaId, nivel, avatar, color, aciertos, total, mejorRacha, puesto]
    );

    const { rows: totalRows } = await client.query(
      "SELECT COUNT(DISTINCT username)::int AS total FROM ranking WHERE categoria_id = $1 AND nivel = $2",
      [categoriaId, nivel]
    );

    const { rows: medallaRows } = await client.query(MEDALLAS_QUERY, [username]);
    const flags = medallaRows[0] || {};
    const medallas = MEDALLAS_INFO.map((m) => ({ ...m, desbloqueada: Boolean(flags[m.id]) }));

    await publicarMetricas(0, Date.now() - inicio);
    return respond(200, {
      puntaje,
      aciertos,
      total,
      mejor_racha: mejorRacha,
      puesto,
      total_jugadores: totalRows[0].total,
      medallas,
    });
  } catch (err) {
    console.error(`submit: error cerrando intento de username=${username}`, err);
    await publicarMetricas(1, Date.now() - inicio);
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};

function respond(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}
