# Estudio de cobertura de tests — app.js

> Realizado el 2026-04-10. Estado en ese momento: 283 tests (node:test).
> Metodología adoptada: **TDD obligatorio** — test primero, implementación después.

---

## Ya cubierto

- `core.js`: noteFreq, getFifths, getMaj3, getMin3, findClosestNote, _computeHarmonics
- `parser.js`: parseTempMarkdown (incluye fixture real de 1784 temperamentos)
- `pitch.js`: detectPitch
- `thermalCompensation.js`: getCompensatedFreq, getFreqOffsetInCents
- `ruuvi.js`: _isCapacitor, _parseRawV5, _hexToBuffer, _connectCapacitor, _connectWebBluetooth, persistencia localStorage, reconexión automática, autoConnect con backoff
- `electron/main.js`: protocol handler app://, MIME types, CDN→vendor, selector BLE, bifurcación SW
- Integración ruuviScanner → sensor → compensatedPitchA → noteFreq

---

## Tier 1 — Críticas (atacar primero en TDD)

### DT.getSuggestions(n=8) — línea ~6256
- Algoritmo RMSE centrado en media sobre notas medidas
- Centra mediciones (resta media de medidas) y referencia (resta media del temperamento)
- RMSE = sqrt(Σ((measured[i] - mMean - (ref[i] - rMean))^2) / numMeasured)
- Filtra pool por: Favoritos, fuente, "Otros"
- Retorna top N ordenados por distancia
- **Sin tests. Matemática compleja. Riesgo: sugerencias incorrectas.**

### DT.setPitchA(newVal) — línea ~5919
- Validación: parseFloat, > 0
- Shift en cents: 1200 × log2(oldA / newA)
- Reajusta TODAS las notas medidas: notes[ni] = round((notes[ni] + shift) × 10) / 10
- Llama setPitchAGlobal para propagación
- **Sin tests. Transforma todos los datos. Riesgo: offsets corruptos.**

### toggleSelect(idx) — línea ~1991
- Multi-selección: max 3 slots
- Toggle: si ya seleccionado → deseleccionar
- Rotación: si 3 slots llenos → [new, null, null]
- Actualiza lastSelected (fallback para tuner/etc)
- Persiste en prefs (selectedName)
- **Sin tests. Core de selección. Riesgo: selección buggy, lastSelected inconsistente.**

### getEffectivePitchA() + updateCompensatedPitch() — líneas ~445/450
- getEffectivePitchA(): retorna pitchA compensado o sin compensar según flag tempCompEnabled
- updateCompensatedPitch(): recalcula compensatedPitchA = getCompensatedFreq(pitchA, refTemp, currentTemp)
- Propaga a oscilador de referencia del tuner
- **Sin tests directos en app.js (sí en ruuviIntegration.test.js vía makeAppState, pero no la función real).**

### ruuviOnTemperature(tempC) — línea ~933
- Actualiza currentTemp, persiste en prefs
- Recalcula compensación
- **Escalado en tiempo real de osciladores activos**: ratio = newEffective / prevEffective → multiplica frecuencias de todos los oscs activos
- **Sin tests. La parte del escalado de oscs es matemáticamente crítica.**

### DT.save() — línea ~6199
- Validación: name no vacío, measuredCount > 0
- Normalización: resta offset de La (notes[9]) a todos los offsets
- Redondeo a décimas de cent
- addUserTemp → persistencia
- **Sin tests. Riesgo: temperamento guardado sin normalizar (La no queda a 0).**

### TUNER._analyze() — lógica de estabilidad — línea ~5994
- Extrae buffer FFT, calcula RMS
- Si clarity < 0.15 → resetea detección
- Refina frecuencia con _refineFFT
- Filtro EMA: 0.75 × prevFreq + 0.25 × newFreq
- Threshold de salto: si |cents - prevCents| > 80¢ → resetea contador
- Contador progresivo hasta STABLE_FRAMES (18)
- Caso especial: La (ni=9) en modo manual → setea pitchA = detectedFreq
- **Sin tests. Múltiples heurísticas. Riesgo: detección inestable.**

