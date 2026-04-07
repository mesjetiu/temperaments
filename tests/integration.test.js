/**
 * tests/integration.test.js
 *
 * Tests de integración estáticos: verifican que app.js no sobreescribe
 * exports de core.js con function declarations de nivel superior.
 *
 * En scripts clásicos (no módulos), `function foo()` al nivel superior
 * crea `window.foo`, sobreescribiendo cualquier valor previo. Si core.js
 * exporta `foo` a window y app.js también declara `function foo`, el
 * resultado es recursión infinita o comportamiento incorrecto.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from '../docs/core.js';

const appSrc = readFileSync(
  fileURLToPath(new URL('../docs/app.js', import.meta.url)),
  'utf8'
);

// Extraer nombres de function declarations de nivel superior en app.js.
// Regexp: línea que empieza (sin indentación) con "function <nombre>"
const topLevelFnNames = [...appSrc.matchAll(/^function\s+(\w+)/gm)].map(m => m[1]);

const coreExports = Object.keys(core);

describe('Integración app.js ↔ core.js', () => {
  it('ninguna function declaration de app.js sobreescribe un export de core.js', () => {
    const conflicts = topLevelFnNames.filter(fn => coreExports.includes(fn));
    assert.deepStrictEqual(
      conflicts,
      [],
      `Colisión de nombres (app.js sobresscribiría window.X de core.js): ${conflicts.join(', ')}\n` +
      `  → Usar "const" en lugar de "function" para el wrapper en app.js`
    );
  });

  it('app.js tiene al menos 10 function declarations de nivel superior (sanidad)', () => {
    assert.ok(
      topLevelFnNames.length >= 10,
      `Se esperaban ≥10 funciones top-level, se encontraron ${topLevelFnNames.length}`
    );
  });
});
