const { Client } = require("pg");

exports.handler = async (event) => {
  const categoria = event.queryStringParameters && event.queryStringParameters.categoria;
  console.log(`ranking: consultando tabla${categoria ? ` categoria=${categoria}` : " (todas las categorias)"}`);

  const client = new Client();
  await client.connect();
  try {
    let query = `
      SELECT r.username, r.puntaje, r.avatar, r.color, r.aciertos, r.total, r.mejor_racha, c.slug AS categoria, r.fecha
      FROM ranking r
      JOIN categorias c ON c.id = r.categoria_id
    `;
    const params = [];
    if (categoria) {
      params.push(categoria);
      query += ` WHERE c.slug = $1`;
    }
    query += ` ORDER BY r.puntaje DESC, r.fecha ASC LIMIT 20`;

    const { rows } = await client.query(query, params);
    return respond(200, rows);
  } catch (err) {
    console.error("ranking: error consultando tabla", err);
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
