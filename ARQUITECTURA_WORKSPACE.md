# Arquitectura Workspace — Salinas

## Objetivo

Pasar de 15 pestañas fijas a un canvas personalizable:
- Pestañas dinámicas: añadir, renombrar, eliminar
- Tarjetas de quita y pon: cualquier vista en cualquier pestaña, instancias múltiples, duplicar, mover entre pestañas
- Guardar/cargar configuraciones de workspace con nombre
- **Impacto de código mínimo**: los `viewXXX()` no se tocan

---

## Elementos fuera del sistema de tarjetas

Dos herramientas no tienen sentido como tarjetas (no son visualizaciones del temperamento, no tiene sentido duplicarlas):

- **Afinador** — ya funciona aparte como overlay
- **Medidor** — sale de la lista de tarjetas

**Se fusionan en un único botón flotante** (renombrar de "Afinar" a algo más neutro, ej. "Escuchar / Medir" o simplemente un icono). Al pulsarlo, aparece un mini-menú para elegir:
- → Afinador (strobe tuner con micrófono)
- → Medidor (comparador de frecuencias con sugerencias)

Esto reusa el patrón ya existente del botón flotante de Afinador.

---

## Modelo de datos

### `localStorage` key: `'workspace'`

```js
{
  version: 1,
  activeTabId: "tab-abc",
  tabs: [
    {
      id: "tab-abc",           // ID estable (Date.now().toString(36))
      label: "Vista general",
      cards: [
        { id: "card-xyz", type: "overview" },
        { id: "card-uvw", type: "fifths" },
        { id: "card-qrs", type: "compare" }
      ]
    },
    {
      id: "tab-def",
      label: "Mi análisis",
      cards: [
        { id: "card-aaa", type: "thirds" }
      ]
    }
  ]
}
```

### `localStorage` key: `'savedWorkspaces'`

```js
[
  { name: "Vista rápida", data: { ...snapshot de workspace } },
  { name: "Análisis completo", data: { ...snapshot } }
]
```

### Tipos de tarjeta disponibles (`type`)

Los mismos strings ya existentes en el dispatch de `renderContent()`:

| type | Etiqueta | Requiere selección |
|---|---|---|
| `overview` | Vista general | sí |
| `fifths` | Quintas | sí |
| `thirds` | Terceras | sí |
| `compare` | Comparar | sí |
| `intervals` | Intervalos | sí |
| `beats` | Batidos | sí |
| `consonance` | Consonancia | sí |
| `histogram` | Histograma | sí |
| `lattice` | Lattice | sí |
| `triads` | Tríadas | sí |
| `tonnetz` | Tonnetz | sí |
| `scatter` | Mapa global | no |
| `keyboard` | Teclado | no |

**Excluidos de tarjetas:** `medidor`, `tuner` (van al botón flotante unificado)

---

## Workspace por defecto (al migrar desde versión anterior)

Una pestaña "Vista general" con 4 tarjetas:
1. `overview`
2. `fifths`
3. `thirds`
4. `compare`

---

## Truco de implementación: redirigir `getElementById`

Todos los `viewXXX()` escriben en `document.getElementById('content').innerHTML`. En lugar de refactorizarlos, se hace un monkey-patch síncrono que redirige ese ID a un wrapper por tarjeta:

```js
const origGet = document.getElementById.bind(document);
document.getElementById = id => id === 'content' ? cardWrap : origGet(id);
VIEW_MAP[card.type]?.(act);   // escribe en cardWrap sin saberlo
document.getElementById = origGet;
```

Seguro: las view functions son síncronas, la restauración es inmediata.
El `cardWrap` usa `display: contents` para que los paneles fluyan en el flex grid existente.

---

## Nuevo archivo: `docs/workspace.js` (~400 líneas)

Objeto global `WS` expuesto en `window.WS`:

### Estado y persistencia
- `WS.current()` — lee localStorage, devuelve workspace actual
- `WS.save(ws)` — escribe en localStorage, llama `renderTabBar()` + `renderContent()`
- `WS.migrateFromLegacy(activeTab)` — crea workspace por defecto si no existe, usando `prefs.activeTab`
- `WS.init()` — llamado tras `restoreSession()`, inicializa y renderiza

### Gestión de pestañas
- `WS.switchTab(id)` — activa pestaña, re-renderiza
- `WS.switchTabRelative(±1)` — navegar entre pestañas (reusa el swipe)
- `WS.addTab()` — nueva pestaña vacía "Sin título"
- `WS.deleteTab(id)` — elimina (mínimo 1 pestaña siempre)
- `WS.renameTab(id, label)` — renombra

### Gestión de tarjetas
- `WS.addCard(type)` — añade tarjeta al final de la pestaña activa
- `WS.removeCard(cardId)` — elimina tarjeta
- `WS.duplicateCard(cardId)` — clona con nuevo ID
- `WS.moveCardToTab(cardId, tabId)` — mueve entre pestañas

