// harmonics.test.js — Tests de _computeHarmonics (coeficientes Fourier)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _computeHarmonics } from '../docs/core.js';

const N = 8; // potencia de 2 manejable para tests

describe('_computeHarmonics', () => {
  // ── Invariantes comunes ──────────────────────────────────────────────────────

  it('devuelve {real, imag} con longitud N+1 para cualquier tipo', () => {
    for (const type of ['sawtooth', 'square', 'triangle']) {
      const { real, imag } = _computeHarmonics(type, N);
      assert.equal(real.length, N + 1, `${type}: real.length`);
      assert.equal(imag.length, N + 1, `${type}: imag.length`);
    }
  });

  it('el término DC (índice 0) siempre es cero (sin bias)', () => {
    for (const type of ['sawtooth', 'square', 'triangle']) {
      const { real, imag } = _computeHarmonics(type, N);
      assert.equal(real[0], 0, `${type}: real[0]`);
      assert.equal(imag[0], 0, `${type}: imag[0]`);
    }
  });

  // ── Sawtooth ─────────────────────────────────────────────────────────────────

  describe('sawtooth', () => {
    it('todos los coeficientes real son cero', () => {
      const { real } = _computeHarmonics('sawtooth', N);
      for (let n = 0; n <= N; n++) {
        assert.equal(real[n], 0, `real[${n}] = ${real[n]}`);
      }
    });

    it('imag[1] es positivo (fundamental positivo)', () => {
      const { imag } = _computeHarmonics('sawtooth', N);
      assert.ok(imag[1] > 0, `imag[1] = ${imag[1]}`);
    });

    it('signos alternantes: imag[2] < 0, imag[3] > 0, imag[4] < 0', () => {
      const { imag } = _computeHarmonics('sawtooth', N);
      assert.ok(imag[2] < 0, `imag[2] = ${imag[2]}`);
      assert.ok(imag[3] > 0, `imag[3] = ${imag[3]}`);
      assert.ok(imag[4] < 0, `imag[4] = ${imag[4]}`);
    });

    it('caída de amplitud: |imag[1]| > |imag[2]| > |imag[3]|', () => {
      const { imag } = _computeHarmonics('sawtooth', N);
      assert.ok(Math.abs(imag[1]) > Math.abs(imag[2]),
        `|imag[1]|=${Math.abs(imag[1]).toFixed(4)} debe ser > |imag[2]|=${Math.abs(imag[2]).toFixed(4)}`);
      assert.ok(Math.abs(imag[2]) > Math.abs(imag[3]),
        `|imag[2]| debe ser > |imag[3]|`);
    });

    it('fórmula exacta: imag[n] = (±1) / n^1.6', () => {
      const { imag } = _computeHarmonics('sawtooth', N);
      for (let n = 1; n <= N; n++) {
        const expected = (n % 2 === 0 ? -1 : 1) / Math.pow(n, 1.6);
        // Float32Array tiene ~7 dígitos significativos; tolerancia 1e-6
        assert.ok(Math.abs(imag[n] - expected) < 1e-6,
          `imag[${n}] = ${imag[n]}, esperado ${expected}`);
      }
    });
  });

  // ── Square ───────────────────────────────────────────────────────────────────

  describe('square', () => {
    it('solo armónicos impares (los pares son cero)', () => {
      const { imag } = _computeHarmonics('square', N);
      for (let n = 2; n <= N; n += 2) {
        assert.equal(imag[n], 0, `imag[${n}] = ${imag[n]} (debería ser 0)`);
      }
    });

    it('imag[1] = 1 (fundamental normalizado)', () => {
      const { imag } = _computeHarmonics('square', N);
      assert.equal(imag[1], 1);
    });

    it('imag[3] ≈ 1/3', () => {
      const { imag } = _computeHarmonics('square', N);
      assert.ok(Math.abs(imag[3] - 1 / 3) < 1e-6);
    });

    it('imag[5] ≈ 1/5', () => {
      const { imag } = _computeHarmonics('square', N);
      assert.ok(Math.abs(imag[5] - 1 / 5) < 1e-6);
    });

    it('todos los coeficientes real son cero', () => {
      const { real } = _computeHarmonics('square', N);
      for (let n = 0; n <= N; n++) assert.equal(real[n], 0);
    });
  });

  // ── Triangle ─────────────────────────────────────────────────────────────────

  describe('triangle', () => {
    it('solo armónicos impares (los pares son cero)', () => {
      const { imag } = _computeHarmonics('triangle', N);
      for (let n = 2; n <= N; n += 2) {
        assert.equal(imag[n], 0, `imag[${n}] = ${imag[n]} (debería ser 0)`);
      }
    });

    it('imag[1] > 0 (fundamental positivo)', () => {
      const { imag } = _computeHarmonics('triangle', N);
      assert.ok(imag[1] > 0);
    });

    it('imag[3] < 0 (alternancia de signos)', () => {
      const { imag } = _computeHarmonics('triangle', N);
      assert.ok(imag[3] < 0, `imag[3] = ${imag[3]}`);
    });

    it('imag[5] > 0', () => {
      const { imag } = _computeHarmonics('triangle', N);
      assert.ok(imag[5] > 0);
    });

    it('caída 1/n² más rápida que square (1/n)', () => {
      const sq = _computeHarmonics('square', N);
      const tr = _computeHarmonics('triangle', N);
      // |imag[3]_triangle| = 1/9, |imag[3]_square| = 1/3
      assert.ok(Math.abs(tr.imag[3]) < Math.abs(sq.imag[3]),
        `triangle[3]=${Math.abs(tr.imag[3]).toFixed(4)}, square[3]=${Math.abs(sq.imag[3]).toFixed(4)}`);
    });

    it('fórmula exacta: imag[n] = (±1) / n² para impares', () => {
      const { imag } = _computeHarmonics('triangle', N);
      for (let n = 1; n <= N; n += 2) {
        const sign = (((n - 1) / 2) % 2 === 0) ? 1 : -1;
        const expected = sign / (n * n);
        assert.ok(Math.abs(imag[n] - expected) < 1e-9,
          `imag[${n}] = ${imag[n]}, esperado ${expected}`);
      }
    });
  });
});
