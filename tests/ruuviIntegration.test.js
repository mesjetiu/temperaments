// ── Tests de integración: sensor RuuviTag → compensación térmica → frecuencias ──
//
// Verifica los dos casos de uso críticos:
//   1. Teclado: getEffectivePitchA() refleja la temperatura actualizada
//   2. Afinador: getTargetFreq() refleja la temperatura actualizada
//
// Estos tests simulan el flujo ruuviOnTemperature → updateCompensatedPitch
// sin DOM ni Web Audio, usando directamente las funciones de core.js.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// ── Cargar core.js como módulo ES ────────────────────────────────────────────
import { getCompensatedFreq, getFreqOffsetInCents, noteFreq } from '../docs/core.js';

// ── Simulación mínima del estado global de app.js ────────────────────────────
// Replicamos solo la lógica relevante sin DOM ni AudioContext.

function makeAppState({ pitchA = 440, refTemp = 20, currentTemp = 20, tempCompEnabled = true } = {}) {
  let _pitchA         = pitchA;
  let _refTemp        = refTemp;
  let _currentTemp    = currentTemp;
  let _tempCompEnabled = tempCompEnabled;
  let _compensated    = pitchA;

  function updateCompensatedPitch() {
    _compensated = _tempCompEnabled
      ? getCompensatedFreq(_pitchA, _refTemp, _currentTemp)
      : _pitchA;
  }

  function getEffectivePitchA() {
    return _tempCompEnabled ? _compensated : _pitchA;
  }

  // Simula ruuviOnTemperature
  function onSensorTemp(tempC) {
    _currentTemp = tempC;
    updateCompensatedPitch();
  }

  // Simula TUNER.getTargetFreq para una nota dada (ni, oct, offsets ET)
  function getTargetFreq(ni, oct = 4, offsets = new Array(12).fill(0)) {
    const ET_FROM_A = [3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22].map(s => s - 12); // semitonos desde A
    // Calcular semitonos desde A4
    const semis = [3,5,7,8,10,12,14,15,17,19,21,22]; // C=3 semitonos sobre A3
    // Usamos noteFreq de core.js directamente
    return noteFreq(ni, offsets, getEffectivePitchA(), oct - 4);
  }

  // Simula playNote: captura la frecuencia en el momento de tocar
  function playNote(ni, offsets = new Array(12).fill(0), oct = 4) {
    return noteFreq(ni, offsets, getEffectivePitchA(), oct - 4);
  }

  updateCompensatedPitch(); // inicializar

  return { onSensorTemp, getEffectivePitchA, getTargetFreq, playNote,
           get compensated() { return _compensated; },
           get currentTemp()  { return _currentTemp; } };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Integración sensor → getEffectivePitchA', () => {

  it('sin sensor: getEffectivePitchA devuelve pitchA base', () => {
    const app = makeAppState({ pitchA: 440, tempCompEnabled: false });
    assert.equal(app.getEffectivePitchA(), 440);
  });

  it('con compEnb y misma temp: getEffectivePitchA = pitchA base', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    assert.equal(app.getEffectivePitchA(), 440);
  });

  it('sensor sube temp 10°C → getEffectivePitchA sube ~29¢', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(30);
    const eff = app.getEffectivePitchA();
    const cents = getFreqOffsetInCents(eff, 440);
    assert.ok(cents > 28 && cents < 30, `esperado ~29¢, obtenido ${cents.toFixed(2)}¢`);
  });

  it('sensor baja temp 10°C → getEffectivePitchA baja ~29-31¢', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(10);
    const eff = app.getEffectivePitchA();
    const cents = getFreqOffsetInCents(eff, 440);
    // La fórmula √(T/Tref) no es lineal: bajar 10°C baja ligeramente más que subir 10°C
    assert.ok(cents < -28 && cents > -32, `esperado ~-30¢, obtenido ${cents.toFixed(2)}¢`);
  });

  it('actualizaciones sucesivas del sensor convergen al último valor', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(25);
    app.onSensorTemp(22);
    app.onSensorTemp(18);
    const expected = getCompensatedFreq(440, 20, 18);
    assert.equal(app.getEffectivePitchA(), expected);
  });

});

