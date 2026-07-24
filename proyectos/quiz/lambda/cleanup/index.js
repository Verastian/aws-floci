const { Client } = require("pg");

const DIAS_INACTIVIDAD = 30;

// Borra el historial completo (todas las filas de ranking) de cualquier jugador cuyo
// intento mas reciente sea de hace mas de DIAS_INACTIVIDAD dias, EXCEPTO si esta
// actualmente en el top 20 de algun tablero (categoria+nivel) -- esos se conservan
// indefinidamente. Sin parametros: se invoca vacia, por el timer systemd de la
// plataforma (ver plataforma/scripts/quiz-cleanup-invoke.sh) o a mano.
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
  const client = new Client();
  await client.connect();
  try {
    const { rows } = await client.query(QUERY_LIMPIEZA);
    const usuariosAfectados = new Set(rows.map((r) => r.username)).size;
    return respond(200, { filas_borradas: rows.length, jugadores_afectados: usuariosAfectados });
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
