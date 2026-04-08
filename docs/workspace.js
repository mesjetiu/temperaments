// ══════════════════════════════════════════════
// WORKSPACE — pestañas y tarjetas configurables
// ══════════════════════════════════════════════

const CARD_REGISTRY = {
  // ── Grupo 1: paneles individuales ──────────────────────────────────────────
  circle:         { label: 'Círculo de quintas',    icon: '◎', needsSelection: true,  group: 'Quintas'     },
  radar:          { label: 'Radar de offsets',       icon: '◈', needsSelection: true,  group: 'Overview'    },
  offsets:        { label: 'Tabla de offsets',       icon: '▤', needsSelection: true,  group: 'Overview'    },
  scatter:        { label: 'Mapa global',            icon: '⠿', needsSelection: false, group: 'Global'      },
  lattice:        { label: 'Lattice de Euler',       icon: '⬡', needsSelection: true,  group: 'Afinación'   },
  triads:         { label: 'Mapa de tríadas',        icon: '▲', needsSelection: true,  group: 'Afinación'   },
  tonnetz:        { label: 'Tonnetz',                icon: '◇', needsSelection: true,  group: 'Afinación'   },
  histogram:      { label: 'Histograma consonancia', icon: '▯', needsSelection: true,  group: 'Consonancia' },
  consonance:     { label: 'Curva de consonancia',   icon: '◉', needsSelection: true,  group: 'Consonancia' },
  keyboard:       { label: 'Teclado',                icon: '▬', needsSelection: false, group: 'Interacción' },
  // ── Grupo 2: gráficas de barras y línea ────────────────────────────────────
  fifths_bar:     { label: 'Gráfica de quintas',     icon: '↕', needsSelection: true,  group: 'Quintas'     },
  maj3_bar:       { label: 'Gráfica 3ª mayores',     icon: '↕', needsSelection: true,  group: 'Terceras'    },
  min3_bar:       { label: 'Gráfica 3ª menores',     icon: '↕', needsSelection: true,  group: 'Terceras'    },
  offsets_line:   { label: 'Línea de offsets',       icon: '〜', needsSelection: true,  group: 'Overview'    },
  // ── Grupo 3: tablas por temperamento ───────────────────────────────────────
  intervals:      { label: 'Matriz de intervalos',   icon: '▦', needsSelection: true,  group: 'Intervalos'  },
  beats:          { label: 'Tabla de batidos',       icon: '〰', needsSelection: true,  group: 'Intervalos'  },
  fifths_table:   { label: 'Tabla de quintas',       icon: '▤', needsSelection: true,  group: 'Quintas'     },
  thirds_table:   { label: 'Tabla de terceras',      icon: '▤', needsSelection: true,  group: 'Terceras'    },
  // ── Grupo 4: tarjeta informativa ───────────────────────────────────────────
  hero:           { label: 'Ficha del temperamento', icon: '★', needsSelection: true,  group: 'Overview'    },
  // medidor y tuner excluidos — van al botón flotante unificado
};

const DEFAULT_WORKSPACE = {
  version: 1,
  activeTabId: 'tab-default',
  tabs: [{
    id: 'tab-default',
    label: 'Vista general',
    cards: [
      { id: 'card-1', type: 'circle'  },
      { id: 'card-2', type: 'radar'   },
      { id: 'card-3', type: 'offsets' },
      { id: 'card-4', type: 'scatter' },
    ]
  }]
};

const WS_KEY   = 'workspace';
const SAVED_KEY = 'savedWorkspaces';

