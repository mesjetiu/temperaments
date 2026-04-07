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

/**
 * Añade ruido blanco determinista (LCG) a una señal.
 * El seed fijo garantiza reproducibilidad entre ejecuciones.
 * @param {Float32Array} signal
 * @param {number} noiseAmplitude
 * @param {number} seed
 * @returns {Float32Array}
 */
export function addNoise(signal, noiseAmplitude, seed = 12345) {
  const buf = new Float32Array(signal.length);
  let s = seed >>> 0;
  for (let i = 0; i < signal.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    buf[i] = signal[i] + noiseAmplitude * (s / 0x80000000 - 1);
  }
  return buf;
}

/**
 * Genera un tono complejo con armónicos decrecientes (más realista que una sinusoide).
 * Simula un instrumento de cuerda/viento con espectro rico.
 * @param {number} freq       - frecuencia fundamental en Hz
 * @param {number} sampleRate
 * @param {number} numSamples
 * @param {number} amplitude
 * @returns {Float32Array}
 */
export function makeRichTone(freq, sampleRate, numSamples, amplitude = 0.5) {
  const weights = [1, 0.6, 0.3, 0.15, 0.08]; // armónicos con caída natural
  const total = weights.reduce((a, b) => a + b, 0);
  const buf = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    let s = 0;
    for (let h = 0; h < weights.length; h++) {
      const f = freq * (h + 1);
      if (f < sampleRate / 2) s += weights[h] * Math.sin(2 * Math.PI * f * i / sampleRate);
    }
    buf[i] = s * amplitude / total;
  }
  return buf;
}
