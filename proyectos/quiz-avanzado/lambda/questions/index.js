const { Client } = require("pg");

// Nunca devuelve es_correcta, explicacion, tip, pistas, glosario ni respuesta_detallada:
// esa informacion solo se entrega despues de invocar /submit.
exports.handler = async (event) => {
  const slug = event.pathParameters && event.pathParameters.categoria;
  if (!slug) {
    return respond(400, { error: "falta el parametro categoria" });
  }

  const client = new Client();
  await client.connect();
  try {
    const catRes = await client.query("SELECT id FROM categorias WHERE slug = $1", [slug]);
    if (catRes.rows.length === 0) {
      return respond(404, { error: "categoria no encontrada" });
    }
    const categoriaId = catRes.rows[0].id;

    const preguntasRes = await client.query(
      "SELECT id, enunciado, es_multiple FROM preguntas WHERE categoria_id = $1 ORDER BY id",
      [categoriaId]
    );
    const preguntaIds = preguntasRes.rows.map((p) => p.id);

    const opcionesRes = await client.query(
      "SELECT id, pregunta_id, texto FROM opciones WHERE pregunta_id = ANY($1) ORDER BY pregunta_id, orden",
      [preguntaIds]
    );

    const opcionesPorPregunta = new Map();
    for (const o of opcionesRes.rows) {
      if (!opcionesPorPregunta.has(o.pregunta_id)) opcionesPorPregunta.set(o.pregunta_id, []);
      opcionesPorPregunta.get(o.pregunta_id).push({ id: o.id, texto: o.texto });
    }

    const preguntas = preguntasRes.rows.map((p) => ({
      id: p.id,
      enunciado: p.enunciado,
      es_multiple: p.es_multiple,
      opciones: opcionesPorPregunta.get(p.id) || [],
    }));

    return respond(200, preguntas);
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
