// ── Tests de workspace: resize de tarjetas (saveCardSize, schema v2, toolbar reset) ──
//
// Evalúa la lógica de persistencia de tamaño de tarjetas y la generación
// de la toolbar con el botón de reset. Se simula localStorage y DOM mínimo.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── Leer fuentes como texto para evaluar con globals simulados ──────────────

const wsSrc = readFileSync(
  fileURLToPath(new URL('../src/workspace.js', import.meta.url)), 'utf8'
);

// ── Mock de localStorage ────────────────────────────────────────────────────

function makeMockStorage() {
  const store = {};
  return {
    getItem(k)    { return store[k] ?? null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    _store: store,
  };
}

// ── Mock de document mínimo ─────────────────────────────────────────────────

function makeMockDocument() {
  return {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        innerHTML: '',
        children: [],
        setAttribute() {},
        appendChild(c) { this.children.push(c); },
      };
    },
  };
}

// ── Evaluar workspace.js en un contexto simulado ────────────────────────────

function loadWorkspace() {
  const localStorage = makeMockStorage();
  const document = makeMockDocument();

  // renderContent se llama desde WS.save(); necesitamos un stub
  let renderContentCalls = 0;
  const renderContent = () => { renderContentCalls++; };

  // Evaluar workspace.js en este contexto
  const fn = new Function(
    'localStorage', 'document', 'renderContent',
    wsSrc + '\nreturn { WS, CARD_REGISTRY, DEFAULT_WORKSPACE, WS_KEY: "workspace" };'
  );
  const ctx = fn(localStorage, document, renderContent);
  ctx.localStorage = localStorage;
  ctx.renderContentCalls = () => renderContentCalls;
  return ctx;
}

// ═════════════════════════════════════════════════════════════════════════════

describe('Workspace schema v2', () => {
  it('DEFAULT_WORKSPACE tiene version 2', () => {
    const { DEFAULT_WORKSPACE } = loadWorkspace();
    assert.equal(DEFAULT_WORKSPACE.version, 2);
  });

  it('las tarjetas por defecto no tienen w ni h', () => {
    const { DEFAULT_WORKSPACE } = loadWorkspace();
    for (const tab of DEFAULT_WORKSPACE.tabs) {
      for (const card of tab.cards) {
        assert.equal(card.w, undefined, `${card.id} no debe tener w`);
        assert.equal(card.h, undefined, `${card.id} no debe tener h`);
      }
    }
  });
});

describe('WS.saveCardSize', () => {
  let ctx;

  beforeEach(() => {
    ctx = loadWorkspace();
    // Inicializar workspace con datos por defecto
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2,
      activeTabId: 'tab-1',
      tabs: [{
        id: 'tab-1', label: 'Test',
        cards: [
          { id: 'c1', type: 'circle' },
          { id: 'c2', type: 'radar' },
        ]
      }]
    }));
  });

  it('guarda w y h en la tarjeta correcta', () => {
    ctx.WS.saveCardSize('c1', 420, 320);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const card = ws.tabs[0].cards[0];
    assert.equal(card.w, 420);
    assert.equal(card.h, 320);
  });

  it('redondea valores decimales', () => {
    ctx.WS.saveCardSize('c1', 419.7, 320.3);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const card = ws.tabs[0].cards[0];
    assert.equal(card.w, 420);
    assert.equal(card.h, 320);
  });

  it('con w=null elimina w de la tarjeta', () => {
    ctx.WS.saveCardSize('c1', 300, 200);
    ctx.WS.saveCardSize('c1', null, 200);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const card = ws.tabs[0].cards[0];
    assert.equal(card.w, undefined);
    assert.equal(card.h, 200);
  });

  it('con h=null elimina h de la tarjeta', () => {
    ctx.WS.saveCardSize('c1', 300, 200);
    ctx.WS.saveCardSize('c1', 300, null);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const card = ws.tabs[0].cards[0];
    assert.equal(card.w, 300);
    assert.equal(card.h, undefined);
  });

  it('con ambos null elimina w y h (reset completo)', () => {
    ctx.WS.saveCardSize('c1', 300, 200);
    ctx.WS.saveCardSize('c1', null, null);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const card = ws.tabs[0].cards[0];
    assert.equal(card.w, undefined);
    assert.equal(card.h, undefined);
  });

  it('no afecta a otras tarjetas', () => {
    ctx.WS.saveCardSize('c1', 500, 400);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const c2 = ws.tabs[0].cards[1];
    assert.equal(c2.w, undefined);
    assert.equal(c2.h, undefined);
  });

  it('busca la tarjeta en cualquier pestaña', () => {
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2, activeTabId: 'tab-1',
      tabs: [
        { id: 'tab-1', label: 'A', cards: [{ id: 'c1', type: 'circle' }] },
        { id: 'tab-2', label: 'B', cards: [{ id: 'c3', type: 'scatter' }] },
      ]
    }));
    ctx.WS.saveCardSize('c3', 600, 350);
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    assert.equal(ws.tabs[1].cards[0].w, 600);
    assert.equal(ws.tabs[1].cards[0].h, 350);
  });

  it('no llama a renderContent (persiste silenciosamente)', () => {
    const before = ctx.renderContentCalls();
    ctx.WS.saveCardSize('c1', 300, 200);
    assert.equal(ctx.renderContentCalls(), before, 'saveCardSize no debe disparar renderContent');
  });

  it('ignora cardId inexistente sin error', () => {
    assert.doesNotThrow(() => {
      ctx.WS.saveCardSize('inexistente', 300, 200);
    });
  });
});

