#!/usr/bin/env bash
# deploy.sh — Actualiza versión en sw.js, index.html y version.json, commitea y sube
# Uso: ./deploy.sh "mensaje del commit"
set -e

MSG="${1:-Deploy: update version}"
HASH=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
VERSION="$HASH · $DATE"

echo "→ Versión: $VERSION"

# Actualizar CACHE en sw.js (el browser detecta byte-diff → instala nuevo SW)
sed -i "s/const CACHE = 'temp-[^']*'/const CACHE = 'temp-$HASH'/" docs/sw.js

# Actualizar APP_VERSION en index.html
sed -i "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$VERSION'/" docs/index.html

# Actualizar version.json (mecanismo de detección de versión independiente del SW)
printf '{"v":"%s"}\n' "$VERSION" > docs/version.json

git add docs/sw.js docs/index.html docs/version.json
git commit -m "$MSG

CACHE: temp-$HASH
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push

echo "✓ Deploy completado: $VERSION"
