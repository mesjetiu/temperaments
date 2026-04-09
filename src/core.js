// core.js — Funciones puras y constantes del motor musical de Salinas.
// Importado por los tests. La app (index.html) mantiene sus propias copias
// hasta que se haga el refactor de módulos.

// ══════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════
export const NOTES     = ['C','C#','D','D#','E','F','F#','G','G#','A','B♭','B'];
export const FIFTH_IDX = [0,7,2,9,4,11,6,1,8,3,10,5];
export const FIFTH_LBL = ['C','G','D','A','E','B','F#','C#','G#','D#','B♭','F'];
export const ET_FROM_A = [-900,-800,-700,-600,-500,-400,-300,-200,-100,0,100,200]; // cents desde A4

export const PURE_FIFTH = 701.955;
export const PURE_MAJ3  = 386.314;
export const PURE_MIN3  = 315.641;

// ══════════════════════════════════════════════
// FRECUENCIAS
// ══════════════════════════════════════════════

/**
 * Frecuencia en Hz de una nota en un temperamento dado.
 * @param {number} noteIdx  - índice de nota 0–11 (C=0 … B=11)
 * @param {number[]|Float32Array} offsets - desviaciones en cents respecto al ET (12 valores)
 * @param {number} pitchA   - frecuencia de La4 en Hz (defecto 440)
 * @param {number} octaveShift - desplazamiento de octava (defecto 0)
 */
export function noteFreq(noteIdx, offsets, pitchA = 440, octaveShift = 0) {
  const cents = ET_FROM_A[noteIdx] + offsets[noteIdx] + octaveShift * 1200;
  return pitchA * Math.pow(2, cents / 1200);
}

// ══════════════════════════════════════════════
// CÁLCULOS MUSICALES
// ══════════════════════════════════════════════

export const getFifths = off => FIFTH_IDX.map((ni, i) => {
  const nj = FIFTH_IDX[(i + 1) % 12], size = 700 + off[nj] - off[ni];
  return { from: FIFTH_LBL[i], to: FIFTH_LBL[(i + 1) % 12], size, dev: size - PURE_FIFTH };
});

export const getMaj3 = off => NOTES.map((n, i) => {
  const j = (i + 4) % 12, size = 400 + off[j] - off[i];
  return { from: n, to: NOTES[j], size, dev: size - PURE_MAJ3 };
});

export const getMin3 = off => NOTES.map((n, i) => {
  const j = (i + 3) % 12, size = 300 + off[j] - off[i];
  return { from: n, to: NOTES[j], size, dev: size - PURE_MIN3 };
});

// ══════════════════════════════════════════════
// COEFICIENTES FOURIER (formas de onda sintéticas)
// ══════════════════════════════════════════════

/**
 * Calcula los coeficientes reales e imaginarios para una onda periódica
 * de N armónicos del tipo dado.
 * @param {'sawtooth'|'square'|'triangle'} type
 * @param {number} N - número de armónicos (potencia de 2)
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function _computeHarmonics(type, N) {
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  if (type === 'sawtooth') {
    for (let n = 1; n <= N; n++) imag[n] = (n % 2 === 0 ? -1 : 1) / Math.pow(n, 1.6);
  } else if (type === 'square') {
    for (let n = 1; n <= N; n += 2) imag[n] = 1 / n;
  } else if (type === 'triangle') {
    for (let n = 1; n <= N; n += 2) imag[n] = (((n - 1) / 2) % 2 === 0 ? 1 : -1) / (n * n);
  }
  return { real, imag };
}

// ══════════════════════════════════════════════
// DETECCIÓN DE TONO (McLeod Pitch Method)
// ══════════════════════════════════════════════

/**
 * Detecta la frecuencia fundamental de una señal de audio usando MPM.
 * @param {Float32Array} buf - buffer de muestras de audio
 * @param {number} sampleRate - frecuencia de muestreo en Hz
 * @returns {{ freq: number, clarity: number, rms: number } | null}
 */
