#!/usr/bin/env node
// scripts/build.js — Genera docs/ desde src/, estampando versión y hash de git.
// Sin dependencias externas. Uso: node scripts/build.js

import { execSync }                          from 'child_process';
import { cpSync, mkdirSync, rmSync,
         writeFileSync, readFileSync,
         existsSync }                        from 'fs';
import { join, dirname }                     from 'path';
import { fileURLToPath }                     from 'url';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC   = join(ROOT, 'src');
const DEST  = join(ROOT, 'docs');

const hash    = execSync('git rev-parse --short HEAD').toString().trim();
const date    = new Date().toISOString().slice(0, 10);
const version = `${hash} · ${date}`;

// 1. Limpiar y copiar src/ → docs/
if (existsSync(DEST)) rmSync(DEST, { recursive: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });

// 2. Estampar CACHE en docs/sw.js
const swPath = join(DEST, 'sw.js');
writeFileSync(swPath,
  readFileSync(swPath, 'utf8')
    .replace("'temp-__HASH__'", `'temp-${hash}'`)
);

// 3. Estampar APP_VERSION en docs/app.js
const appPath = join(DEST, 'app.js');
writeFileSync(appPath,
  readFileSync(appPath, 'utf8')
    .replace("'__VERSION__'", `'${version}'`)
);

// 4. Generar docs/version.json
writeFileSync(join(DEST, 'version.json'), JSON.stringify({ v: version }) + '\n');

console.log(`✓ Build: ${version}`);
