ALTER TABLE preguntas
  ADD COLUMN dificultad TEXT NOT NULL DEFAULT 'recordar'
    CHECK (dificultad IN ('recordar', 'aplicar', 'analizar'));

ALTER TABLE ranking ADD COLUMN nivel INTEGER;
UPDATE ranking SET nivel = total;
ALTER TABLE ranking ALTER COLUMN nivel SET NOT NULL;

CREATE INDEX idx_ranking_categoria_nivel_puntaje
  ON ranking(categoria_id, nivel, puntaje DESC, fecha ASC);

-- Nota: el DROP INDEX del indice viejo se corrio a mano (idx_ranking_categoria_puntaje,
-- reemplazado por idx_ranking_categoria_nivel_puntaje ya creado arriba). No incluido
-- aca como DROP porque en una DB nueva ese indice viejo nunca existio.
