// helpers.js — Utilidades compartidas para los tests

/**
 * Genera un buffer de audio con una onda sinusoidal pura.
 * @param {number} freq       - frecuencia en Hz
 * @param {number} sampleRate - frecuencia de muestreo en Hz
 * @param {number} numSamples - número de muestras
 * @param {number} amplitude  - amplitud (defecto 0.5)
 * @returns {Float32Array}
 */
export function makeSine(freq, sampleRate, numSamples, amplitude = 0.5) {
  const buf = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buf[i] = amplitude * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  return buf;
}

/**
 * Mezcla dos señales sinusoidales (útil para probar detección con armónicos).
 * @param {number} freq1
 * @param {number} freq2
 * @param {number} sampleRate
 * @param {number} numSamples
 * @returns {Float32Array}
 */
export function mixSines(freq1, freq2, sampleRate, numSamples) {
  const buf = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    buf[i] = 0.4 * Math.sin(2 * Math.PI * freq1 * i / sampleRate)
           + 0.2 * Math.sin(2 * Math.PI * freq2 * i / sampleRate);
  }
  return buf;
}

/**
 * Convierte frecuencia a cents respecto a una referencia.
 */
export function freqToCents(freq, ref) {
  return 1200 * Math.log2(freq / ref);
}

/**
 * Construye un buffer FFT sintético (dB) con un pico gaussiano en la frecuencia dada.
 * Simula la salida de AnalyserNode.getFloatFrequencyData().
 * @param {number} peakFreq
 * @param {number} sampleRate
 * @param {number} fftSize   - tamaño del FFT (el buffer tiene fftSize/2 bins)
 * @returns {Float32Array}
 */
export function makeFFTBuf(peakFreq, sampleRate, fftSize = 4096) {
  const N = fftSize / 2;
  const binW = sampleRate / fftSize;
  const buf = new Float32Array(N).fill(-100); // suelo de ruido
  const centerBin = Math.round(peakFreq / binW);
  for (let d = -2; d <= 2; d++) {
    const b = centerBin + d;
    if (b >= 0 && b < N) buf[b] = -20 - d * d * 5;
  }
  return buf;
}

/** Array de 12 ceros (ET) como offsets de referencia */
export const ET_OFFSETS = new Array(12).fill(0);
