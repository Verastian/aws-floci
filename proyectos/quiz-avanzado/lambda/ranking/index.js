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
  console.log(`ranking: consultando tabla${categoria ? ` categoria=${categoria}` : " (todas las categorias)"}`);
  const inicio = Date.now();

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
