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

exports.handler = async (event) => {
  const categoria = event.queryStringParameters && event.queryStringParameters.categoria;
  const nivel = event.queryStringParameters && Number(event.queryStringParameters.nivel);
  if (!categoria || !nivel) {
    return respond(400, { error: "categoria y nivel son requeridos" });
  }
  console.log(`ranking: consultando tabla categoria=${categoria} nivel=${nivel}`);
  const inicio = Date.now();

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
    await publicarMetricas(0, Date.now() - inicio);
    return respond(200, rows);
  } catch (err) {
    console.error("ranking: error consultando tabla", err);
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