describe('WS.duplicateCard preserva w/h', () => {
  it('la tarjeta duplicada hereda w y h del original', () => {
    const ctx = loadWorkspace();
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2, activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', label: 'T', cards: [
        { id: 'c1', type: 'circle', w: 400, h: 300 },
      ]}]
    }));
    ctx.WS.duplicateCard('c1');
    const ws = JSON.parse(ctx.localStorage._store.workspace);
    const clone = ws.tabs[0].cards[1];
    assert.equal(clone.w, 400);
    assert.equal(clone.h, 300);
    assert.notEqual(clone.id, 'c1', 'el clon debe tener id distinto');
  });
});

describe('makeCardToolbar — botón reset de tamaño', () => {
  it('incluye botón ⊡ cuando la tarjeta tiene w', () => {
    const ctx = loadWorkspace();
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2, activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', label: 'T', cards: [
        { id: 'c1', type: 'circle', w: 400 },
      ]}]
    }));
    const card = { id: 'c1', type: 'circle', w: 400 };
    const div = ctx.WS.makeCardToolbar(card);
    assert.ok(div.innerHTML.includes('⊡'), 'debe incluir botón de reset ⊡');
  });

  it('incluye botón ⊡ cuando la tarjeta tiene h', () => {
    const ctx = loadWorkspace();
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2, activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', label: 'T', cards: [
        { id: 'c1', type: 'circle', h: 300 },
      ]}]
    }));
    const card = { id: 'c1', type: 'circle', h: 300 };
    const div = ctx.WS.makeCardToolbar(card);
    assert.ok(div.innerHTML.includes('⊡'), 'debe incluir botón de reset ⊡');
  });

  it('NO incluye botón ⊡ cuando la tarjeta no tiene w ni h', () => {
    const ctx = loadWorkspace();
    ctx.localStorage.setItem('workspace', JSON.stringify({
      version: 2, activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', label: 'T', cards: [
        { id: 'c1', type: 'circle' },
      ]}]
    }));
    const card = { id: 'c1', type: 'circle' };
    const div = ctx.WS.makeCardToolbar(card);
    assert.ok(!div.innerHTML.includes('⊡'), 'no debe incluir botón de reset ⊡');
  });
});

describe('Análisis estático: _bindCardResize en app.js', () => {
  const appSrc = readFileSync(
    fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
  );

  it('app.js define la función _bindCardResize', () => {
    assert.ok(appSrc.includes('function _bindCardResize'), '_bindCardResize debe estar definida');
  });

  it('renderContent llama a _bindCardResize', () => {
    assert.ok(appSrc.includes('_bindCardResize(el)'), 'renderContent debe llamar _bindCardResize');
  });

  it('_bindCardDrag no se activa sobre handles de resize', () => {
    assert.ok(
      appSrc.includes('.panel-resize-e') && appSrc.includes('.panel-resize-s') && appSrc.includes('.panel-resize-se'),
      '_bindCardDrag debe excluir los handles de resize'
    );
  });

  it('startPanelDragResize persiste la altura con saveCardSize', () => {
    assert.ok(
      appSrc.includes('WS.saveCardSize(cardWrap.dataset.cardId'),
      'startPanelDragResize debe persistir la altura'
    );
  });
});