function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// ── Persistencia ────────────────────────────────
const WS = {

  current() {
    try {
      const raw = localStorage.getItem(WS_KEY);
      if (raw) return JSON.parse(raw);
    } catch(e) {}
    return JSON.parse(JSON.stringify(DEFAULT_WORKSPACE));
  },

  save(ws) {
    localStorage.setItem(WS_KEY, JSON.stringify(ws));
    this.renderTabBar();
    if (typeof renderContent === 'function') renderContent();
  },

  // Crea workspace por defecto si no existe todavía, o si contiene tipos obsoletos
  migrateFromLegacy(activeTabName) {
    const raw = localStorage.getItem(WS_KEY);
    if (raw) {
      try {
        const ws = JSON.parse(raw);
        // Si alguna tarjeta tiene un type que ya no existe en CARD_REGISTRY, resetear
        const hasObsolete = ws.tabs?.some(t =>
          t.cards?.some(c => c.type && !CARD_REGISTRY[c.type])
        );
        if (!hasObsolete) return; // workspace válido, no tocar
      } catch(e) {}
      // Obsoleto o corrupto → reemplazar
    }
    localStorage.setItem(WS_KEY, JSON.stringify(JSON.parse(JSON.stringify(DEFAULT_WORKSPACE))));
  },

  init() {
    this.renderTabBar();
    // renderContent() lo llama app.js justo después
  },

  // ── Pestañas ──────────────────────────────────

  _leaveCurrentTab() {
    // Limpiar estado de vistas que manejan recursos propios
    if (typeof KB !== 'undefined' && KB.mode !== 'chord') KB.clearAll();
    if (document.body.classList.contains('kb-fullscreen') && typeof toggleKbFullscreen === 'function') toggleKbFullscreen();
    if (typeof TUNER !== 'undefined') { TUNER.stop(); document.getElementById('tuner-screen')?.remove(); }
    if (typeof DT !== 'undefined') { DT.stopMic(); document.getElementById('medidor-screen')?.remove(); }
  },

  switchTab(id) {
    const ws = this.current();
    if (!ws.tabs.find(t => t.id === id)) return;
    if (ws.activeTabId === id) return; // ya activa, no re-renderizar
    this._leaveCurrentTab();
    ws.activeTabId = id;
    this.save(ws);
  },

  switchTabRelative(delta) {
    const ws = this.current();
    const idx = ws.tabs.findIndex(t => t.id === ws.activeTabId);
    const next = (idx + delta + ws.tabs.length) % ws.tabs.length;
    this._leaveCurrentTab();
    ws.activeTabId = ws.tabs[next].id;
    this.save(ws);
  },

  addTab() {
    const ws = this.current();
    const id = 'tab-' + _uid();
    ws.tabs.push({ id, label: 'Nueva pestaña', cards: [] });
    ws.activeTabId = id;
    this.save(ws);
    // Iniciar renombrado inmediatamente
    setTimeout(() => {
      const span = document.querySelector(`#tabs [data-tabid="${id}"] .tab-label`);
      if (span) this._startRename(span, id);
    }, 50);
  },

  deleteTab(id) {
    const ws = this.current();
    if (ws.tabs.length <= 1) return; // nunca <1 pestaña
    const idx = ws.tabs.findIndex(t => t.id === id);
    ws.tabs.splice(idx, 1);
    if (ws.activeTabId === id) {
      ws.activeTabId = ws.tabs[Math.max(0, idx - 1)].id;
    }
    this.save(ws);
  },

  renameTab(id, label) {
    const ws = this.current();
    const tab = ws.tabs.find(t => t.id === id);
    if (tab) { tab.label = label.trim() || tab.label; this.save(ws); }
  },

  // ── Tarjetas ──────────────────────────────────

  addCard(type) {
    if (!CARD_REGISTRY[type]) return;
    const ws = this.current();
    const tab = ws.tabs.find(t => t.id === ws.activeTabId);
    if (!tab) return;
    tab.cards.push({ id: 'card-' + _uid(), type });
    this.save(ws);
  },

  removeCard(cardId) {
    const ws = this.current();
    for (const tab of ws.tabs) {
      const idx = tab.cards.findIndex(c => c.id === cardId);
      if (idx !== -1) { tab.cards.splice(idx, 1); break; }
    }
    this.save(ws);
  },

  duplicateCard(cardId) {
    const ws = this.current();
    for (const tab of ws.tabs) {
      const idx = tab.cards.findIndex(c => c.id === cardId);
      if (idx !== -1) {
        const clone = { ...tab.cards[idx], id: 'card-' + _uid() };
        tab.cards.splice(idx + 1, 0, clone);
        break;
      }
    }
    this.save(ws);
  },

  moveCardToTab(cardId, targetTabId) {
    const ws = this.current();
    let card = null;
    for (const tab of ws.tabs) {
      const idx = tab.cards.findIndex(c => c.id === cardId);
      if (idx !== -1) { [card] = tab.cards.splice(idx, 1); break; }
    }
    if (!card) return;
    const target = ws.tabs.find(t => t.id === targetTabId);
    if (target) { target.cards.push(card); this.save(ws); }
  },

  // ── Render barra de pestañas ──────────────────

  renderTabBar() {
    const el = document.getElementById('tabs');
    if (!el) return;
    const ws = this.current();
    el.innerHTML = ws.tabs.map(tab => {
      const active = tab.id === ws.activeTabId ? ' active' : '';
      const closeBtn = ws.tabs.length > 1
        ? `<span class="tab-x" onclick="event.stopPropagation();WS.deleteTab('${tab.id}')" title="Cerrar">×</span>`
        : '';
      return `<div class="tab${active}" data-tabid="${tab.id}"
                   onclick="WS.switchTab('${tab.id}')"
                   ondblclick="WS._startRenameTab('${tab.id}',this)">
                <span class="tab-label">${tab.label}</span>
                ${closeBtn}
              </div>`;
    }).join('') +
    `<div class="tab tab-add" onclick="WS.addTab()" title="Nueva pestaña">＋</div>` +
    `<div class="tab tab-menu" onclick="WS.openWorkspaceMenu(event)" title="Gestionar workspace">⋮</div>`;
  },

  // ── Toolbar de tarjeta ────────────────────────

  makeCardToolbar(card) {
    const ws = this.current();
    const otherTabs = ws.tabs.filter(t => t.id !== ws.activeTabId);
    const moveBtn = otherTabs.length > 0
      ? `<button onclick="event.stopPropagation();WS.openMoveCardMenu('${card.id}',event)" title="Mover a pestaña">⇒</button>`
      : '';
    const div = document.createElement('div');
    div.className = 'card-toolbar';
    div.setAttribute('onclick', 'event.stopPropagation()');
    div.innerHTML =
      `<button onclick="event.stopPropagation();WS.duplicateCard('${card.id}')" title="Duplicar tarjeta">⧉</button>` +
      moveBtn +
      `<button onclick="event.stopPropagation();WS.removeCard('${card.id}')" title="Quitar tarjeta">✕</button>`;
    return div;
  },

  // ── Popovers ──────────────────────────────────

  _closePopovers() {
    document.querySelectorAll('.ws-popover').forEach(p => p.remove());
  },

  _popover(html, anchorEvent, anchorEl) {
    this._closePopovers();
    const div = document.createElement('div');
    div.className = 'ws-popover';
    div.innerHTML = html;
    document.body.appendChild(div);
    // Si hay elemento ancla, usar su borde como referencia (más fiable que clientY en móvil)
    let x, yTop, yBottom;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      x = r.left;
      yTop = r.top;
      yBottom = r.bottom;
    } else {
      x = anchorEvent.clientX;
      yTop = yBottom = anchorEvent.clientY;
    }
    const maxH = Math.round(window.innerHeight * 0.75);
    div.style.maxHeight = maxH + 'px';
    const spaceBelow = window.innerHeight - yBottom - 8;
    const spaceAbove = yTop - 8;
    // Siempre usar top (nunca bottom) para evitar bugs en móvil con barra del navegador
    if (spaceAbove > spaceBelow) {
      // Abrir hacia arriba: el borde inferior del popover = yTop - 4
      div.style.top = Math.max(4, yTop - maxH - 4) + 'px';
    } else {
      div.style.top = (yBottom + 4) + 'px';
    }
    div.style.left = Math.max(4, Math.min(x, window.innerWidth - 224)) + 'px';
    // Cerrar al click fuera
    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!div.contains(e.target)) { div.remove(); document.removeEventListener('click', h); }
      });
    }, 0);
    return div;
  },

  openAddCardMenu(event, anchorEl) {
    // Agrupar por group
    const groups = {};
    for (const [type, desc] of Object.entries(CARD_REGISTRY)) {
      const g = desc.group || 'Otros';
      if (!groups[g]) groups[g] = [];
      groups[g].push([type, desc]);
    }
    let html = '';
    for (const [groupName, entries] of Object.entries(groups)) {
      html += `<div class="ws-popover-group">${groupName}</div>`;
      html += entries.map(([type, desc]) =>
        `<div class="ws-popover-item" onclick="WS.addCard('${type}');WS._closePopovers()">
           <span class="ws-popover-icon">${desc.icon}</span> ${desc.label}
         </div>`
      ).join('');
    }
    this._popover(html, event, anchorEl);
  },

  openMoveCardMenu(cardId, event) {
    const ws = this.current();
    const others = ws.tabs.filter(t => t.id !== ws.activeTabId);
    if (!others.length) return;
    const items = others.map(t =>
      `<div class="ws-popover-item" onclick="WS.moveCardToTab('${cardId}','${t.id}');WS._closePopovers()">
        → ${t.label}
       </div>`
    ).join('');
    this._popover(items, event);
  },

  openWorkspaceMenu(event) {
    const saved = this._loadSaved();
    const loadItems = saved.length
      ? saved.map((s, i) =>
          `<div class="ws-popover-item" onclick="WS._loadWorkspace(${i});WS._closePopovers()">↺ ${s.name}</div>`
        ).join('')
      : '<div class="ws-popover-item ws-popover-dim">Sin guardados</div>';
    const html =
      `<div class="ws-popover-item" onclick="WS._saveAs();WS._closePopovers()">💾 Guardar como…</div>` +
      `<div class="ws-popover-sep"></div>` +
      loadItems +
      `<div class="ws-popover-sep"></div>` +
      `<div class="ws-popover-item" onclick="WS._resetDefault();WS._closePopovers()">↺ Restablecer por defecto</div>`;
    this._popover(html, event);
  },

  // ── Guardado / carga de workspaces con nombre ─

  _loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch(e) { return []; }
  },

  _saveAs() {
    const name = prompt('Nombre para esta configuración:');
    if (!name || !name.trim()) return;
    const saved = this._loadSaved();
    // Sobrescribir si ya existe el nombre
    const idx = saved.findIndex(s => s.name === name.trim());
    const entry = { name: name.trim(), data: this.current() };
    if (idx !== -1) saved[idx] = entry; else saved.push(entry);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  },

  _loadWorkspace(index) {
    const saved = this._loadSaved();
    if (!saved[index]) return;
    localStorage.setItem(WS_KEY, JSON.stringify(saved[index].data));
    this.renderTabBar();
    if (typeof renderContent === 'function') renderContent();
  },

  _resetDefault() {
    if (!confirm('¿Restablecer el workspace por defecto? Se perderá la configuración actual.')) return;
    localStorage.removeItem(WS_KEY);
    this.renderTabBar();
    if (typeof renderContent === 'function') renderContent();
  },

  // ── Renombrado de pestaña in-place ────────────

  _startRenameTab(tabId, tabDiv) {
    // Evitar doble instancia
    if (tabDiv.querySelector('input')) return;
    const span = tabDiv.querySelector('.tab-label');
    const currentLabel = span ? span.textContent : '';

    const input = document.createElement('input');
    input.className = 'tab-rename-input';
    input.value = currentLabel;
    input.style.width = Math.max(80, (currentLabel.length + 2) * 8) + 'px';

    // Ocultar el span y poner el input en su lugar
    if (span) span.style.display = 'none';
    tabDiv.insertBefore(input, span || tabDiv.firstChild);
    input.focus();
    input.select();

    const done = (save) => {
      input.remove();
      if (span) span.style.display = '';
      if (save && input.value.trim()) {
        // Actualizar el span directamente sin re-render completo
        if (span) span.textContent = input.value.trim();
        WS.renameTab(tabId, input.value.trim());
      }
    };

    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
    });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('dblclick', e => e.stopPropagation());
  },

  onResize() {
    // Hook para futuras necesidades de reajuste por tarjeta
  },
};
