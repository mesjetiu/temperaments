// core.test.js — Tests de noteFreq, getFifths, getMaj3, getMin3

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteFreq, getFifths, getMaj3, getMin3,
  PURE_FIFTH, PURE_MAJ3, PURE_MIN3, NOTES, FIFTH_LBL, FIFTH_IDX
} from '../src/core.js';

const ET = new Array(12).fill(0);

// ─── noteFreq ────────────────────────────────────────────────────────────────

describe('noteFreq', () => {
  it('A4 en ET a 440 Hz', () => {
    assert.ok(Math.abs(noteFreq(9, ET) - 440) < 0.0001);
  });

  it('A4 en ET a 432 Hz', () => {
    assert.ok(Math.abs(noteFreq(9, ET, 432) - 432) < 0.0001);
  });

  it('A5 (octaveShift +1) = 880 Hz', () => {
    assert.ok(Math.abs(noteFreq(9, ET, 440, 1) - 880) < 0.0001);
  });

  it('A3 (octaveShift -1) = 220 Hz', () => {
    assert.ok(Math.abs(noteFreq(9, ET, 440, -1) - 220) < 0.0001);
  });

  it('C4 en ET ≈ 261.626 Hz', () => {
    assert.ok(Math.abs(noteFreq(0, ET) - 261.6256) < 0.01);
  });

  it('offset +10 cents sube la frecuencia correctamente', () => {
    const off = new Array(12).fill(0);
    off[9] = 10;
    const expected = 440 * Math.pow(2, 10 / 1200);
    assert.ok(Math.abs(noteFreq(9, off) - expected) < 0.001);
  });

  it('offset -10 cents baja la frecuencia correctamente', () => {
    const off = new Array(12).fill(0);
    off[9] = -10;
    const expected = 440 * Math.pow(2, -10 / 1200);
    assert.ok(Math.abs(noteFreq(9, off) - expected) < 0.001);
  });

  it('todas las notas devuelven frecuencias positivas', () => {
    for (let ni = 0; ni < 12; ni++) {
      assert.ok(noteFreq(ni, ET) > 0, `nota ${ni} devolvió frecuencia no positiva`);
    }
  });
});

// ─── getFifths ───────────────────────────────────────────────────────────────

describe('getFifths', () => {
  it('devuelve exactamente 12 quintas', () => {
    assert.equal(getFifths(ET).length, 12);
  });

  it('en ET todas las quintas son 700 cents', () => {
    for (const q of getFifths(ET)) {
      assert.ok(Math.abs(q.size - 700) < 0.0001, `quinta ${q.from}-${q.to} = ${q.size}`);
    }
  });

  it('en ET la desviación de quinta pura es ≈ -1.955 cents', () => {
    for (const q of getFifths(ET)) {
      assert.ok(Math.abs(q.dev - (700 - PURE_FIFTH)) < 0.001, `dev = ${q.dev}`);
    }
  });

  it('primera quinta es C → G', () => {
    const quintas = getFifths(ET);
    assert.equal(quintas[0].from, 'C');
    assert.equal(quintas[0].to, 'G');
  });

  it('las etiquetas from/to cubren las 12 notas del círculo de quintas', () => {
    const quintas = getFifths(ET);
    const froms = new Set(quintas.map(q => q.from));
    for (const lbl of FIFTH_LBL) assert.ok(froms.has(lbl), `falta ${lbl}`);
  });

  it('la suma de las 12 quintas mod 1200 ≈ 0 (el círculo cierra)', () => {
    // Σ size = 7 × 1200 (7 octavas), o sea mod 1200 = 0
    const suma = getFifths(ET).reduce((s, q) => s + q.size, 0);
    assert.ok(Math.abs(suma % 1200) < 0.001 || Math.abs(suma % 1200 - 1200) < 0.001,
      `suma mod 1200 = ${suma % 1200}`);
  });

  it('bajar G 5 cents estrecha la quinta C–G', () => {
    const off = new Array(12).fill(0);
    off[7] = -5; // G (índice 7)
    // En el círculo de quintas, FIFTH_IDX[0]=C, FIFTH_IDX[1]=G
    // size = 700 + off[G] - off[C] = 700 - 5 - 0 = 695
    const q = getFifths(off)[0];
    assert.ok(Math.abs(q.size - 695) < 0.0001, `size = ${q.size}`);
  });

  // Escala Pitagórica: 11 quintas puras + 1 lobo (D#→B♭ ≈ 678.5¢)
  it('escala pitagórica: 11 quintas puras y 1 lobo en D#→B♭', () => {
    const pythagorean = buildPythagorean();
    const quintas = getFifths(pythagorean);
    const wolfQ = quintas.find(q => q.from === 'D#' && q.to === 'B♭');
    assert.ok(wolfQ, 'debería existir una quinta D#→B♭');
    assert.ok(Math.abs(wolfQ.size - 678.495) < 0.5,
      `lobo D#→B♭ = ${wolfQ.size.toFixed(3)} (esperado ≈ 678.5¢)`);
    const puras = quintas.filter(q => !(q.from === 'D#' && q.to === 'B♭'));
    for (const q of puras) {
      assert.ok(Math.abs(q.size - PURE_FIFTH) < 0.01,
        `quinta ${q.from}-${q.to} = ${q.size.toFixed(3)} (esperado ${PURE_FIFTH}¢)`);
    }
  });
});

// ─── getMaj3 ─────────────────────────────────────────────────────────────────