export function detectPitch(buf, sampleRate) {
  const W = Math.min(2048, buf.length >> 1);

  // RMS
  let rms = 0;
  for (let i = 0; i < W; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / W);
  if (rms < 0.0001) return null;

  const maxTau = Math.min(W - 1, Math.floor(sampleRate / 50));

  // Paso 1: autocorrelación directa r'(tau) para tau = 0..maxTau
  // Paso 2: NSDF = 2·r'(tau) / m'(tau) con m' incremental (ec. 6 y 9 del paper)
  // m'(0) = 2·r'(0); m'(tau) = m'(tau-1) - x[tau-1]² - x[W-tau]²
  const nsdf = new Float32Array(maxTau + 1);
  let r0 = 0;
  for (let j = 0; j < W; j++) r0 += buf[j] * buf[j];
  let m = 2 * r0;

  for (let tau = 0; tau <= maxTau; tau++) {
    if (tau > 0) m -= buf[tau - 1] * buf[tau - 1] + buf[W - tau] * buf[W - tau];
    if (m <= 0) { nsdf[tau] = 0; continue; }
    let r = 0;
    for (let j = 0; j < W - tau; j++) r += buf[j] * buf[j + tau];
    nsdf[tau] = 2 * r / m;
  }

  // Peak picking: key maximums entre cruces por cero (exacto al paper)
  const MPM_K = 0.85;
  const minTau = Math.max(2, Math.ceil(sampleRate / 4096)); // hasta C8
  let lookingForMax = false, maxIdx = -1, maxVal = -Infinity;
  let globalBestVal = -Infinity;
  const keys = [];
  for (let i = minTau; i <= maxTau; i++) {
    if (nsdf[i - 1] <= 0 && nsdf[i] > 0) {
      lookingForMax = true; maxIdx = i; maxVal = nsdf[i];
    } else if (nsdf[i - 1] > 0 && nsdf[i] <= 0) {
      if (lookingForMax && maxIdx >= 0) {
        keys.push(maxIdx);
        if (maxVal > globalBestVal) globalBestVal = maxVal;
      }
      lookingForMax = false;
    } else if (lookingForMax && nsdf[i] > maxVal) {
      maxVal = nsdf[i]; maxIdx = i;
    }
  }
  if (lookingForMax && maxIdx >= 0) {
    keys.push(maxIdx);
    if (maxVal > globalBestVal) globalBestVal = maxVal;
  }

  if (!keys.length) return null;

  // Primer key maximum ≥ K × máximo global
  const thresh = MPM_K * globalBestVal;
  let bestIdx = keys[keys.length - 1];
  for (let i = 0; i < keys.length; i++) {
    if (nsdf[keys[i]] >= thresh) { bestIdx = keys[i]; break; }
  }

  // Interpolación parabólica (sección 5 del paper)
  let clarity = nsdf[bestIdx];
  let refinedTau = bestIdx;
  if (bestIdx > 0 && bestIdx < maxTau) {
    const y0 = nsdf[bestIdx - 1], y1 = nsdf[bestIdx], y2 = nsdf[bestIdx + 1];
    const a = y0 / 2 - y1 + y2 / 2;
    if (Math.abs(a) > 1e-12) {
      const shift = (y0 - y2) / (4 * a);
      refinedTau = bestIdx + shift;
      clarity = Math.min(y1 - a * shift * shift, 1);
    }
  }

  return { freq: sampleRate / refinedTau, clarity, rms };
}

// ══════════════════════════════════════════════
// REFINAMIENTO FFT
// ══════════════════════════════════════════════

/**
 * Refina una frecuencia aproximada usando interpolación parabólica sobre
 * el espectro FFT (dB) de un AnalyserNode.
 * @param {number} approxFreq - frecuencia aproximada en Hz (del MPM)
 * @param {Float32Array} freqBuf - datos de frecuencia en dB (getFloatFrequencyData)
 * @param {number} sampleRate
 * @returns {number} frecuencia refinada en Hz
 */
export function _refineFFT(approxFreq, freqBuf, sampleRate) {
  const N = freqBuf.length;
  const binW = sampleRate / (N * 2);
  const center = Math.round(approxFreq / binW);
  const lo = Math.max(1, center - 3), hi = Math.min(N - 2, center + 3);
  let pk = lo;
  for (let b = lo; b <= hi; b++) if (freqBuf[b] > freqBuf[pk]) pk = b;
  if (pk < 1 || pk >= N - 1) return approxFreq;
  const l = freqBuf[pk - 1], m = freqBuf[pk], r = freqBuf[pk + 1];
  const d = 2 * (l + r - 2 * m);
  if (Math.abs(d) < 1e-8) return approxFreq;
  const refined = (pk + (l - r) / d) * binW;
  // Sanity: si el refinamiento se aleja > 1 semitono de MPM, ignorarlo
  return Math.abs(1200 * Math.log2(refined / approxFreq)) < 100 ? refined : approxFreq;
}