### Render
- `WS.renderTabBar()` — genera HTML para `#tabs`
- `WS.makeCardToolbar(card)` — toolbar por tarjeta (✕ ⧉ ⇒)
- `WS.onResize()` — hook para resize

### Menús y popovers
- `WS.openAddCardMenu(event)` — lista de tipos para añadir
- `WS.openMoveCardMenu(cardId, event)` — lista de pestañas destino
- `WS.openWorkspaceMenu(event)` — guardar / cargar / restablecer

### Constantes
- `CARD_REGISTRY` — mapa type → `{ label, icon, needsSelection }`
- `DEFAULT_WORKSPACE` — workspace de arranque

---

## Cambios en `app.js` (~50 líneas netas)

| Zona | Cambio |
|---|---|
| `renderContent()` líneas 1730–1739 | Reemplazar por versión card-aware (~30 líneas): itera cards, monkey-patch, llama view, inyecta toolbar |
| Tab click listener líneas 1448–1468 | Reemplazar por delegación a `WS.switchTab(tabId)` |
| Swipe gesture líneas 1473–1491 | Cambiar dispatch final a `WS.switchTabRelative(±1)` |
| `restoreSession()` | +3 líneas: `WS.migrateFromLegacy(p.activeTab)` + `WS.init()` |
| `_onResize()` | +1 línea: `WS.onResize()` |
| Botón flotante Afinador | Convertir en botón dual con mini-menú Afinador / Medidor |

---

## Cambios en `index.html`

- Reemplazar los 15 `<div class="tab" data-tab="...">` por `<div id="tabs"></div>` vacío
- Añadir `<script defer src="./workspace.js"></script>` antes de `app.js`
- Añadir `<div id="add-card-btn">＋ Añadir tarjeta</div>` al final de `#content` (o como botón sticky)
- CSS nuevo:
  - `.card-toolbar` — toolbar flotante por tarjeta (hover desktop / siempre mobile)
  - `.tab-close-btn`, `.tab-add-btn`
  - `.ws-popover` — popovers de menús (patrón del `.temp-ctx-menu` existente)

---

## UI de gestión

### Barra de pestañas
```
[Vista general ×] [Análisis ×] [＋]  ·····  [⋮]
```
- Doble-click en label → `<input>` in-place, Enter confirma
- `×` solo si hay >1 pestaña
- `＋` añade pestaña nueva
- `⋮` abre menú workspace (guardar / cargar / restablecer)

### Toolbar de tarjeta (aparece en hover)
```
[✕ Quitar]  [⧉ Duplicar]  [⇒ Mover a...]
```

### Botón flotante unificado (reemplaza el de "Afinar")
```
[🎤]  → click → mini-menú:
          ├ Afinador
          └ Medidor
```

---

## Lo que NO cambia

- `core.js` — intacto
- Todas las funciones `viewXXX()` — intactas (ninguna línea)
- `panel()`, helpers de charts, audio, `KB`, `DT` — intactos
- Tests — no se tocan (solo core.js y parser)
- Claves existentes de localStorage: `prefs`, `tempFavs`, `userTemps`, `tempNotes`
- Service worker, deploy.sh, PWA

---

## Migración desde versión anterior

Al abrir la app por primera vez tras el update:
1. `WS.migrateFromLegacy(prefs.activeTab)` detecta ausencia de `'workspace'` en localStorage
2. Crea workspace por defecto (4 tarjetas en una pestaña)
3. El usuario ve exactamente lo que veía antes, pero ahora configurable
4. No se pierde ningún dato existente

---

## Verificación

1. `npm test` — todos los tests pasan (nada de core/parser cambia)
2. Primera carga tras update: migración automática, 1 pestaña con 4 tarjetas
3. Añadir tarjeta → aparece en pestaña activa
4. Duplicar → segunda instancia independiente y funcional
5. Mover tarjeta → desaparece de origen, aparece en destino
6. Renombrar pestaña (doble-click) → persiste tras reload
7. Añadir/eliminar pestañas → nunca <1 pestaña
8. Guardar config con nombre → reload → cargar → estado exacto restaurado
9. Afinador y Medidor funcionan desde el botón flotante unificado
10. Audio, keyboard: funcionan igual en sus tarjetas
11. Mobile: drag-bar y colapso por tarjeta siguen funcionando

---

## Archivos a tocar

| Archivo | Tipo de cambio |
|---|---|
| `docs/workspace.js` | **Nuevo** (~400 líneas) |
| `docs/app.js` | Modificar ~50 líneas en 5 zonas |
| `docs/index.html` | Modificar ~20 líneas (HTML + CSS) |
| `docs/core.js` | No se toca |
| `tests/*` | No se tocan |
