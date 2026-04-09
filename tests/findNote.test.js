// findNote.test.js — Tests de findClosestNote

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findClosestNote } from '../src/core.js';
import { ET_OFFSETS } from './helpers.js';

describe('findClosestNote', () => {
  it('440 Hz → A4 (ni=9, oct=4)', () => {
    const { ni, oct } = findClosestNote(440, 440, ET_OFFSETS);
    assert.equal(ni, 9);
    assert.equal(oct, 4);
  });

  it('880 Hz → A5 (ni=9, oct=5)', () => {
    const { ni, oct } = findClosestNote(880, 440, ET_OFFSETS);
    assert.equal(ni, 9);
    assert.equal(oct, 5);
  });

  it('220 Hz → A3 (ni=9, oct=3)', () => {
    const { ni, oct } = findClosestNote(220, 440, ET_OFFSETS);
    assert.equal(ni, 9);
    assert.equal(oct, 3);
  });

  it('261.63 Hz → C4 (ni=0, oct=4)', () => {
    const { ni, oct } = findClosestNote(261.63, 440, ET_OFFSETS);
    assert.equal(ni, 0);
    assert.equal(oct, 4);
  });

  it('293.66 Hz → D4 (ni=2, oct=4)', () => {
    const { ni, oct } = findClosestNote(293.66, 440, ET_OFFSETS);
    assert.equal(ni, 2);
    assert.equal(oct, 4);
  });

  it('32.7 Hz → C1 (ni=0, oct=1)', () => {
    const { ni, oct } = findClosestNote(32.7, 440, ET_OFFSETS);
    assert.equal(ni, 0);
    assert.equal(oct, 1);
  });

  it('4186 Hz → C8 (ni=0, oct=8)', () => {
    const { ni, oct } = findClosestNote(4186, 440, ET_OFFSETS);
    assert.equal(ni, 0);
    assert.equal(oct, 8);
  });

  it('432 Hz con pitchA=432 → A4', () => {
    const { ni, oct } = findClosestNote(432, 432, ET_OFFSETS);
    assert.equal(ni, 9);
    assert.equal(oct, 4);
  });

  it('devuelve ni en rango [0, 11]', () => {
    for (const freq of [100, 200, 440, 880, 1760]) {
      const { ni } = findClosestNote(freq, 440, ET_OFFSETS);
      assert.ok(ni >= 0 && ni <= 11, `ni=${ni} fuera de rango para freq=${freq}`);
    }
  });

  it('devuelve oct en rango [0, 8]', () => {
    for (const freq of [27.5, 440, 4186]) {
      const { oct } = findClosestNote(freq, 440, ET_OFFSETS);
      assert.ok(oct >= 0 && oct <= 8, `oct=${oct} fuera de rango para freq=${freq}`);
    }
  });

  it('exactamente a 50¢ entre notas: devuelve un resultado determinista', () => {
    // 440 × 2^(50/1200) = punto medio entre A y B♭
    const freq = 440 * Math.pow(2, 50 / 1200);
    const r1 = findClosestNote(freq, 440, ET_OFFSETS);
    const r2 = findClosestNote(freq, 440, ET_OFFSETS);
    assert.equal(r1.ni, r2.ni);
    assert.equal(r1.oct, r2.oct);
  });
});
