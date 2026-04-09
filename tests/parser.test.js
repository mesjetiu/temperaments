// parser.test.js — Tests de parseTempMarkdown

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { parseTempMarkdown } from '../src/core.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const TEMPS_MD = join(__dir, '../src/temperaments.md');

// ─── Fixtures inline ──────────────────────────────────────────────────────────

describe('parseTempMarkdown (fixtures)', () => {
  it('devuelve array vacío para texto sin filas válidas', () => {
    assert.deepEqual(parseTempMarkdown(''), []);
    assert.deepEqual(parseTempMarkdown('Sin pipes aquí'), []);
  });

  it('ignora la fila de cabecera (contiene "Name")', () => {
    const header = '| Source | Name | C | C# | D | D# | E | F | F# | G | G# | A | B♭ | B |';
    assert.equal(parseTempMarkdown(header).length, 0);
  });

  it('ignora la fila separadora (|---|)', () => {
    const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
    assert.equal(parseTempMarkdown(sep).length, 0);
  });

  it('parsea una fila válida correctamente', () => {
    const row = '| Scala | Equal temperament | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |';
    const result = parseTempMarkdown(row);
    assert.equal(result.length, 1);
    assert.equal(result[0].source, 'Scala');
    assert.equal(result[0].name, 'Equal temperament');
    assert.equal(result[0].offsets.length, 12);
  });

  it('extrae el nombre de un enlace Markdown [Texto](url)', () => {
    const row = '| [Scala](http://example.com) | Mi temperamento | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |';
    const result = parseTempMarkdown(row);
    assert.equal(result[0].source, 'Scala');
  });

  it('deja la fuente como texto plano si no hay enlace', () => {
    const row = '| Manual | Mi temperamento | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |';
    assert.equal(parseTempMarkdown(row)[0].source, 'Manual');
  });

  it('parsea offsets numéricos incluyendo decimales y signo positivo', () => {
    const row = '| Src | Temp | +52.941 | -3.0 | +5.5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |';
    const offs = parseTempMarkdown(row)[0].offsets;
    assert.ok(Math.abs(offs[0] - 52.941) < 0.0001);
    assert.ok(Math.abs(offs[1] - (-3.0)) < 0.0001);
    assert.ok(Math.abs(offs[2] - 5.5) < 0.0001);
  });

  it('descarta una fila con un offset no numérico', () => {
    const row = '| Src | Temp | X | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |';
    assert.equal(parseTempMarkdown(row).length, 0);
  });

  it('descarta una fila con menos de 15 celdas', () => {
    const row = '| Src | Temp | 0 | 0 | 0 |';
    assert.equal(parseTempMarkdown(row).length, 0);
  });

  it('parsea varias filas válidas en el mismo texto', () => {
    const text = [
      '| Src | A | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
      '| Src | B | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0 | 1 | 2 |',
    ].join('\n');
    assert.equal(parseTempMarkdown(text).length, 2);
  });
});

// ─── Integración con el fichero real ─────────────────────────────────────────

describe('parseTempMarkdown (temperaments.md real)', () => {
  let temps;

  it('lee y parsea el fichero sin errores', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    assert.ok(Array.isArray(temps));
  });

  it('contiene exactamente 1784 temperamentos', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    assert.equal(temps.length, 1784,
      `encontrados ${temps.length} temperamentos`);
  });

  it('todos los offsets tienen exactamente 12 valores', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    for (const t of temps) {
      assert.equal(t.offsets.length, 12, `"${t.name}" tiene ${t.offsets.length} offsets`);
    }
  });

  it('ningún temperamento tiene nombre vacío', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    for (const t of temps) {
      assert.ok(t.name && t.name.length > 0, 'nombre vacío encontrado');
    }
  });

  it('ningún offset es NaN', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    for (const t of temps) {
      for (let i = 0; i < 12; i++) {
        assert.ok(!isNaN(t.offsets[i]), `NaN en "${t.name}" offset[${i}]`);
      }
    }
  });

  it('al menos una entrada tiene source "Scala"', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    assert.ok(temps.some(t => t.source === 'Scala'));
  });

  it('existe un temperamento llamado "Equal temperament" con todos los offsets = 0', () => {
    const text = readFileSync(TEMPS_MD, 'utf-8');
    temps = parseTempMarkdown(text);
    const et = temps.find(t => t.name === 'Equal temperament');
    assert.ok(et, 'no se encontró "Equal temperament"');
    for (let i = 0; i < 12; i++) {
      assert.ok(Math.abs(et.offsets[i]) < 0.001,
        `ET offset[${i}] = ${et.offsets[i]} (esperado 0)`);
    }
  });
});
