#!/usr/bin/env bash
# A diferencia de floci-tunnel.sh (que corre en el cliente), este script corre
# EN EL VPS, disparado por plataforma/systemd/floci-lambda-runtime-guard.timer
# poco despues del cron preexistente /etc/cron.d/docker-image-prune (fuera de
# este repo, `docker image prune -af --filter "until=24h"`, diario 00:41 UTC).
#
# Ese prune borra cualquier imagen sin contenedor activo con mas de 24h. Floci
# lanza un contenedor nuevo por cada invocacion de Lambda y lo destruye al
# terminar, asi que la imagen del runtime (public.ecr.aws/lambda/nodejs:22,
# usada por las 13 Lambdas de los 3 proyectos de este repo) siempre queda "sin
# uso" entre invocaciones -> el prune la borra tarde o temprano si nadie la
# re-descarga antes. Este script la restaura si falta (ver incidente en
# proyectos/quiz/docs/ARQUITECTURA.md).
set -euo pipefail

IMAGE="public.ecr.aws/lambda/nodejs:22"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "$(date -Is) OK: $IMAGE presente."
else
  echo "$(date -Is) FALTA $IMAGE (probablemente borrada por el prune diario), re-descargando..."
  docker pull "$IMAGE"
fi
