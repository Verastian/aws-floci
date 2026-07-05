// Script de una sola ejecucion: lee proyectos/quiz/data/*.json y los carga en Postgres.
// Requiere que schema.sql ya haya sido aplicado.
// Variables de entorno esperadas: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DATA_DIR = path.join(__dirname, "..", "data");
const CATEGORIA_SLUG = "aws-cloud-practitioner";

async function main() {
  const preguntas = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "preguntas.json"), "utf8"));
  const explicaciones = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "explicaciones.json"), "utf8"));
  const respuestas = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "respuestas.json"), "utf8"));

  const explicacionesPorId = new Map(explicaciones.map((e) => [e.id, e]));
  const respuestasPorId = new Map(respuestas.map((r) => [r.id, r]));

  const client = new Client();
  await client.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query("SELECT id FROM categorias WHERE slug = $1", [CATEGORIA_SLUG]);
    if (rows.length === 0) {
      throw new Error(`No existe la categoria con slug '${CATEGORIA_SLUG}'. Corre schema.sql primero.`);
    }
    const categoriaId = rows[0].id;

    let preguntasInsertadas = 0;
    let opcionesInsertadas = 0;
    let explicacionesInsertadas = 0;
    let respuestasInsertadas = 0;

    for (const p of preguntas) {
      await client.query(
        `INSERT INTO preguntas (id, categoria_id, enunciado, enunciado_en, es_multiple)
         VALUES ($1, $2, $3, $4, $5)`,
        [p.id, categoriaId, p.pregunta, p.pregunta_en || null, Boolean(p.multiple)]
      );
      preguntasInsertadas++;

      for (let i = 0; i < p.opciones.length; i++) {
        const texto = p.opciones[i];
        const esCorrecta = p.correctas.includes(texto);
        await client.query(
          `INSERT INTO opciones (pregunta_id, texto, es_correcta, orden)
           VALUES ($1, $2, $3, $4)`,
          [p.id, texto, esCorrecta, i]
        );
        opcionesInsertadas++;
      }

      const e = explicacionesPorId.get(p.id);
      if (e) {
        await client.query(
          `INSERT INTO explicaciones (pregunta_id, explicacion, tip, pistas, glosario)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            p.id,
            e.explicacion,
            e.tip || null,
            JSON.stringify(e.pistas || []),
            JSON.stringify(e.glosario || []),
          ]
        );
        explicacionesInsertadas++;
      }

      const r = respuestasPorId.get(p.id);
      if (r) {
        await client.query(
          `INSERT INTO respuestas_detalladas (pregunta_id, contenido_md) VALUES ($1, $2)`,
          [p.id, r.contenido_md]
        );
        respuestasInsertadas++;
      }
    }

    await client.query("COMMIT");

    console.log("Carga completada:");
    console.log(`  preguntas:              ${preguntasInsertadas}`);
    console.log(`  opciones:               ${opcionesInsertadas}`);
    console.log(`  explicaciones:          ${explicacionesInsertadas}`);
    console.log(`  respuestas_detalladas:  ${respuestasInsertadas}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Error durante la carga:", err);
  process.exit(1);
});
