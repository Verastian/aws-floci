#!/usr/bin/env bash
# Corre EN EL VPS, disparado por plataforma/systemd/quiz-cleanup.timer. Invoca la
# Lambda quiz-cleanup (borra el historial de jugadores inactivos hace mas de 30
# dias que no esten en ningun top 20 -- ver proyectos/quiz/lambda/cleanup/index.js)
# directo por HTTP contra el puerto local de Floci, sin aws-cli: no hace falta
# instalarlo en el VPS solo para esto, y Floci no exige autenticacion real.
#
# quiz-avanzado usa un disparador distinto (EventBridge Scheduler real, ver
# proyectos/quiz-avanzado/docs/GUIA-SERVICIOS-AVANZADOS.md) porque ahi SI se
# documentan servicios avanzados de AWS; este proyecto (el publico) se queda con
# una herramienta de ops simple, igual que floci-lambda-runtime-guard.sh.
set -euo pipefail

RESPUESTA=$(curl -sf -X POST 'http://localhost:4566/2015-03-31/functions/quiz-cleanup/invocations' -d '{}')
echo "$(date -Is) $RESPUESTA"