describe('Caso 1: teclado — playNote usa pitchA actualizado por sensor', () => {

  it('nota A4 en ET con pitchA=440 suena a 440 Hz sin sensor', () => {
    const app = makeAppState({ pitchA: 440, tempCompEnabled: false });
    const A4 = 9; // ni=9 es La en notación C=0
    const freq = app.playNote(A4);
    assert.ok(Math.abs(freq - 440) < 0.01, `A4 debería ser ~440, fue ${freq}`);
  });

  it('nota A4 tras subida de 10°C suena ~29¢ más aguda', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(30);
    const A4 = 9;
    const freq = app.playNote(A4);
    const cents = getFreqOffsetInCents(freq, 440);
    assert.ok(cents > 28 && cents < 30,
      `A4 tras +10°C debería subir ~29¢, subió ${cents.toFixed(2)}¢`);
  });

  it('nota C4 (Do4) también se desplaza proporcionalmente con la temperatura', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    const freqBase = app.playNote(0); // C4 en ET
    app.onSensorTemp(30); // +10°C
    const freqComp = app.playNote(0);
    const cents = getFreqOffsetInCents(freqComp, freqBase);
    assert.ok(cents > 28 && cents < 30,
      `C4 tras +10°C debería desplazarse ~29¢, fue ${cents.toFixed(2)}¢`);
  });

  it('con compensación desactivada el sensor no altera la frecuencia', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: false });
    app.onSensorTemp(40); // +20°C pero comp desactivada
    const A4 = 9;
    const freq = app.playNote(A4);
    assert.ok(Math.abs(freq - 440) < 0.01,
      `Con comp desactivada A4 debe seguir siendo 440, fue ${freq}`);
  });

});

describe('Caso 2: afinador — getTargetFreq usa pitchA actualizado por sensor', () => {

  it('La4 objetivo antes del sensor es 440 Hz', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    const A4 = 9;
    const freq = app.getTargetFreq(A4, 4);
    assert.ok(Math.abs(freq - 440) < 0.01, `La4 base debería ser 440, fue ${freq}`);
  });

  it('La4 objetivo sube ~29¢ tras sensor +10°C', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(30);
    const A4 = 9;
    const freq = app.getTargetFreq(A4, 4);
    const cents = getFreqOffsetInCents(freq, 440);
    assert.ok(cents > 28 && cents < 30,
      `La4 tras +10°C debería apuntar ~29¢ más arriba, fue ${cents.toFixed(2)}¢`);
  });

  it('La4 objetivo baja tras sensor -5°C', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(15);
    const A4 = 9;
    const freq = app.getTargetFreq(A4, 4);
    assert.ok(freq < 440, `La4 tras -5°C debería bajar de 440, fue ${freq}`);
  });

  it('varias actualizaciones sucesivas: getTargetFreq refleja la última temperatura', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: true });
    app.onSensorTemp(25);
    app.onSensorTemp(30);
    app.onSensorTemp(23);
    const expected = getCompensatedFreq(440, 20, 23);
    // noteFreq(9, zeros, expected, 0) para A4
    const zeros = new Array(12).fill(0);
    const A4 = 9;
    const freq = app.getTargetFreq(A4, 4, zeros);
    assert.ok(Math.abs(freq - expected) < 0.001,
      `getTargetFreq tras 23°C debería ser ${expected.toFixed(3)}, fue ${freq.toFixed(3)}`);
  });

  it('con compensación desactivada getTargetFreq no cambia con el sensor', () => {
    const app = makeAppState({ pitchA: 440, refTemp: 20, currentTemp: 20, tempCompEnabled: false });
    const A4 = 9;
    const freqAntes = app.getTargetFreq(A4, 4);
    app.onSensorTemp(35);
    const freqDespues = app.getTargetFreq(A4, 4);
    assert.equal(freqAntes, freqDespues);
  });

});
