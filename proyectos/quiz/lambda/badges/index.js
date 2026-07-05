const { Client } = require("pg");

// Definicion de las 7 medallas, igual que en frontend/app.js (MEDALLAS_INFO).
// Cada condicion se evalua sobre TODO el historial del username (todas las
// categorias, todos los intentos), no solo el intento actual.
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

async function calcularMedallas(client, username) {
  const { rows } = await client.query(MEDALLAS_QUERY, [username]);
  const flags = rows[0] || {};
  return MEDALLAS_INFO.map((m) => ({ ...m, desbloqueada: Boolean(flags[m.id]) }));
}

exports.handler = async (event) => {
  const username = event.queryStringParameters && event.queryStringParameters.username;
  if (!username) {
    return respond(400, { error: "username es requerido" });
  }

  const client = new Client();
  await client.connect();
  try {
    const medallas = await calcularMedallas(client, username);
    return respond(200, medallas);
  } catch (err) {
    return respond(500, { error: err.message });
  } finally {
    await client.end();
  }
};

exports.calcularMedallas = calcularMedallas;
exports.MEDALLAS_QUERY = MEDALLAS_QUERY;
exports.MEDALLAS_INFO = MEDALLAS_INFO;

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
