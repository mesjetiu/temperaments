/**
 * tests/perception.test.js
 *
 * Tests de límites de percepción del detector de pitch (MPM).
 * Los thresholds reflejan el rendimiento ACTUAL del algoritmo —
 * nunca deben empeorar. Si mejoran en el futuro, actualizar aquí.
 *
 * Valores reales medidos (calibración 2026-04-07):
 *   Sinusoide pura SR=44100:  error < 0.05¢ en todo el rango 65–2093 Hz
 *   Clarity sinusoide pura:   1.000
 *   Clarity tono complejo:    1.000
 *   SNR 20 dB (amp/10):       0.57¢ error, clarity=0.994
 *   SNR 12 dB (amp/4):        1.92¢ error, clarity=0.961
 *   SNR  6 dB (amp/2):        2.93¢ error, clarity=0.862
 *   SNR  0 dB (amp=noise):    3.39¢ error, clarity=0.611
 *   Amplitud mínima:          0.0002 (null a partir de ~0.0001)
 *
 * Cobertura:
 *  1. Inmunidad al ruido blanco (SNR)
 *  2. Rango de frecuencias detectables
 *  3. Amplitud mínima operativa
 *  4. Señales con armónicos (tono complejo)
 *  5. Calidad mínima (clarity) según tipo de señal
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/core.js';
import { makeSine, makeRichTone, addNoise, freqToCents } from './helpers.js';

const SR = 44100;
const N  = 4096;

// ── 1. Inmunidad al ruido blanco ───────────────────────────────────────────────
// Señal: sinusoide 440 Hz, amp=0.5. Ruido: LCG determinista, seed=12345.
// Thresholds conservadores: ~50% sobre el valor real medido.

describe('Inmunidad al ruido blanco (440 Hz, SR 44100)', () => {
  it('SNR ~20 dB (ruido=amp/10): detecta con error < 1¢', () => {
    // real: 0.57¢
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.05);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó ningún tono');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 1,
      `error=${freqToCents(r.freq, 440).toFixed(3)}¢ (máx 1¢)`);
  });

  it('SNR ~12 dB (ruido=amp/4): detecta con error < 2.5¢', () => {
    // real: 1.92¢
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.125);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó ningún tono');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 2.5,
      `error=${freqToCents(r.freq, 440).toFixed(3)}¢ (máx 2.5¢)`);
  });

  it('SNR ~6 dB (ruido=amp/2): detecta con error < 6¢', () => {
    // real: 2.93¢
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.25);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó ningún tono');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 6,
      `error=${freqToCents(r.freq, 440).toFixed(3)}¢ (máx 6¢)`);
  });

  it('SNR ~0 dB (ruido=señal): detecta con error < 8¢', () => {
    // real: 3.39¢, clarity=0.611 — el algoritmo aún detecta con seed fijo
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.5);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó ningún tono con SNR ~0 dB');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 8,
      `error=${freqToCents(r.freq, 440).toFixed(3)}¢ (máx 8¢)`);
  });
});

// ── 2. Rango de frecuencias detectables ───────────────────────────────────────
// Para sinusoides puras el error es esencialmente el límite de la interpolación
// parabólica: < 0.05¢ en todo el rango 65–2093 Hz.

describe('Rango de frecuencias (sinusoide pura, SR 44100)', () => {
  const casos = [
    // [nombre, freq, toleranceCents, numSamples]
    ['C2  =  65.4 Hz',   65.41,  0.1,  8192],
    ['A2  = 110.0 Hz',  110.00,  0.1,  8192],
    ['C3  = 130.8 Hz',  130.81,  0.1,  4096],
    ['A3  = 220.0 Hz',  220.00,  0.05, 4096],
    ['A4  = 440.0 Hz',  440.00,  0.05, 4096],
    ['A5  = 880.0 Hz',  880.00,  0.1,  4096],
    ['C6  =1046.5 Hz', 1046.50,  0.1,  4096],
    ['E6  =1318.5 Hz', 1318.51,  0.1,  4096],
    ['A6  =1760.0 Hz', 1760.00,  0.1,  4096],
    ['C7  =2093.0 Hz', 2093.00,  0.2,  4096],
  ];

  for (const [nombre, freq, tol, n] of casos) {
    it(`${nombre}: error < ${tol}¢`, () => {
      const buf = makeSine(freq, SR, n);
      const r   = detectPitch(buf, SR);
      assert.ok(r !== null, `no detectó ${nombre}`);
      const err = Math.abs(freqToCents(r.freq, freq));
      assert.ok(err < tol, `error=${err.toFixed(4)}¢ (máx ${tol}¢)`);
    });
  }
});

// ── 3. Amplitud mínima operativa ───────────────────────────────────────────────
// La función retorna null si RMS < 0.0001 (umbral codificado).
// La amplitud mínima real para detección fiable es ~0.0002.

describe('Amplitud mínima (440 Hz, SR 44100)', () => {
  it('amplitud 0.0002 → detecta correctamente (error < 1¢)', () => {
    // real: error < 0.01¢
    const buf = makeSine(440, SR, N, 0.0002);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó con amp=0.0002');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 1,
      `error=${freqToCents(r.freq, 440).toFixed(4)}¢`);
  });

  it('amplitud 0.001 → detecta correctamente (error < 0.1¢)', () => {
    // real: ~0.005¢
    const buf = makeSine(440, SR, N, 0.001);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó con amp=0.001');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 0.1,
      `error=${freqToCents(r.freq, 440).toFixed(4)}¢`);
  });

  it('amplitud 0.0001 (en umbral RMS) → retorna null o detecta sin crash', () => {
    assert.doesNotThrow(() => detectPitch(makeSine(440, SR, N, 0.0001), SR));
  });

  it('amplitud 0.00009 (bajo umbral RMS) → retorna null', () => {
    assert.equal(detectPitch(makeSine(440, SR, N, 0.00009), SR), null);
  });
});

// ── 4. Señales con armónicos (tono complejo) ───────────────────────────────────
// makeRichTone genera 5 armónicos con caída natural (pesos [1, 0.6, 0.3, 0.15, 0.08]).
// MPM detecta el fundamental incluso con espectro rico.

describe('Tono complejo con armónicos', () => {
  const casos = [
    // [nombre, freq, toleranceCents]
    ['A3  = 220 Hz',   220.00, 0.1],
    ['A4  = 440 Hz',   440.00, 0.1],
    ['E4  = 329.6 Hz', 329.63, 0.1],
    ['D3  = 146.8 Hz', 146.83, 0.1],
    ['G4  = 392.0 Hz', 392.00, 0.1],
  ];

  for (const [nombre, freq, tol] of casos) {
    it(`${nombre}: fundamental con error < ${tol}¢`, () => {
      const buf = makeRichTone(freq, SR, N);
      const r   = detectPitch(buf, SR);
      assert.ok(r !== null, `no detectó ${nombre}`);
      const err = Math.abs(freqToCents(r.freq, freq));
      assert.ok(err < tol, `error=${err.toFixed(4)}¢ (máx ${tol}¢)`);
    });
  }

  it('tono complejo + ruido SNR ~12 dB: error < 5¢', () => {
    // real: noise=0.06, error < 1¢
    const buf = addNoise(makeRichTone(440, SR, N), 0.06);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null, 'no detectó tono complejo con ruido');
    assert.ok(Math.abs(freqToCents(r.freq, 440)) < 5,
      `error=${freqToCents(r.freq, 440).toFixed(3)}¢`);
  });
});

// ── 5. Calidad mínima (clarity) ───────────────────────────────────────────────
// clarity ∈ [0, 1]: mide la confianza del detector.
// Valores reales calibrados con seed determinista.

describe('Clarity mínima según tipo de señal', () => {
  it('sinusoide pura 440 Hz: clarity > 0.99  (real: 1.000)', () => {
    const r = detectPitch(makeSine(440, SR, N), SR);
    assert.ok(r !== null && r.clarity > 0.99,
      `clarity=${r?.clarity?.toFixed(4)}`);
  });

  it('tono complejo 440 Hz: clarity > 0.99  (real: 1.000)', () => {
    const r = detectPitch(makeRichTone(440, SR, N), SR);
    assert.ok(r !== null && r.clarity > 0.99,
      `clarity=${r?.clarity?.toFixed(4)}`);
  });

  it('sinusoide + ruido SNR ~12 dB: clarity > 0.93  (real: 0.961)', () => {
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.125);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null && r.clarity > 0.93,
      `clarity=${r?.clarity?.toFixed(4)}`);
  });

  it('tono complejo + ruido SNR ~12 dB: clarity > 0.90  (real: 0.972)', () => {
    const buf = addNoise(makeRichTone(440, SR, N), 0.06);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null && r.clarity > 0.90,
      `clarity=${r?.clarity?.toFixed(4)}`);
  });

  it('señal SNR ~0 dB: clarity > 0.55  (real: 0.611)', () => {
    const buf = addNoise(makeSine(440, SR, N, 0.5), 0.5);
    const r   = detectPitch(buf, SR);
    assert.ok(r !== null && r.clarity > 0.55,
      `clarity=${r?.clarity?.toFixed(4)}`);
  });
});