describe('getMaj3', () => {
  it('devuelve exactamente 12 terceras mayores', () => {
    assert.equal(getMaj3(ET).length, 12);
  });

  it('en ET todas las 3as mayores son 400 cents', () => {
    for (const t of getMaj3(ET)) {
      assert.ok(Math.abs(t.size - 400) < 0.0001, `3a ${t.from}-${t.to} = ${t.size}`);
    }
  });

  it('en ET la desviación de 3a mayor pura es ≈ +13.686 cents', () => {
    const expectedDev = 400 - PURE_MAJ3;
    for (const t of getMaj3(ET)) {
      assert.ok(Math.abs(t.dev - expectedDev) < 0.001, `dev = ${t.dev}`);
    }
  });

  it('primera 3a mayor es C → E', () => {
    const t3 = getMaj3(ET);
    assert.equal(t3[0].from, 'C');
    assert.equal(t3[0].to, 'E');
  });

  it('subir E 10 cents amplía la 3a C–E en 10 cents', () => {
    const off = new Array(12).fill(0);
    off[4] = 10; // E (índice 4)
    assert.ok(Math.abs(getMaj3(off)[0].size - 410) < 0.0001);
  });

  it('1/4-coma mesotónica: 3a C–E ≈ pura (386.314 cents)', () => {
    const meantone = buildQuarterCommaMeantone();
    const t = getMaj3(meantone)[0]; // C–E
    assert.ok(Math.abs(t.size - PURE_MAJ3) < 0.5,
      `C–E en mesotónica = ${t.size.toFixed(3)} cents`);
  });
});

// ─── getMin3 ─────────────────────────────────────────────────────────────────

describe('getMin3', () => {
  it('devuelve exactamente 12 terceras menores', () => {
    assert.equal(getMin3(ET).length, 12);
  });

  it('en ET todas las 3as menores son 300 cents', () => {
    for (const t of getMin3(ET)) {
      assert.ok(Math.abs(t.size - 300) < 0.0001, `3a ${t.from}-${t.to} = ${t.size}`);
    }
  });

  it('en ET la desviación de 3a menor pura es ≈ -15.641 cents', () => {
    const expectedDev = 300 - PURE_MIN3;
    for (const t of getMin3(ET)) {
      assert.ok(Math.abs(t.dev - expectedDev) < 0.001, `dev = ${t.dev}`);
    }
  });

  it('primera 3a menor es C → D#', () => {
    const t3 = getMin3(ET);
    assert.equal(t3[0].from, 'C');
    assert.equal(t3[0].to, NOTES[3]); // D#
  });
});

// ─── Helpers para datos de test ───────────────────────────────────────────────

/**
 * Construye los offsets pitagóricos: ciclo de quintas puras (701.955¢) desde A=0.
 * A=0, E=+701.955-1200, B=+2×701.955-1200, F#=+3×701.955-2400, etc.
 * Se normaliza para que A quede en 0.
 */
function buildPythagorean() {
  // Para cada nota, la distancia pitagórica desde A es N × PURE_FIFTH (subiendo)
  // o -N × PURE_FIFTH (bajando). Se elige el múltiplo de 1200 que deja el resultado
  // más cerca de ET_FROM_A[ni], y el offset es esa distancia menos ET_FROM_A[ni].
  //
  // Subiendo: A→E(1)→B(2)→F#(3)→C#(4)→G#(5)→D#(6)
  // Bajando:  A→D(1)→G(2)→C(3)→F(4)→B♭(5)
  // (El lobo queda en D#→B♭, que no se genera con ninguna cadena)
  const etFromA = [-900,-800,-700,-600,-500,-400,-300,-200,-100,0,100,200];
  const off = new Array(12).fill(0);

  const upChain   = [4, 11, 6, 1, 8, 3]; // E, B, F#, C#, G#, D#
  for (let i = 0; i < upChain.length; i++) {
    const ni = upChain[i];
    const raw = (i + 1) * PURE_FIFTH;
    const k = Math.round((raw - etFromA[ni]) / 1200);
    off[ni] = (raw - k * 1200) - etFromA[ni];
  }

  const downChain = [2, 7, 0, 5, 10]; // D, G, C, F, B♭
  for (let i = 0; i < downChain.length; i++) {
    const ni = downChain[i];
    const raw = -(i + 1) * PURE_FIFTH;
    const k = Math.round((raw - etFromA[ni]) / 1200);
    off[ni] = (raw - k * 1200) - etFromA[ni];
  }

  return off;
}

/**
 * Construye offsets de 1/4-coma mesotónica desde A=0.
 * Quinta mesotónica = 696.578 cents → la 3a mayor C-E resulta pura (386.314¢).
 */
function buildQuarterCommaMeantone() {
  const MEANTONE_FIFTH = 696.578;
  const etFromA = [-900,-800,-700,-600,-500,-400,-300,-200,-100,0,100,200];
  const off = new Array(12).fill(0);

  const upChain   = [4, 11, 6, 1, 8, 3];
  for (let i = 0; i < upChain.length; i++) {
    const ni = upChain[i];
    const raw = (i + 1) * MEANTONE_FIFTH;
    const k = Math.round((raw - etFromA[ni]) / 1200);
    off[ni] = (raw - k * 1200) - etFromA[ni];
  }

  const downChain = [2, 7, 0, 5, 10];
  for (let i = 0; i < downChain.length; i++) {
    const ni = downChain[i];
    const raw = -(i + 1) * MEANTONE_FIFTH;
    const k = Math.round((raw - etFromA[ni]) / 1200);
    off[ni] = (raw - k * 1200) - etFromA[ni];
  }

  return off;
}
