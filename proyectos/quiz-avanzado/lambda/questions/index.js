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

// Nunca devuelve es_correcta, explicacion, tip, pistas, glosario ni respuesta_detallada:
// esa informacion solo se entrega despues de invocar /submit.
exports.handler = async (event) => {
  const slug = event.pathParameters && event.pathParameters.categoria;
  if (!slug) {
    return respond(400, { error: "falta el parametro categoria" });
  }
  console.log(`questions: listando preguntas de categoria=${slug}`);
  const inicio = Date.now();

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

    await publicarMetricas(0, Date.now() - inicio);
    return respond(200, preguntas);
  } catch (err) {
    console.error(`questions: error consultando categoria=${slug}`, err);
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
