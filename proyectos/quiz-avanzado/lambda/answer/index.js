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
  const inicio = Date.now();

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
    // Se revela recien aca (nunca en /questions, antes de responder): no da pista
    // de dificultad. El frontend la usa solo para animar el "+N" del HUD de puntaje.
    const dificultadRes = await client.query(
      "SELECT dificultad FROM preguntas WHERE id = $1",
      [pregunta_id]
    );

    await publicarMetricas(0, Date.now() - inicio);
    return respond(200, {
      correcta,
      opciones_correctas: [...esperadas],
      dificultad: dificultadRes.rows[0] ? dificultadRes.rows[0].dificultad : null,
      explicacion: explRes.rows[0] || null,
    });
  } catch (err) {
    console.error(`answer: error evaluando pregunta_id=${pregunta_id}`, err);
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
