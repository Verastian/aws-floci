const { Client } = require("pg");

exports.handler = async (event) => {
  const categoria = event.queryStringParameters && event.queryStringParameters.categoria;
  const nivel = event.queryStringParameters && Number(event.queryStringParameters.nivel);
  if (!categoria || !nivel) {
    return respond(400, { error: "categoria y nivel son requeridos" });
  }

  const client = new Client();
  await client.connect();
  try {
    // Top 20 por JUGADOR distinto (mejor puntaje de cada uno), no por intento -- un
    // mismo jugador que jugo varias veces no debe ocupar varios lugares del podio.
    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (r.username)
          r.username, r.puntaje, r.avatar, r.color, r.aciertos, r.total, r.mejor_racha, r.fecha
        FROM ranking r
        JOIN categorias c ON c.id = r.categoria_id
        WHERE c.slug = $1 AND r.nivel = $2
        ORDER BY r.username, r.puntaje DESC, r.fecha ASC
      ) mejores
      ORDER BY puntaje DESC, fecha ASC
      LIMIT 20
    `;

    const { rows } = await client.query(query, [categoria, nivel]);
    return respond(200, rows);
  } catch (err) {
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
