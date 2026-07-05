-- Esquema del Quiz de tecnología (AWS Cloud Practitioner / Python / Linux)
-- Ver proyectos/quiz/docs/ARQUITECTURA.md para el contexto de estas decisiones.

CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
);

CREATE TABLE preguntas (
    id INTEGER PRIMARY KEY,              -- se reutiliza el id original de preguntas.json
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    enunciado TEXT NOT NULL,
    enunciado_en TEXT,                   -- nullable, no todas las preguntas tienen traduccion
    es_multiple BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE opciones (
    id SERIAL PRIMARY KEY,
    pregunta_id INTEGER NOT NULL REFERENCES preguntas(id),
    texto TEXT NOT NULL,
    es_correcta BOOLEAN NOT NULL DEFAULT FALSE,
    orden INTEGER NOT NULL               -- preserva el orden original del JSON
);

CREATE TABLE explicaciones (
    pregunta_id INTEGER PRIMARY KEY REFERENCES preguntas(id),
    explicacion TEXT NOT NULL,
    tip TEXT,
    pistas JSONB,                        -- array de strings
    glosario JSONB                       -- array de {termino, definicion}
);

CREATE TABLE respuestas_detalladas (
    pregunta_id INTEGER PRIMARY KEY REFERENCES preguntas(id),
    contenido_md TEXT NOT NULL           -- solo existe para un subconjunto de preguntas
);

CREATE TABLE ranking (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    puntaje INTEGER NOT NULL,             -- puntos (100 por correcta + bonus por racha), no porcentaje
    categoria_id INTEGER NOT NULL REFERENCES categorias(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
    avatar TEXT,                          -- emoji elegido, ver frontend/app.js AVATARES
    color TEXT,                           -- hex del color elegido, ver frontend/app.js COLORES
    aciertos INTEGER,
    total INTEGER,
    mejor_racha INTEGER,
    puesto_logrado INTEGER               -- puesto en el ranking al momento de este intento (para medallas Podio/Campeon)
);

CREATE INDEX idx_opciones_pregunta ON opciones(pregunta_id);
CREATE INDEX idx_preguntas_categoria ON preguntas(categoria_id);
CREATE INDEX idx_ranking_categoria_puntaje ON ranking(categoria_id, puntaje DESC);

INSERT INTO categorias (nombre, slug) VALUES
    ('AWS Cloud Practitioner', 'aws-cloud-practitioner'),
    ('Python', 'python'),
    ('Linux', 'linux');
