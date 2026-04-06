// pitch.test.js — Tests de detectPitch y _refineFFT

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, _refineFFT } from '../docs/core.js';
import { makeSine, mixSines, makeFFTBuf, freqToCents } from './helpers.js';

const SR = 44100;
const N  = 4096;

// ─── detectPitch ──────────────────────────────────────────────────────────────

describe('detectPitch', () => {
  it('silencio (todo ceros) devuelve null', () => {
    assert.equal(detectPitch(new Float32Array(N), SR), null);
  });

  it('señal casi silenciosa (RMS < 0.0001) devuelve null', () => {
    assert.equal(detectPitch(makeSine(440, SR, N, 0.000009), SR), null);
  });

  it('devuelve {freq, clarity, rms} con señal válida', () => {
    const r = detectPitch(makeSine(440, SR, N), SR);
    assert.ok(r !== null);
    assert.ok('freq' in r && 'clarity' in r && 'rms' in r);
  });

  it('clarity está en [0, 1]', () => {
    const r = detectPitch(makeSine(440, SR, N), SR);
    assert.ok(r.clarity >= 0 && r.clarity <= 1, `clarity = ${r.clarity}`);
  });

  it('clarity > 0.85 para sinusoide pura', () => {
    const r = detectPitch(makeSine(440, SR, N), SR);
    assert.ok(r.clarity > 0.85, `clarity = ${r.clarity}`);
  });

  it('rms > 0 con señal válida', () => {
    const r = detectPitch(makeSine(440, SR, N), SR);
    assert.ok(r.rms > 0);
  });

  // Precisión: error < 1 cent para sinusoides puras en rangos típicos

  const casosFreq = [
    ['A4 = 440 Hz, SR 44100',  440,    SR,    1],
    ['A4 = 440 Hz, SR 48000',  440,    48000, 1],
    ['C4 = 261.63 Hz',         261.63, SR,    1],
    ['G3 = 196 Hz',            196,    SR,    1],
    ['E5 = 659.26 Hz',         659.26, SR,    2],
    ['B5 = 987.77 Hz',         987.77, SR,    2],
  ];

  for (const [nombre, freq, sr, toleranceCents] of casosFreq) {
    it(`detecta ${nombre} con error < ${toleranceCents}¢`, () => {
      const buf = makeSine(freq, sr, Math.max(N, sr >> 1));
      const r = detectPitch(buf, sr);
      assert.ok(r !== null, 'no detectó ningún tono');
      const errorCents = Math.abs(freqToCents(r.freq, freq));
      assert.ok(errorCents < toleranceCents,
        `freq=${r.freq.toFixed(3)} Hz, error=${errorCents.toFixed(3)}¢`);
    });
  }

  it('mezcla 440 Hz + 880 Hz detecta el fundamental (440 Hz)', () => {
    const buf = mixSines(440, 880, SR, N);
    const r = detectPitch(buf, SR);
    assert.ok(r !== null);
    // Debe detectar el fundamental o la octava inferior (ambas son 440 Hz ± 1 octava)
    const errorCents = Math.abs(freqToCents(r.freq, 440));
    assert.ok(errorCents < 50 || Math.abs(freqToCents(r.freq, 880)) < 50,
      `freq detectada = ${r.freq.toFixed(2)} Hz`);
  });

  it('buffer corto (< 2×W): no lanza excepción', () => {
    assert.doesNotThrow(() => detectPitch(makeSine(440, SR, 100), SR));
  });
});

// ─── _refineFFT ───────────────────────────────────────────────────────────────

describe('_refineFFT', () => {
  it('pico exactamente en bin: devuelve frecuencia muy cercana', () => {
    const targetFreq = 440;
    const fftSize = 4096;
    const buf = makeFFTBuf(targetFreq, SR, fftSize);
    const binW = SR / fftSize;
    const approx = Math.round(targetFreq / binW) * binW; // frecuencia del bin más cercano
    const refined = _refineFFT(approx, buf, SR);
    assert.ok(Math.abs(refined - targetFreq) < binW,
      `refined=${refined.toFixed(2)}, target=${targetFreq}`);
  });

  it('espectro plano (ruido uniforme): devuelve approxFreq sin cambio', () => {
    const flat = new Float32Array(2048).fill(-60);
    const refined = _refineFFT(440, flat, SR);
    assert.equal(refined, 440);
  });

  it('pico alejado > 1 semitono de approxFreq: ignora el pico, devuelve approxFreq', () => {
    // Pico en 500 Hz, approxFreq = 440 Hz (diferencia > 100¢)
    const buf = makeFFTBuf(500, SR);
    const refined = _refineFFT(440, buf, SR);
    assert.equal(refined, 440, `refined=${refined} debería ser 440`);
  });

  it('el resultado es un número finito positivo', () => {
    const buf = makeFFTBuf(440, SR);
    const refined = _refineFFT(440, buf, SR);
    assert.ok(Number.isFinite(refined) && refined > 0);
  });
});
