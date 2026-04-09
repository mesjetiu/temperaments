// thermalCompensation.test.js — Tests de compensación térmica para órganos
// Fórmula: f(T) = f_ref × √((273.15 + T_actual) / (273.15 + T_ref))
// Basada en la velocidad del sonido en el aire: v(T) = 331.3 × √(1 + T/273.15)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCompensatedFreq, getFreqOffsetInCents } from '../src/core.js';

// Función auxiliar: valor esperado con la fórmula exacta
const expected = (f, tRef, tCurr) => f * Math.sqrt((273.15 + tCurr) / (273.15 + tRef));

describe('Compensación térmica (órgano — velocidad del sonido)', () => {
  describe('getCompensatedFreq', () => {
    it('sin cambio de temperatura devuelve la misma frecuencia', () => {
      assert.equal(getCompensatedFreq(440, 20, 20), 440);
    });

    it('aumento de 5°C (415 Hz, 20→25°C): sube ~14.7¢', () => {
      const f = getCompensatedFreq(415, 20, 25);
      const exp = expected(415, 20, 25); // ≈ 418.53
      assert(Math.abs(f - exp) < 0.001, `esperado ${exp.toFixed(3)}, obtuvo ${f.toFixed(3)}`);
      const cents = getFreqOffsetInCents(f, 415);
      assert(cents > 14 && cents < 15, `esperado ~14.7¢, obtuvo ${cents.toFixed(1)}¢`);
    });

    it('aumento de 10°C (440 Hz, 20→30°C): sube ~29.3¢', () => {
      const f = getCompensatedFreq(440, 20, 30);
      const exp = expected(440, 20, 30); // ≈ 447.5
      assert(Math.abs(f - exp) < 0.001);
      const cents = getFreqOffsetInCents(f, 440);
      assert(cents > 29 && cents < 30, `esperado ~29.3¢, obtuvo ${cents.toFixed(1)}¢`);
    });

    it('disminución de 5°C (440 Hz, 20→15°C): baja ~14.7¢', () => {
      const f = getCompensatedFreq(440, 20, 15);
      assert(f < 440);
      const cents = getFreqOffsetInCents(f, 440);
      assert(cents < -14 && cents > -15, `esperado ~-14.7¢, obtuvo ${cents.toFixed(1)}¢`);
    });

    it('temperatura negativa (440 Hz, 20→0°C): baja ~61¢', () => {
      const f = getCompensatedFreq(440, 20, 0);
      const exp = expected(440, 20, 0);
      assert(Math.abs(f - exp) < 0.001);
      const cents = getFreqOffsetInCents(f, 440);
      assert(cents < -59 && cents > -63, `esperado ~-61¢, obtuvo ${cents.toFixed(1)}¢`);
    });

    it('gran diferencia (440 Hz, 15→35°C): ≈ un tercio de semitono', () => {
      const f = getCompensatedFreq(440, 15, 35);
      const cents = getFreqOffsetInCents(f, 440);
      // 20°C de diferencia ≈ 59¢ (casi un semitono)
      assert(cents > 55 && cents < 62, `esperado ~59¢, obtuvo ${cents.toFixed(1)}¢`);
    });

    it('resultado coincide con la fórmula de velocidad del sonido', () => {
      // Verificación directa: f(T) / f(Tref) = v(T) / v(Tref) = √((273.15+T)/(273.15+Tref))
      for (const [tRef, tCurr] of [[20, 25], [18, 22], [15, 30], [20, 0], [20, 40]]) {
        const f = getCompensatedFreq(440, tRef, tCurr);
        const ratio = f / 440;
        const expectedRatio = Math.sqrt((273.15 + tCurr) / (273.15 + tRef));
        assert(Math.abs(ratio - expectedRatio) < 1e-12,
          `T ${tRef}→${tCurr}: ratio ${ratio} ≠ expected ${expectedRatio}`);
      }
    });
  });

  describe('getFreqOffsetInCents', () => {
    it('misma frecuencia devuelve 0 cents', () => {
      assert.equal(getFreqOffsetInCents(440, 440), 0);
    });

    it('octava arriba devuelve 1200 cents', () => {
      assert.equal(Math.round(getFreqOffsetInCents(880, 440)), 1200);
    });

    it('octava abajo devuelve -1200 cents', () => {
      assert.equal(Math.round(getFreqOffsetInCents(220, 440)), -1200);
    });

    it('frecuencias inválidas o negativas devuelven 0', () => {
      assert.equal(getFreqOffsetInCents(0, 440), 0);
      assert.equal(getFreqOffsetInCents(440, 0), 0);
      assert.equal(getFreqOffsetInCents(-440, 440), 0);
      assert.equal(getFreqOffsetInCents(440, -440), 0);
    });

    it('el offset es simétrico: freq1→freq2 ≈ -freq2→freq1', () => {
      const offset1 = getFreqOffsetInCents(450, 440);
      const offset2 = getFreqOffsetInCents(440, 450);
      assert(Math.abs(offset1 - (-offset2)) < 1e-10, `${offset1} ≠ ${-offset2}`);
    });
  });
});
