const { Client } = require("pg");

// Respuesta inmediata: se llama una vez por cada pregunta respondida (no al final).
// Solo revela la correccion de ESA pregunta puntual, nunca las demas - el cliente
// sigue sin poder ver respuestas de preguntas que todavia no contesto.
exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (err) {
    return respond(400, { error: "body invalido, se esperaba JSON" });
  }

  const { pregunta_id, opciones_seleccionadas } = body;
  if (!pregunta_id || !Array.isArray(opciones_seleccionadas)) {
    return respond(400, { error: "pregunta_id y opciones_seleccionadas son requeridos" });
  }
  console.log(`answer: evaluando pregunta_id=${pregunta_id}`);

  const client = new Client();
  await client.connect();
  try {
    const opcionesRes = await client.query(
      "SELECT id, es_correcta FROM opciones WHERE pregunta_id = $1",
      [pregunta_id]
    );
    if (opcionesRes.rows.length === 0) {
      return respond(404, { error: "pregunta no encontrada" });
    }

    const esperadas = new Set(opcionesRes.rows.filter((o) => o.es_correcta).map((o) => o.id));
    const seleccionadas = new Set(opciones_seleccionadas);
    const correcta =
      esperadas.size === seleccionadas.size && [...esperadas].every((id) => seleccionadas.has(id));

    const explRes = await client.query(
      "SELECT explicacion, tip FROM explicaciones WHERE pregunta_id = $1",
      [pregunta_id]
    );

    return respond(200, {
      correcta,
      opciones_correctas: [...esperadas],
      explicacion: explRes.rows[0] || null,
    });
  } catch (err) {
    console.error(`answer: error evaluando pregunta_id=${pregunta_id}`, err);
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
