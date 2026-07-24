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

const DIAS_INACTIVIDAD = 30;

// Borra el historial completo (todas las filas de ranking) de cualquier jugador cuyo
// intento mas reciente sea de hace mas de DIAS_INACTIVIDAD dias, EXCEPTO si esta
// actualmente en el top 20 de algun tablero (categoria+nivel) -- esos se conservan
// indefinidamente. Sin parametros: se invoca vacia, por EventBridge Scheduler o a mano.
const QUERY_LIMPIEZA = `
  WITH mejores_por_jugador AS (
    SELECT DISTINCT ON (categoria_id, nivel, username) categoria_id, nivel, username, puntaje, fecha
    FROM ranking ORDER BY categoria_id, nivel, username, puntaje DESC, fecha ASC
  ),
  top20_por_segmento AS (
    SELECT categoria_id, nivel, username,
           ROW_NUMBER() OVER (PARTITION BY categoria_id, nivel ORDER BY puntaje DESC, fecha ASC) AS puesto
    FROM mejores_por_jugador
  ),
  protegidos AS (SELECT DISTINCT username FROM top20_por_segmento WHERE puesto <= 20),
  inactivos AS (
    SELECT username FROM ranking
    GROUP BY username
    HAVING MAX(fecha) < now() - interval '${DIAS_INACTIVIDAD} days'
  )
  DELETE FROM ranking
  WHERE username IN (SELECT username FROM inactivos WHERE username NOT IN (SELECT username FROM protegidos))
  RETURNING username
`;

exports.handler = async () => {
  console.log(`cleanup: buscando jugadores inactivos (> ${DIAS_INACTIVIDAD} dias, fuera del top 20)`);
  const inicio = Date.now();

  const client = new Client();
  await client.connect();
  try {
    const { rows } = await client.query(QUERY_LIMPIEZA);
    const usuariosAfectados = new Set(rows.map((r) => r.username)).size;
    console.log(`cleanup: ${rows.length} filas borradas de ${usuariosAfectados} jugador(es) inactivo(s)`);
    await publicarMetricas(0, Date.now() - inicio);
    return respond(200, { filas_borradas: rows.length, jugadores_afectados: usuariosAfectados });
  } catch (err) {
    console.error("cleanup: error limpiando jugadores inactivos", err);
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
