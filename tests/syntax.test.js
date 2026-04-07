// syntax.test.js — Comprueba que los ficheros JS del proyecto no tienen errores de sintaxis.
// Usa `node --check` (el mismo parser de Node) para detectar SyntaxError antes del deploy.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'docs/app.js',
  'docs/core.js',
  'docs/sw.js',
];

describe('sintaxis JS', () => {
  for (const rel of files) {
    it(rel, () => {
      const { status, stderr } = spawnSync(process.execPath, ['--check', join(root, rel)]);
      assert.strictEqual(status, 0, stderr?.toString() || `SyntaxError en ${rel}`);
    });
  }
});
