#!/usr/bin/env bash
# Túnel SSH persistente hacia Floci (puerto 4566 del VPS), pensado para correr
# bajo systemd (ver plataforma/systemd/floci-tunnel.service) con Restart=always,
# y autossh como capa extra de reconexión ante cortes de red intermitentes.
#
# Valores (IP del VPS, usuario, puertos) se leen de plataforma/.env, que NO se
# sube al repositorio (ver plataforma/.env.example para la plantilla).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Falta $ENV_FILE -- copia plataforma/.env.example a plataforma/.env y completa tus valores." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

: "${FLOCI_VPS_HOST:?Falta FLOCI_VPS_HOST en $ENV_FILE}"
FLOCI_VPS_USER="${FLOCI_VPS_USER:-root}"
FLOCI_LOCAL_PORT="${FLOCI_LOCAL_PORT:-4566}"
FLOCI_REMOTE_PORT="${FLOCI_REMOTE_PORT:-4566}"

# -M 0: sin puerto de monitoreo propio de autossh, solo usamos los keep-alives de ssh.
# -N: no ejecutar comando remoto, solo reenviar el puerto.
# ExitOnForwardFailure: si el reenvío falla, autossh lo nota y reintenta (en vez de
#   quedar "vivo" pero sin túnel funcional).
# StrictHostKeyChecking=accept-new: acepta la clave la primera vez sin bloquear un
#   servicio no interactivo, pero sigue rechazando si la clave cambia después (a
#   diferencia de "no", que ignora cambios de clave silenciosamente).
exec autossh -M 0 -N \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -o "ExitOnForwardFailure yes" \
  -o "StrictHostKeyChecking accept-new" \
  -L "${FLOCI_LOCAL_PORT}:localhost:${FLOCI_REMOTE_PORT}" \
  "${FLOCI_VPS_USER}@${FLOCI_VPS_HOST}"
