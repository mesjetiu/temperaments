// ══════════════════════════════════════════════
// WORKSPACE — pestañas y tarjetas configurables
// ══════════════════════════════════════════════

const CARD_REGISTRY = {
  overview:   { label: 'Vista general', icon: '◎', needsSelection: true  },
  fifths:     { label: 'Quintas',       icon: '↻', needsSelection: true  },
  thirds:     { label: 'Terceras',      icon: '△', needsSelection: true  },
  compare:    { label: 'Comparar',      icon: '⚖', needsSelection: true  },
  intervals:  { label: 'Intervalos',    icon: '▦', needsSelection: true  },
  beats:      { label: 'Batidos',       icon: '〰', needsSelection: true  },
  consonance: { label: 'Consonancia',   icon: '◉', needsSelection: true  },
  histogram:  { label: 'Histograma',    icon: '▯', needsSelection: true  },
  lattice:    { label: 'Lattice',       icon: '⬡', needsSelection: true  },
  triads:     { label: 'Tríadas',       icon: '▲', needsSelection: true  },
  tonnetz:    { label: 'Tonnetz',       icon: '◈', needsSelection: true  },
  scatter:    { label: 'Mapa global',   icon: '⠿', needsSelection: false },
  keyboard:   { label: 'Teclado',       icon: '▬', needsSelection: false },
  // medidor y tuner excluidos — van al botón flotante unificado
};

const DEFAULT_WORKSPACE = {
  version: 1,
  activeTabId: 'tab-default',
  tabs: [{
    id: 'tab-default',
    label: 'Vista general',
    cards: [
      { id: 'card-1', type: 'overview'  },
      { id: 'card-2', type: 'fifths'    },
      { id: 'card-3', type: 'thirds'    },
      { id: 'card-4', type: 'compare'   },
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

  // Crea workspace por defecto si no existe todavía
  migrateFromLegacy(activeTabName) {
    if (localStorage.getItem(WS_KEY)) return;
    // Si el activeTab era uno de los nuestros, arrancamos con esa tarjeta más las básicas
    const ws = JSON.parse(JSON.stringify(DEFAULT_WORKSPACE));
    if (activeTabName && CARD_REGISTRY[activeTabName] && activeTabName !== 'overview') {
      ws.tabs[0].cards.push({ id: _uid(), type: activeTabName });
    }
    localStorage.setItem(WS_KEY, JSON.stringify(ws));
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
    if (typeof DT !== 'undefined') DT.stopMic();
  },

  switchTab(id) {
    const ws = this.current();
    if (!ws.tabs.find(t => t.id === id)) return;
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
                   onclick="WS.switchTab('${tab.id}')">
                <span class="tab-label"
                      ondblclick="event.stopPropagation();WS._startRename(this,'${tab.id}')">${tab.label}</span>
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
      ? `<button onclick="WS.openMoveCardMenu('${card.id}',event)" title="Mover a pestaña">⇒</button>`
      : '';
    const div = document.createElement('div');
    div.className = 'card-toolbar';
    div.innerHTML =
      `<button onclick="WS.removeCard('${card.id}')" title="Quitar tarjeta">✕</button>` +
      `<button onclick="WS.duplicateCard('${card.id}')" title="Duplicar tarjeta">⧉</button>` +
      moveBtn;
    return div;
  },

  // ── Popovers ──────────────────────────────────

  _closePopovers() {
    document.querySelectorAll('.ws-popover').forEach(p => p.remove());
  },

  _popover(html, anchorEvent) {
    this._closePopovers();
    const div = document.createElement('div');
    div.className = 'ws-popover';
    div.innerHTML = html;
    document.body.appendChild(div);
    // Posición
    const x = anchorEvent.clientX, y = anchorEvent.clientY;
    div.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    div.style.top  = (y + 4) + 'px';
    // Cerrar al click fuera
    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!div.contains(e.target)) { div.remove(); document.removeEventListener('click', h); }
      });
    }, 0);
    return div;
  },

  openAddCardMenu(event) {
    const items = Object.entries(CARD_REGISTRY).map(([type, desc]) =>
      `<div class="ws-popover-item" onclick="WS.addCard('${type}');WS._closePopovers()">
        <span class="ws-popover-icon">${desc.icon}</span> ${desc.label}
       </div>`
    ).join('');
    this._popover(items, event);
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

  _startRename(spanEl, tabId) {
    const input = document.createElement('input');
    input.className = 'tab-rename-input';
    input.value = spanEl.textContent;
    input.style.width = Math.max(60, spanEl.offsetWidth) + 'px';
    spanEl.replaceWith(input);
    input.focus();
    input.select();
    const confirm = () => {
      WS.renameTab(tabId, input.value);
      // renderTabBar() llamado desde renameTab → save()
    };
    input.addEventListener('blur', confirm);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.removeEventListener('blur', confirm); WS.renderTabBar(); }
    });
  },

  onResize() {
    // Hook para futuras necesidades de reajuste por tarjeta
  },
};
