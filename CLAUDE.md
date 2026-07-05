# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A learning workspace for practicing AWS by deploying real projects against **Floci**
(https://floci.io/), an open-source AWS emulator running in Docker on a remote VPS (Hostinger).
Floci is a LocalStack-compatible drop-in replacement: same AWS CLI/SDKs, endpoint
`http://localhost:4566`, dummy credentials (`test`/`test`). Some services (Lambda, RDS, ECS, …)
orchestrate **real** Docker containers as sibling containers via the host's `docker.sock`; others
(S3, IAM, API Gateway, DynamoDB, SNS/SQS, …) are in-memory protocol reimplementations. This
distinction matters when debugging — a Lambda/RDS problem is a real Postgres/Node process, an S3
or API Gateway problem is Floci's own emulation.

There is no local runtime for any of this: administrative access (deploying a Lambda, creating a
bucket, any `aws` command) goes over an SSH tunnel to port 4566, using `--profile floci`
(configured with `endpoint_url = http://localhost:4566`, region `us-east-1`). Port 4566 itself is
intentionally **never** exposed publicly — Floci has no real authentication, so exposing it grants
control over the emulated "AWS" and, transitively, root-equivalent access to the VPS's Docker
daemon. See `plataforma/PLAN.md` for the full feasibility analysis, VPS inventory, and
implementation history.

**End-user access is different and does not need the tunnel.** Since 2026-07-05, `nginx-proxy-manager`
(already running on the VPS for other projects) exposes two narrow, generic HTTPS patterns on a
real domain — `https://floci.devera.cloud/site/<bucket>/...` for any S3 static-website bucket, and
`https://floci.devera.cloud/restapis/...` for any API Gateway HTTP API — via
`plataforma/nginx/floci-advanced.conf` + `plataforma/scripts/npm-configure-floci-host.py`. Anything
else on that domain (including the bare `/`) hits a dead port and gets `502`, so this does not
expose Floci's management APIs (Lambda/IAM/CloudFormation/etc.) — only whatever is explicitly
published as a website or an API route. See `proyectos/quiz-avanzado/docs/GUIA-SERVICIOS-AVANZADOS.md`
§1 for the full design and the exact commands to reproduce/extend it for a new service (that's
where it lives even though it was implemented against `quiz/` — see that project's note below).

The tunnel itself runs as a `systemd` service (`floci-tunnel.service`, installed from
`plataforma/scripts/floci-tunnel.sh` + `plataforma/systemd/floci-tunnel.service`, both committed)
using `autossh` with `Restart=always`, so it self-heals on network drops or crashes — it no longer
needs to be started manually. Its config (real VPS IP, user, ports) lives in `plataforma/.env`,
which is **git-ignored**; `plataforma/.env.example` is the committed template. If the whole stack
looks "down" but `docker ps` on the VPS shows Floci healthy, check `systemctl status
floci-tunnel.service` first — see `proyectos/quiz/docs/GUIA-PASO-A-PASO.md` §5 for the full
diagnostic flow.

## Repository structure and conventions

```
AWS-FLOCI/
├── plataforma/PLAN.md        # Floci/VPS platform decisions — NOT project-specific
└── proyectos/<nombre>/       # One subdirectory per project deployed on the emulated cloud
    ├── docs/                 # Guides, architecture history, diagrams (docs/imgs/)
    └── <source>/             # e.g. lambda/, frontend/, db/
```

- Platform-level changes (Floci itself, the VPS, shared infra) go in `plataforma/PLAN.md`.
  Project-specific decisions go in that project's `docs/`.
- Docs are written as **narrative history logs** (dated sections appended over time, in Spanish),
  not evergreen reference docs — read them chronologically to understand how something evolved,
  and append new sections rather than rewriting old ones when documenting new work.
- Real infra identifiers that grant *access* (VPS IP, SSH hostname) are placeholdered in committed
  docs as `<TU-IP-VPS>` / `<TU-HOSTNAME-VPS>` — never reintroduce the real values in files that get
  committed. This does **not** apply to the public domain (`floci.devera.cloud`) — that one is
  meant to be shared, so it's written out in full wherever relevant.
- **No cross-duplicated docs between `quiz/` and `quiz-avanzado/`**: `quiz/docs/` has only
  `ARQUITECTURA.md`, `GUIA-PASO-A-PASO.md`, and `AWS-PARA-PRINCIPIANTES.md` (the app itself — same
  code in both projects); `quiz-avanzado/docs/` has only `PLAN-SERVICIOS-AVANZADOS.md` and
  `GUIA-SERVICIOS-AVANZADOS.md` (all advanced-services work, both planning and technical detail,
  even the Fase 1/nginx work that historically ran against `quiz/`'s resources — it's documented
  once, in the fork, not duplicated). If a future change seems to need touching the same fact in
  both projects, that's a sign it belongs in exactly one of them with the other linking to it.
- **Every advanced-service phase gets documented twice, in different files, not two drafts of the
  same file**: once technically in `quiz-avanzado/docs/GUIA-SERVICIOS-AVANZADOS.md` (commands,
  Floci-vs-real-AWS caveats, incidents), and once in a beginner-focused, Floci-agnostic companion
  modeled on `quiz/docs/AWS-PARA-PRINCIPIANTES.md` (plain language, analogies, no Docker/VPS/tunnel
  mentions) — that file is where a new section/sibling doc gets added as each phase ships.
- **Diagrams live in Lucid**, in the folder "AWS-FLOCI Diagramas" (folder id `445317425`), not as
  static images in the repo (no reliable way to pull a rendered PNG onto disk from this tooling —
  docs link to the live editable Lucid document instead, e.g. `https://lucid.app/lucidchart/<id>/edit`).
  Use Lucid for more than AWS service diagrams: sequence diagrams for connection/request flows
  (`lucid_create_sequence_diagram`, PlantUML), and plain abstracting diagrams for mental models
  (e.g. Cliente/Servidor/Base de datos, the restaurant analogy) belong here too, especially for
  `AWS-PARA-PRINCIPIANTES.md`-style docs. When using `lucid_create_diagram_from_specification` with
  AWS shapes (`namedShape`/`namedContainer`, `aws-2024` library): their `text` property is ignored
  in rendering — they always show the library's default label — so don't rely on it to disambiguate
  two instances of the same shape (e.g. primary vs. standby RDS); use a separate small `text` shape
  positioned nearby instead, and verify placement doesn't collide with the icon's own caption by
  exporting a PNG (`lucid_export_document_as_PNG`) and inspecting it before calling it done.

## Current projects

### `proyectos/hello-world/`
Minimal Lambda + Function URL smoke test. `lambda/index.js` returns a static HTML string — no
dependencies, no build step. Guide: `docs/GUIA-PASO-A-PASO.md`.

### `proyectos/quiz/`
**Public URL (no tunnel needed): `https://floci.devera.cloud/site/quiz-frontend/`.** If *that*
appears down, the SSH tunnel is irrelevant to it — check Floci/RDS/Lambda health on the VPS
directly (see the diagnostic table in `docs/GUIA-PASO-A-PASO.md` §5.3, and note the
`Lambda.InitError: No such image` gotcha below). The tunnel (`docs/GUIA-PASO-A-PASO.md` §5) only
matters for *your own* administrative access (deploying, seeding data, etc.) — it can be down
while the public quiz is fine, and vice versa.

A tech quiz app (AWS Cloud Practitioner questions today; Python/Linux categories exist but have no
questions yet). Full history and rationale: `docs/ARQUITECTURA.md` (architecture decisions,
findings, changelog by round) and `docs/GUIA-PASO-A-PASO.md` (concrete replicable commands).
`docs/AWS-PARA-PRINCIPIANTES.md` is a third, deliberately different kind of doc — no Floci/Docker/
VPS at all, just AWS concepts (S3, API Gateway, Lambda, RDS, Route 53, VPC/Region/AZ) explained
with analogies and Lucid diagrams for someone new to AWS; keep it that way when extending it, don't
let implementation detail leak in. This project intentionally has **no** advanced-services docs (`PLAN`/`GUIA-SERVICIOS-AVANZADOS.md`) —
those live entirely in `proyectos/quiz-avanzado/docs/`, including Fase 1 (public exposure via
nginx), even though Fase 1 was implemented against *this* project's resources (`quiz-frontend`,
`f3744ef7e3`) — see the fork's docs for that history, to avoid the same facts drifting out of sync
in two places.

**Architecture:** static frontend (S3-hosted, no server) + one Lambda per API endpoint + RDS
Postgres, all behind an API Gateway HTTP API. The frontend is vanilla JS (no framework/build step
for JS), Tailwind v4 for CSS (build step required), GSAP via CDN for animation.

```
proyectos/quiz/
├── db/            # schema.sql (source of truth for the data model) + seed.js (one-off loader)
├── lambda/
│   ├── categories/   GET  /categories        list categories, "tiene_preguntas" via COUNT(*)
│   ├── questions/    GET  /questions/{cat}   questions+options, never the correct answer
│   ├── answer/       POST /answer            reveal correctness for ONE question immediately
│   ├── submit/       POST /submit            score computed server-side, never trust client
│   ├── ranking/      GET  /ranking           leaderboard
│   └── badges/       GET  /badges?username=  achievement evaluation over full user history
└── frontend/
    ├── index.html, style.css, app.js   # the only 3 files deployed to S3
    ├── src/input.css                  # Tailwind source — NOT deployed
    └── package.json, node_modules/    # build tooling only — NOT deployed
```

Each Lambda has its own IAM role and its own `package.json`/`node_modules` (only `submit`,
`ranking`, etc. that touch Postgres depend on `pg`; `categories`/`questions` may too — check
per-function). There is no shared/monorepo dependency layer.

**Data model** (`db/schema.sql`): `categorias` → `preguntas` → `opciones`, plus `explicaciones`
(short answer explanation/tip/glossary — the *only* explanation format now; `respuestas_detalladas`
is legacy/unused, kept for data preservation only) and `ranking` (one row per completed attempt,
storing username, avatar emoji, color, score, streak, and `puesto_logrado` — the rank *at the time
of that attempt*, frozen permanently so achievements like "Podio"/"Campeón" don't change
retroactively as the leaderboard moves).

**Scoring model:** 100 points per correct answer + 20 bonus per consecutive streak answer, always
recomputed server-side in `submit` from the DB in the order answers arrived — the client-reported
score is never trusted, even though `/answer` already revealed correctness question-by-question for
immediate feedback.

## Working with the code

There is no test suite, linter, or CI in this repo — verification has historically been done by
running the actual flow in a browser (including headless Playwright) against the live Floci
deployment, since bugs here have repeatedly been deployment/environment issues (CORS, caching,
Docker network reachability) rather than pure logic bugs. When changing quiz behavior, prefer
checking `docs/ARQUITECTURA.md` §5.1 ("Hallazgos técnicos importantes") first — it documents
several non-obvious Floci quirks that look like bugs but aren't:

- **RDS is only reachable from inside the VPS's `floci_default` Docker network**, never through the
  SSH tunnel — the address Floci hands back always has the same IP (`172.22.0.2`, Floci's own
  container) but a different port per instance (`7001` for `quiz-db`, `7002` for
  `quiz-avanzado-db`; check `aws rds describe-db-instances --profile floci` rather than assuming).
  Lambdas reach it automatically (Floci attaches them to that network); any manual DB work
  (seeding, ad-hoc queries, cross-database copies) must run in an ephemeral container on the VPS
  with `--network floci_default`.
- **API Gateway invocation URL** in Floci is
  `http://localhost:4566/restapis/{api_id}/$default/_user_request_/{route}` — the
  `{api-id}.execute-api...localhost:4566` subdomain style works for Lambda Function URLs but not
  for API Gateway.
- **CORS preflight is not handled** on the `_user_request_` route even with `--cors-configuration`
  set. Workaround: the frontend sends `POST` bodies as `Content-Type: text/plain` (a CORS "simple
  request", no preflight); the Lambda still parses the body as JSON regardless of that header. This
  workaround is Floci-specific and would not be needed against real AWS.
- Frontend deploys to S3 always use `aws s3 cp` for the 3 specific files (never `aws s3 sync` of the
  whole directory, which would also upload build tooling) with `--cache-control "no-cache"` — S3
  objects have no cache headers by default, so without this flag browsers may serve a stale
  `app.js` after a redeploy.
- **All Lambdas return 502 / `Lambda.InitError: No such image`** if the VPS's Docker image cache
  lost `public.ecr.aws/lambda/nodejs:22` (the runtime image Floci launches per invocation — e.g.
  after a `docker image prune`). Fix: `docker pull public.ecr.aws/lambda/nodejs:22` on the VPS.
  Confirm with `aws lambda invoke --function-name quiz-categories --profile floci out.json && cat
  out.json` — a healthy response is JSON data, not an `errorType`.

### Build the frontend CSS (required after editing `frontend/src/input.css` or Tailwind classes)

```bash
cd proyectos/quiz/frontend
npm install        # once
npm run build:css  # tailwindcss -i src/input.css -o style.css --minify
```

### Deploy a Lambda (pattern repeated per function — see `docs/GUIA-PASO-A-PASO.md` Paso 4/5 for the full walkthrough including IAM role and API Gateway route wiring)

```bash
cd proyectos/quiz/lambda/<name>
npm install && zip -r function.zip index.js package.json node_modules
aws lambda update-function-code --function-name quiz-<name> \
  --zip-file fileb://function.zip --profile floci
```

### Deploy the frontend

```bash
cd proyectos/quiz/frontend
aws s3 cp index.html s3://quiz-frontend/index.html --cache-control "no-cache" --profile floci
aws s3 cp style.css  s3://quiz-frontend/style.css  --cache-control "no-cache" --profile floci
aws s3 cp app.js     s3://quiz-frontend/app.js     --cache-control "no-cache" --profile floci
```

Access: publicly at `https://floci.devera.cloud/site/quiz-frontend/` (no tunnel needed), or via the
SSH tunnel at `http://quiz-frontend.s3-website.us-east-1.localhost:4566/` (useful right after a
deploy, before checking it works publicly too).

### `proyectos/quiz-avanzado/`
A **complete, independent fork of `proyectos/quiz/`** (created 2026-07-05) — same code, same
architecture, but its own RDS (`quiz-avanzado-db`, internal endpoint `172.22.0.2:7002`, db
`quiz_avanzado`), its own 6 Lambdas (`quiz-avanzado-*`), its own API Gateway (`quiz-avanzado-api`,
id `a7f3682d91`), and its own bucket (`quiz-avanzado-frontend`). It exists so the advanced-services
work (Secrets Manager, KMS, CloudTrail, SNS, EventBridge, WAF, CloudFormation, Cognito) can break
things experimentally without touching the original, which is public and in real use.

This project has **no** `ARQUITECTURA.md` / `GUIA-PASO-A-PASO.md` of its own — the app's design is
identical to `proyectos/quiz/`, so those docs are the ones to read for that. What lives only here:
`docs/PLAN-SERVICIOS-AVANZADOS.md` (with a "Contexto de este fork" section covering exactly what
differs: resource names, how data was copied, the fork's own history) and
`docs/GUIA-SERVICIOS-AVANZADOS.md` (all advanced-services concepts + implementation, including
Fase 1/nginx even though that was implemented against the original's resources).

Public URL: `https://floci.devera.cloud/site/quiz-avanzado-frontend/` — works with **zero** nginx
changes, because the public-exposure pattern (`docs/GUIA-SERVICIOS-AVANZADOS.md` §1, here) was
built generic from the start (`/site/<bucket>/`, `/restapis/<any-api-id>/`), confirmed by this fork
working immediately after creation.

`db/seed.js` in this fork is vestigial (same as in the original — the source JSON in `data/` was
deleted after the original's one-time load). The 169 questions/697 options/169 explanations here
were copied directly from the original's RDS via `pg_dump`/`psql` over `--network floci_default`,
not re-seeded; `ranking` was intentionally left empty (new fork, old scores don't carry over).