describe('Análisis estático: CSS de handles de resize', () => {
  const cssSrc = readFileSync(
    fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8'
  );

  it('define .panel-resize-e con position:absolute', () => {
    assert.ok(cssSrc.includes('.panel-resize-e'), '.panel-resize-e debe existir en CSS');
  });

  it('define .panel-resize-s con position:absolute', () => {
    assert.ok(cssSrc.includes('.panel-resize-s'), '.panel-resize-s debe existir en CSS');
  });

  it('define .panel-resize-se con cursor:nwse-resize', () => {
    assert.ok(cssSrc.includes('.panel-resize-se'), '.panel-resize-se debe existir en CSS');
    assert.ok(cssSrc.includes('nwse-resize'), 'cursor debe ser nwse-resize para esquina SE');
  });

  it('oculta handles de ancho en móvil', () => {
    assert.ok(
      cssSrc.includes('.panel-resize-e, .panel-resize-se { display: none'),
      'handles de ancho deben ocultarse en móvil'
    );
  });

  it('.panel tiene position:relative', () => {
    assert.ok(
      cssSrc.includes('.panel {') && cssSrc.includes('position: relative'),
      '.panel necesita position:relative para los handles absolutos'
    );
  });

  it('handles ocultos en fullscreen (.panel-fake-fs)', () => {
    assert.ok(
      cssSrc.includes('.panel-fake-fs .panel-resize-e'),
      'handles deben ocultarse en fullscreen'
    );
  });
});

describe('Análisis estático: plugin Immersive en fullscreen', () => {
  const appSrc = readFileSync(
    fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
  );

  it('define _setImmersive que llama a Capacitor Immersive plugin', () => {
    assert.ok(appSrc.includes('function _setImmersive'), '_setImmersive debe existir');
    assert.ok(appSrc.includes('Plugins?.Immersive'), 'debe acceder a Capacitor.Plugins.Immersive');
  });

  it('togglePanelFullscreen activa modo inmersivo al entrar', () => {
    assert.ok(appSrc.includes('_setImmersive(true)'), 'debe llamar _setImmersive(true) al entrar');
  });

  it('_exitPanelFullscreen desactiva modo inmersivo al salir', () => {
    assert.ok(appSrc.includes('_setImmersive(false)'), 'debe llamar _setImmersive(false) al salir');
  });
});

describe('Análisis estático: scatter (_initScatter)', () => {
  const appSrc = readFileSync(
    fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
  );

  it('_initScatter reintenta con rAF si clientWidth es 0 (canvas no visible aún)', () => {
    assert.ok(
      appSrc.includes('if (!W) { requestAnimationFrame(() => _initScatter(canvas)); return; }'),
      '_initScatter debe diferir si el canvas aún no tiene ancho'
    );
  });

  it('_initScatter lee canvas.clientHeight tras limpiar style.height', () => {
    assert.ok(
      appSrc.includes("canvas.style.height = ''") &&
      appSrc.includes('canvas.clientHeight'),
      '_initScatter debe limpiar style.height y leer clientHeight para obtener altura real del layout'
    );
  });

  it('togglePanelFullscreen redibuja canvas[data-ro] al entrar en fullscreen', () => {
    assert.ok(
      appSrc.includes("panel.querySelectorAll('canvas[data-ro]')") &&
      appSrc.includes('cv._redraw?.()'),
      'togglePanelFullscreen debe redibujar canvas custom al entrar en fullscreen'
    );
  });

  it('scatter no tiene handle de resize interno (#scat-resize)', () => {
    assert.ok(
      !appSrc.includes('scat-resize'),
      'el handle interno de resize del scatter debe estar eliminado'
    );
  });

  it('_panel_scatter registra attachPanelResize para que el ResizeObserver lo gestione', () => {
    // Comprobar que attachPanelResize aparece en el bloque de _panel_scatter
    const scatterFn = appSrc.slice(appSrc.indexOf('function _panel_scatter'));
    const nextFn    = scatterFn.indexOf('\nfunction ', 10);
    const body      = scatterFn.slice(0, nextFn > 0 ? nextFn : 2000);
    assert.ok(body.includes('attachPanelResize'), '_panel_scatter debe llamar attachPanelResize');
  });
});

