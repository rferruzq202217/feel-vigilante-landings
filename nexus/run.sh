#!/usr/bin/env bash
# Una pasada del vigilante desde el servidor de Nexus (lo lanza el temporizador de systemd cada 5 minutos).
# 1) Actualiza el código desde main. 2) Recupera estado e histórico de la rama «data».
# 3) Pasa por las landings en un contenedor con memoria limitada. 4) Publica estado y web en la rama «data».
set -euo pipefail

BASE=/opt/feel-vigilante
REPO="$BASE/repo"
REMOTE_SSH=git@github.com:rferruzq202217/feel-vigilante-landings.git
export GIT_SSH_COMMAND="ssh -i $BASE/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

cd "$REPO"
git fetch -q origin main
git checkout -q -B main origin/main
rm -rf data site
if git fetch -q origin data 2>/dev/null; then
  git archive origin/data data | tar -x || true
fi
mkdir -p data

# Playwright en node_modules (una vez); el navegador ya viene en la imagen.
IMAGE=mcr.microsoft.com/playwright:v1.48.2-jammy
if [ ! -d node_modules/playwright ]; then
  docker run --rm -v "$REPO":/app -w /app "$IMAGE" npm install --no-save --no-audit --no-fund playwright@1.48.2
fi

# El servidor va justo de memoria: contenedor limitado a 1 GB y 2 landings a la vez.
docker run --rm --name feel-vigilante --memory=1g --memory-swap=1g --shm-size=256m \
  --env-file "$BASE/env" -e VIGILANTE_SOURCE=nexus -e PARALLEL=2 \
  -v "$REPO":/app -w /app "$IMAGE" node monitor.js || true

# Publicar: un único commit en la rama «data» (sin histórico, para que no crezca).
TMP=$(mktemp -d)
cp -r data site "$TMP"/
cd "$TMP"
git init -q -b data
git add -A
git -c user.name="Vigilante Nexus" -c user.email="vigilante@feelthecity.invalid" commit -qm "Datos $(date -u +%FT%TZ)"
git push -qf "$REMOTE_SSH" data
cd / && rm -rf "$TMP"
