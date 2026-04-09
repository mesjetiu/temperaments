#!/usr/bin/env bash
# deploy.sh — Build + commit + push
# Uso: ./deploy.sh "mensaje del commit"
set -e

MSG="${1:-Deploy: update version}"

npm run build

VERSION=$(node -e "import('./docs/version.json', {assert:{type:'json'}}).then(m=>process.stdout.write(m.default.v))" 2>/dev/null \
       || node -e "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync('docs/version.json')).v)")

echo "→ Versión: $VERSION"

git add docs/
git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push

echo "✓ Deploy completado: $VERSION"