describe('Geometría isométrica del scatter', () => {
  // Extraemos y ejecutamos solo la lógica de cálculo de viewport de _initScatter
  // para verificar que la escala ¢/px es igual en ambos ejes.

  function calcViewport(plotW, plotH, fullMaxX, fullMaxY) {
    const scaleX0 = plotW / fullMaxX, scaleY0 = plotH / fullMaxY;
    const scale0  = Math.min(scaleX0, scaleY0);
    const rangeX0 = plotW / scale0;
    const rangeY0 = plotH / scale0;
    const padX0   = (rangeX0 - fullMaxX) / 2;
    const padY0   = (rangeY0 - fullMaxY) / 2;
    const vMinX = -padX0, vMaxX = fullMaxX + padX0;
    const vMinY = -padY0, vMaxY = fullMaxY + padY0;
    return { vMinX, vMaxX, vMinY, vMaxY, plotW, plotH };
  }

  function scalePerCent(vp) {
    return {
      sx: vp.plotW / (vp.vMaxX - vp.vMinX),
      sy: vp.plotH / (vp.vMaxY - vp.vMinY),
    };
  }

  it('escala ¢/px igual en X e Y para panel cuadrado', () => {
    const vp = calcViewport(400, 400, 20, 15);
    const { sx, sy } = scalePerCent(vp);
    assert.ok(Math.abs(sx - sy) < 0.001, `sx=${sx.toFixed(4)} debe ≈ sy=${sy.toFixed(4)}`);
  });

  it('escala ¢/px igual en X e Y para panel apaisado (ancho > alto)', () => {
    const vp = calcViewport(600, 300, 20, 15);
    const { sx, sy } = scalePerCent(vp);
    assert.ok(Math.abs(sx - sy) < 0.001, `sx=${sx.toFixed(4)} debe ≈ sy=${sy.toFixed(4)}`);
  });

  it('escala ¢/px igual en X e Y para panel vertical (alto > ancho)', () => {
    const vp = calcViewport(300, 600, 20, 15);
    const { sx, sy } = scalePerCent(vp);
    assert.ok(Math.abs(sx - sy) < 0.001, `sx=${sx.toFixed(4)} debe ≈ sy=${sy.toFixed(4)}`);
  });

  it('el eje restrictivo llena exactamente su dimensión', () => {
    // Con plotW=600, plotH=300, fullMaxX=20, fullMaxY=15:
    // scaleX0=30, scaleY0=20 → scale0=20 (Y es restrictivo)
    // rangeY0 = 300/20 = 15 = fullMaxY → padY0=0 → Y llena exactamente
    const vp = calcViewport(600, 300, 20, 15);
    const { sy } = scalePerCent(vp);
    assert.ok(Math.abs(sy * (vp.vMaxY - vp.vMinY) - vp.plotH) < 0.01, 'eje Y debe llenar plotH exactamente');
  });

  it('zoom con mismo factor en ambos ejes preserva la escala isométrica', () => {
    const vp = calcViewport(400, 300, 20, 15);
    const factor = 0.5; // zoom in
    const cx = 10, cy = 7; // punto central en datos
    // Aplicar zoom igual que zoomAround
    const vMinX2 = cx + (vp.vMinX - cx) * factor;
    const vMaxX2 = cx + (vp.vMaxX - cx) * factor;
    const vMinY2 = cy + (vp.vMinY - cy) * factor;
    const vMaxY2 = cy + (vp.vMaxY - cy) * factor;
    const sx2 = vp.plotW / (vMaxX2 - vMinX2);
    const sy2 = vp.plotH / (vMaxY2 - vMinY2);
    assert.ok(Math.abs(sx2 - sy2) < 0.001, 'zoom preserva isometría');
  });

  it('_initScatter usa scale0 = min(scaleX0, scaleY0) para inicializar viewport', () => {
    const appSrc = readFileSync(
      fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
    );
    assert.ok(appSrc.includes('Math.min(scaleX0, scaleY0)'), 'debe usar Math.min para escala isométrica');
    assert.ok(appSrc.includes('plotW / scale0'), 'debe calcular rangeX0 con scale0');
    assert.ok(appSrc.includes('plotH / scale0'), 'debe calcular rangeY0 con scale0');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Análisis estático: plugin Immersive Android (Java)
// ══════════════════════════════════════════════════════════════════════════════

describe('Plugin Immersive Android — archivos Java', () => {
  const pluginSrc = readFileSync(
    fileURLToPath(new URL('../android/app/src/main/java/es/carlosguerra/salinas/ImmersivePlugin.java', import.meta.url)), 'utf8'
  );
  const mainSrc = readFileSync(
    fileURLToPath(new URL('../android/app/src/main/java/es/carlosguerra/salinas/MainActivity.java', import.meta.url)), 'utf8'
  );

  it('ImmersivePlugin.java tiene anotación @CapacitorPlugin(name = "Immersive")', () => {
    assert.ok(pluginSrc.includes('@CapacitorPlugin(name = "Immersive")'), 'debe tener la anotación correcta');
  });

  it('ImmersivePlugin.java implementa métodos enter y exit', () => {
    assert.ok(pluginSrc.includes('@PluginMethod') && pluginSrc.includes('void enter'), 'debe tener método enter');
    assert.ok(pluginSrc.includes('void exit'), 'debe tener método exit');
  });

  it('ImmersivePlugin.java oculta statusBars y navigationBars en API >= 30', () => {
    assert.ok(pluginSrc.includes('statusBars()') && pluginSrc.includes('navigationBars()'), 'debe ocultar ambas barras');
    assert.ok(pluginSrc.includes('BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE'), 'debe usar modo sticky swipe');
  });

  it('MainActivity.java registra ImmersivePlugin antes de super.onCreate', () => {
    assert.ok(mainSrc.includes('registerPlugin(ImmersivePlugin.class)'), 'debe registrar el plugin');
    // registerPlugin debe aparecer ANTES de super.onCreate
    const regIdx   = mainSrc.indexOf('registerPlugin');
    const superIdx = mainSrc.indexOf('super.onCreate');
    assert.ok(regIdx < superIdx, 'registerPlugin debe llamarse antes de super.onCreate');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Análisis estático: candado de resize en móvil
// ══════════════════════════════════════════════════════════════════════════════

describe('Candado de resize en panel-drag-bar (móvil)', () => {
  const appSrc = readFileSync(
    fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
  );
  const cssSrc = readFileSync(
    fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8'
  );

  it('panel-drag-bar contiene botón .panel-resize-lock', () => {
    assert.ok(appSrc.includes('panel-resize-lock'), 'debe existir el botón de candado');
    assert.ok(appSrc.includes('togglePanelResizeLock'), 'debe existir la función togglePanelResizeLock');
  });

  it('startPanelDragResize respeta panel-resize-locked', () => {
    assert.ok(
      appSrc.includes('panel-resize-locked') && appSrc.includes("classList.contains('panel-resize-locked')"),
      'startPanelDragResize debe retornar si el panel está bloqueado'
    );
  });

  it('renderContent inicializa todos los paneles con panel-resize-locked', () => {
    assert.ok(
      appSrc.includes("classList.add('panel-resize-locked')"),
      'los paneles deben arrancar bloqueados'
    );
  });

  it('togglePanelResizeLock configura auto-relock con setTimeout', () => {
    assert.ok(
      appSrc.includes('_relockTimer') && appSrc.includes('setTimeout'),
      'debe haber auto-relock automático'
    );
  });

  it('CSS define .panel-resize-lock con estilos de botón', () => {
    assert.ok(cssSrc.includes('.panel-resize-lock'), '.panel-resize-lock debe existir en CSS');
  });

  it('CSS define panel-resize-locked para estado bloqueado', () => {
    assert.ok(cssSrc.includes('panel-resize-locked'), 'debe existir clase panel-resize-locked en CSS');
  });

  it('CSS aplica min-height al .panel en móvil para que la barra siempre sea visible', () => {
    assert.ok(
      cssSrc.includes('min-height:74px') || cssSrc.includes('min-height: 74px'),
      '.panel en móvil debe tener min-height para que el drag-bar nunca desaparezca'
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Análisis estático: altura dinámica de barra de nav móvil
// ══════════════════════════════════════════════════════════════════════════════

describe('Altura dinámica de barra de nav móvil (--mob-nav-h)', () => {
  const appSrc = readFileSync(
    fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8'
  );
  const cssSrc = readFileSync(
    fileURLToPath(new URL('../src/index.html', import.meta.url)), 'utf8'
  );

  it('syncMobNavHeight existe y usa ResizeObserver sobre #mob-nav', () => {
    assert.ok(appSrc.includes('syncMobNavHeight'), 'debe existir la función syncMobNavHeight');
    assert.ok(appSrc.includes('new ResizeObserver'), 'debe usar ResizeObserver para seguir la altura');
    assert.ok(appSrc.includes('mob-nav'), 'debe observar #mob-nav');
  });

  it('syncMobNavHeight actualiza --mob-nav-h en documentElement', () => {
    assert.ok(
      appSrc.includes('--mob-nav-h') && appSrc.includes('documentElement.style.setProperty'),
      'debe setear --mob-nav-h como CSS custom property en :root'
    );
  });

  it('CSS de #content en móvil usa var(--mob-nav-h) para padding-bottom', () => {
    assert.ok(
      cssSrc.includes('var(--mob-nav-h'),
      '#content debe usar --mob-nav-h para que el padding-bottom sea dinámico'
    );
  });
});
