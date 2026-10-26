#!/usr/bin/env bash
# Instala el vigilante en el servidor de Nexus. Se ejecuta una vez, como root.
# No toca los contenedores que ya hay (audioguías, marcus): solo añade un temporizador de systemd.
set -euo pipefail
BASE=/opt/feel-vigilante
mkdir -p "$BASE"
chmod 700 "$BASE"

# 1) Clave de despliegue (solo para este repositorio). La pública se añade en GitHub: Settings → Deploy keys, con escritura.
[ -f "$BASE/deploy_key" ] || ssh-keygen -q -t ed25519 -N '' -C 'vigilante-nexus' -f "$BASE/deploy_key"

# 2) Avisos a Slack: SLACK_WEBHOOK_URL=… en este fichero (vacío = sin avisos).
[ -f "$BASE/env" ] || { echo 'SLACK_WEBHOOK_URL=' > "$BASE/env"; chmod 600 "$BASE/env"; }

# 3) Código (el repositorio es público: se clona por HTTPS y se publica por SSH).
[ -d "$BASE/repo/.git" ] || git clone -q https://github.com/rferruzq202217/feel-vigilante-landings.git "$BASE/repo"

docker pull -q mcr.microsoft.com/playwright:v1.48.2-jammy

echo "Clave pública para GitHub (Deploy keys, marcar «Allow write access»):"
cat "$BASE/deploy_key.pub"
