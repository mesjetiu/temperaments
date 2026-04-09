// thermalCompensation.test.js — Tests de compensación térmica para órganos

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCompensatedFreq, getFreqOffsetInCents } from '../docs/core.js';

describe('Compensación térmica (órgano)', () => {
  describe('getCompensatedFreq', () => {
    it('sin cambio de temperatura devuelve la misma frecuencia', () => {
      const f = getCompensatedFreq(440, 20, 20);
      assert.equal(f, 440);
    });

    it('aumento de 5°C (415 Hz a 20°C → 25°C): sube ~1.6¢', () => {
      const f = getCompensatedFreq(415, 20, 25);
      // α = 0.000184/°C para estaño-plomo
      // f(25°C) = 415 * (1 + 0.000184 * 5) = 415.3818 Hz
      assert.equal(f.toFixed(4), '415.3818');
    });

    it('aumento de 10°C (440 Hz a 20°C → 30°C): sube ~3.2¢', () => {
      const f = getCompensatedFreq(440, 20, 30);
      // f(30°C) = 440 * (1 + 0.000184 * 10) = 440.8096 Hz
      assert.equal(f.toFixed(4), '440.8096');
    });

    it('disminución de 5°C (440 Hz a 20°C → 15°C): baja ~1.6¢', () => {
      const f = getCompensatedFreq(440, 20, 15);
      // f(15°C) = 440 * (1 + 0.000184 * (-5)) = 439.5952 Hz
      assert.equal(f.toFixed(4), '439.5952');
    });

    it('temperatura negativa (440 Hz a 0°C)', () => {
      const f = getCompensatedFreq(440, 20, 0);
      // f(0°C) = 440 * (1 + 0.000184 * (-20)) = 438.3808 Hz
      assert.equal(f.toFixed(4), '438.3808');
    });

    it('alpha personalizado: coeficiente diferente', () => {
      // Con alpha = 0.0001/°C (valor aproximado menos preciso)
      const f = getCompensatedFreq(440, 20, 30, 0.0001);
      // f(30°C) = 440 * (1 + 0.0001 * 10) = 440.44 Hz
      assert.equal(f.toFixed(4), '440.4400');
    });
  });

  describe('getFreqOffsetInCents', () => {
    it('misma frecuencia devuelve 0 cents', () => {
      const cents = getFreqOffsetInCents(440, 440);
      assert.equal(cents, 0);
    });

    it('octava arriba devuelve 1200 cents', () => {
      const cents = getFreqOffsetInCents(880, 440);
      assert.equal(Math.round(cents), 1200);
    });

    it('octava abajo devuelve -1200 cents', () => {
      const cents = getFreqOffsetInCents(220, 440);
      assert.equal(Math.round(cents), -1200);
    });

    it('compensación térmica de 415 Hz +5°C: ~1.59 cents', () => {
      const ref = 415;
      const comp = getCompensatedFreq(ref, 20, 25);
      const offset = getFreqOffsetInCents(comp, ref);
      // 1200 * log2(415.3818 / 415) ≈ 1.59 cents
      assert(Math.abs(offset - 1.59) < 0.05, `esperado ~1.59¢, obtuvo ${offset.toFixed(2)}¢`);
    });

    it('compensación térmica de 440 Hz +10°C: ~3.18 cents', () => {
      const ref = 440;
      const comp = getCompensatedFreq(ref, 20, 30);
      const offset = getFreqOffsetInCents(comp, ref);
      // 1200 * log2(440.8096 / 440) ≈ 3.18 cents
      assert(Math.abs(offset - 3.18) < 0.05, `esperado ~3.18¢, obtuvo ${offset.toFixed(2)}¢`);
    });

    it('compensación térmica de 440 Hz -5°C: ~-1.59 cents', () => {
      const ref = 440;
      const comp = getCompensatedFreq(ref, 20, 15);
      const offset = getFreqOffsetInCents(comp, ref);
      // 1200 * log2(439.5952 / 440) ≈ -1.59 cents
      assert(Math.abs(offset - (-1.59)) < 0.05, `esperado ~-1.59¢, obtuvo ${offset.toFixed(2)}¢`);
    });

    it('frecuencias inválidas o negativas devuelven 0', () => {
      assert.equal(getFreqOffsetInCents(0, 440), 0);
      assert.equal(getFreqOffsetInCents(440, 0), 0);
      assert.equal(getFreqOffsetInCents(-440, 440), 0);
      assert.equal(getFreqOffsetInCents(440, -440), 0);
    });

    it('el offset es simétrico: freq1→freq2 = -freq2→freq1', () => {
      const offset1 = getFreqOffsetInCents(450, 440);
      const offset2 = getFreqOffsetInCents(440, 450);
      // Comparar con tolerancia por precisión flotante
      assert(Math.abs(offset1 - (-offset2)) < 1e-10, `${offset1} ≠ ${-offset2}`);
    });
  });
});
