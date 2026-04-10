# Arquitectura del proyecto — Salinas

## Visión general

Salinas es una aplicación para explorar y comparar temperamentos musicales históricos y microtonales. Su arquitectura está organizada en capas, con la **base web como núcleo central** del que derivan todas las demás plataformas.

---

## Capas de la arquitectura

### 1. Base web (núcleo) — `docs/`

**Tecnologías:** HTML, CSS, JavaScript vanilla  
**Despliegue:** GitHub Pages → `https://mesjetiu.github.io/temperaments/`  
**Modo:** PWA (Progressive Web App) cuando el navegador lo permite

Es el núcleo del proyecto. **Todo el desarrollo parte de aquí.** Cualquier nueva funcionalidad, mejora o corrección se implementa primero en la base web.

Criterio: *si algo se puede hacer en web, se hace en web.*

### 2. Android (objetivo principal nativo) — `android/`

**Tecnología:** Capacitor (wrapper nativo sobre la base web)  
**Prioridad:** Alta — es el objetivo principal de desarrollo nativo

Sigue la base web al máximo. Solo se adapta o se implementa de forma nativa lo que la web no puede hacer directamente (acceso a hardware, BLE, APIs de sistema, etc.).

### 3. Electron (escritorio) — `electron/`

**Prioridad:** Baja — rama abierta, se mantiene pero no es el foco

Se mantiene al día con los cambios de la base web. No es un objetivo de desarrollo activo.

### 4. iOS (futuro)

No implementado aún. La razón por la que la base web es tan importante: cuando se aborde iOS (probablemente también con Capacitor), el núcleo web ya estará maduro y la adaptación será mínima.

---

## Regla de despliegue

1. **Cualquier cambio se desarrolla primero en la base web.**
2. Se propaga a las plataformas que correspondan.
3. Para la base web, **siempre usar `./deploy.sh "mensaje"`** — nunca commit+push manual (ver `CLAUDE.md`).
4. Para Android, usar `./deploy-android.sh`.

---

## Criterio de decisión: web vs. nativo

| ¿Se puede hacer en web? | Dónde se implementa |
|---|---|
| Sí | Base web (`docs/`) |
| No (hardware, APIs nativas) | Capa nativa de la plataforma correspondiente, manteniendo paridad con web en lo posible |

Ejemplos de lo que se hace en nativo: BLE (RuuviTag), acceso a sensores del dispositivo, integraciones de sistema operativo.

---

## Estructura de ficheros relevante

```
docs/           → Base web (núcleo): HTML, CSS, JS, SW, PWA assets
android/        → Proyecto Android (Capacitor)
electron/       → Proyecto Electron (escritorio)
src/            → Fuentes/scripts de generación de datos
tests/          → Tests (node:test, ~90 tests sobre core.js y parser)
scripts/        → Scripts auxiliares
deploy.sh       → Deploy web (obligatorio, ver CLAUDE.md)
deploy-android.sh → Deploy Android
capacitor.config.json → Configuración Capacitor (Android/iOS)
```

---

## Documentos relacionados

- `CLAUDE.md` — instrucciones de deploy y reglas para Claude Code
- `ARQUITECTURA_WORKSPACE.md` — plan de implementación del sistema de workspace (pestañas y tarjetas dinámicas)
- `VISUALIZACIONES_PENDIENTES.md` — visualizaciones y features pendientes
