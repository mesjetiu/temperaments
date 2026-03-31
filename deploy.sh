#!/usr/bin/env bash
# deploy.sh — Actualiza versión en sw.js e index.html, commitea y sube
# Uso: ./deploy.sh "mensaje del commit"
set -e

MSG="${1:-Deploy: update version}"
HASH=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
VERSION="$HASH · $DATE"

echo "→ Versión: $VERSION"

# Actualizar CACHE en sw.js
sed -i "s/const CACHE = 'temp-[^']*'/const CACHE = 'temp-$HASH'/" docs/sw.js

# Actualizar APP_VERSION en index.html
sed -i "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$VERSION'/" docs/index.html

git add docs/sw.js docs/index.html
git commit -m "$MSG

CACHE: temp-$HASH
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push

echo "✓ Deploy completado: $VERSION"