---

## Tier 2 — Altas

### getFilteredList() — línea ~1962
- Búsqueda text: name + source (case-insensitive includes)
- Filtro de fuente: srcFilter vs KNOWN_SRCS
- Filtro de favoritos: showFavsOnly
- Aplicación en cadena (Y lógico)
- Pura con estado inyectable. Fácil de testear.

### setPitchAGlobal(val) — línea ~432
- Validación: parseFloat + rango > 0
- Redondeo a centésimas
- Persiste en prefs
- Actualiza compensación si está activa

### Importación por URL (?t=&o=) — línea ~242
- Validación: offsets.length === 12 && !offsets.some(isNaN)
- Creación de user temp, limpieza de URL, selección post-carga
- Pura si se aísla la validación.

### DT.normalize() — línea ~5932
- Toma frecuencia real de La medida como nueva pitchA
- Fuerza notes[9] = 0
- Llama setPitchAGlobal

### loadUserTemps / saveUserTemps / addUserTemp / deleteUserTemp — líneas ~126-173
- CRUD completo de temperamentos de usuario en localStorage
- addUserTemp: insert-or-update por nombre
- deleteUserTemp: borra, limpia selecciones si la estaba usando
- Testeables con mock de localStorage.

### _tempShareUrl(name, offsets, notes) — línea ~202
- Pura. Codifica ?t=name&o=offsetlist&n=notes
- Fácil, valor inmediato.

### _tempShareText(name, offsets, notes) — línea ~193
- Pura. Formatea para texto plano.

### TUNER.setTarget(ni, oct) — línea ~5147
- Toggle: pulsar misma nota la apaga (refOn)
- Actualiza targetNi, targetOct
- Limpia estado de detección

### loadPrefs / savePrefs — línea ~262
- Puras con mock de localStorage.
- Críticas para toda la persistencia pero muy simples.

---

## Tier 3 — Medias (simples, bajo riesgo)

| Función | Línea | Nota |
|---|---|---|
| `shortName(t, n)` | ~2189 | Pura, trunca a n chars + '…' |
| `selClass(t)` | ~1933 | Pura, retorna 'sel0'/'sel1'/'sel2'/'' |
| `activeSlotMap()` | ~2190 | Pura, índices de slots no-null |
| `toggleFav()` | ~103 | Toggle en Set, persiste |
| `DT._allSources()` | ~6281 | Extrae fuentes únicas con orden MAIN_SRCS |
| `DT.toggleSuggSource(src)` | ~6289 | Toggle complejo: null↔Set |
| `DT.measuredCount()` | ~5907 | Cuenta no-null en notes[12] |
| `DT.getOffsets()` | ~5906 | null→0 en array |
| `DT.reset()` | ~6190 | Reinicia notes a [null×12] |
| `DT.tapKey(ni)` | ~6086 | Toggle nota manual/auto |
| `octShift(d)` | ~1264 | Clamp [-3,3], persiste |
| `TUNER.shiftOct(d)` | ~5175 | Clamp [1,7], persiste |
| `fifthColor(dev)` | ~2058 | Interpolación de color por desviación |
| `maj3DevColor(dev)` | ~2135 | Igual para 3as |
| `fifthDevColor(dev)` | ~2143 | Igual para barras |

---

## Estrategia de mocks

Todas las funciones son testeables sin DOM con estos mocks mínimos:

```javascript
// localStorage simulado
const store = {};
const mockStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// Estado mínimo de app (para funciones que leen variables globales)
function makeAppState({
  pitchA = 440, refTemp = 20, currentTemp = 20,
  tempCompEnabled = true, selected = [null, null, null]
} = {}) { ... }

// Mock de AudioContext (para funciones de audio)
// No necesario para Tier 1/2 salvo playFreqs
```