// ══════════════════════════════════════════════
// NOTA MÁS CERCANA
// ══════════════════════════════════════════════

/**
 * Encuentra la nota (índice + octava) más cercana a una frecuencia dada.
 * @param {number} freq - frecuencia en Hz
 * @param {number} pitchA - frecuencia de La4 (defecto 440)
 * @param {number[]|Float32Array} offsets - desviaciones del temperamento activo (defecto ET)
 * @returns {{ ni: number, oct: number }}
 */
export function findClosestNote(freq, pitchA = 440, offsets = new Array(12).fill(0)) {
  const centsFromA4 = 1200 * Math.log2(freq / pitchA);
  let bestNi = 9, bestOct = 4, bestDiff = Infinity;
  for (let oct = 0; oct <= 8; oct++) {
    for (let ni = 0; ni < 12; ni++) {
      const diff = Math.abs(centsFromA4 - (ET_FROM_A[ni] + offsets[ni] + (oct - 4) * 1200));
      if (diff < bestDiff) { bestDiff = diff; bestNi = ni; bestOct = oct; }
    }
  }
  return { ni: bestNi, oct: bestOct };
}

// ══════════════════════════════════════════════
// PARSER DE TEMPERAMENTOS (parte pura)
// ══════════════════════════════════════════════

/**
 * Parsea el contenido Markdown de temperaments.md y devuelve un array de temperamentos.
 * Sin efectos secundarios (no muta estado global, no accede a localStorage ni al DOM).
 * @param {string} text - contenido completo del fichero temperaments.md
 * @returns {{ source: string, name: string, offsets: number[] }[]}
 */
export function parseTempMarkdown(text) {
  const temps = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 15 || !cells[2] || cells[2] === 'Name' || cells[3].startsWith('--')) continue;
    const offsets = []; let ok = true;
    for (let i = 3; i <= 14; i++) {
      const v = parseFloat(cells[i]);
      if (isNaN(v)) { ok = false; break; }
      offsets.push(v);
    }
    if (!ok || offsets.length !== 12) continue;
    const m = cells[1].match(/\[([^\]]+)\]/);
    temps.push({ source: (m ? m[1] : cells[1]).trim(), name: cells[2], offsets });
  }
  return temps;
}

// ══════════════════════════════════════════════
// COMPENSACIÓN TÉRMICA (órgano)
// ══════════════════════════════════════════════

/**
 * Compensa la frecuencia de referencia según la temperatura.
 *
 * En un tubo de órgano la frecuencia es proporcional a la velocidad del sonido
 * en el aire: v(T) = 331.3 × √(1 + T/273.15).
 * Por tanto:  f(T) = f_ref × √((273.15 + T_actual) / (273.15 + T_ref))
 *
 * Ejemplo: 440 Hz a 20 °C → a 30 °C ≈ 447.5 Hz (+29.3 ¢).
 *
 * @param {number} refFreq      - frecuencia de referencia (La4 objetivo) en Hz
 * @param {number} refTemp      - temperatura de referencia en °C
 * @param {number} currentTemp  - temperatura actual en °C
 * @returns {number} frecuencia compensada en Hz
 */
export function getCompensatedFreq(refFreq, refTemp = 20, currentTemp = 20) {
  return refFreq * Math.sqrt((273.15 + currentTemp) / (273.15 + refTemp));
}

/**
 * Calcula la diferencia en cents entre dos frecuencias.
 * @param {number} freq1 - primera frecuencia en Hz
 * @param {number} freq2 - segunda frecuencia en Hz
 * @returns {number} diferencia en cents (positivo si freq1 > freq2)
 */
export function getFreqOffsetInCents(freq1, freq2) {
  if (!freq1 || !freq2 || freq1 <= 0 || freq2 <= 0) return 0;
  return 1200 * Math.log2(freq1 / freq2);
}

// Exponer al scope global cuando se carga como módulo en el browser,
// para que los scripts clásicos (app.js) puedan usar estas funciones.
if (typeof window !== 'undefined') {
  Object.assign(window, {
    NOTES, FIFTH_IDX, FIFTH_LBL, ET_FROM_A,
    PURE_FIFTH, PURE_MAJ3, PURE_MIN3,
    noteFreq, getFifths, getMaj3, getMin3,
    detectPitch, _refineFFT, findClosestNote,
    parseTempMarkdown, _computeHarmonics,
    getCompensatedFreq, getFreqOffsetInCents,
  });
}
