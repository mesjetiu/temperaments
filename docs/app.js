const APP_VERSION = '0857691 · 2026-04-08';

// ── Update toast ──
let _pendingUpdateSW = null;
function showUpdateToast(waitingSW) {
  _pendingUpdateSW = waitingSW || null;
  document.getElementById('update-toast').classList.add('visible');
}
function dismissUpdateToast() {
  document.getElementById('update-toast').classList.remove('visible');
}
function applyUpdate() {
  if (_pendingUpdateSW) {
    _pendingUpdateSW.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}

// ── Service Worker ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  function onSWInstalled(sw) {
    if (!sw) return;
    if (navigator.serviceWorker.controller) {
      // Update real: hay un SW antiguo controlando → avisar al usuario
      showUpdateToast(sw);
    }
    // Sin controller (primera instalación): el activate + claim() lo gestiona solo
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});

      // SW ya esperando (de una visita anterior que no completó la transición)
      if (reg.waiting) onSWInstalled(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (!newSW) return;
        if (newSW.state === 'installed') { onSWInstalled(newSW); return; }
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'installed') onSWInstalled(newSW);
        });
      });
    }).catch(() => {});
  });
}

// ── Chequeo de versión independiente del ciclo SW ──────────────────────────
async function checkForNewVersion() {
  try {
    const r = await fetch('./version.json?_=' + Date.now(), { cache: 'no-cache' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (!v || v === APP_VERSION) return;
    // Nueva versión detectada: mostrar aviso (no recargar automáticamente)
    const reg = await navigator.serviceWorker.getRegistration('./');
    showUpdateToast(reg?.waiting || null);
  } catch (e) {}
}
window.addEventListener('load', () => setTimeout(checkForNewVersion, 3000));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForNewVersion();
});

// CONSTANTES y funciones puras → vienen de core.js (cargado antes como módulo)
// NOTES, FIFTH_IDX, FIFTH_LBL, ET_FROM_A, PURE_FIFTH, PURE_MAJ3, PURE_MIN3
// noteFreq, getFifths, getMaj3, getMin3, detectPitch, _refineFFT,
// findClosestNote, parseTempMarkdown, _computeHarmonics

const COLORS  = ['#60a5fa','#f87171','#4ade80'];
const COLORS_A= ['rgba(96,165,250,0.18)','rgba(248,113,113,0.18)','rgba(74,222,128,0.18)'];

// ══════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════
let all       = [];
let selected  = [null, null, null];
let _scatterPts = null; // caché de métricas para el scatter
let lastSelected = null;   // último temperamento elegido (teclado + afinador lo usan)
let activeTab = 'overview';
let charts    = {};
let chartMeta = {};

// ── Favoritos ──
const FAV_DEFAULTS = [
  'Equal temperament','Werckmeister III','Kirnberger III','Valotti',
  'Bach (Bradley Lehman)','1/4 comma meantone (Aaron 1523)','Pythagorean'
];
const _favRaw = localStorage.getItem('tempFavs');
let favs = new Set(_favRaw ? JSON.parse(_favRaw) : FAV_DEFAULTS);
function saveFavs() { localStorage.setItem('tempFavs', JSON.stringify([...favs])); }
function toggleFav(name, e) {
  e.stopPropagation();
  favs.has(name) ? favs.delete(name) : favs.add(name);
  saveFavs();
  refreshList();
}
let showFavsOnly = false;
let srcFilter = 'Todos';

function setSrcFilter(src) {
  srcFilter = src;
  document.querySelectorAll('.src-tab').forEach(b => b.classList.toggle('sel', b.dataset.src === src));
  refreshList();
}
document.querySelectorAll('.src-tab').forEach(b => {
  b.addEventListener('click', () => setSrcFilter(b.dataset.src));
});

// ══════════════════════════════════════════════
// TEMPERAMENTOS DE USUARIO (localStorage)
// ══════════════════════════════════════════════
const USER_KEY = 'userTemps';
function loadUserTemps() { try { return JSON.parse(localStorage.getItem(USER_KEY) || '[]'); } catch(e) { return []; } }
function saveUserTemps(arr) { localStorage.setItem(USER_KEY, JSON.stringify(arr)); }

function injectUserTemps() {
  all = all.filter(t => t.source !== 'Usuario');
  loadUserTemps().forEach(t => all.push({ name: t.name, offsets: t.offsets, source: 'Usuario', notes: t.notes || '' }));
}
function addUserTemp(name, offsets, notes) {
  const arr = loadUserTemps();
  const idx = arr.findIndex(t => t.name === name);
  const entry = { name, offsets, source: 'Usuario', notes: notes || '' };
  if (idx >= 0) arr[idx] = entry; else arr.push(entry);
  saveUserTemps(arr);
  injectUserTemps(); refreshList();
}
const NOTES_KEY = 'tempNotes';
function loadTempNotesStore() { try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch(e) { return {}; } }
function getTempNotes(name) {
  // User temps: notes live in user array; all others: in the notes store
  const t = all.find(x => x.name === name && x.source === 'Usuario');
  if (t) return t.notes || '';
  return loadTempNotesStore()[name] || '';
}
function saveTempNotes(name, notes) {
  // User temps: persist in user array
  const arr = loadUserTemps();
  const idx = arr.findIndex(t => t.name === name);
  if (idx >= 0) {
    arr[idx].notes = notes;
    saveUserTemps(arr);
    const t = all.find(x => x.name === name && x.source === 'Usuario');
    if (t) t.notes = notes;
    return;
  }
  // All other temps: persist in notes store
  const store = loadTempNotesStore();
  if (notes) store[name] = notes; else delete store[name];
  localStorage.setItem(NOTES_KEY, JSON.stringify(store));
  // update in-memory
  const t = all.find(x => x.name === name);
  if (t) t.notes = notes;
}
function deleteUserTemp(name) {
  saveUserTemps(loadUserTemps().filter(t => t.name !== name));
  selected = selected.map(s => s?.name === name ? null : s);
  if (lastSelected?.name === name) lastSelected = selected.find(Boolean) ?? null;
  injectUserTemps(); renderBadges(); refreshList(); renderContent();
}

// ── Menú contextual de temperamento ──
function openTempMenu(idx, event) {
  event.stopPropagation();
  document.querySelectorAll('.temp-ctx-menu').forEach(m => m.remove());
  const t = all[idx];
  if (!t) return;
  const menu = document.createElement('div');
  menu.className = 'temp-ctx-menu';
  menu.innerHTML = `
    <div class="temp-ctx-item" onclick="doShareTemp(${idx});document.querySelectorAll('.temp-ctx-menu').forEach(m=>m.remove())">📤 Compartir enlace</div>
    <div class="temp-ctx-item temp-ctx-disabled" title="Próximamente">⚙ Modificar</div>
  `;
  document.body.appendChild(menu);
  const r = event.target.getBoundingClientRect();
  menu.style.left = Math.min(r.left, window.innerWidth - 210) + 'px';
  menu.style.top  = (r.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('click', () => document.querySelectorAll('.temp-ctx-menu').forEach(m => m.remove()), { once: true }), 0);
}
function _tempShareText(name, offsets, notes) {
  const lines = offsets.map((o, i) => {
    const sign = o >= 0 ? '+' : '';
    return `  ${NOTES[i].padEnd(3)} ${sign}${o.toFixed(2)}¢`;
  });
  let text = `🎹 ${name}\n\nDesviaciones vs ET (cents):\n${lines.join('\n')}`;
  if (notes) text += `\n\n${notes}`;
  return text;
}
function _tempShareUrl(name, offsets, notes) {
  const offs = offsets.map(o => Math.round(o * 100) / 100).join(',');
  let url = location.origin + location.pathname + '?t=' + encodeURIComponent(name) + '&o=' + encodeURIComponent(offs);
  if (notes) url += '&n=' + encodeURIComponent(notes);
  return url;
}
let _shareTemp = null;
function showShareDialog(t) {
  _shareTemp = t;
  document.getElementById('share-name-input').value = t.name;
  const notes = getTempNotes(t.name);
  const notesSection = document.getElementById('share-notes-section');
  const notesInput = document.getElementById('share-notes-input');
  notesInput.value = notes;
  notesSection.style.display = notes ? 'block' : 'none';
  document.getElementById('share-dialog').classList.add('open');
}
function closeShareDialog() {
  document.getElementById('share-dialog').classList.remove('open');
  _shareTemp = null;
}
function confirmShare() {
  if (!_shareTemp) return;
  const name = document.getElementById('share-name-input').value.trim() || _shareTemp.name;
  const includeNotes = document.getElementById('share-include-notes').checked;
  const notesRaw = document.getElementById('share-notes-input').value.trim();
  const notes = includeNotes ? notesRaw : '';
  const url = _tempShareUrl(name, _shareTemp.offsets, notes);
  const text = _tempShareText(name, _shareTemp.offsets, notes);
  closeShareDialog();
  if (navigator.share) navigator.share({ title: name, text: text + '\n\n' + url }).catch(() => {});
  else navigator.clipboard?.writeText(text + '\n\n' + url).then(() => alert('Copiado al portapapeles')).catch(() => { prompt('Copia este enlace:', text + '\n\n' + url); });
}
function doShareTemp(idx) {
  const t = all[idx];
  if (!t) return;
  showShareDialog(t);
}

// ── Importación por URL (?t=Nombre&o=0,-3.9,3.9,...) ──
(function() {
  const p = new URLSearchParams(location.search);
  const tn = p.get('t'), os = p.get('o'), ns = p.get('n');
  if (!tn || !os) return;
  const offsets = os.split(',').map(Number);
  if (offsets.length !== 12 || offsets.some(isNaN)) return;
  addUserTemp(tn.trim(), offsets, ns ? ns.trim() : '');
  // Limpiar URL sin recargar
  history.replaceState(null, '', location.pathname);
  // Seleccionarlo tras la carga completa
  window.addEventListener('_dataReady', () => {
    const t = all.find(x => x.name === tn.trim() && x.source === 'Usuario');
    if (t) { selected[0] = t; lastSelected = t; renderBadges(); refreshList(); renderContent(); }
  }, { once: true });
})();

// ══════════════════════════════════════════════
// PERSISTENCIA
// ══════════════════════════════════════════════
const PREF_KEY = 'tempVizPrefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch(e) { return {}; }
}
function savePrefs(patch) {
  const p = loadPrefs();
  Object.assign(p, patch);
  localStorage.setItem(PREF_KEY, JSON.stringify(p));
}
const _prefs = loadPrefs();

let pitchA        = _prefs.pitchA ?? 440;
let octaveShift   = _prefs.octaveShift ?? 0;
let chartPlayMode = 'normal'; // 'normal' | 'legato'

// ══════════════════════════════════════════════
// AUDIO ENGINE (gráficas)
// ══════════════════════════════════════════════
let audioCtx   = null;
let masterGain = null;
let envGain    = null;
let activeOscs = [];
let currentWave = _prefs.wave ?? 'sawtooth';
const currentVol = 0.14; // volumen fijo conservador; el usuario usa el volumen del dispositivo

// ── Wake Lock: evita que la pantalla se apague mientras el micrófono está activo ──
let _wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch(_) {}
}
function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
}
// Liberar micrófono al salir de la app; reactivar al volver
let _tunerMicPaused = false, _dtMicPaused = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Pausar micrófonos para que otras apps puedan usarlos
    if (TUNER?.micOn) { _tunerMicPaused = true; TUNER.stopMic(); }
    if (DT?.micOn)    { _dtMicPaused = true;    DT.stopMic(); }
  } else {
    // Reactivar wake lock y micrófonos si estaban activos
    if (_tunerMicPaused) { _tunerMicPaused = false; TUNER.startMic(); }
    if (_dtMicPaused)    { _dtMicPaused = false;    DT.startMic(); }
    if (TUNER?.micOn || DT?.micOn) requestWakeLock();
  }
});

function getCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = currentVol;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// ── Síntesis band-limited (anti-aliasing) ──
// Genera PeriodicWave con exactamente los armónicos que caben antes de Nyquist.
// Sawtooth usa roll-off 1/n^1.35 para un timbre más suavizado.
const _waveCache = new WeakMap(); // ctx → Map<key, PeriodicWave>

function _makePeriodicWave(ctx, type, freq) {
  if (type === 'sine') return null;
  const sr = ctx.sampleRate;
  const maxH = Math.min(256, Math.floor(sr / (2.2 * Math.max(freq, 20))));
  if (maxH < 2) return null;
  const N = Math.pow(2, Math.ceil(Math.log2(maxH))); // potencia de 2 para cachear
  const key = `${type}_${N}`;
  let cm = _waveCache.get(ctx);
  if (!cm) { cm = new Map(); _waveCache.set(ctx, cm); }
  if (cm.has(key)) return cm.get(key);
  const { real, imag } = _computeHarmonics(type, N);
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  cm.set(key, wave);
  return wave;
}

function _applyWave(osc, ctx, type, freq) {
  const w = _makePeriodicWave(ctx, type, freq);
  if (w) { osc.setPeriodicWave(w); } else { osc.type = type; }
  osc._wt = type; // guardar tipo para comparaciones posteriores
}

function playFreqs(freqs) {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Si ya hay osciladores del mismo tipo y cantidad: rampar frecuencia sin corte
  if (activeOscs.length === freqs.length && envGain &&
      activeOscs.every(o => o._wt === currentWave)) {
    freqs.forEach((freq, i) => {
      activeOscs[i].frequency.cancelScheduledValues(now);
      activeOscs[i].frequency.setTargetAtTime(freq, now, 0.006);
    });
    
    return;
  }

  // Distinto número u onda: crossfade — desvanecer los viejos sin corte brusco
  const oldOscs = [...activeOscs];
  const oldGain = envGain;
  activeOscs = [];
  if (oldGain && oldOscs.length) {
    oldGain.gain.cancelScheduledValues(now);
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0, now + 0.025);
    setTimeout(() => {
      oldOscs.forEach(o => { try { o.stop(); o.disconnect(); } catch(e){} });
      try { oldGain.disconnect(); } catch(e){}
    }, 60);
  }

  envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, now);
  envGain.gain.linearRampToValueAtTime(1 / Math.sqrt(freqs.length), now + 0.010);
  envGain.connect(masterGain);
  activeOscs = freqs.map(freq => {
    const osc = ctx.createOscillator();
    _applyWave(osc, ctx, currentWave, freq);
    osc.frequency.value = freq;
    osc.connect(envGain);
    osc.start(now);
    return osc;
  });
  
}

function stopSound(hard = false) {
  if (!hard && chartPlayMode === 'legato') return;
  
  if (!activeOscs.length) return;
  const ctx = audioCtx;
  const now = ctx?.currentTime ?? 0;
  const oscs = [...activeOscs];
  activeOscs = [];
  if (hard || !envGain) {
    oscs.forEach(o => { try { o.stop(now); o.disconnect(); } catch(e){} });
    return;
  }
  envGain.gain.cancelScheduledValues(now);
  envGain.gain.setValueAtTime(envGain.gain.value, now);
  envGain.gain.linearRampToValueAtTime(0, now + 0.07);
  setTimeout(() => oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch(e){} }), 120);
}

// ── controles audio bar ──
document.getElementById('wave-sel').addEventListener('change', function() {
  currentWave = this.value;
  savePrefs({ wave: currentWave });
});


// ── Pitch A ──
const ICON_EXPAND   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const ICON_COLLAPSE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>`;

document.getElementById('pitch-input').addEventListener('input', function() {
  const v = parseFloat(this.value);
  if (v > 0) { pitchA = v; savePrefs({ pitchA: v }); }
  document.querySelectorAll('#tuner-pitch-input,#kb-pitch-input,#dt-pitch-input').forEach(el => { if (el !== this) el.value = this.value; });
});

function setPitchAGlobal(val) {
  const v = parseFloat(val);
  if (!v || v < 390 || v > 470) return;
  pitchA = v; savePrefs({ pitchA: v });
  document.querySelectorAll('#pitch-input,#tuner-pitch-input,#kb-pitch-input,#dt-pitch-input').forEach(el => el.value = v);
  if (TUNER.refOsc) TUNER.refOsc.frequency.setTargetAtTime(TUNER.getTargetFreq(), getCtx().currentTime, 0.01);
}

// ── Persiana móvil ──
function toggleTopBar(forceHide) {
  const coll  = document.getElementById('top-collapsible');
  const arrow = document.getElementById('top-toggle-arrow');
  if (!coll) return;
  const hide = forceHide !== undefined ? forceHide : !coll.classList.contains('top-hidden');
  coll.classList.toggle('top-hidden', hide);
  if (arrow) arrow.style.transform = hide ? 'rotate(180deg)' : 'rotate(0deg)';
  savePrefs({ audioBarHidden: hide });
}

// ── Pantalla completa del teclado ──
function toggleKbFullscreen() {
  const isFs = document.body.classList.toggle('kb-fullscreen');
  const btn = document.getElementById('kb-fs-btn');
  if (btn) btn.innerHTML = isFs ? ICON_COLLAPSE : ICON_EXPAND;
  if (isFs) closeSidebar();
  if (activeTab === 'keyboard') KB.render();
}

// ── Pantalla completa de gráfica (legacy, mantenido para desk-btn) ──
function toggleContentFullscreen() {
  const content = document.getElementById('content');
  const closeBtn = document.getElementById('content-fullscreen-close');
  const isFs = content.classList.toggle('content-fullscreen');
  if (closeBtn) closeBtn.style.display = isFs ? 'flex' : 'none';
  ['mob-fullscreen-btn','desk-fullscreen-btn'].forEach(id => {
    const b = document.getElementById(id); if (b) b.innerHTML = isFs ? ICON_COLLAPSE : ICON_EXPAND;
  });
  renderContent();
}

// ── Fullscreen API por panel individual ──
function togglePanelFullscreen(btn) {
  const panel = btn.closest('.panel');
  if (!panel) return;
  if (document.fullscreenElement === panel || document.webkitFullscreenElement === panel) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    const req = panel.requestFullscreen || panel.webkitRequestFullscreen;
    if (req) req.call(panel);
  }
}

document.addEventListener('fullscreenchange', _onPanelFullscreenChange);
document.addEventListener('webkitfullscreenchange', _onPanelFullscreenChange);
function _onPanelFullscreenChange() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  // Actualizar icono de todos los botones de zoom de paneles
  document.querySelectorAll('.panel-zoom-btn').forEach(btn => {
    const panel = btn.closest('.panel');
    btn.innerHTML = (panel && panel === fsEl) ? ICON_COLLAPSE : ICON_EXPAND;
  });
  // Al salir de fullscreen sí redibujamos (el panel vuelve a su tamaño original).
  // Al entrar NO: renderContent destruye el DOM y el navegador cancela el fullscreen.
  if (!fsEl) setTimeout(renderContent, 50);
}

// ── ResizeObserver para canvas custom (scatter, tonnetz) y tablas ──
const _panelRO = new ResizeObserver(entries => {
  entries.forEach(e => {
    // Mark as resized when the panel has an explicit style.height (desktop CSS resize sets it)
    if (e.target.style.height) e.target.classList.add('panel-resized');
    e.target.querySelectorAll('canvas[data-ro]').forEach(cv => {
      if (!cv._redraw) return;
      clearTimeout(cv._roTimer);
      cv._roTimer = setTimeout(() => cv._redraw(), 120);
    });
    const tbl = e.target.querySelector('table[data-rt]');
    if (tbl) {
      clearTimeout(tbl._roTimer);
      tbl._roTimer = setTimeout(() => _resizeTableToPanel(tbl, e.contentRect), 60);
    }
  });
});
function attachPanelResize(canvas) {
  canvas.setAttribute('data-ro', '1');
  const panel = canvas.closest('.panel');
  if (panel) { panel.classList.add('panel-resizable'); _panelRO.observe(panel); }
}
function togglePanelCollapse(panel) {
  const collapsing = !panel.classList.contains('collapsed');
  if (collapsing) {
    if (panel.style.height) panel.dataset.savedH = panel.style.height;
    panel.style.height = '';
  } else {
    if (panel.dataset.savedH) panel.style.height = panel.dataset.savedH;
  }
  panel.classList.toggle('collapsed');
}
// Devuelve el alto disponible para un canvas dentro de su panel.
// Sube hasta .panel-body (o .panel), mide su clientHeight - padding,
// y resta la altura de todos los hijos directos excepto el ancestro
// directo del canvas (que es quien lo contiene).
function _availCanvasH(canvas) {
  const body = canvas.closest('.panel-body') || canvas.closest('.panel');
  if (!body) return 0;
  // Hijo directo de `body` que contiene el canvas (puede ser el canvas mismo o un wrapper)
  let canvasContainer = canvas;
  while (canvasContainer.parentElement !== body) {
    if (!canvasContainer.parentElement) return 0;
    canvasContainer = canvasContainer.parentElement;
  }
  const cs    = getComputedStyle(body);
  const bodyH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const siblH = Array.from(body.children)
    .filter(el => el !== canvasContainer && getComputedStyle(el).position !== 'absolute')
    .reduce((sum, el) => {
      const m = getComputedStyle(el);
      return sum + el.offsetHeight + parseFloat(m.marginTop) + parseFloat(m.marginBottom);
    }, 0);
  return Math.max(0, bodyH - siblH);
}

function startPanelDragResize(e, panel) {
  e.preventDefault();
  const bar = e.target.closest('.panel-drag-bar') || e.target;
  bar.setPointerCapture(e.pointerId);
  panel.classList.add('panel-resized');
  // Altura mínima = cabecera + barra de drag (sin contenido)
  const hdr  = panel.querySelector('.panel-hdr');
  const minH = (hdr ? hdr.offsetHeight : 40) + bar.offsetHeight + 8;
  // Altura de partida: fijar inline la actual para poder restar/sumar desde ella
  const startH = panel.clientHeight;
  panel.style.height = startH + 'px';
  const startY = e.clientY;
  function onMove(ev) {
    const h = Math.max(minH, startH + ev.clientY - startY);
    panel.style.height = h + 'px';
  }
  function onEnd() {
    bar.removeEventListener('pointermove', onMove);
    bar.removeEventListener('pointerup', onEnd);
  }
  bar.addEventListener('pointermove', onMove, { passive: true });
  bar.addEventListener('pointerup', onEnd);
}
// Zoom+pan+resize para tablas heatmap (intervalos, batidos).
// Mismo patrón que el scatter: transform:scale en el contenido,
// handle arrastrable para resize, pinch+rueda para zoom.
function _initZoomTable(wrap) {
  const tbl = wrap.querySelector('table');
  if (!tbl) return;

  // Envolver la tabla en un div que recibe el transform
  const mover = document.createElement('div');
  mover.style.cssText = 'transform-origin:0 0;display:inline-block;min-width:100%;transition:none';
  tbl.parentNode.insertBefore(mover, tbl);
  mover.appendChild(tbl);

  let scale = 1, panX = 0, panY = 0;

  function apply() {
    mover.style.transform = `translate(${panX}px,${panY}px) scale(${scale})`;
    wrap.style.cursor = scale > 1 ? 'grab' : 'default';
  }
  function zoomAt(cx, cy, factor) {
    const ns = Math.max(0.25, Math.min(6, scale * factor));
    panX = cx + (panX - cx) * (ns / scale);
    panY = cy + (panY - cy) * (ns / scale);
    scale = ns; apply();
  }
  function resetZoom() { scale = 1; panX = 0; panY = 0; apply(); }

  // Rueda
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const rc = wrap.getBoundingClientRect();
    zoomAt(e.clientX - rc.left, e.clientY - rc.top, e.deltaY > 0 ? 0.83 : 1/0.83);
  }, { passive: false });

  // Drag con pointer capture
  let _dragging = false, _dragX = 0, _dragY = 0, _dragMoved = false;
  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('td')) return; // clic en celda = audio, no drag
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    _dragging = true; _dragX = e.clientX; _dragY = e.clientY; _dragMoved = false;
    wrap.style.cursor = 'grabbing';
  });
  wrap.addEventListener('pointermove', e => {
    if (!_dragging) return;
    const dx = e.clientX - _dragX, dy = e.clientY - _dragY;
    if (!_dragMoved && Math.hypot(dx, dy) < 3) return;
    _dragMoved = true; _dragX = e.clientX; _dragY = e.clientY;
    panX += dx; panY += dy; apply();
  });
  wrap.addEventListener('pointerup', () => { _dragging = false; apply(); });
  wrap.addEventListener('dblclick', resetZoom);

  // Pinch táctil
  let _tc = {}, _pd = null, _pm = null;
  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => { _tc[t.identifier] = {x:t.clientX,y:t.clientY}; });
    const ids = Object.keys(_tc);
    if (ids.length === 2) {
      const [a,b] = ids.map(id => _tc[id]);
      _pd = Math.hypot(a.x-b.x, a.y-b.y);
      _pm = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
    }
  }, {passive:false});
  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => { _tc[t.identifier] = {x:t.clientX,y:t.clientY}; });
    const ids = Object.keys(_tc);
    const rc = wrap.getBoundingClientRect();
    if (ids.length >= 2) {
      const [a,b] = ids.slice(0,2).map(id => _tc[id]);
      const dist = Math.hypot(a.x-b.x, a.y-b.y);
      const mid  = {x:(a.x+b.x)/2, y:(a.y+b.y)/2};
      if (_pd) {
        zoomAt(mid.x - rc.left, mid.y - rc.top, dist / _pd);
        if (_pm) { panX += mid.x - _pm.x; panY += mid.y - _pm.y; apply(); }
      }
      _pd = dist; _pm = mid;
    } else if (ids.length === 1) {
      const t = _tc[ids[0]];
      if (_pm) { panX += t.x - _pm.x; panY += t.y - _pm.y; apply(); }
      _pm = {x:t.x, y:t.y};
    }
  }, {passive:false});
  wrap.addEventListener('touchend', e => {
    Array.from(e.changedTouches).forEach(t => { delete _tc[t.identifier]; });
    if (Object.keys(_tc).length < 2) { _pd = null; _pm = null; }
  }, {passive:false});

  // Handle de resize arrastrable
  const handle = document.createElement('div');
  handle.className = 'chart-resize-handle';
  handle.title = 'Arrastra para cambiar altura';
  wrap.after(handle);
  handle.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const startY = ev.clientY, startH = wrap.offsetHeight;
    function onMove(e) { wrap.style.height = Math.max(80, startH + e.clientY - startY) + 'px'; }
    function onUp()   { handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); }
    handle.addEventListener('pointermove', onMove, {passive:true});
    handle.addEventListener('pointerup', onUp);
  });
}

// ── Modo reproducción gráficas ──
function toggleChartPlayMode() {
  chartPlayMode = chartPlayMode === 'normal' ? 'legato' : 'normal';
  const on = chartPlayMode === 'legato';
  const track = document.getElementById('play-mode-track');
  const thumb = document.getElementById('play-mode-thumb');
  if (track) track.style.background = on ? '#3b82f6' : '#334155';
  if (thumb) thumb.style.left = on ? '13px' : '2px';
  if (!on) stopSound(true);
}

// ── Octava gráficas ──
function octShift(d) {
  octaveShift = Math.max(-3, Math.min(3, octaveShift + d));
  const el = document.getElementById('oct-disp');
  el.textContent = octaveShift > 0 ? '+' + octaveShift : String(octaveShift);
  savePrefs({ octaveShift });
}

window.addEventListener('mouseup',     () => stopSound());
window.addEventListener('touchend',    () => stopSound(), { passive: true });
window.addEventListener('touchcancel', () => stopSound(), { passive: true });

// ══════════════════════════════════════════════
// FRECUENCIAS (gráficas)  — noteFreq viene de core.js
// ══════════════════════════════════════════════
function playNote(ni, off)       { playFreqs([noteFreq(ni, off, pitchA, octaveShift)]); }
function playFifthAudio(fi, off) { const f=getFifths(off)[fi]; const r=noteFreq(FIFTH_IDX[fi],off,pitchA,octaveShift); playFreqs([r, r*Math.pow(2,f.size/1200)]); }
function playMaj3Audio(ni, off)  { const t=getMaj3(off)[ni]; const r=noteFreq(ni,off,pitchA,octaveShift); playFreqs([r, r*Math.pow(2,t.size/1200)]); }
function playMin3Audio(ni, off)  { const t=getMin3(off)[ni]; const r=noteFreq(ni,off,pitchA,octaveShift); playFreqs([r, r*Math.pow(2,t.size/1200)]); }

function playForType(type, idx, off) {
  ({ fifths:playFifthAudio, maj3:playMaj3Audio, min3:playMin3Audio,
     offsets:playNote, radar:playNote })[type]?.(idx, off);
}

// ══════════════════════════════════════════════
// CHART AUDIO BINDING
// ══════════════════════════════════════════════
function bindChartAudio(canvasId, type, slotMap) {
  chartMeta[canvasId] = { type, slotMap };
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.classList.add('playable');

  // Estado del highlight actual
  let _hlDataset = -1, _hlIndex = -1;

  function setHighlight(chart, datasetIndex, colIndex) {
    if (_hlDataset === datasetIndex && _hlIndex === colIndex) return;
    clearHighlight(chart);
    _hlDataset = datasetIndex; _hlIndex = colIndex;
    if (datasetIndex < 0 || !chart) return;
    const ds = chart.data.datasets[datasetIndex];
    if (!ds) return;
    const n = ds.data.length;

    // backgroundColor — solo la columna/punto activo se ilumina
    const origBg = Array.isArray(ds.backgroundColor) ? [...ds.backgroundColor] : Array(n).fill(ds.backgroundColor);
    ds._origBg = ds.backgroundColor;
    ds.backgroundColor = origBg.map((c, i) => i === colIndex ? 'rgba(255,255,255,0.55)' : c);

    // borderColor — array: solo la columna activa en blanco
    const origBorderColor = Array.isArray(ds.borderColor) ? [...ds.borderColor] : Array(n).fill(ds.borderColor ?? 'transparent');
    ds._origBorder = ds.borderColor;
    ds.borderColor = origBorderColor.map((c, i) => i === colIndex ? '#fff' : c);

    // borderWidth — array: solo la columna activa con borde grueso
    const origBorderWidth = Array.isArray(ds.borderWidth) ? [...ds.borderWidth] : Array(n).fill(ds.borderWidth ?? 1);
    ds._origBorderWidth = ds.borderWidth;
    ds.borderWidth = origBorderWidth.map((w, i) => i === colIndex ? 2 : w);

    // Radar: resaltar el punto concreto con pointBackgroundColor y pointRadius
    if (chart.config.type === 'radar') {
      const origPtBg = Array.isArray(ds.pointBackgroundColor) ? [...ds.pointBackgroundColor] : Array(n).fill(ds.pointBackgroundColor ?? ds.borderColor[colIndex] ?? '#fff');
      ds._origPtBg = ds.pointBackgroundColor;
      ds.pointBackgroundColor = origPtBg.map((c, i) => i === colIndex ? '#fff' : c);
      const origPtR = Array.isArray(ds.pointRadius) ? [...ds.pointRadius] : Array(n).fill(ds.pointRadius ?? 3);
      ds._origPtR = ds.pointRadius;
      ds.pointRadius = origPtR.map((r, i) => i === colIndex ? 7 : r);
    }

    chart.update('none');
  }

  function clearHighlight(chart) {
    if (_hlDataset < 0 || !chart) { _hlDataset = -1; _hlIndex = -1; return; }
    const ds = chart.data.datasets[_hlDataset];
    if (ds) {
      if (ds._origBg !== undefined)          { ds.backgroundColor    = ds._origBg;          delete ds._origBg; }
      if (ds._origBorder !== undefined)       { ds.borderColor        = ds._origBorder;       delete ds._origBorder; }
      if (ds._origBorderWidth !== undefined)  { ds.borderWidth        = ds._origBorderWidth;  delete ds._origBorderWidth; }
      if (ds._origPtBg !== undefined)         { ds.pointBackgroundColor = ds._origPtBg;       delete ds._origPtBg; }
      if (ds._origPtR !== undefined)          { ds.pointRadius        = ds._origPtR;          delete ds._origPtR; }
    }
    _hlDataset = -1; _hlIndex = -1;
    chart.update('none');
  }

  function interact(clientX, clientY) {
    const chart = charts[canvasId];
    if (!chart) return;
    const meta = chartMeta[canvasId];

    if (meta.type === 'radar') {
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left, py = clientY - rect.top;
      const ca = chart.chartArea;
      const cx = (ca.left + ca.right) / 2, cy = (ca.top + ca.bottom) / 2;
      const n = chart.data.labels.length;
      const angle = Math.atan2(py - cy, px - cx);
      const norm = (angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
      const index = Math.round(norm / (2 * Math.PI / n)) % n;
      const slotIdx = 0;
      const temp = selected[meta.slotMap[slotIdx]];
      if (!temp) return;
      setHighlight(chart, slotIdx, index);
      playForType(meta.type, index, temp.offsets);
      return;
    }

    // Bar / line: detectar columna y dataset
    // 1) Intentar hit exacto sobre una barra
    let els = chart.getElementsAtEventForMode({ clientX, clientY }, 'nearest', { intersect: true }, false);

    // 2) Si no hay hit exacto: detectar columna por X y dataset por Y
    if (!els.length) {
      // Detectar índice de columna por posición X
      const colEls = chart.getElementsAtEventForMode({ clientX, clientY }, 'index', { intersect: false }, false);
      if (!colEls.length) return;
      const colIndex = colEls[0].index;
      const nDatasets = chart.data.datasets.length;

      if (nDatasets === 1) {
        // Un solo temperamento: usar directamente
        els = [{ datasetIndex: 0, index: colIndex }];
      } else {
        // Varios datasets: detectar por X en qué barra (columna extendida) cae el click
        const rect = canvas.getBoundingClientRect();
        const px = clientX - rect.left;
        let bestDs = 0, bestDist = Infinity;
        for (let di = 0; di < nDatasets; di++) {
          const barEl = chart.getDatasetMeta(di).data[colIndex];
          if (!barEl) continue;
          const hw = (barEl.width ?? 0) / 2;
          const barLeft = barEl.x - hw, barRight = barEl.x + hw;
          if (px >= barLeft && px <= barRight) { bestDs = di; break; } // dentro de la columna
          const dist = Math.min(Math.abs(px - barLeft), Math.abs(px - barRight));
          if (dist < bestDist) { bestDist = dist; bestDs = di; }
        }
        els = [{ datasetIndex: bestDs, index: colIndex }];
      }
    }

    if (!els.length) return;
    const { datasetIndex, index } = els[0];
    const temp = selected[meta.slotMap[datasetIndex]];
    if (!temp) return;
    setHighlight(chart, datasetIndex, index);
    playForType(meta.type, index, temp.offsets);
  }

  function release() {
    const chart = charts[canvasId];
    clearHighlight(chart);
    stopSound();
  }

  let pressing = false;
  // Mouse
  canvas.addEventListener('mousedown', e => { e.preventDefault(); pressing = true; interact(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove', e => { if (pressing) interact(e.clientX, e.clientY); });
  canvas.addEventListener('mouseup',    () => { pressing = false; release(); });
  canvas.addEventListener('mouseleave', () => { if (pressing) { pressing = false; release(); } });
  // Touch
  let _tx0 = 0, _ty0 = 0, _scrolling = false;
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    _tx0 = t.clientX; _ty0 = t.clientY; _scrolling = false; pressing = true;
    interact(t.clientX, t.clientY);
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!_scrolling && Math.abs(t.clientY - _ty0) > 8) { _scrolling = true; pressing = false; release(); }
    if (pressing && !_scrolling) interact(t.clientX, t.clientY);
  }, { passive: true });
  canvas.addEventListener('touchend',    () => { pressing = false; release(); });
  canvas.addEventListener('touchcancel', () => { pressing = false; release(); });
}

// ══════════════════════════════════════════════
// CIRCLE AUDIO BINDING
// ══════════════════════════════════════════════
function bindCircleAudio() {
  const wrap = document.getElementById('circle-wrap');
  if (!wrap) return;
  wrap.style.cursor = 'crosshair';
  let _hlPath = null;

  function getPath(cx,cy) { return document.elementFromPoint(cx,cy)?.closest('[data-fi]'); }

  function setHL(p) {
    if (_hlPath === p) return;
    clearHL();
    _hlPath = p;
    if (p) {
      p._origStroke = p.style.stroke;
      p._origStrokeW = p.style.strokeWidth;
      p._origOpacity = p.style.opacity;
      p.style.stroke = '#fff';
      p.style.strokeWidth = '2';
      p.style.opacity = '1';
    }
  }
  function clearHL() {
    if (!_hlPath) return;
    _hlPath.style.stroke = _hlPath._origStroke ?? '';
    _hlPath.style.strokeWidth = _hlPath._origStrokeW ?? '';
    _hlPath.style.opacity = _hlPath._origOpacity ?? '';
    _hlPath = null;
  }

  function interact(cx,cy) {
    const p=getPath(cx,cy); if(!p) return;
    const temp=selected[+p.dataset.ti]; if(!temp) return;
    setHL(p);
    playFifthAudio(+p.dataset.fi, temp.offsets);
  }
  function release() { clearHL(); stopSound(); }

  let pressing=false;
  wrap.addEventListener('mousedown', e => { pressing=true; interact(e.clientX,e.clientY); });
  wrap.addEventListener('mousemove', e => { if(pressing) interact(e.clientX,e.clientY); });
  wrap.addEventListener('mouseup',    () => { pressing=false; release(); });
  wrap.addEventListener('mouseleave', () => { if(pressing){ pressing=false; release(); } });
  let _cy0 = 0, _cscrolling = false;
  wrap.addEventListener('touchstart', e => {
    const t = e.touches[0]; _cy0 = t.clientY; _cscrolling = false; pressing = true;
    interact(t.clientX, t.clientY);
  }, { passive: true });
  wrap.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (!_cscrolling && Math.abs(t.clientY - _cy0) > 8) { _cscrolling = true; pressing = false; release(); }
    if (pressing && !_cscrolling) interact(t.clientX, t.clientY);
  }, { passive: true });
  wrap.addEventListener('touchend',    () => { pressing = false; release(); });
  wrap.addEventListener('touchcancel', () => { pressing = false; release(); });
}

// ══════════════════════════════════════════════
// TECLADO (KB)
// ══════════════════════════════════════════════
const KB = {
  mode:     'normal',   // 'normal' | 'legato' | 'chord'
  octave:   4,
  chordMap: new Map(),  // key(ni,oct) → audioNode
  singleNode: null,
  singleKey:  null,
  mouseDown:  false,
  touchId:    null,
  _moveL:     null,
  _upL:       null,

  key(ni, oct) { return `${ni}_${oct}`; },

  getOffsets() { return (lastSelected ?? selected.find(Boolean))?.offsets ?? new Array(12).fill(0); },

  freq(ni, oct) {
    const cents = ET_FROM_A[ni] + this.getOffsets()[ni] + (oct - 4) * 1200;
    return pitchA * Math.pow(2, cents / 1200);
  },

  // ── audio node ──
  startNode(ni, oct) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.55, now + 0.012);
    g.connect(masterGain);
    const osc = ctx.createOscillator();
    const f = this.freq(ni, oct);
    _applyWave(osc, ctx, currentWave, f);
    osc.frequency.value = f;
    osc.connect(g);
    osc.start(now);
    return { osc, g, ni, oct };
  },

  stopNode(node, hard = false) {
    if (!node) return;
    const now = audioCtx?.currentTime ?? 0;
    if (hard) {
      try { node.osc.stop(); node.osc.disconnect(); node.g.disconnect(); } catch(e){}
      return;
    }
    node.g.gain.cancelScheduledValues(now);
    node.g.gain.setValueAtTime(node.g.gain.value, now);
    node.g.gain.linearRampToValueAtTime(0, now + 0.08);
    setTimeout(() => { try { node.osc.stop(); node.osc.disconnect(); node.g.disconnect(); } catch(e){} }, 140);
  },

  // ── mode ──
  setMode(m) {
    this.clearAll();
    this.mode = m;
    document.querySelectorAll('.kb-mode').forEach(b => b.classList.toggle('sel', b.dataset.mode === m));
    const btn = document.getElementById('kb-clear-btn');
    if (btn) btn.style.display = m === 'chord' ? 'inline-block' : 'none';
  },

  shiftOct(d) {
    const prevOctave = this.octave;
    this.octave = Math.max(1, Math.min(7, this.octave + d));

    if (this.mode === 'legato' && this.singleNode) {
      // Legato: transponer la nota activa a la nueva octava
      const savedNi  = this.singleNode.ni;
      const savedRel = this.singleNode.oct - prevOctave;
      this.stopNode(this.singleNode);
      this.singleNode = null; this.singleKey = null;
      const newOct = this.octave + savedRel;
      this.singleNode = this.startNode(savedNi, newOct);
      this.singleKey  = this.key(savedNi, newOct);
    } else if (this.mode === 'chord' && this.chordMap.size > 0) {
      // Acorde: transponer todas las notas activas a la nueva octava
      const saved = [...this.chordMap.entries()].map(([k, node]) => ({
        ni: node.ni, rel: node.oct - prevOctave
      }));
      this.chordMap.forEach(n => this.stopNode(n));
      this.chordMap.clear();
      saved.forEach(({ ni, rel }) => {
        const newOct = this.octave + rel;
        const node = this.startNode(ni, newOct);
        this.chordMap.set(this.key(ni, newOct), node);
      });
    } else {
      this.clearAll();
    }

    const lbl = document.getElementById('kb-oct-lbl');
    if (lbl) lbl.textContent = `Oct. ${this.octave}–${this.octave+2}`;
    this.render();
    this.updateKeys();
  },

  shiftSemitone(d) {
    // En legato/normal con nota sonando: avanzar desde la nota activa
    // Sin nota sonando: empezar desde C de la octava actual
    let ni, oct;
    if (this.singleNode) {
      ni = this.singleNode.ni + d;
      oct = this.singleNode.oct;
    } else {
      ni = d > 0 ? 0 : 11;
      oct = d > 0 ? this.octave : this.octave + 2;
    }
    if (ni > 11) { ni = 0; oct++; }
    else if (ni < 0) { ni = 11; oct--; }
    if (oct < 1 || oct > 8) return;
    if (oct < this.octave) this.octave = oct;
    else if (oct > this.octave + 2) this.octave = oct - 2;
    // En normal: simular pulsación breve; en legato/chord: press normal
    if (this.mode === 'normal') {
      this.stopNode(this.singleNode);
      this.singleNode = this.startNode(ni, oct);
      this.singleKey = this.key(ni, oct);
      this.updateKeys();
      this.showLabel(ni, oct);
    } else {
      this.press(ni, oct);
    }
    const lbl = document.getElementById('kb-oct-lbl');
    if (lbl) lbl.textContent = `Oct. ${this.octave}–${this.octave+2}`;
    this.render();
  },

  // ── state ──
  isActive(ni, oct) {
    const k = this.key(ni, oct);
    return this.mode === 'chord' ? this.chordMap.has(k) : this.singleKey === k;
  },

  press(ni, oct) {
    getCtx(); // ensure context
    const k = this.key(ni, oct);
    if (this.mode === 'chord') {
      if (this.chordMap.has(k)) { this.stopNode(this.chordMap.get(k)); this.chordMap.delete(k); }
      else { this.chordMap.set(k, this.startNode(ni, oct)); }
    } else {
      if (this.singleKey === k) {
        if (this.mode === 'normal') return; // ya sonando, ignorar re-entrada
        // legato: misma nota → apagar (toggle)
        this.stopNode(this.singleNode);
        this.singleNode = null; this.singleKey = null;
      } else {
        this.stopNode(this.singleNode);
        this.singleNode = this.startNode(ni, oct);
        this.singleKey  = k;
      }
    }
    this.updateKeys();
    this.showLabel(ni, oct);
  },

  release(ni, oct) {
    if (this.mode !== 'normal') return;
    const k = this.key(ni, oct);
    if (this.singleKey === k) {
      this.stopNode(this.singleNode);
      this.singleNode = null; this.singleKey = null;
      this.updateKeys();
    }
  },

  enter(ni, oct) {
    if (!this.mouseDown && this.touchId === null) return;
    if (this.mode === 'normal' || this.mode === 'legato') this.press(ni, oct);
  },

  clearAll() {
    this.stopNode(this.singleNode); this.singleNode = null; this.singleKey = null;
    this.chordMap.forEach(n => this.stopNode(n)); this.chordMap.clear();
    this.updateKeys();
  },

  updateKeys() {
    document.querySelectorAll('[data-ni]').forEach(el => {
      el.classList.toggle('ka', this.isActive(+el.dataset.ni, +el.dataset.oct));
    });
    const btn = document.getElementById('kb-clear-btn');
    if (btn) btn.style.opacity = this.chordMap.size > 0 ? '1' : '0.4';
  },

  showLabel(ni, oct) {
    const el = document.getElementById('kb-lbl');
    if (!el) return;
    if (this.mode === 'chord' && this.chordMap.size > 0) {
      const notes = [...this.chordMap.keys()].map(k => {
        const [n,o] = k.split('_').map(Number);
        return NOTES[n] + o;
      }).join(' + ');
      el.textContent = notes;
    } else {
      const f = this.freq(ni, oct).toFixed(2);
      const dev = this.getOffsets()[ni];
      el.textContent = `${NOTES[ni]}${oct}  ·  ${f} Hz  ·  ${dev>=0?'+':''}${dev.toFixed(2)}¢ vs ET`;
    }
  },

  // ── render ──
  render() {
    const wrap = document.getElementById('kb-wrap');
    if (!wrap) return;
    const mob = isMobile();
    // 3 octavas siempre; en móvil se ajusta para que 2 octavas sean cómodas (3ª scrollable)
    const nO = 3;
    const availW = mob ? (window.innerWidth - 16) : Math.max(480, (document.getElementById('kb-wrap')?.clientWidth || 700) - 8);
    const visOct = mob ? 1.5 : 3;
    const W  = Math.max(mob ? 36 : 28, Math.floor(availW / (visOct * 7)));
    const H  = Math.round(W * (mob ? 4.5 : 3.6));
    const BW = Math.round(W * 0.58);
    const BH = Math.round(H * 0.62);
    const totalW = W * 7 * nO + 1;

    const WN = [0,2,4,5,7,9,11];   // note idx for white keys
    const WL = ['C','D','E','F','G','A','B'];
    const BK = [{ni:1,cx:1},{ni:3,cx:2},{ni:6,cx:4},{ni:8,cx:5},{ni:10,cx:6}];

    let html = `<div id="kb" style="position:relative;height:${H+2}px;width:${totalW}px;user-select:none;-webkit-user-select:none;touch-action:manipulation">`;

    for (let o = 0; o < nO; o++) {
      const oct = this.octave + o;
      const ox  = o * W * 7;

      WN.forEach((ni, wi) => {
        const x   = ox + wi * W;
        const act = this.isActive(ni, oct);
        const lbl = ni === 0 ? `C${oct}` : WL[wi];
        html += `<div class="kw${act?' ka':''}" style="left:${x}px;width:${W-1}px;height:${H}px" data-ni="${ni}" data-oct="${oct}"><span class="klbl">${lbl}</span></div>`;
      });

      BK.forEach(({ni, cx}) => {
        const x   = ox + cx * W - BW / 2;
        const act = this.isActive(ni, oct);
        html += `<div class="kb2${act?' ka':''}" style="left:${x}px;width:${BW}px;height:${BH}px" data-ni="${ni}" data-oct="${oct}"></div>`;
      });
    }

    html += '</div>';
    wrap.innerHTML = html;
    this.setupKbEvents();
    this.updateKeys();
  },

  // ── events ──
  setupKbEvents() {
    const kb = document.getElementById('kb');
    if (!kb) return;

    // Remove stale window listeners
    if (this._moveL) window.removeEventListener('mousemove', this._moveL);
    if (this._upL)   window.removeEventListener('mouseup',   this._upL);

    const getKey = (cx, cy) => document.elementFromPoint(cx, cy)?.closest('[data-ni]');

    // El browser sintetiza mousedown ~300 ms después de un touchend si no hay preventDefault.
    // Ese mousedown haría toggle de la nota en legato → la apagaría. Ignorarlo.
    let _lastTouchTs = 0;

    kb.addEventListener('mousedown', e => {
      if (Date.now() - _lastTouchTs < 700) return; // ignorar mousedown sintético post-touch
      this.mouseDown = true;
      const k = getKey(e.clientX, e.clientY);
      if (k) this.press(+k.dataset.ni, +k.dataset.oct);
    });

    this._moveL = e => {
      if (!this.mouseDown) return;
      const k = getKey(e.clientX, e.clientY);
      if (k) this.enter(+k.dataset.ni, +k.dataset.oct);
    };
    this._upL = e => {
      if (!this.mouseDown) return;
      this.mouseDown = false;
      const k = getKey(e.clientX, e.clientY);
      if (k) this.release(+k.dataset.ni, +k.dataset.oct);
      else if (this.mode === 'normal') {
        this.stopNode(this.singleNode); this.singleNode = null; this.singleKey = null; this.updateKeys();
      }
    };
    window.addEventListener('mousemove', this._moveL);
    window.addEventListener('mouseup',   this._upL);

    // Touch: tap/hold plays note; cancela si el dedo se mueve (scroll)
    let _tpKey = null, _tpX = 0, _tpY = 0, _tpScrolling = false;
    kb.addEventListener('touchstart', e => {
      _lastTouchTs = Date.now();
      this.touchId = e.changedTouches[0].identifier;
      _tpKey = null; _tpScrolling = false;
      const t = e.changedTouches[0];
      _tpX = t.clientX; _tpY = t.clientY;
      const k = getKey(t.clientX, t.clientY);
      if (k) { _tpKey = { ni: +k.dataset.ni, oct: +k.dataset.oct }; this.press(_tpKey.ni, _tpKey.oct); }
    }, { passive: true });

    kb.addEventListener('touchmove', e => {
      if (_tpScrolling || !_tpKey) return;
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - _tpX) > 10 || Math.abs(t.clientY - _tpY) > 10) {
        _tpScrolling = true;
        this.release(_tpKey.ni, _tpKey.oct);
        _tpKey = null;
      }
    }, { passive: true });

    kb.addEventListener('touchend', e => {
      const pressed = _tpKey;
      this.touchId = null; _tpKey = null; _tpScrolling = false;
      if (pressed) this.release(pressed.ni, pressed.oct);
      else if (this.mode === 'normal') {
        this.stopNode(this.singleNode); this.singleNode=null; this.singleKey=null; this.updateKeys();
      }
    }, { passive: true });

    kb.addEventListener('touchcancel', () => {
      this.touchId = null; _tpKey = null; _tpScrolling = false;
      if (this.mode === 'normal') { this.stopNode(this.singleNode); this.singleNode=null; this.singleKey=null; this.updateKeys(); }
    }, { passive: true });
  }
};

// ══════════════════════════════════════════════
// MÓVIL
// ══════════════════════════════════════════════
const isMobile = () => window.innerWidth < 768;
function openSidebar()  { document.getElementById('sidebar').classList.add('open'); document.getElementById('overlay').classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }

// Swipe izquierda en el sidebar para cerrarlo (móvil)
(function() {
  let sx = 0, sy = 0;
  const sb = document.getElementById('sidebar');
  sb.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  sb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (dx < -50 && Math.abs(dy) < Math.abs(dx)) closeSidebar();
  }, { passive: true });
})();

// ══════════════════════════════════════════════
// CARGA Y PARSEO
// ══════════════════════════════════════════════
async function loadData() {
  let text = null;
  for (const p of ['temperaments.md','./temperaments.md','../docs/temperaments.md']) {
    try { const r = await fetch(p); if (r.ok) { text = await r.text(); break; } } catch(e) {}
  }
  if (!text) {
    document.getElementById('list').innerHTML =
      '<div style="padding:14px;font-size:11px;color:#6b7280">No se pudo cargar temperaments.md.<br>Sirve desde docs/ con:<br><code>python -m http.server</code></div>';
    return;
  }
  parseMarkdown(text);
}

function parseMarkdown(text) {
  // Parseo puro delegado a core.js
  const temps = parseTempMarkdown(text);
  // Inicializar campo notes e inyectar notas del usuario guardadas
  const _notesStore = loadTempNotesStore();
  temps.forEach(t => { t.notes = _notesStore[t.name] ?? ''; });
  all = temps;
  injectUserTemps();
  restoreSession();
  refreshList();
  window.dispatchEvent(new Event('_dataReady'));
}

function restoreSession() {
  const p = loadPrefs();
  // Restaurar pitch A
  // Validar rango: pitchA debe estar entre 390–470 Hz (A4 estándar ± ~3 semitonos)
  if (p.pitchA && p.pitchA >= 390 && p.pitchA <= 470) {
    pitchA = p.pitchA;
    document.getElementById('pitch-input').value = p.pitchA;
  }
  // Restaurar onda
  if (p.wave) {
    currentWave = p.wave;
    document.getElementById('wave-sel').value = p.wave;
  }
  // Restaurar octava
  if (p.octaveShift !== undefined) {
    octaveShift = p.octaveShift;
    const el = document.getElementById('oct-disp');
    if (el) el.textContent = octaveShift > 0 ? '+' + octaveShift : String(octaveShift);
  }
  // Restaurar modo tuner
  if (p.tunerMode) TUNER.mode = p.tunerMode;
  if (p.tunerVizMode) TUNER.vizMode = p.tunerVizMode;
  // Restaurar octava del afinador
  if (p.tunerOct !== undefined) TUNER.tunerOct = p.tunerOct;
  // Restaurar filtro de fuentes del medidor
  if (p.dtSuggSources !== undefined) DT._suggSources = p.dtSuggSources ? new Set(p.dtSuggSources) : null;
  // La barra de audio siempre visible al iniciar (no persistir estado oculto)
  // Restaurar temperamento seleccionado; si nunca se eligió, usar Equal temperament de GrandOrgue
  const nameToRestore = p.selectedName || 'Equal temperament';
  const t = all.find(x => x.name === nameToRestore && (!p.selectedName ? x.source === 'GrandOrgue' : true));

  // Inicializar workspace (migrar desde prefs si es la primera vez)
  WS.migrateFromLegacy(p.activeTab && p.activeTab !== 'tuner' ? p.activeTab : 'overview');
  WS.init();

  if (t) { selected[0] = t; lastSelected = t; renderBadges(); renderContent(); }
}

// ══════════════════════════════════════════════
// LISTA
// ══════════════════════════════════════════════
function selClass(t) { const i=selected.findIndex(s=>s&&s.name===t.name); return i>=0?`sel${i}`:''; }

function renderList(temps) {
  const el = document.getElementById('list');
  if (!temps.length) { el.innerHTML='<div style="padding:12px;font-size:11px;color:#6b7280">Sin resultados</div>'; return; }
  // Favoritos primero
  const fav = temps.filter(t => favs.has(t.name));
  const rest = temps.filter(t => !favs.has(t.name));
  const ordered = [...fav, ...rest];
  let html = '';
  if (fav.length && rest.length) html += `<div style="font-size:9px;color:#6b7280;padding:4px 8px 2px;letter-spacing:.5px">★ FAVORITOS</div>`;
  html += fav.map(t => itemHtml(t)).join('');
  if (fav.length && rest.length) html += `<div style="font-size:9px;color:#6b7280;padding:6px 8px 2px;letter-spacing:.5px">OTROS</div>`;
  html += rest.map(t => itemHtml(t)).join('');
  el.innerHTML = html;
}
function itemHtml(t) {
  const i = all.indexOf(t);
  const isFav = favs.has(t.name);
  const isUser = t.source === 'Usuario';
  const safeName = t.name.replace(/'/g,"\\'");
  return `<div class="temp-item ${selClass(t)}" onclick="toggleSelect(${i})" title="${t.name} [${t.source}]">
    <span class="fav-btn${isFav?' fav-on':''}" onclick="toggleFav('${safeName}',event)" title="${isFav?'Quitar de favoritos':'Añadir a favoritos'}">${isFav?'★':'☆'}</span>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${t.name}</span>
    ${isUser ? `<span onclick="deleteUserTemp('${safeName}');event.stopPropagation()" style="padding:0 3px;color:#6b7280;font-size:11px;cursor:pointer;flex-shrink:0" title="Eliminar">✕</span>` : ''}
    <span onclick="openTempMenu(${i},event)" style="padding:2px 5px;color:#94a3b8;font-size:15px;font-weight:700;cursor:pointer;flex-shrink:0;line-height:1;border-radius:4px;letter-spacing:1px" title="Opciones">···</span>
  </div>`;
}

function getFilteredList() {
  const q = document.getElementById('search').value.toLowerCase();
  let f = all.filter(t => !q || t.name.toLowerCase().includes(q) || t.source.toLowerCase().includes(q));
  const KNOWN_SRCS = ['Scala','GrandOrgue','Asselin','Usuario'];
  if (srcFilter !== 'Todos' && srcFilter !== 'Otros') f = f.filter(t => t.source === srcFilter);
  else if (srcFilter === 'Otros') f = f.filter(t => !KNOWN_SRCS.includes(t.source));
  if (showFavsOnly) f = f.filter(t => favs.has(t.name));
  return f;
}
function refreshList() {
  const f = getFilteredList();
  const q = document.getElementById('search').value.trim().toLowerCase();
  const filtered = showFavsOnly || srcFilter !== 'Todos' || q;
  document.getElementById('count').textContent = filtered
    ? `${f.length} / ${all.length}` : `${all.length} temperamentos`;
  renderList(f);
}
function toggleFavFilter() {
  showFavsOnly = !showFavsOnly;
  const btn = document.getElementById('fav-btn');
  btn.style.color    = showFavsOnly ? '#fbbf24' : '#9ca3af';
  btn.style.borderColor = showFavsOnly ? '#fbbf24' : '';
  refreshList();
}
document.getElementById('search').addEventListener('input', refreshList);

// ══════════════════════════════════════════════
// SELECCIÓN
// ══════════════════════════════════════════════
function toggleSelect(idx) {
  const t = all[idx];
  const ei = selected.findIndex(s => s && s.name === t.name);
  // Multi-selección siempre: hasta 3 temperamentos en paralelo
  if (ei >= 0) {
    selected[ei] = null;
    if (lastSelected?.name === t.name) lastSelected = selected.find(Boolean) ?? null;
  } else {
    const free = selected.findIndex(s => !s);
    if (free >= 0) selected[free] = t; else selected = [t, null, null];
    lastSelected = t;
    savePrefs({ selectedName: t.name });
  }
  renderBadges();
  refreshList();
  updateTunerTempName();
  if (isMobile()) closeSidebar();
  renderContent();
}

function updateTunerTempName() {
  const el = document.getElementById('tuner-temp-name');
  if (el) el.textContent = tunerTempName();
}
function renderBadges() {
  const act = selected.filter(Boolean);
  const html = selected.map((t,i) => {
    if (!t) return '';
    const tidx = all.indexOf(t);
    return `<span class="badge badge${i}"><span class="badge-menu-btn" onclick="openTempMenu(${tidx},event)" title="Opciones">···</span>${shortName(t,20)}<span class="badge-close-btn" onclick="clearSel(${i})" title="Quitar">✕</span></span>`;
  }).join('');
  document.getElementById('desk-badges').innerHTML = html;
  document.getElementById('mob-badges').innerHTML  = html;
  // En móvil: ocultar el título cuando hay temperamentos seleccionados para ganar espacio
  const mobTitle = document.getElementById('mob-title');
  if (mobTitle) mobTitle.style.display = act.length ? 'none' : '';
}
function clearSel(i) { selected[i]=null; renderBadges(); refreshList(); renderContent(); }

// ══════════════════════════════════════════════
// TABS — gestionados por WS (workspace.js)
// ══════════════════════════════════════════════
// Los clicks de pestaña los maneja WS.switchTab() vía onclick en el HTML generado.

// ══════════════════════════════════════════════
// SWIPE HORIZONTAL EN CONTENT PARA CAMBIAR PESTAÑA (móvil)
// ══════════════════════════════════════════════
(function() {
  let sx = 0, sy = 0, swiping = false;
  document.getElementById('content').addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
  }, { passive: true });
  document.getElementById('content').addEventListener('touchend', e => {
    if (!swiping) return; swiping = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < window.innerWidth * 0.6 || Math.abs(dx) < Math.abs(dy) * 4) return;
    WS.switchTabRelative(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// getFifths, getMaj3, getMin3 → vienen de core.js

// ══════════════════════════════════════════════
// COLORES
// ══════════════════════════════════════════════
function fifthColor(dev) {
  const t=Math.max(-1,Math.min(1,dev/8));
  if(t<=0){const r=Math.round(239*(-t)),g=Math.round(180*(1+t*0.6));return `rgb(${r},${g},30)`;}
  else{const g=Math.round(100*(1-t)),b=Math.round(255*t);return `rgb(140,${g},${b})`;}
}

// ══════════════════════════════════════════════
// CÍRCULO DE QUINTAS SVG
// ══════════════════════════════════════════════
function drawCircle(selTemps) {
  const S=270,cx=S/2,cy=S/2,R=108,gap=0.04;
  let svg=`<svg viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:270px;height:auto">`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="${R+8}" fill="none" stroke="#374151" stroke-width="1"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="38" fill="#111827"/>`;
  selTemps.forEach((temp,ti)=>{
    if(!temp) return;
    const fif=getFifths(temp.offsets),ro=R-ti*19,ri=ro-17;
    fif.forEach((f,i)=>{
      const a0=(i/12)*2*Math.PI-Math.PI/2,a1=((i+1)/12)*2*Math.PI-Math.PI/2;
      const c=(a,r)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
      const [x1,y1]=c(a0+gap,ro),[x2,y2]=c(a1-gap,ro),[x3,y3]=c(a1-gap,ri),[x4,y4]=c(a0+gap,ri);
      svg+=`<path d="M${x1},${y1} A${ro},${ro} 0 0,1 ${x2},${y2} L${x3},${y3} A${ri},${ri} 0 0,0 ${x4},${y4} Z"
        fill="${fifthColor(f.dev)}" stroke="#111827" stroke-width="0.8"
        data-fi="${i}" data-ti="${ti}" style="cursor:crosshair">
        <title>${f.from}→${f.to}: ${f.size.toFixed(2)}¢ (${f.dev>=0?'+':''}${f.dev.toFixed(3)}¢)</title></path>`;
    });
  });
  FIFTH_LBL.forEach((lbl,i)=>{
    const a=(i/12)*2*Math.PI-Math.PI/2;
    svg+=`<text x="${cx+(R+18)*Math.cos(a)}" y="${cy+(R+18)*Math.sin(a)}" text-anchor="middle" dominant-baseline="middle"
      font-size="11" fill="#d1d5db" font-family="sans-serif" font-weight="500">${lbl}</text>`;
  });
  svg+='</svg>';
  return svg;
}

// Leyenda HTML de identidad de temperamentos (fuera del SVG del círculo)
function circleHtml(selTemps) {
  const act = selTemps.filter(Boolean);
  const legend = act.length > 1
    ? `<div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:11px;flex-wrap:wrap">`
      + act.map(t => { const ci=selTemps.indexOf(t); return `<span style="color:${COLORS[ci]}">● ${shortName(t,22)}</span>`; }).join('')
      + `</div>`
    : '';
  return `<div id="circle-wrap">${drawCircle(selTemps)}</div>${legend}`;
}

// Etiquetas de identidad para gráficas cuyo color de barra es de pureza, no de temperamento
function tempIdentityHtml(act) {
  return `<div style="display:flex;gap:14px;justify-content:center;margin-bottom:4px;font-size:11px;flex-wrap:wrap">`
    + act.map(t => { const ci=selected.indexOf(t); return `<span style="color:${COLORS[ci]}">■ ${shortName(t,24)}</span>`; }).join('')
    + `</div>`;
}

// ══════════════════════════════════════════════
// TABLAS
// ══════════════════════════════════════════════
function statsTable(temp) {
  const fif=getFifths(temp.offsets),maj=getMaj3(temp.offsets);
  const wf=fif.reduce((a,b)=>Math.abs(a.dev)>Math.abs(b.dev)?a:b);
  const bf=fif.reduce((a,b)=>Math.abs(a.dev)<Math.abs(b.dev)?a:b);
  const avgF=fif.reduce((s,f)=>s+f.dev,0)/12;
  const wm=maj.reduce((a,b)=>Math.abs(a.dev)>Math.abs(b.dev)?a:b);
  const bm=maj.reduce((a,b)=>Math.abs(a.dev)<Math.abs(b.dev)?a:b);
  const f=v=>`${v>=0?'+':''}${v.toFixed(2)}¢`;
  const cc=v=>v>8?'#f87171':v<-4?'#fb923c':v>3?'#a78bfa':'#4ade80';
  return `<table>
    <tr><th>Métrica</th><th>Notas</th><th>Valor</th></tr>
    <tr><td style="color:var(--muted)">Quinta más pura</td><td>${bf.from}→${bf.to}</td><td style="color:${cc(bf.dev)}">${bf.size.toFixed(2)}¢ (${f(bf.dev)})</td></tr>
    <tr><td style="color:var(--muted)">Quinta más impura</td><td>${wf.from}→${wf.to}</td><td style="color:${cc(wf.dev)}">${wf.size.toFixed(2)}¢ (${f(wf.dev)})</td></tr>
    <tr><td style="color:var(--muted)">Desv. media quintas</td><td>—</td><td style="color:${cc(avgF)}">${f(avgF)}</td></tr>
    <tr><td style="color:var(--muted)">3ª mayor más pura</td><td>${bm.from}→${bm.to}</td><td style="color:#4ade80">${bm.size.toFixed(2)}¢ (${f(bm.dev)})</td></tr>
    <tr><td style="color:var(--muted)">3ª mayor más impura</td><td>${wm.from}→${wm.to}</td><td style="color:#f87171">${wm.size.toFixed(2)}¢ (${f(wm.dev)})</td></tr>
  </table>`;
}

// Color según desviación de quinta pura
function fifthDevColor(dev) {
  if (dev < -8)  return '#ef4444'; // muy estrecha
  if (dev < -4)  return '#fb923c'; // estrecha
  if (dev < -0.5) return '#facc15'; // levemente estrecha
  if (dev < 0.5) return '#4ade80'; // casi pura
  if (dev < 3)   return '#c084fc'; // levemente ancha
  return '#a21caf';                 // muy ancha
}
// Color según desviación de 3ª mayor pura
function maj3DevColor(dev) {
  if (dev < -4)  return '#60a5fa'; // muy plana (rara, casi no existe)
  if (dev < 0)   return '#4ade80'; // más pura que ET - lo mejor
  if (dev < 6)   return '#a3e635'; // levemente alta
  if (dev < 12)  return '#fb923c'; // alta
  return '#ef4444';                 // muy alta (como ET +14¢)
}
// Tabla de offsets respecto al ET
function offsetsTable(temps) {
  const rows = NOTES.map((n, i) =>
    `<tr><td style="color:#94a3b8;font-weight:600;padding:1px 8px 1px 0;white-space:nowrap">${n}</td>${
      temps.map(t => {
        const v = t.offsets[i];
        const c = Math.abs(v) < 1 ? '#4ade80' : Math.abs(v) < 5 ? '#facc15' : '#f87171';
        return `<td style="text-align:right;padding:1px 0 1px 2px;color:${c};font-variant-numeric:tabular-nums;white-space:nowrap">${v>=0?'+':''}${v.toFixed(2)}¢</td>`;
      }).join('')
    }</tr>`
  ).join('');
  const hdr = temps.length > 1
    ? `<tr><th style="padding:1px 8px 1px 0">Nota</th>${temps.map(t=>`<th style="text-align:right;padding:1px 0 1px 2px">${shortName(t,18)}</th>`).join('')}</tr>`
    : '';
  return `<table style="border-collapse:collapse;font-size:12px;width:auto">${hdr}${rows}</table>`;
}

function fifthsTable(temp) {
  return `<table><tr><th>Quinta</th><th>¢</th><th>Desv.</th></tr>${getFifths(temp.offsets).map(f=>{
    const c=f.dev<-5?'#f87171':f.dev>2?'#a78bfa':f.dev<-1?'#fb923c':'#4ade80';
    return `<tr><td style="color:var(--muted)">${f.from}→${f.to}</td><td>${f.size.toFixed(2)}</td><td style="color:${c};text-align:right">${f.dev>=0?'+':''}${f.dev.toFixed(3)}¢</td></tr>`;
  }).join('')}</table>`;
}

function thirdsTableFn(temp) {
  return `<table><tr><th>3ª Mayor</th><th>¢</th><th>Desv.</th></tr>${getMaj3(temp.offsets).map(t=>{
    const c=t.dev>15?'#f87171':t.dev>6?'#fb923c':t.dev<0?'#60a5fa':'#4ade80';
    return `<tr><td style="color:var(--muted)">${t.from}→${t.to}</td><td>${t.size.toFixed(2)}</td><td style="color:${c};text-align:right">${t.dev>=0?'+':''}${t.dev.toFixed(2)}¢</td></tr>`;
  }).join('')}</table>`;
}

// ══════════════════════════════════════════════
// CHART.JS HELPERS
// ══════════════════════════════════════════════
function destroyCharts() {
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {}; chartMeta = {};
}
const shortName = (t,n=32) => t.name.length>n ? t.name.slice(0,n-1)+'…' : t.name;
function activeSlotMap() { return selected.map((t,i)=>({t,i})).filter(x=>x.t).map(x=>x.i); }

const gridColor='#374151', tickColor='#9ca3af';
const baseOpts = { responsive:true, maintainAspectRatio:false, animation:{duration:250},
  plugins:{legend:{labels:{color:'#d1d5db',font:{size:11},boxWidth:14}}} };
const ds = (t,i,data,extra={}) => ({ label:shortName(t), data, backgroundColor:COLORS_A[i], borderColor:COLORS[i], borderWidth:isMobile()?1.5:2, minBarLength:3, ...extra });
const dsFifth = (t,i,devs) => ({ label:shortName(t), data:devs, backgroundColor:devs.map(fifthDevColor), borderColor:devs.map(fifthDevColor), borderWidth:1, minBarLength:3 });
const dsMaj3  = (t,i,devs) => ({ label:shortName(t), data:devs, backgroundColor:devs.map(maj3DevColor),  borderColor:devs.map(maj3DevColor),  borderWidth:1, minBarLength:3 });

function _attachChartResize(id, c) {
  // Chart.js (responsive:true) gestiona su propio ResizeObserver interno.
  // NO llamar attachPanelResize aquí: eso añadiría un segundo observer que
  // dispara _redraw → chart.resize → el panel cambia → observer dispara → bucle infinito.
  // _attachChartResize existe solo para compatibilidad futura (p.ej. drag-resize manual).
}

// Envuelve el canvas en un div de altura fija + handle de resize.
// Height fija es imprescindible: Chart.js (responsive:true) observa el padre;
// si el padre tiene height:auto crece sin fin. El handle permite al usuario estirar.
function _wrapCanvas(c) {
  const h = parseInt(c.getAttribute('height') || '160', 10);
  const wrap = document.createElement('div');
  wrap.style.cssText = `height:${h}px;width:100%;overflow:hidden`;
  c.removeAttribute('height');
  // NO tocar estilos del canvas — Chart.js los gestiona internamente.
  // El wrap tiene altura fija; chart.resize() hace que Chart.js lea el wrap y ajuste el canvas.
  c.parentNode.insertBefore(wrap, c);
  wrap.appendChild(c);
  // Handle de resize (solo desktop, vía CSS)
  const handle = document.createElement('div');
  handle.className = 'chart-resize-handle';
  handle.title = 'Arrastra para cambiar altura';
  wrap.after(handle);
  handle.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    handle.setPointerCapture(ev.pointerId);
    const startY = ev.clientY, startH = wrap.offsetHeight;
    function onMove(e) { wrap.style.height = Math.max(80, startH + e.clientY - startY) + 'px'; charts[c.id]?.resize(); }
    function onUp()   { handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); }
    handle.addEventListener('pointermove', onMove, { passive: true });
    handle.addEventListener('pointerup', onUp);
  });
}

function mkBar(id, labels, datasets, yLabel, tipFmt, audioType, noLegend=false) {
  const c=document.getElementById(id); if(!c) return;
  _wrapCanvas(c);
  charts[id]=new Chart(c,{type:'bar',data:{labels,datasets},options:{...baseOpts,
    plugins:{...baseOpts.plugins,legend:noLegend?{display:false}:baseOpts.plugins.legend,tooltip:{callbacks:{label:tipFmt}}},
    datasets:{bar:{minBarLength:4}},
    scales:{x:{ticks:{color:tickColor,font:{size:9},maxRotation:40},grid:{color:gridColor}},
            y:{ticks:{color:tickColor,callback:v=>`${v>=0?'+':''}${v}¢`},grid:{color:gridColor},
               title:{display:true,text:yLabel,color:'#6b7280',font:{size:10}}}}}});
  if(audioType) bindChartAudio(id,audioType,activeSlotMap());
}

function mkLine(id, labels, datasets, yLabel, tipFmt, audioType) {
  const c=document.getElementById(id); if(!c) return;
  _wrapCanvas(c);
  charts[id]=new Chart(c,{type:'line',data:{labels,datasets},options:{...baseOpts,
    plugins:{...baseOpts.plugins,tooltip:{callbacks:{label:tipFmt}}},
    scales:{x:{ticks:{color:tickColor,font:{size:10}},grid:{color:gridColor}},
            y:{ticks:{color:tickColor,callback:v=>`${v>0?'+':''}${v}¢`},grid:{color:gridColor},
               title:{display:true,text:yLabel,color:'#6b7280',font:{size:10}}}}}});
  if(audioType) bindChartAudio(id,audioType,activeSlotMap());
}

function mkRadar(id, datasets) {
  const c=document.getElementById(id); if(!c) return;
  charts[id]=new Chart(c,{type:'radar',data:{labels:NOTES,datasets},options:{...baseOpts,
    maintainAspectRatio:true,
    scales:{r:{ticks:{color:tickColor,backdropColor:'transparent',font:{size:9}},
              grid:{color:gridColor},angleLines:{color:gridColor},
              pointLabels:{color:'#d1d5db',font:{size:isMobile()?10:12}}}}}});
  bindChartAudio(id,'radar',activeSlotMap());
}

// ══════════════════════════════════════════════
// PANEL PLEGABLE (móvil)
// ══════════════════════════════════════════════
// En móvil genera un panel con header clicable que colapsa el contenido.
// En desktop devuelve el HTML tal cual (sin wrapper extra).
function panel(title, bodyHtml, style = '') {
  const closeBtn = `<button class="panel-fs-close" onclick="togglePanelFullscreen(this)" title="Salir de pantalla completa">✕</button>`;
  const zoomBtn  = `<button class="panel-zoom-btn" onclick="togglePanelFullscreen(this);event.stopPropagation()" title="Pantalla completa">${ICON_EXPAND}</button>`;
  if (!isMobile()) {
    return `<div class="panel" style="${style}">${closeBtn}<div class="panel-h3-row"><h3>${title}</h3>${zoomBtn}</div>${bodyHtml}</div>`;
  }
  return `<div class="panel" style="width:100%;box-sizing:border-box">${closeBtn}
    <div class="panel-hdr" onclick="togglePanelCollapse(this.closest('.panel'))">
      <h3>${title}</h3><span style="display:flex;gap:6px;align-items:center">${zoomBtn}<span class="panel-chevron">▼</span></span>
    </div>
    <div class="panel-body">${bodyHtml}</div>
    <div class="panel-drag-bar" onpointerdown="startPanelDragResize(event,this.closest('.panel'))"></div>
  </div>`;
}

// ══════════════════════════════════════════════
// VISTAS
// ══════════════════════════════════════════════
// Mapa de type → función de panel atómica _panel_xxx(act, el)
// Se completa abajo a medida que se añaden grupos de paneles.
const _PANEL_FN = {};

function renderContent() {
  destroyCharts(); stopSound(true);
  const act = selected.filter(Boolean);
  const ws  = WS.current();
  const tab = ws.tabs.find(t => t.id === ws.activeTabId);
  const el  = document.getElementById('content');

  if (!tab || !tab.cards.length) {
    el.innerHTML = '<div class="empty-state">Añade una tarjeta con el botón de abajo.</div>';
    return;
  }

  el.innerHTML = '';

  for (const card of tab.cards) {
    const desc = CARD_REGISTRY[card.type];
    if (!desc) continue;

    const wrap = document.createElement('div');
    wrap.dataset.cardId = card.id;
    wrap.style.cssText = 'display:contents';
    el.appendChild(wrap);

    if (desc.needsSelection && !act.length) {
      // Panel vacío con toolbar para poder cerrarlo sin seleccionar temperatura
      const toolbar = WS.makeCardToolbar(card);
      const hdrHtml = isMobile()
        ? `<div class="panel-hdr" style="cursor:default"></div>`
        : `<div class="panel-h3-row"><h3>${desc.label}</h3></div>`;
      wrap.innerHTML = `<div class="panel" style="width:100%;box-sizing:border-box">${hdrHtml}<div class="empty-state" style="padding:12px 0">Selecciona un temperamento de la lista para empezar.</div></div>`;
      const hdrRow = wrap.querySelector('.panel-h3-row');
      const hdrMob = wrap.querySelector('.panel-hdr');
      if (hdrRow) hdrRow.insertBefore(toolbar, hdrRow.querySelector('.panel-zoom-btn') || null);
      else if (hdrMob) hdrMob.appendChild(toolbar);
    } else {
      _PANEL_FN[card.type]?.(act, wrap);
      // Inyectar toolbar en el header del panel
      const hdrRow = wrap.querySelector('.panel-h3-row'); // desktop
      const hdrMob = wrap.querySelector('.panel-hdr');    // móvil
      if (hdrRow) {
        const zoomBtn = hdrRow.querySelector('.panel-zoom-btn');
        hdrRow.insertBefore(WS.makeCardToolbar(card), zoomBtn || null);
      } else if (hdrMob) {
        hdrMob.insertBefore(WS.makeCardToolbar(card), hdrMob.lastElementChild);
      }
    }
  }
}

// ══════════════════════════════════════════════
// PANELES ATÓMICOS — cada función renderiza UN solo panel
// Convención: _panel_xxx(act, el)  donde el = contenedor destino
// ══════════════════════════════════════════════

function _panel_circle(act, el) {
  const mob = isMobile();
  el.innerHTML = panel(
    'Círculo de quintas <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un sector</small>',
    `<div class="grad-bar"><span>−8¢</span><div class="grad-strip"></div><span>+4¢</span><span style="color:#4b5563">● pura=701.955¢</span></div>
     ${circleHtml(selected)}`,
    mob ? '' : 'width:290px'
  );
  bindCircleAudio();
}

function _panel_radar(act, el) {
  const mob = isMobile();
  el.innerHTML = panel(
    'Radar — offsets <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un punto</small>',
    `<canvas id="c-radar" ${mob ? 'height="200"' : 'height="240"'}></canvas>`,
    mob ? '' : 'flex:1;min-width:280px'
  );
  mkRadar('c-radar', selected.map((t,i) => !t ? null : ({
    label: shortName(t), data: t.offsets,
    backgroundColor: COLORS_A[i], borderColor: COLORS[i], borderWidth: 2, pointRadius: 4
  })).filter(Boolean));
}

function _panel_offsets(act, el) {
  const mob = isMobile();
  el.innerHTML = panel('Offsets respecto al ET (¢)', offsetsTable(act), mob ? '' : 'flex:1;min-width:200px');
}

function _panel_scatter(act, el) {
  if (!_scatterPts) {
    _scatterPts = all.map((temp, idx) => {
      let minM3 = Infinity;
      for (let i = 0; i < 12; i++) {
        const d = Math.abs(400 + temp.offsets[(i+4)%12] - temp.offsets[i] - 386.314);
        if (d < minM3) minM3 = d;
      }
      let maxP5 = 0;
      for (let i = 0; i < 12; i++) {
        const d = Math.abs(700 + temp.offsets[(i+7)%12] - temp.offsets[i] - 701.955);
        if (d > maxP5) maxP5 = d;
      }
      return { idx, x: minM3, y: maxP5, src: temp.source, name: temp.name };
    });
  }
  el.innerHTML = panel(
    `Cartografía de temperamentos (${all.length})`,
    `<canvas id="scat-cv" style="width:100%;cursor:grab;display:block;touch-action:none"></canvas>
     <div id="scat-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>
     <div id="scat-nfo" style="margin-top:4px;min-height:1.4em;font-size:10px;color:var(--muted);text-align:center">pulsa un punto para seleccionarlo · rueda/pinch para zoom · arrastra para mover</div>
     <div style="margin-top:4px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:10px;color:#6b7280">
       <span><span style="color:#60a5fa">●</span> Scala</span>
       <span><span style="color:#fb923c">●</span> GrandOrgue</span>
       <span><span style="color:#a78bfa">●</span> Otros</span>
       <span style="color:#4b5563">← 3ªM mejor &nbsp;↓ 5ª mejor</span>
     </div>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('scat-cv');
    if (cv) _initScatter(cv);
  });
}

function _panel_lattice(act, el) {
  el.innerHTML = panel(
    'Lattice de Euler <small style="color:#4b5563;font-size:10px;font-weight:400">— red de quintas × terceras mayores</small>',
    `<canvas id="c-lattice" style="width:100%;display:block;cursor:pointer;touch-action:none"></canvas>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-lattice');
    if (!cv) return;
    const redraw = () => _drawLattice(cv, act);
    redraw();
    cv._redraw = redraw;
    attachPanelResize(cv);
    cv._hoverNode = null;
    function _nodeAtPoint(x, y) {
      const info = cv._nodeInfo; if (!info) return null;
      const R = cv._nodeR || 18;
      for (const n of info) { const dx = x - n.px, dy = y - n.py; if (dx*dx + dy*dy <= R*R) return n; }
      return null;
    }
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      const node = _nodeAtPoint(e.clientX - r.left, e.clientY - r.top);
      if (node !== cv._hoverNode) { cv._hoverNode = node; redraw(); }
    });
    cv.addEventListener('pointerleave', () => { if (cv._hoverNode) { cv._hoverNode = null; redraw(); } });
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      const node = _nodeAtPoint(e.clientX - r.left, e.clientY - r.top);
      if (node) playNote(node.ni, act[0]);
    });
  });
}

function _panel_triads(act, el) {
  const btnStyle = (active) =>
    `font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;border:1px solid #334155;` +
    (active ? 'background:#1e40af;color:#e2e8f0' : 'background:transparent;color:#6b7280');
  el.innerHTML = panel(
    'Mapa de tríadas <small style="color:#4b5563;font-size:10px;font-weight:400">— pureza de las 24 tríadas (mayores + menores)</small>',
    `<div style="display:flex;gap:6px;margin-bottom:8px">
       <button id="triads-btn-wheel" style="${btnStyle(_triadsMode==='wheel')}" onclick="setTriadsMode('wheel')">Rueda</button>
       <button id="triads-btn-grid"  style="${btnStyle(_triadsMode==='grid')}"  onclick="setTriadsMode('grid')">Grid</button>
     </div>
     <canvas id="c-triads" style="width:100%;display:block;cursor:pointer;touch-action:none"></canvas>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-triads');
    if (!cv) return;
    const redraw = () => _drawTriads(cv, act);
    redraw(); cv._redraw = redraw; attachPanelResize(cv);
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      const nx = _nodeAtTriad(cv, e.clientX - r.left, e.clientY - r.top);
      if (JSON.stringify(nx) !== JSON.stringify(cv._hoverTriad)) { cv._hoverTriad = nx; redraw(); }
    });
    cv.addEventListener('pointerleave', () => { cv._hoverTriad = null; redraw(); });
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect();
      const nx = _nodeAtTriad(cv, e.clientX - r.left, e.clientY - r.top);
      if (nx) { cv._clickTriad = nx; redraw(); playTriad(nx, act[0]); }
    });
  });
}

function _panel_tonnetz(act, el) {
  let html = '';
  act.forEach((temp, ti) => {
    html += panel(
      `Tonnetz — <span style="color:${COLORS[ti]}">${temp.name}</span>`,
      `<canvas id="tz-${ti}" style="width:100%;cursor:pointer;display:block"></canvas>
       <div style="margin-top:4px;font-size:9px;color:#4b5563;text-align:center">→ quinta &nbsp;↗ 3ª Mayor &nbsp;↘ 3ª menor &nbsp;·&nbsp; ▲ tríada mayor &nbsp;▽ tríada menor</div>
       <div id="tz-nfo-${ti}" style="margin-top:8px;min-height:1.8em;font-size:clamp(14px,4vw,18px);color:var(--text);text-align:center;font-weight:500;letter-spacing:0.2px">pulsa una nota o región para oír</div>
       <div class="grad-bar" style="margin-top:6px">
         <span>tríada pura</span>
         <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,65%,30%),hsl(50,80%,30%),hsl(0,85%,30%))"></div>
         <span>tríada impura</span>
       </div>`,
      'width:100%'
    );
  });
  el.innerHTML = html;
  act.forEach((temp, ti) => {
    requestAnimationFrame(() => {
      const cv = document.getElementById(`tz-${ti}`);
      if (cv) {
        const nfo = document.getElementById(`tz-nfo-${ti}`);
        _initTonnetz(cv, nfo, temp, ti);
        cv._redraw = () => _initTonnetz(cv, nfo, temp, ti);
        attachPanelResize(cv);
      }
    });
  });
}

function _panel_histogram(act, el) {
  el.innerHTML = panel(
    'Histograma de consonancia <small style="color:#4b5563;font-size:10px;font-weight:400">— distribución de los 132 intervalos por consonancia teórica</small>',
    `<canvas id="c-hist" style="width:100%;display:block"></canvas>
     <div id="hist-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-hist');
    if (!cv) return;
    const redraw = () => _drawHistogram(cv, act);
    redraw(); cv._redraw = redraw; attachPanelResize(cv);
    const rh = document.getElementById('hist-resize');
    if (rh) {
      rh.addEventListener('pointerdown', ev => {
        ev.preventDefault(); rh.setPointerCapture(ev.pointerId);
        const sy = ev.clientY, sh = cv.clientHeight || Math.round(cv.clientWidth * 0.55);
        const onMove = e => { const h = Math.max(140, sh + e.clientY - sy); cv.style.height = h + 'px'; cv.dataset.userH = h; };
        const onUp = () => { rh.removeEventListener('pointermove', onMove); rh.removeEventListener('pointerup', onUp); cv.dataset.userH = cv.clientHeight; cv.style.height = ''; redraw(); };
        rh.addEventListener('pointermove', onMove, { passive: true });
        rh.addEventListener('pointerup', onUp);
      });
    }
  });
}

function _panel_consonance(act, el) {
  const _noteBtnStyle = (on) =>
    `font-size:9px;padding:2px 5px;border-radius:3px;cursor:pointer;border:none;font-family:monospace;` +
    (on ? 'background:#1e40af;color:#e2e8f0' : 'background:#1e293b;color:#475569');
  const notesBtns = NOTES.map((n, i) =>
    `<button id="cons-root-${i}" data-ni="${i}" style="${_noteBtnStyle(true)}">${n}</button>`
  ).join('');
  const auxBtn = `font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #334155;background:transparent;color:#6b7280`;
  el.innerHTML = panel(
    'Curva de consonancia <small style="color:#4b5563;font-size:10px;font-weight:400">— firma espectral del temperamento</small>',
    `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px;flex-wrap:wrap">
       ${_swHtml('cons-audio-sw', 'Audio continuo', false)}
       ${_swHtml('cons-beat-sw',  'Ver batimentos', false)}
       <span id="cons-nfo" style="font-size:10px;color:var(--muted);flex:1;min-width:0">
         Mueve el ratón sobre la gráfica · pulsa para oír un intervalo
       </span>
     </div>
     <div style="display:flex;align-items:center;gap:3px;margin-bottom:6px;flex-wrap:wrap">
       <span style="font-size:10px;color:#6b7280;white-space:nowrap;margin-right:2px">Raíz:</span>
       ${notesBtns}
       <button id="cons-roots-all"  style="${auxBtn};margin-left:6px">Todas</button>
       <button id="cons-roots-none" style="${auxBtn}">Ninguna</button>
     </div>
     <div style="position:relative">
       <canvas id="c-cons" style="width:100%;display:block;cursor:crosshair;touch-action:none"></canvas>
       <canvas id="c-cons-cur" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></canvas>
     </div>
     <div id="cons-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-cons');
    const cvCur = document.getElementById('c-cons-cur');
    if (!cv) return;
    const redraw = () => _drawConsonance(cv, cvCur, act);
    redraw(); cv._redraw = redraw;
    cv._rootNotes = null;
    function _updateRootBtns() {
      NOTES.forEach((_, i) => {
        const btn = document.getElementById(`cons-root-${i}`);
        if (!btn) return;
        const on = !cv._rootNotes || cv._rootNotes.has(i);
        btn.style.background = on ? '#1e40af' : '#1e293b';
        btn.style.color      = on ? '#e2e8f0' : '#475569';
      });
    }
    NOTES.forEach((_, i) => {
      document.getElementById(`cons-root-${i}`)?.addEventListener('click', () => {
        if (!cv._rootNotes) cv._rootNotes = new Set(NOTES.map((__, j) => j));
        if (cv._rootNotes.has(i)) { cv._rootNotes.delete(i); } else { cv._rootNotes.add(i); }
        if (cv._rootNotes.size === 12) cv._rootNotes = null;
        _updateRootBtns(); redraw();
      });
    });
    document.getElementById('cons-roots-all')?.addEventListener('click', () => { cv._rootNotes = null; _updateRootBtns(); redraw(); });
    document.getElementById('cons-roots-none')?.addEventListener('click', () => { cv._rootNotes = new Set(); _updateRootBtns(); redraw(); });
    attachPanelResize(cv);
    const rh = document.getElementById('cons-resize');
    if (rh) {
      rh.addEventListener('pointerdown', ev => {
        ev.preventDefault(); rh.setPointerCapture(ev.pointerId);
        const sy = ev.clientY, sh = cv.clientHeight || parseInt(cv.dataset.userH||'0',10) || Math.round(cv.clientWidth*0.5);
        const onMove = e => { const newH = Math.max(140, sh + e.clientY - sy); cv.style.height = newH + 'px'; cv.dataset.userH = newH; };
        const onUp = () => { rh.removeEventListener('pointermove', onMove); rh.removeEventListener('pointerup', onUp); cv.dataset.userH = cv.clientHeight; cv.style.height = ''; redraw(); };
        rh.addEventListener('pointermove', onMove, { passive: true });
        rh.addEventListener('pointerup', onUp);
      });
    }
  });
}

function _panel_keyboard(act, el) {
  const tempName = selected.find(Boolean)?.name ?? '—';
  el.innerHTML = `
    <div class="panel" style="width:100%">
      <div id="kb-controls">
        <div style="display:flex;gap:4px">
          <button class="kb-mode${KB.mode==='normal'?' sel':''}" data-mode="normal" onclick="KB.setMode('normal')">Normal</button>
          <button class="kb-mode${KB.mode==='legato'?' sel':''}" data-mode="legato" onclick="KB.setMode('legato')">Legato</button>
          <button class="kb-mode${KB.mode==='chord'?' sel':''}"  data-mode="chord"  onclick="KB.setMode('chord')">Acorde</button>
        </div>
        <div style="display:flex;align-items:center;gap:5px">
          <button class="icon-btn" onclick="KB.shiftOct(-1)">◀</button>
          <span id="kb-oct-lbl" style="font-size:11px;color:var(--muted);white-space:nowrap">Oct. ${KB.octave}–${KB.octave+2}</span>
          <button class="icon-btn" onclick="KB.shiftOct(+1)">▶</button>
        </div>
        <div id="kb-semi-btns" style="display:flex;align-items:center;gap:4px">
          <button class="icon-btn" onclick="KB.shiftSemitone(-1)" style="padding:4px 12px;font-size:15px">−</button>
          <span style="font-size:10px;color:var(--muted);white-space:nowrap">Semitono</span>
          <button class="icon-btn" onclick="KB.shiftSemitone(+1)" style="padding:4px 12px;font-size:15px">+</button>
        </div>
        <button id="kb-clear-btn" class="icon-btn" onclick="KB.clearAll()"
          style="display:${KB.mode==='chord'?'inline-block':'none'};opacity:${KB.chordMap.size>0?'1':'0.4'}">
          Limpiar ✕
        </button>
        <button id="kb-fs-btn" class="icon-btn" onclick="toggleKbFullscreen()" title="Pantalla completa" style="margin-left:auto;display:flex;align-items:center;justify-content:center;padding:4px 8px">
          ${document.body.classList.contains('kb-fullscreen') ? ICON_COLLAPSE : ICON_EXPAND}
        </button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:#4b5563;margin-bottom:10px">
        <span style="color:var(--muted)">La =</span>
        <input id="kb-pitch-input" type="number" value="${pitchA}" min="390" max="470" step="0.1"
          style="width:58px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;text-align:center;outline:none"
          onchange="setPitchAGlobal(this.value)" onkeydown="if(event.key==='Enter')setPitchAGlobal(this.value)">
        <span style="color:var(--muted)">Hz</span>
        <span style="color:var(--border)">·</span>
        Temperamento: <span style="color:var(--c0)">${tempName}</span>
        ${!selected.find(Boolean) ? '<span style="color:#f87171"> — selecciona uno en la lista</span>' : ''}
      </div>
      <div id="kb-wrap"></div>
      <div id="kb-lbl">—</div>
      <div style="margin-top:16px;font-size:10px;color:#4b5563;line-height:1.8">
        <b style="color:#6b7280">Normal</b> — suena solo mientras se pulsa &nbsp;·&nbsp;
        <b style="color:#6b7280">Legato</b> — la nota sigue hasta que se pulsa otra &nbsp;·&nbsp;
        <b style="color:#6b7280">Acorde</b> — las notas se acumulan; pulsa de nuevo para quitar
      </div>
    </div>`;
  KB.render();
}

// ── Grupo 2: gráficas de barras y línea ──────────────────────────────────────

function _panel_fifths_bar(act, el) {
  const mob = isMobile();
  const fl = FIFTH_LBL.map((n,i) => `${n}→${FIFTH_LBL[(i+1)%12]}`);
  el.innerHTML = panel(
    'Desviación de las 12 quintas respecto a la quinta pura (701.955 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
    `<canvas id="c-fifths" ${mob?'height="160"':'height="110"'}></canvas>`,
    'width:100%'
  );
  mkBar('c-fifths', fl,
    selected.map((t,i) => !t ? null : dsFifth(t, i, getFifths(t.offsets).map(f => f.dev))).filter(Boolean),
    'Desv. de quinta pura (¢)',
    ctx => `${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(3)}¢  (${(PURE_FIFTH+ctx.parsed.y).toFixed(2)}¢)`,
    'fifths', true);
}

function _panel_maj3_bar(act, el) {
  const mob = isMobile();
  el.innerHTML = panel(
    'Terceras mayores — desv. de la 3ª mayor pura (386.314 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
    `<canvas id="c-maj3" ${mob?'height="160"':'height="110"'}></canvas>`,
    'width:100%'
  );
  mkBar('c-maj3', NOTES,
    selected.map((t,i) => !t ? null : dsMaj3(t, i, getMaj3(t.offsets).map(x => x.dev))).filter(Boolean),
    'Desv. de 3ª mayor pura (¢)',
    ctx => `${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}¢  (${(PURE_MAJ3+ctx.parsed.y).toFixed(2)}¢)`,
    'maj3', true);
}

function _panel_min3_bar(act, el) {
  const mob = isMobile();
  el.innerHTML = panel(
    'Terceras menores — desv. de la 3ª menor pura (315.641 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
    `<canvas id="c-min3" ${mob?'height="160"':'height="110"'}></canvas>`,
    'width:100%'
  );
  mkBar('c-min3', NOTES,
    selected.map((t,i) => !t ? null : dsMaj3(t, i, getMin3(t.offsets).map(x => x.dev))).filter(Boolean),
    'Desv. de 3ª menor pura (¢)',
    ctx => `${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}¢  (${(PURE_MIN3+ctx.parsed.y).toFixed(2)}¢)`,
    'min3', true);
}

function _panel_offsets_line(act, el) {
  const mob = isMobile();
  el.innerHTML = panel(
    'Offsets de las 12 notas <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un punto</small>',
    `<canvas id="c-off" ${mob?'height="180"':'height="100"'}></canvas>`,
    'width:100%'
  );
  mkLine('c-off', NOTES,
    selected.map((t,i) => !t ? null : ({...ds(t, i, t.offsets, {pointRadius:5, tension:0.3, fill:i===0})})).filter(Boolean),
    'Desviación del ET (¢)',
    ctx => `${ctx.dataset.label}: ${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(3)}¢`,
    'offsets');
}

// ── Grupo 3: paneles con tabla por temperamento ──────────────────────────────

function _panel_intervals(act, el) {
  const JUST_REF  = [0, 111.731, 203.910, 315.641, 386.314, 498.045, 600.0, 701.955, 813.686, 884.359, 1017.596, 1088.269];
  const INT_NAMES = ['P1','m2','M2','m3','M3','P4','tt','P5','m6','M6','m7','M7'];
  function devColor(dev) {
    const t = Math.min(1, Math.abs(dev) / 22);
    const hue = t < 0.5 ? 142 - t * 2 * 92 : 50 - (t - 0.5) * 2 * 50;
    return `hsl(${hue.toFixed(0)},${(70 + t * 20).toFixed(0)}%,36%)`;
  }
  let html = '';
  act.forEach((temp, ti) => {
    let rows = '';
    for (let start = 0; start < 12; start++) {
      let cells = `<td style="padding:2px 6px;font-size:9px;color:var(--muted);white-space:nowrap;font-weight:600">${NOTES[start]}</td>`;
      for (let semi = 0; semi < 12; semi++) {
        if (semi === 0) { cells += `<td style="background:#161e2e;text-align:center;padding:3px 4px;font-size:9px;color:#2d3f55;border:1px solid rgba(0,0,0,0.3)">—</td>`; continue; }
        const end = (start + semi) % 12;
        const actual = semi * 100 + temp.offsets[end] - temp.offsets[start];
        const dev = actual - JUST_REF[semi];
        const sign = dev >= 0 ? '+' : '';
        const title = `${NOTES[start]}→${NOTES[end]} (${INT_NAMES[semi]}): ${actual.toFixed(1)}¢  desv. ${sign}${dev.toFixed(1)}¢ de la justa`;
        cells += `<td title="${title}" style="background:${devColor(dev)};text-align:center;padding:3px 4px;font-size:9px;cursor:pointer;border:1px solid rgba(0,0,0,0.25)" onpointerdown="playHeatCell(${ti},${start},${semi})">${sign}${dev.toFixed(1)}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    const headerCols = INT_NAMES.map(n => `<th style="padding:3px 4px;font-size:9px;color:var(--accent);text-align:center;white-space:nowrap">${n}</th>`).join('');
    html += panel(
      `Matriz de intervalos — <span style="color:${COLORS[ti]}">${temp.name}</span>`,
      `<div class="table-zoom-wrap" style="overflow:hidden;position:relative;height:260px;touch-action:none">
         <table style="border-collapse:collapse">
           <thead><tr><th style="padding:3px 6px;font-size:9px;color:var(--muted)"></th>${headerCols}</tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>
       <div class="grad-bar" style="margin-top:10px">
         <span>0¢ justo</span>
         <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,72%,36%),hsl(96,76%,36%),hsl(50,80%,36%),hsl(25,84%,36%),hsl(0,88%,36%))"></div>
         <span>≥22¢ impuro</span>
       </div>`,
      'width:100%');
  });
  el.innerHTML = html;
  el.querySelectorAll('.table-zoom-wrap').forEach(_initZoomTable);
}

function _panel_beats(act, el) {
  const IVLS = [
    { semi:4, name:'M3', p:5, q:4 }, { semi:3, name:'m3', p:6, q:5 },
    { semi:7, name:'P5', p:3, q:2 }, { semi:5, name:'P4', p:4, q:3 },
    { semi:9, name:'M6', p:5, q:3 }, { semi:8, name:'m6', p:8, q:5 },
    { semi:2, name:'M2', p:9, q:8 }, { semi:10, name:'m7', p:9, q:5 },
  ];
  function beatColor(hz) {
    const t = Math.min(1, hz / 12);
    const hue = t < 0.5 ? 142 - t * 2 * 92 : 50 - (t - 0.5) * 2 * 50;
    return `hsl(${hue.toFixed(0)},${(70 + t * 20).toFixed(0)}%,36%)`;
  }
  let html = '';
  act.forEach((temp, ti) => {
    const headerCols = IVLS.map(iv => `<th style="padding:3px 6px;font-size:9px;color:var(--accent);text-align:center">${iv.name}</th>`).join('');
    let rows = '';
    for (let start = 0; start < 12; start++) {
      const f1 = noteFreq(start, temp.offsets, pitchA, octaveShift);
      let cells = `<td style="padding:2px 6px;font-size:9px;color:var(--muted);font-weight:600;white-space:nowrap">${NOTES[start]}</td>`;
      IVLS.forEach(iv => {
        const end = (start + iv.semi) % 12;
        const actual = iv.semi * 100 + temp.offsets[end] - temp.offsets[start];
        const f2 = f1 * Math.pow(2, actual / 1200);
        const beat = Math.abs(iv.p * f1 - iv.q * f2);
        const dispHz = beat < 0.05 ? '0' : beat < 10 ? beat.toFixed(1) : beat.toFixed(0);
        const title = `${NOTES[start]}→${NOTES[end]} (${iv.name}): ${beat.toFixed(2)} Hz`;
        cells += `<td title="${title}" style="background:${beatColor(beat)};text-align:center;padding:3px 5px;font-size:9px;cursor:pointer;border:1px solid rgba(0,0,0,0.25)" onpointerdown="playHeatCell(${ti},${start},${iv.semi})">${dispHz}</td>`;
      });
      rows += `<tr>${cells}</tr>`;
    }
    html += panel(
      `Batidos — <span style="color:${COLORS[ti]}">${temp.name}</span>`,
      `<p style="font-size:10px;color:var(--muted);margin-bottom:8px">Hz de batido. 0 = intervalo justo puro. La = ${pitchA} Hz.</p>
       <div class="table-zoom-wrap" style="overflow:hidden;position:relative;height:260px;touch-action:none">
         <table style="border-collapse:collapse">
           <thead><tr><th style="padding:3px 6px;font-size:9px;color:var(--muted)"></th>${headerCols}</tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>
       <div class="grad-bar" style="margin-top:10px">
         <span>0 Hz puro</span>
         <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,72%,36%),hsl(96,76%,36%),hsl(50,80%,36%),hsl(25,84%,36%),hsl(0,88%,36%))"></div>
         <span>≥12 Hz áspero</span>
       </div>`,
      'width:100%');
  });
  el.innerHTML = html;
  el.querySelectorAll('.table-zoom-wrap').forEach(_initZoomTable);
}

function _panel_fifths_table(act, el) {
  const mob = isMobile();
  el.innerHTML = act.map(t => {
    const ci = selected.indexOf(t);
    return panel(`<span style="color:${COLORS[ci]}">${shortName(t, 40)}</span>`, fifthsTable(t),
      mob ? '' : 'flex:1;min-width:190px');
  }).join('');
}

function _panel_thirds_table(act, el) {
  const mob = isMobile();
  el.innerHTML = act.map(t => {
    const ci = selected.indexOf(t);
    return panel(`<span style="color:${COLORS[ci]}">${shortName(t, 40)}</span>`, thirdsTableFn(t),
      mob ? '' : 'flex:1;min-width:190px');
  }).join('');
}

// ── Grupo 4: hero / tarjeta de información ────────────────────────────────────

function _panel_hero(act, el) {
  if (!act.length) { el.innerHTML = '<div class="empty-state" style="width:100%">Selecciona un temperamento.</div>'; return; }
  const t = act[0];
  const fif = getFifths(t.offsets), maj = getMaj3(t.offsets);
  const wf = fif.reduce((a,b) => Math.abs(a.dev)>Math.abs(b.dev)?a:b);
  const bf = fif.reduce((a,b) => Math.abs(a.dev)<Math.abs(b.dev)?a:b);
  const wm = maj.reduce((a,b) => Math.abs(a.dev)>Math.abs(b.dev)?a:b);
  const bm = maj.reduce((a,b) => Math.abs(a.dev)<Math.abs(b.dev)?a:b);
  const avgF = fif.reduce((s,f) => s+f.dev, 0) / 12;
  const f = v => `${v>=0?'+':''}${v.toFixed(2)}¢`;
  const cc = v => v>8?'#f87171':v<-4?'#fb923c':Math.abs(v)<0.5?'#4ade80':v>3?'#a78bfa':'#facc15';
  const statCard = (label, note, value, color) =>
    `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px 12px;flex:1;min-width:120px">
       <div style="font-size:10px;color:#64748b;margin-bottom:2px">${label}</div>
       <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">${note}</div>
       <div style="font-size:15px;font-weight:700;color:${color}">${value}</div>
     </div>`;
  el.innerHTML =
    `<div style="width:100%;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid #1e293b;border-radius:12px;padding:20px 24px;box-sizing:border-box">
       <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
         <div style="flex:1;min-width:200px">
           <div style="font-size:22px;font-weight:700;color:#e2e8f0;line-height:1.2;margin-bottom:6px">${t.name}</div>
           <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
             <span style="font-size:11px;background:#1e3a5f;color:#60a5fa;border-radius:4px;padding:2px 8px">${t.source}</span>
             <span style="font-size:11px;color:#475569">${fif.filter(x=>Math.abs(x.dev)<0.5).length} quintas puras</span>
             <span style="font-size:11px;color:#475569">·</span>
             <span style="font-size:11px;color:#475569">avg quinta ${f(avgF)}</span>
           </div>
         </div>
         <button onclick="openTempMenu(${all.indexOf(t)},event)" title="Opciones"
           style="background:none;border:none;color:#475569;cursor:pointer;font-size:22px;line-height:1;padding:0 4px;flex-shrink:0;-webkit-tap-highlight-color:transparent">···</button>
       </div>
       <div style="margin-top:14px">
         <div style="font-size:11px;color:#64748b;margin-bottom:5px">Notas</div>
         <textarea id="overview-notes" rows="3" placeholder="Descripción, origen histórico, características…"
           style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:8px 10px;font-size:12px;outline:none;resize:vertical;font-family:inherit"
           onblur="saveTempNotes('${t.name.replace(/'/g,"\\'")}', this.value)">${getTempNotes(t.name)}</textarea>
       </div>
     </div>
     <div style="width:100%;display:flex;gap:8px;flex-wrap:wrap">
       ${statCard('Quinta más pura',   bf.from+'→'+bf.to, bf.size.toFixed(2)+'¢ ('+f(bf.dev)+')', cc(bf.dev))}
       ${statCard('Quinta más impura', wf.from+'→'+wf.to, wf.size.toFixed(2)+'¢ ('+f(wf.dev)+')', cc(wf.dev))}
       ${statCard('3ª mayor más pura',   bm.from+'→'+bm.to, bm.size.toFixed(2)+'¢ ('+f(bm.dev)+')', '#4ade80')}
       ${statCard('3ª mayor más impura', wm.from+'→'+wm.to, wm.size.toFixed(2)+'¢ ('+f(wm.dev)+')', '#f87171')}
     </div>`;
}

// Registrar todos los paneles atómicos
Object.assign(_PANEL_FN, {
  // Grupo 1
  circle:          _panel_circle,
  radar:           _panel_radar,
  offsets:         _panel_offsets,
  scatter:         _panel_scatter,
  lattice:         _panel_lattice,
  triads:          _panel_triads,
  tonnetz:         _panel_tonnetz,
  histogram:       _panel_histogram,
  consonance:      _panel_consonance,
  keyboard:        _panel_keyboard,
  // Grupo 2
  fifths_bar:      _panel_fifths_bar,
  maj3_bar:        _panel_maj3_bar,
  min3_bar:        _panel_min3_bar,
  offsets_line:    _panel_offsets_line,
  // Grupo 3
  intervals:       _panel_intervals,
  beats:           _panel_beats,
  fifths_table:    _panel_fifths_table,
  thirds_table:    _panel_thirds_table,
  // Grupo 4
  hero:            _panel_hero,
});

// ─── VISTA GENERAL ───
function viewOverview(act) {
  const mob = isMobile();
  if (act.length === 1) {
    const t = act[0];
    const isUser = t.source === 'Usuario';
    const fif = getFifths(t.offsets), maj = getMaj3(t.offsets);
    const wf = fif.reduce((a,b) => Math.abs(a.dev)>Math.abs(b.dev)?a:b);
    const bf = fif.reduce((a,b) => Math.abs(a.dev)<Math.abs(b.dev)?a:b);
    const wm = maj.reduce((a,b) => Math.abs(a.dev)>Math.abs(b.dev)?a:b);
    const bm = maj.reduce((a,b) => Math.abs(a.dev)<Math.abs(b.dev)?a:b);
    const avgF = fif.reduce((s,f) => s+f.dev, 0) / 12;
    const f = v => `${v>=0?'+':''}${v.toFixed(2)}¢`;
    const cc = v => v>8?'#f87171':v<-4?'#fb923c':Math.abs(v)<0.5?'#4ade80':v>3?'#a78bfa':'#facc15';

    // stat card html
    const statCard = (label, note, value, color) =>
      `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:10px 12px;flex:1;min-width:120px">
        <div style="font-size:10px;color:#64748b;margin-bottom:2px">${label}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">${note}</div>
        <div style="font-size:15px;font-weight:700;color:${color}">${value}</div>
      </div>`;

    document.getElementById('content').innerHTML =
      // ── HERO ──
      `<div style="width:100%;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);border:1px solid #1e293b;border-radius:12px;padding:20px 24px;box-sizing:border-box">
        <div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-size:22px;font-weight:700;color:#e2e8f0;line-height:1.2;margin-bottom:6px">${t.name}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:11px;background:#1e3a5f;color:#60a5fa;border-radius:4px;padding:2px 8px">${t.source}</span>
              <span style="font-size:11px;color:#475569">${fif.filter(f=>Math.abs(f.dev)<0.5).length} quintas puras</span>
              <span style="font-size:11px;color:#475569">·</span>
              <span style="font-size:11px;color:#475569">avg quinta ${f(avgF)}</span>
            </div>
          </div>
          <button onclick="openTempMenu(${all.indexOf(t)},event)" title="Opciones"
            style="background:none;border:none;color:#475569;cursor:pointer;font-size:22px;line-height:1;padding:0 4px;flex-shrink:0;-webkit-tap-highlight-color:transparent">···</button>
        </div>
        <div style="margin-top:14px">
          <div style="font-size:11px;color:#64748b;margin-bottom:5px">Notas</div>
          <textarea id="overview-notes" rows="3" placeholder="Descripción, origen histórico, características…"
            style="width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;color:#cbd5e1;border-radius:6px;padding:8px 10px;font-size:12px;outline:none;resize:vertical;font-family:inherit"
            onblur="saveTempNotes('${t.name.replace(/'/g,"\\'")}', this.value)">${getTempNotes(t.name)}</textarea>
        </div>
      </div>`
      // ── STAT CARDS ──
      + `<div style="width:100%;display:flex;gap:8px;flex-wrap:wrap">
          ${statCard('Quinta más pura', bf.from+'→'+bf.to, bf.size.toFixed(2)+'¢ ('+f(bf.dev)+')', cc(bf.dev))}
          ${statCard('Quinta más impura', wf.from+'→'+wf.to, wf.size.toFixed(2)+'¢ ('+f(wf.dev)+')', cc(wf.dev))}
          ${statCard('3ª mayor más pura', bm.from+'→'+bm.to, bm.size.toFixed(2)+'¢ ('+f(bm.dev)+')', '#4ade80')}
          ${statCard('3ª mayor más impura', wm.from+'→'+wm.to, wm.size.toFixed(2)+'¢ ('+f(wm.dev)+')', '#f87171')}
        </div>`
      // ── CIRCLE + OFFSETS ──
      + panel('Círculo de quintas <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un sector</small>',
          `<div class="grad-bar"><span>−8¢</span><div class="grad-strip"></div><span>+4¢</span><span style="color:#4b5563">● pura=701.955¢</span></div>
           ${circleHtml(selected)}`,
          mob?'':'width:290px')
      + panel('Radar — offsets <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un punto</small>',
          `<canvas id="c-radar" ${mob?'height="200"':'height="240"'}></canvas>`,
          mob?'':'flex:1;min-width:280px')
      + panel('Offsets respecto al ET (¢)', offsetsTable(act), mob?'':'flex:1;min-width:200px');

    mkRadar('c-radar', selected.map((t,i) => !t?null:({label:shortName(t),data:t.offsets,backgroundColor:COLORS_A[i],borderColor:COLORS[i],borderWidth:2,pointRadius:4})).filter(Boolean));
    bindCircleAudio();
    return;
  }

  // ── multi-temp: vista original ──
  document.getElementById('content').innerHTML =
    panel('Círculo de quintas <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un sector</small>',
      `<div class="grad-bar"><span>−8¢</span><div class="grad-strip"></div><span>+4¢</span><span style="color:#4b5563">● pura=701.955¢</span></div>
       ${circleHtml(selected)}`,
      mob?'':'width:290px')
    + panel('Radar — offsets <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un punto</small>',
      `<canvas id="c-radar" ${mob?'height="200"':'height="240"'}></canvas>`,
      mob?'':'flex:1;min-width:280px')
    + panel('Offsets respecto al ET (¢)', offsetsTable(act), mob?'':'width:100%');
  mkRadar('c-radar', selected.map((t,i) => !t?null:({label:shortName(t),data:t.offsets,backgroundColor:COLORS_A[i],borderColor:COLORS[i],borderWidth:2,pointRadius:4})).filter(Boolean));
  bindCircleAudio();
}

// ─── QUINTAS ───
function viewFifths(act) {
  const mob=isMobile(), fl=FIFTH_LBL.map((n,i)=>`${n}→${FIFTH_LBL[(i+1)%12]}`);
  document.getElementById('content').innerHTML=
    panel('Desviación de las 12 quintas respecto a la quinta pura (701.955 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
      `<canvas id="c-fifths" ${mob?'height="160"':'height="110"'}></canvas>`, 'width:100%')
    + panel('Círculo de quintas',
      `<div class="grad-bar"><span>−8¢</span><div class="grad-strip"></div><span>+4¢</span></div>
       ${circleHtml(selected)}`,
      mob?'':'width:290px')
    + act.map(t=>{const ci=selected.indexOf(t);
      return panel(`<span style="color:${COLORS[ci]}">${shortName(t,40)}</span>`, fifthsTable(t),
        mob?'':'flex:1;min-width:190px');}).join('');
  mkBar('c-fifths',fl,selected.map((t,i)=>!t?null:dsFifth(t,i,getFifths(t.offsets).map(f=>f.dev))).filter(Boolean),
    'Desv. de quinta pura (¢)',ctx=>`${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(3)}¢  (${(PURE_FIFTH+ctx.parsed.y).toFixed(2)}¢)`,'fifths',true);
  bindCircleAudio();
}

// ─── TERCERAS ───
function viewThirds(act) {
  const mob=isMobile();
  document.getElementById('content').innerHTML=
    panel('Terceras mayores — desv. de la 3ª mayor pura (386.314 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
      `<canvas id="c-maj3" ${mob?'height="160"':'height="110"'}></canvas>`, 'width:100%')
    + panel('Terceras menores — desv. de la 3ª menor pura (315.641 ¢) <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
      `<canvas id="c-min3" ${mob?'height="160"':'height="110"'}></canvas>`, 'width:100%')
    + act.map(t=>{const ci=selected.indexOf(t);
      return panel(`<span style="color:${COLORS[ci]}">${shortName(t,40)}</span>`, thirdsTableFn(t),
        mob?'':'flex:1;min-width:190px');}).join('');
  mkBar('c-maj3',NOTES,selected.map((t,i)=>!t?null:dsMaj3(t,i,getMaj3(t.offsets).map(x=>x.dev))).filter(Boolean),
    'Desv. de 3ª mayor pura (¢)',ctx=>`${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}¢  (${(PURE_MAJ3+ctx.parsed.y).toFixed(2)}¢)`,'maj3',true);
  mkBar('c-min3',NOTES,selected.map((t,i)=>!t?null:dsMaj3(t,i,getMin3(t.offsets).map(x=>x.dev))).filter(Boolean),
    'Desv. de 3ª menor pura (¢)',ctx=>`${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}¢  (${(PURE_MIN3+ctx.parsed.y).toFixed(2)}¢)`,'min3',true);
}

// ─── COMPARAR ───
function viewCompare(act) {
  const mob=isMobile(), fl=FIFTH_LBL.map((n,i)=>`${n}→${FIFTH_LBL[(i+1)%12]}`);
  document.getElementById('content').innerHTML=
    panel('Offsets de las 12 notas <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa un punto</small>',
      `<canvas id="c-off" ${mob?'height="180"':'height="100"'}></canvas>`, 'width:100%')
    + panel('Quintas — desviación de pura <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
      (act.length>1?tempIdentityHtml(act):'')+`<canvas id="c-fif" ${mob?'height="180"':'height="100"'}></canvas>`, 'width:100%')
    + panel('Terceras mayores — desviación de pura <small style="color:#4b5563;font-size:10px;font-weight:400">— pulsa una barra</small>',
      (act.length>1?tempIdentityHtml(act):'')+`<canvas id="c-3rd" ${mob?'height="180"':'height="100"'}></canvas>`, 'width:100%');
  mkLine('c-off',NOTES,selected.map((t,i)=>!t?null:({...ds(t,i,t.offsets,{pointRadius:5,tension:0.3,fill:i===0})})).filter(Boolean),
    'Desviación del ET (¢)',ctx=>`${ctx.dataset.label}: ${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(3)}¢`,'offsets');
  mkBar('c-fif',fl,selected.map((t,i)=>!t?null:dsFifth(t,i,getFifths(t.offsets).map(f=>f.dev))).filter(Boolean),
    'Desv. de quinta pura (¢)',ctx=>`${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(3)}¢`,'fifths',true);
  mkBar('c-3rd',NOTES,selected.map((t,i)=>!t?null:dsMaj3(t,i,getMaj3(t.offsets).map(x=>x.dev))).filter(Boolean),
    'Desv. de 3ª mayor pura (¢)',ctx=>`${ctx.parsed.y>=0?'+':''}${ctx.parsed.y.toFixed(2)}¢`,'maj3',true);
}

// ─── INTERVALOS (heatmap 12×12) ───
function playHeatCell(ti, start, semi) {
  const off = selected.filter(Boolean)[ti]?.offsets;
  if (!off || semi === 0) return;
  const f1 = noteFreq(start, off, pitchA, octaveShift);
  const end = (start + semi) % 12;
  const actual = semi * 100 + off[end] - off[start];
  playFreqs([f1, f1 * Math.pow(2, actual / 1200)]);
}

function viewIntervals(act) {
  const JUST_REF  = [0, 111.731, 203.910, 315.641, 386.314, 498.045, 600.0, 701.955, 813.686, 884.359, 1017.596, 1088.269];
  const INT_NAMES = ['P1','m2','M2','m3','M3','P4','tt','P5','m6','M6','m7','M7'];

  function devColor(dev) {
    const t = Math.min(1, Math.abs(dev) / 22);
    const hue = t < 0.5 ? 142 - t * 2 * 92 : 50 - (t - 0.5) * 2 * 50;
    return `hsl(${hue.toFixed(0)},${(70 + t * 20).toFixed(0)}%,36%)`;
  }

  let html = '';
  act.forEach((temp, ti) => {
    let rows = '';
    for (let start = 0; start < 12; start++) {
      let cells = `<td style="padding:2px 6px;font-size:9px;color:var(--muted);white-space:nowrap;font-weight:600">${NOTES[start]}</td>`;
      for (let semi = 0; semi < 12; semi++) {
        if (semi === 0) {
          cells += `<td style="background:#161e2e;text-align:center;padding:3px 4px;font-size:9px;color:#2d3f55;border:1px solid rgba(0,0,0,0.3)">—</td>`;
          continue;
        }
        const end = (start + semi) % 12;
        const actual = semi * 100 + temp.offsets[end] - temp.offsets[start];
        const dev = actual - JUST_REF[semi];
        const sign = dev >= 0 ? '+' : '';
        const title = `${NOTES[start]}→${NOTES[end]} (${INT_NAMES[semi]}): ${actual.toFixed(1)}¢  desv. ${sign}${dev.toFixed(1)}¢ de la justa`;
        cells += `<td title="${title}" style="background:${devColor(dev)};text-align:center;padding:3px 4px;font-size:9px;cursor:pointer;border:1px solid rgba(0,0,0,0.25)" onpointerdown="playHeatCell(${ti},${start},${semi})">${sign}${dev.toFixed(1)}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    const headerCols = INT_NAMES.map(n => `<th style="padding:3px 4px;font-size:9px;color:var(--accent);text-align:center;white-space:nowrap">${n}</th>`).join('');
    const tableHtml =
      `<div class="table-zoom-wrap" style="overflow:hidden;position:relative;height:260px;touch-action:none">
        <table style="border-collapse:collapse">
          <thead><tr><th style="padding:3px 6px;font-size:9px;color:var(--muted)"></th>${headerCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="grad-bar" style="margin-top:10px">
        <span>0¢ justo</span>
        <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,72%,36%),hsl(96,76%,36%),hsl(50,80%,36%),hsl(25,84%,36%),hsl(0,88%,36%))"></div>
        <span>≥22¢ impuro</span>
      </div>`;
    html += panel(`Matriz de intervalos — <span style="color:${COLORS[ti]}">${temp.name}</span>`, tableHtml, 'width:100%');
  });
  document.getElementById('content').innerHTML = html;
  document.querySelectorAll('#content .table-zoom-wrap').forEach(_initZoomTable);
}

// ─── BATIDOS ───
function viewBeats(act) {
  // Intervalos con sus razones justas (p/q) para el cálculo de batidos
  const IVLS = [
    { semi:4, name:'M3', p:5, q:4 },
    { semi:3, name:'m3', p:6, q:5 },
    { semi:7, name:'P5', p:3, q:2 },
    { semi:5, name:'P4', p:4, q:3 },
    { semi:9, name:'M6', p:5, q:3 },
    { semi:8, name:'m6', p:8, q:5 },
    { semi:2, name:'M2', p:9, q:8 },
    { semi:10, name:'m7', p:9, q:5 },
  ];

  function beatColor(hz) {
    // 0 Hz = verde, ~4 Hz = amarillo, ≥12 Hz = rojo
    const t = Math.min(1, hz / 12);
    const hue = t < 0.5 ? 142 - t * 2 * 92 : 50 - (t - 0.5) * 2 * 50;
    return `hsl(${hue.toFixed(0)},${(70 + t * 20).toFixed(0)}%,36%)`;
  }

  let html = '';
  act.forEach((temp, ti) => {
    const headerCols = IVLS.map(iv =>
      `<th style="padding:3px 6px;font-size:9px;color:var(--accent);text-align:center">${iv.name}</th>`
    ).join('');
    let rows = '';
    for (let start = 0; start < 12; start++) {
      const f1 = noteFreq(start, temp.offsets, pitchA, octaveShift);
      let cells = `<td style="padding:2px 6px;font-size:9px;color:var(--muted);font-weight:600;white-space:nowrap">${NOTES[start]}</td>`;
      IVLS.forEach(iv => {
        const end = (start + iv.semi) % 12;
        const actual = iv.semi * 100 + temp.offsets[end] - temp.offsets[start];
        const f2 = f1 * Math.pow(2, actual / 1200);
        const beat = Math.abs(iv.p * f1 - iv.q * f2);
        const dispHz = beat < 0.05 ? '0' : beat < 10 ? beat.toFixed(1) : beat.toFixed(0);
        const title = `${NOTES[start]}→${NOTES[end]} (${iv.name}): ${beat.toFixed(2)} Hz`;
        cells += `<td title="${title}" style="background:${beatColor(beat)};text-align:center;padding:3px 5px;font-size:9px;cursor:pointer;border:1px solid rgba(0,0,0,0.25)" onpointerdown="playHeatCell(${ti},${start},${iv.semi})">${dispHz}</td>`;
      });
      rows += `<tr>${cells}</tr>`;
    }
    const tableHtml =
      `<p style="font-size:10px;color:var(--muted);margin-bottom:8px">Hz de batido. 0 = intervalo justo puro. La = ${pitchA} Hz.</p>
      <div class="table-zoom-wrap" style="overflow:hidden;position:relative;height:260px;touch-action:none">
        <table style="border-collapse:collapse">
          <thead><tr><th style="padding:3px 6px;font-size:9px;color:var(--muted)"></th>${headerCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="grad-bar" style="margin-top:10px">
        <span>0 Hz puro</span>
        <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,72%,36%),hsl(96,76%,36%),hsl(50,80%,36%),hsl(25,84%,36%),hsl(0,88%,36%))"></div>
        <span>≥12 Hz áspero</span>
      </div>`;
    html += panel(`Batidos — <span style="color:${COLORS[ti]}">${temp.name}</span>`, tableHtml, 'width:100%');
  });
  document.getElementById('content').innerHTML = html;
  document.querySelectorAll('#content .table-zoom-wrap').forEach(_initZoomTable);
}

// ─── CONSONANCIA ───
// Intervalos justos con ratio a:b (a = harmónico nota alta, b = harmónico nota baja)
const JUST_IVLS = [
  { name:'P1', cents:0,       w:1.00, a:1,  b:1  },
  { name:'m2', cents:111.73,  w:0.30, a:16, b:15 },
  { name:'M2', cents:203.91,  w:0.45, a:9,  b:8  },
  { name:'m3', cents:315.64,  w:0.70, a:6,  b:5  },
  { name:'M3', cents:386.31,  w:0.85, a:5,  b:4  },
  { name:'P4', cents:498.04,  w:0.90, a:4,  b:3  },
  { name:'TT', cents:590.22,  w:0.20, a:7,  b:5  },
  { name:'P5', cents:701.96,  w:1.00, a:3,  b:2  },
  { name:'m6', cents:813.69,  w:0.70, a:8,  b:5  },
  { name:'M6', cents:884.36,  w:0.75, a:5,  b:3  },
  { name:'m7', cents:996.09,  w:0.40, a:7,  b:4  },
  { name:'M7', cents:1088.27, w:0.30, a:15, b:8  },
  { name:'8va', cents:1200,   w:1.00, a:2,  b:1  },
];

// Consonancia teórica: superposición de Gaussianas centradas en los intervalos justos
function _consValue(c) {
  const s2 = 72; // σ²=6² cents²
  let v = 0;
  for (const j of JUST_IVLS) { const d = c - j.cents; v = Math.max(v, j.w * Math.exp(-(d*d)/(2*s2))); }
  return v;
}

function _nearestJust(cents) {
  let best = JUST_IVLS[0], bestAbs = Infinity;
  for (const j of JUST_IVLS) {
    const a = Math.abs(cents - j.cents);
    if (a < bestAbs) { bestAbs = a; best = j; }
  }
  return { j: best, dev: cents - best.cents };
}

// Batimento en Hz entre los armónicos (a, b) del intervalo j cuando se toca a playCents
// fRef = frecuencia de la nota base (toma en cuenta octava y afinación real)
function _beatHz(j, playCents, fRef) {
  return fRef * Math.abs(j.a - j.b * Math.pow(2, playCents / 1200));
}

// Verde (0 Hz) → amarillo (~5 Hz) → rojo (≥15 Hz)
function _beatColor(hz) {
  const t = Math.min(1, hz / 15);
  return `hsl(${Math.round(142 * (1 - t))},${Math.round(65 + t * 20)}%,55%)`;
}

// ── Toggles estilo medidor ──
function _swHtml(id, label, initOn) {
  const bg = initOn ? '#3b82f6' : '#334155';
  const lx = initOn ? '16px' : '2px';
  return `<label onclick="_toggleSw(this)" id="${id}" data-on="${initOn ? '1' : '0'}"
    style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;font-size:11px;color:#94a3b8">
    <div style="position:relative;width:34px;height:18px;background:${bg};border-radius:9px;flex-shrink:0;transition:background 0.2s">
      <div style="position:absolute;top:2px;left:${lx};width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s"></div>
    </div>
    ${label}
  </label>`;
}
function _toggleSw(el) {
  const on = el.dataset.on !== '1';
  el.dataset.on = on ? '1' : '0';
  const track = el.querySelector('div');
  const thumb = track?.querySelector('div');
  if (track) track.style.background = on ? '#3b82f6' : '#334155';
  if (thumb) thumb.style.left = on ? '16px' : '2px';
}
function _swOn(id) { return document.getElementById(id)?.dataset.on === '1'; }

function viewConsonance(act) {
  const _noteBtnStyle = (on) =>
    `font-size:9px;padding:2px 5px;border-radius:3px;cursor:pointer;border:none;font-family:monospace;` +
    (on ? 'background:#1e40af;color:#e2e8f0' : 'background:#1e293b;color:#475569');
  const notesBtns = NOTES.map((n, i) =>
    `<button id="cons-root-${i}" data-ni="${i}" style="${_noteBtnStyle(true)}">${n}</button>`
  ).join('');
  const auxBtn = `font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid #334155;background:transparent;color:#6b7280`;

  document.getElementById('content').innerHTML = panel(
    'Curva de consonancia <small style="color:#4b5563;font-size:10px;font-weight:400">— firma espectral del temperamento</small>',
    `<div style="display:flex;align-items:center;gap:14px;margin-bottom:6px;flex-wrap:wrap">
       ${_swHtml('cons-audio-sw', 'Audio continuo', false)}
       ${_swHtml('cons-beat-sw',  'Ver batimentos', false)}
       <span id="cons-nfo" style="font-size:10px;color:var(--muted);flex:1;min-width:0">
         Mueve el ratón sobre la gráfica · pulsa para oír un intervalo
       </span>
     </div>
     <div style="display:flex;align-items:center;gap:3px;margin-bottom:6px;flex-wrap:wrap">
       <span style="font-size:10px;color:#6b7280;white-space:nowrap;margin-right:2px">Raíz:</span>
       ${notesBtns}
       <button id="cons-roots-all"  style="${auxBtn};margin-left:6px">Todas</button>
       <button id="cons-roots-none" style="${auxBtn}">Ninguna</button>
     </div>
     <div style="position:relative">
       <canvas id="c-cons" style="width:100%;display:block;cursor:crosshair;touch-action:none"></canvas>
       <canvas id="c-cons-cur" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none"></canvas>
     </div>
     <div id="cons-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-cons');
    const cvCur = document.getElementById('c-cons-cur');
    if (!cv) return;
    const redraw = () => _drawConsonance(cv, cvCur, act);
    redraw();
    cv._redraw = redraw;

    // ── Selector de notas raíz ──
    cv._rootNotes = null; // null = todas activas

    function _updateRootBtns() {
      NOTES.forEach((_, i) => {
        const btn = document.getElementById(`cons-root-${i}`);
        if (!btn) return;
        const on = !cv._rootNotes || cv._rootNotes.has(i);
        btn.style.background = on ? '#1e40af' : '#1e293b';
        btn.style.color      = on ? '#e2e8f0' : '#475569';
      });
    }

    NOTES.forEach((_, i) => {
      document.getElementById(`cons-root-${i}`)?.addEventListener('click', () => {
        if (!cv._rootNotes) cv._rootNotes = new Set(NOTES.map((__, j) => j));
        if (cv._rootNotes.has(i)) { cv._rootNotes.delete(i); } else { cv._rootNotes.add(i); }
        if (cv._rootNotes.size === 12) cv._rootNotes = null;
        _updateRootBtns(); redraw();
      });
    });
    document.getElementById('cons-roots-all')?.addEventListener('click', () => {
      cv._rootNotes = null; _updateRootBtns(); redraw();
    });
    document.getElementById('cons-roots-none')?.addEventListener('click', () => {
      cv._rootNotes = new Set(); _updateRootBtns(); redraw();
    });

    attachPanelResize(cv);
    const rh = document.getElementById('cons-resize');
    if (rh) {
      rh.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        rh.setPointerCapture(ev.pointerId);
        const sy = ev.clientY, sh = cv.clientHeight || parseInt(cv.dataset.userH||'0',10) || Math.round(cv.clientWidth*0.5);
        const onMove = e => { const newH = Math.max(140, sh + e.clientY - sy); cv.style.height = newH + 'px'; cv.dataset.userH = newH; };
        const onUp   = () => { rh.removeEventListener('pointermove', onMove); rh.removeEventListener('pointerup', onUp); cv.dataset.userH = cv.clientHeight; cv.style.height = ''; redraw(); };
        rh.addEventListener('pointermove', onMove, { passive: true });
        rh.addEventListener('pointerup', onUp);
      });
    }
  });
}

// ══════════════════════════════════════════════
// HISTOGRAMA DE CONSONANCIA
// ══════════════════════════════════════════════
function viewHistogram(act) {
  document.getElementById('content').innerHTML = panel(
    'Histograma de consonancia <small style="color:#4b5563;font-size:10px;font-weight:400">— distribución de los 132 intervalos por consonancia teórica</small>',
    `<canvas id="c-hist" style="width:100%;display:block"></canvas>
     <div id="hist-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-hist');
    if (!cv) return;
    const redraw = () => _drawHistogram(cv, act);
    redraw();
    cv._redraw = redraw;
    attachPanelResize(cv);
    const rh = document.getElementById('hist-resize');
    if (rh) {
      rh.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        rh.setPointerCapture(ev.pointerId);
        const sy = ev.clientY, sh = cv.clientHeight || Math.round(cv.clientWidth * 0.55);
        const onMove = e => { const h = Math.max(140, sh + e.clientY - sy); cv.style.height = h + 'px'; cv.dataset.userH = h; };
        const onUp   = () => { rh.removeEventListener('pointermove', onMove); rh.removeEventListener('pointerup', onUp); cv.dataset.userH = cv.clientHeight; cv.style.height = ''; redraw(); };
        rh.addEventListener('pointermove', onMove, { passive: true });
        rh.addEventListener('pointerup', onUp);
      });
    }
  });
}

function _drawHistogram(canvas, act) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth || 560;
  const exH = canvas.dataset.userH ? parseInt(canvas.dataset.userH, 10) : 0;
  const H   = exH > 80 ? exH : Math.round(Math.min(W * 0.55, 320));
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const BINS   = 20;
  const MX = 36, MY = 14, MR = 10, MB = 42;
  const PW = W - MX - MR, PH = H - MY - MB;
  const fSz = Math.min(10, Math.max(8, Math.round(9 * W / 500)));

  // ── Fondo ──
  ctx.clearRect(0, 0, W, H);

  // ── Calcular histograma por temperamento ──
  // 132 intervalos: semi 1..11, raíz 0..11 → cents = semi*100 + offsets[nj] - offsets[ni]
  // Los replicamos por octava simétrica (0–1200), mapeamos a consonancia con _consValue
  // Bin = Math.floor(cons * BINS), clamped a [0, BINS-1]
  const histData = act.map(t => {
    const counts = new Array(BINS).fill(0);
    for (let semi = 1; semi <= 11; semi++) {
      for (let ni = 0; ni < 12; ni++) {
        const nj = (ni + semi) % 12;
        const cents = semi * 100 + t.offsets[nj] - t.offsets[ni];
        const cons  = _consValue(cents);
        const bin   = Math.min(BINS - 1, Math.floor(cons * BINS));
        counts[bin]++;
      }
    }
    return counts;
  });

  const maxCount = Math.max(1, ...histData.flatMap(c => c));

  // Helpers coord
  const toX = bin => MX + (bin / BINS) * PW;
  const toY = v   => MY + PH - (v / maxCount) * PH;
  const bW  = PW / BINS;

  // ── Y grid ──
  ctx.font = `${fSz}px monospace`;
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(maxCount * i / 4);
    const y = toY(v);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(MX, y); ctx.lineTo(MX + PW, y); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.textAlign = 'right';
    ctx.fillText(v, MX - 4, y + 3);
  }

  // ── Líneas verticales de los intervalos justos (referencia) ──
  // Mapeamos sus cents a bin-x y dibujamos líneas tenues con etiqueta
  const labeledBins = new Set();
  ctx.font = `${fSz}px monospace`;
  for (const j of JUST_IVLS) {
    if (j.cents === 0 || j.cents === 1200) continue;
    const cons = j.w; // la consonancia en el pico exacto = peso del intervalo
    const binF = cons * BINS;
    const x = MX + binF / BINS * PW; // posición continua en x
    ctx.strokeStyle = `rgba(148,163,184,${(0.08 + j.w * 0.12).toFixed(2)})`;
    ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(x, MY); ctx.lineTo(x, MY + PH); ctx.stroke();
    ctx.setLineDash([]);
    // Etiqueta solo si no hay otra muy cercana
    const bKey = Math.round(binF * 2);
    if (!labeledBins.has(bKey)) {
      labeledBins.add(bKey);
      ctx.fillStyle = `rgba(148,163,184,${(0.45 + j.w * 0.4).toFixed(2)})`;
      ctx.textAlign = 'center';
      ctx.fillText(j.name, x, MY + PH + 14);
    }
  }

  // ── Barras por temperamento ──
  const HIST_COLORS   = ['rgba(96,165,250,0.55)', 'rgba(248,113,113,0.55)', 'rgba(74,222,128,0.55)'];
  const HIST_BORDERS  = ['#60a5fa', '#f87171', '#4ade80'];
  histData.forEach((counts, ti) => {
    const ci = selected.indexOf(act[ti]);
    const fill   = HIST_COLORS[ci]  || HIST_COLORS[ti % 3];
    const stroke = HIST_BORDERS[ci] || HIST_BORDERS[ti % 3];
    counts.forEach((count, bin) => {
      if (count === 0) return;
      const x = toX(bin) + 1;
      const y = toY(count);
      const bh = MY + PH - y;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, bW - 2, bh);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(x, y, bW - 2, bh);
    });
  });

  // ── Eje X: etiquetas 0.0 – 1.0 ──
  ctx.font = `${fSz}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#475569';
  for (let i = 0; i <= 4; i++) {
    const v = i / 4;
    const x = MX + v * PW;
    ctx.fillText(v.toFixed(2), x, MY + PH + 28);
  }
  ctx.fillStyle = '#6b7280'; ctx.font = `${fSz + 1}px monospace`;
  ctx.fillText('Consonancia teórica →', MX + PW / 2, MY + PH + 40);

  // ── Eje Y label ──
  ctx.save();
  ctx.translate(10, MY + PH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillStyle = '#6b7280'; ctx.font = `${fSz}px monospace`;
  ctx.fillText('Nº intervalos', 0, 0);
  ctx.restore();

  // ── Leyenda ──
  if (act.length > 1) {
    let lx = MX + 4;
    act.forEach((t, ti) => {
      const ci = selected.indexOf(t);
      const col = HIST_BORDERS[ci] || HIST_BORDERS[ti % 3];
      ctx.fillStyle = col;
      ctx.fillRect(lx, MY + 2, 10, 8);
      ctx.fillStyle = '#d1d5db'; ctx.textAlign = 'left'; ctx.font = `${fSz}px monospace`;
      ctx.fillText(shortName(t, 20), lx + 13, MY + 10);
      lx += ctx.measureText(shortName(t, 20)).width + 28;
    });
  }
}

function _drawConsonance(canvas, cursorCanvas, act) {
  if (canvas._consAbort) canvas._consAbort.abort();
  canvas._consAbort = new AbortController();
  const sig = canvas._consAbort.signal;

  const dpr     = window.devicePixelRatio || 1;
  const W       = canvas.clientWidth || 560;
  const panelEl = canvas.closest('.panel');
  const availH  = panelEl?.style.height ? _availCanvasH(canvas) : 0;
  const exH     = canvas.dataset.userH ? parseInt(canvas.dataset.userH, 10) : 0;
  const H = availH > 80 ? Math.round(availH) : exH > 80 ? exH : Math.round(Math.min(W * 0.5, 300));

  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (cursorCanvas) {
    cursorCanvas.width  = canvas.width;
    cursorCanvas.height = canvas.height;
    cursorCanvas.style.height = H + 'px';
  }

  const fSz = Math.min(10, Math.max(8, Math.round(9 * W / 500)));
  const MX = 38, MY = 14, MR = 12, MB = 36;
  const PW = W - MX - MR, PH = H - MY - MB;

  // dots: compartido entre _paint (lo rellena) y los event listeners (lo leen)
  const dots = [];

  // Helpers de coordenadas — leen el zoom actual del canvas en cada llamada
  function getZoom() {
    const zoomSpan   = canvas._zoomSpan   || 1200;
    const zoomCenter = canvas._zoomCenter !== undefined ? canvas._zoomCenter : 600;
    const zMin = Math.max(0, Math.min(1200 - zoomSpan, zoomCenter - zoomSpan / 2));
    return { zoomSpan, zMin, zMax: zMin + zoomSpan };
  }
  const toX     = c  => { const z = getZoom(); return MX + ((c - z.zMin) / z.zoomSpan) * PW; };
  const toCents = mx => { const z = getZoom(); return z.zMin + ((mx - MX) / PW) * z.zoomSpan; };
  const toY     = v  => MY + (1 - v) * PH;

  // ── Función de pintado puro (no toca listeners) ──
  // Lee _zoomSpan/_zoomCenter del canvas en cada llamada para reflejar el zoom actual.
  canvas._paint = function() {
  const { zoomSpan, zMin, zMax } = getZoom();

  // ── Fondo ──
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  // ── Curva teórica (Gaussianas) — relleno ──
  ctx.beginPath();
  let first = true;
  for (let px = 0; px <= PW; px++) {
    const c0 = zMin + (px / PW) * zoomSpan, v0 = _consValue(c0);
    if (first) { ctx.moveTo(toX(c0), toY(v0)); first = false; } else ctx.lineTo(toX(c0), toY(v0));
  }
  ctx.lineTo(MX + PW, MY + PH); ctx.lineTo(MX, MY + PH); ctx.closePath();
  ctx.fillStyle = 'rgba(96,165,250,0.07)'; ctx.fill();

  // ── Curva teórica — trazo ──
  ctx.beginPath(); first = true;
  for (let px = 0; px <= PW; px++) {
    const c0 = zMin + (px / PW) * zoomSpan, v0 = _consValue(c0);
    if (first) { ctx.moveTo(toX(c0), toY(v0)); first = false; } else ctx.lineTo(toX(c0), toY(v0));
  }
  ctx.strokeStyle = 'rgba(96,165,250,0.30)'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();

  // ── Y grid + etiquetas ──
  ctx.font = `${fSz}px monospace`; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = i / 4, y = toY(v);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(MX, y); ctx.lineTo(MX + PW, y); ctx.stroke();
    ctx.fillStyle = i === 4 ? '#4ade80' : '#475569';
    ctx.fillText(v.toFixed(2), MX - 4, y + 3);
  }

  // ── Líneas verticales just + etiquetas X ──
  // Suprimir etiquetas demasiado próximas (< minGap px) respecto a la última dibujada
  const minGap = fSz * 2.8;
  let lastLabelX = -Infinity;
  ctx.font = `${fSz}px monospace`;
  for (const j of JUST_IVLS) {
    if (j.cents < zMin || j.cents > zMax) continue;
    const x = toX(j.cents);
    ctx.beginPath(); ctx.moveTo(x, MY); ctx.lineTo(x, MY + PH);
    ctx.strokeStyle = `rgba(148,163,184,${(0.05 + j.w * 0.08).toFixed(2)})`;
    ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
    if (x - lastLabelX >= minGap) {
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(148,163,184,${(0.35 + j.w * 0.4).toFixed(2)})`;
      ctx.fillText(j.name, x, MY + PH + 14);
      ctx.fillStyle = 'rgba(71,85,105,0.75)';
      if (j.cents > zMin && j.cents < zMax) ctx.fillText(Math.round(j.cents), x, MY + PH + 25);
      lastLabelX = x;
    }
  }

  // ── Ticks extremos (rango visible) ──
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1;
  [[zMin, 'left'], [zMax, 'right']].forEach(([c, align]) => {
    const x = toX(c);
    ctx.beginPath(); ctx.moveTo(x, MY + PH); ctx.lineTo(x, MY + PH + 4); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.textAlign = align; ctx.font = `${fSz}px monospace`;
    ctx.fillText(Math.round(c) + '¢', x, MY + PH + 25);
  });

  // ── Zoom indicator ──
  if (zoomSpan < 1200) {
    ctx.fillStyle = 'rgba(96,165,250,0.55)'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`×${(1200 / zoomSpan).toFixed(1)}  [${Math.round(zMin)}–${Math.round(zMax)}¢]  · rueda/pinch=zoom  · doble toque=reset`, MX + 2, MY + 10);
  }

  // ── Puntos de los temperamentos ──
  dots.length = 0;
  const rootFilter = canvas._rootNotes; // Set<number> | null (null = todas)
  act.forEach(t => {
    const ci = selected.indexOf(t);
    for (let semi = 1; semi <= 11; semi++) {
      for (let ni = 0; ni < 12; ni++) {
        if (rootFilter && !rootFilter.has(ni)) continue;
        const nj = (ni + semi) % 12;
        const cents = semi * 100 + t.offsets[nj] - t.offsets[ni];
        if (cents < zMin || cents > zMax) continue;
        const cons  = _consValue(cents);
        const { j, dev } = _nearestJust(cents);
        const d = { cents, cons, ci, j, dev, fromNote: NOTES[ni], toNote: NOTES[nj], semi, ni, t };
        d.x = toX(cents); d.y = toY(cons);
        dots.push(d);
        ctx.beginPath(); ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[ci]; ctx.globalAlpha = 0.70; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  });

  // ── Leyenda ──
  ctx.font = '10px sans-serif';
  act.forEach((t, ti) => {
    const ci = selected.indexOf(t);
    const ly = MY + 8 + ti * 16;
    ctx.beginPath(); ctx.arc(MX + PW - 6, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[ci]; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'right';
    ctx.fillText(shortName(t, 26), MX + PW - 13, ly + 3);
  });

  // ── Títulos de ejes ──
  ctx.save();
  ctx.translate(10, MY + PH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Consonancia', 0, 0);
  ctx.restore();
  ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Intervalo (¢)', MX + PW / 2, H - 2);

  }; // fin canvas._paint

  canvas._paint();

  // ── Estado compartido entre eventos y RAF ──
  // _animMx    : posición X del cursor en px (para la línea vertical) — sigue al ratón siempre
  // _clickCents: cents de la nota clicada (modo discreto, solo para batimentos)
  // _clickNi   : índice de nota clicada (para calcular f0 exacto)
  // _clickT    : temperamento de la nota clicada
  let _animMx = null, _clickCents = null, _clickNi = null, _clickT = null;

  // ── Loop de animación (RAF) ──
  function startAnim() {
    if (!cursorCanvas) return;
    const cc = cursorCanvas.getContext('2d');
    const s2 = 72;

    function frame(now) {
      if (sig.aborted) return;
      cc.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
      cc.save(); cc.scale(dpr, dpr);

      const { zoomSpan, zMin, zMax } = getZoom();
      const beatOn = _swOn('cons-beat-sw');
      const contOn = _swOn('cons-audio-sw');
      const t = now / 1000;

      // f0 leído en cada frame: respeta cambios de octava y pitchA en tiempo real
      const f0 = contOn
        ? noteFreq(0, act[0]?.offsets ?? new Array(12).fill(0), pitchA, octaveShift)
        : (_clickNi !== null
            ? noteFreq(_clickNi, _clickT?.offsets ?? act[0]?.offsets ?? new Array(12).fill(0), pitchA, octaveShift)
            : null);

      // cents a usar para calcular batimentos:
      // - continuo: posición del cursor en cents
      // - discreto: cents de la nota temperada clicada (no el cursor)
      const beatCents = contOn
        ? (_animMx !== null ? toCents(_animMx) : null)
        : _clickCents;

      // Siempre: solo el intervalo justo más cercano a beatCents
      if (beatOn && beatCents !== null && f0 !== null) {
        const { j } = _nearestJust(beatCents);
        if (j.cents >= zMin && j.cents <= zMax) {
          const hz = _beatHz(j, beatCents, f0);
          // Superposición de batimentos de pares de armónicos superiores (k=1..4,
          // peso 1/k). Solo los que caen en rango perceptible (< 25 Hz). Si todos
          // lo superan → brillo estacionario (aspereza sin batimentos discretos).
          const MAX_BEAT = 25;
          let pSum = 0, wSum = 0;
          for (let k = 1; k <= 4; k++) {
            const hzK = k * hz;
            if (hzK > MAX_BEAT) break;
            const w = 1 / k;
            pSum += w * Math.cos(2 * Math.PI * hzK * t);
            wSum += w;
          }
          const pulse = wSum > 0 ? 0.5 + 0.5 * (pSum / wSum) : 0.5;
          const color  = _beatColor(hz);
          const lo = Math.max(zMin, j.cents - 55), hi = Math.min(zMax, j.cents + 55);
          cc.beginPath();
          let fst = true;
          for (let px = Math.round(((lo - zMin) / zoomSpan) * PW); px <= Math.round(((hi - zMin) / zoomSpan) * PW); px++) {
            const c0 = zMin + (px / PW) * zoomSpan, d = c0 - j.cents;
            const v  = j.w * Math.exp(-(d * d) / (2 * s2));
            if (fst) { cc.moveTo(toX(c0), toY(v)); fst = false; } else cc.lineTo(toX(c0), toY(v));
          }
          cc.lineTo(toX(hi), toY(0)); cc.lineTo(toX(lo), toY(0)); cc.closePath();
          cc.globalAlpha = 0.15 + pulse * 0.55; cc.fillStyle = color; cc.fill();
          cc.globalAlpha = 0.40 + pulse * 0.60; cc.strokeStyle = color; cc.lineWidth = 1.5; cc.stroke();
          if (hz < 99) {
            cc.globalAlpha = 0.40 + pulse * 0.60;
            cc.fillStyle = color; cc.font = `${fSz}px monospace`; cc.textAlign = 'center';
            cc.fillText(hz.toFixed(1) + ' Hz', toX(j.cents), toY(j.w) - 4);
          }
        }
      }

      // Línea vertical del cursor
      if (_animMx !== null) {
        cc.globalAlpha = 1;
        cc.beginPath(); cc.moveTo(_animMx, MY); cc.lineTo(_animMx, MY + PH);
        cc.strokeStyle = 'rgba(255,255,255,0.55)';
        cc.lineWidth = 1; cc.setLineDash([4, 4]); cc.stroke(); cc.setLineDash([]);
      }
      cc.restore();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ── Zoom helper ──
  // Llama _paint (solo redibuja pixels) para no destruir los listeners del pinch en curso.
  function applyZoom(pivotCents, factor) {
    const curSpan   = canvas._zoomSpan   || 1200;
    const curCenter = canvas._zoomCenter !== undefined ? canvas._zoomCenter : 600;
    const curMin    = Math.max(0, Math.min(1200 - curSpan, curCenter - curSpan / 2));
    const newSpan   = Math.min(1200, Math.max(30, curSpan * factor));
    const newMin    = Math.max(0, Math.min(1200 - newSpan, pivotCents - (pivotCents - curMin) * (newSpan / curSpan)));
    canvas._zoomSpan   = newSpan;
    canvas._zoomCenter = newMin + newSpan / 2;
    canvas._paint();   // solo pinta — no rehace listeners
  }

  // ── Eventos de interacción: audio (1 dedo/ratón) + pinch zoom (2 dedos) ──
  // Usamos touch events para el pinch (fiables en móvil, no interfieren con pointer capture)
  // y pointer events solo para el audio/cursor con un dedo.

  // ── Touch: pinch zoom con 2 dedos ──
  let _touches = {}; // identifier → clientX
  let _pinchX  = null;

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => { _touches[t.identifier] = t.clientX; });
    const ids = Object.keys(_touches);
    if (ids.length === 2) {
      _pinchX = Math.abs(_touches[ids[0]] - _touches[ids[1]]);
    }
  }, { signal: sig, passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t => { _touches[t.identifier] = t.clientX; });
    const ids = Object.keys(_touches);
    if (ids.length >= 2 && _pinchX !== null) {
      const xa = _touches[ids[0]], xb = _touches[ids[1]];
      const dist = Math.abs(xa - xb);
      if (dist > 0.5) {
        const rect = canvas.getBoundingClientRect();
        const midX = Math.max(MX, Math.min(MX + PW, (xa + xb) / 2 - rect.left));
        const cSpan = canvas._zoomSpan   || 1200;
        const cCtr  = canvas._zoomCenter !== undefined ? canvas._zoomCenter : 600;
        const cMin  = Math.max(0, Math.min(1200 - cSpan, cCtr - cSpan / 2));
        applyZoom(cMin + (midX - MX) / PW * cSpan, _pinchX / dist);
        _pinchX = dist;
      }
    }
  }, { signal: sig, passive: false });

  canvas.addEventListener('touchend', e => {
    Array.from(e.changedTouches).forEach(t => { delete _touches[t.identifier]; });
    if (Object.keys(_touches).length < 2) _pinchX = null;
  }, { signal: sig, passive: false });

  canvas.addEventListener('touchcancel', e => {
    Array.from(e.changedTouches).forEach(t => { delete _touches[t.identifier]; });
    _pinchX = null;
  }, { signal: sig, passive: false });

  // Doble toque: reset zoom
  let _lastTap = 0;
  canvas.addEventListener('touchend', e => {
    if (e.changedTouches.length === 1 && Object.keys(_touches).length === 0) {
      const now = Date.now();
      if (now - _lastTap < 300) { canvas._zoomSpan = 1200; canvas._zoomCenter = 600; canvas._redraw(); }
      _lastTap = now;
    }
  }, { signal: sig, passive: false });

  // ── Pointer events: audio y cursor (1 dedo o ratón) ──
  // Solo capturamos en móvil si hay exactamente 1 toque activo, para no
  // interferir con el segundo dedo del pinch.
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    const nTouches = Object.keys(_touches).length;
    if (nTouches >= 2) return; // pinch en curso, ignorar
    if (e.pointerType !== 'mouse') canvas.setPointerCapture(e.pointerId);
    if (_swOn('cons-audio-sw')) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let nearest = null, minD = 14;
    for (const d of dots) { const dist = Math.hypot(d.x - mx, d.y - my); if (dist < minD) { minD = dist; nearest = d; } }
    if (!nearest) return;
    playFreqs([noteFreq(nearest.ni, nearest.t.offsets, pitchA, octaveShift),
               noteFreq(nearest.ni, nearest.t.offsets, pitchA, octaveShift) * Math.pow(2, nearest.cents / 1200)]);
    _clickCents = nearest.cents; _clickNi = nearest.ni; _clickT = nearest.t;
  }, { signal: sig });

  canvas.addEventListener('pointermove', e => {
    if (Object.keys(_touches).length >= 2) return; // pinch en curso
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const inPlot = mx >= MX && mx <= MX + PW;
    const cents  = toCents(mx);
    _animMx = inPlot ? mx : null;
    const nfoEl = document.getElementById('cons-nfo');
    if (nfoEl && inPlot) {
      let nearPt = null, minD = 10;
      for (const d of dots) { const dist = Math.hypot(d.x - mx, d.y - my); if (dist < minD) { minD = dist; nearPt = d; } }
      if (nearPt) {
        const s = nearPt.dev >= 0 ? '+' : '';
        nfoEl.textContent = `${nearPt.fromNote}→${nearPt.toNote}  ${nearPt.cents.toFixed(2)}¢  [${nearPt.j.name}: ${s}${nearPt.dev.toFixed(2)}¢]`;
      } else {
        const { j, dev } = _nearestJust(cents);
        nfoEl.textContent = `${cents.toFixed(1)}¢  —  ${j.name} justo=${j.cents.toFixed(2)}¢  (${dev >= 0 ? '+' : ''}${dev.toFixed(1)}¢)`;
      }
    }
    if (_swOn('cons-audio-sw') && inPlot) {
      const fRef = noteFreq(0, act[0]?.offsets ?? new Array(12).fill(0), pitchA, octaveShift);
      playFreqs([fRef, fRef * Math.pow(2, cents / 1200)]);
    }
  }, { signal: sig });

  function _consPointerEnd() {
    if (_swOn('cons-audio-sw')) stopSound(true);
    else { _clickCents = null; _clickNi = null; _clickT = null; stopSound(true); }
    _animMx = null;
    const nfoEl = document.getElementById('cons-nfo');
    if (nfoEl) nfoEl.textContent = 'Mueve el ratón sobre la gráfica · pulsa para oír un intervalo · rueda/pinch=zoom';
  }
  canvas.addEventListener('pointerup',     _consPointerEnd, { signal: sig });
  canvas.addEventListener('pointercancel', _consPointerEnd, { signal: sig });

  canvas.addEventListener('pointerleave', e => {
    if (e.pointerType === 'mouse') {
      _animMx = null;
      if (_swOn('cons-audio-sw')) stopSound(true);
      const nfoEl = document.getElementById('cons-nfo');
      if (nfoEl) nfoEl.textContent = 'Mueve el ratón sobre la gráfica · pulsa para oír un intervalo · rueda/pinch=zoom';
    }
  }, { signal: sig });

  // ── Zoom con rueda del ratón ──
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx   = Math.max(MX, Math.min(MX + PW, e.clientX - rect.left));
    applyZoom(toCents(mx), e.deltaY > 0 ? 1.25 : 0.8);
  }, { signal: sig, passive: false });

  // ── Doble clic (desktop): reset zoom ──
  canvas.addEventListener('dblclick', () => {
    canvas._zoomSpan = 1200; canvas._zoomCenter = 600; canvas._redraw();
  }, { signal: sig });

  startAnim();
}

// ══════════════════════════════════════════════
// LATTICE DE EULER (red de quintas × terceras)
// ══════════════════════════════════════════════
// Grid 4×3: columnas = quintas, filas = terceras mayores
// Row 0: Ab Eb Bb F  (índices 8,3,10,5)
// Row 1: C  G  D  A  (índices 0,7,2,9)
// Row 2: E  B  F# C# (índices 4,11,6,1)
const LATTICE_GRID = [
  [8, 3, 10, 5],   // row 0 (bottom): Ab Eb Bb F
  [0, 7,  2, 9],   // row 1 (mid):    C  G  D  A
  [4,11,  6, 1],   // row 2 (top):    E  B  F# C#
];

function viewLattice(act) {
  document.getElementById('content').innerHTML = panel(
    'Lattice de Euler <small style="color:#4b5563;font-size:10px;font-weight:400">— red de quintas × terceras mayores</small>',
    `<canvas id="c-lattice" style="width:100%;display:block;cursor:pointer;touch-action:none"></canvas>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-lattice');
    if (!cv) return;
    const redraw = () => _drawLattice(cv, act);
    redraw();
    cv._redraw = redraw;
    attachPanelResize(cv);

    // Hover / tap: mostrar info de nota
    cv._hoverNode = null;
    function _nodeAtPoint(x, y) {
      const info = cv._nodeInfo;
      if (!info) return null;
      const R = cv._nodeR || 18;
      for (const n of info) {
        const dx = x - n.px, dy = y - n.py;
        if (dx*dx + dy*dy <= R*R) return n;
      }
      return null;
    }
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const node = _nodeAtPoint((e.clientX - r.left) * dpr / dpr, (e.clientY - r.top));
      if (node !== cv._hoverNode) { cv._hoverNode = node; redraw(); }
    });
    cv.addEventListener('pointerleave', () => { cv._hoverNode = null; redraw(); });
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const node = _nodeAtPoint(e.clientX - r.left, e.clientY - r.top);
      if (!node) return;
      // Reproducir la nota del primer temperamento activo
      const t = act[0]; if (!t) return;
      playFreqs([noteFreq(node.ni, t.offsets, pitchA, octaveShift)]);
    });
  });
}

function _drawLattice(canvas, act) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth || 500;
  const H   = Math.round(Math.min(W * 0.52, 280));
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const ROWS = LATTICE_GRID.length;    // 3
  const COLS = LATTICE_GRID[0].length; // 4
  // Calcular R primero a partir del espacio disponible, luego PAD garantiza que no se corte
  const cellW0 = (W * 0.82) / (COLS - 1);
  const cellH0 = (H * 0.72) / (ROWS - 1);
  const R = Math.round(Math.min(cellW0, cellH0) * 0.30);
  const PAD = R + Math.round(Math.min(W, H) * 0.04);
  const cellW = (W - PAD * 2) / (COLS - 1);
  const cellH = (H - PAD * 2) / (ROWS - 1);
  canvas._nodeR = R;

  // Coordenadas de cada nodo: row 0 = abajo, row 2 = arriba
  function nodeXY(row, col) {
    return {
      x: PAD + col * cellW,
      y: H - PAD - row * cellH,
    };
  }

  // Colores de desviación (usa la del primer temperamento activo)
  const t0 = act[0];
  function deviationColor(ni) {
    if (!t0) return '#334155';
    // Desviación = offset[ni] (cents respecto a ET)
    // Verde=cerca de justo, naranja/rojo=lejos
    const v = Math.abs(t0.offsets[ni]);
    if (v < 1)  return '#4ade80';
    if (v < 3)  return '#a3e635';
    if (v < 6)  return '#facc15';
    if (v < 10) return '#fb923c';
    return '#f87171';
  }

  // ── Aristas de quinta (horizontales) ──
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const ni = LATTICE_GRID[row][col];
      const nj = LATTICE_GRID[row][col + 1];
      const {x:x1,y:y1} = nodeXY(row, col);
      const {x:x2,y:y2} = nodeXY(row, col + 1);
      // Calidad de la quinta: desviación respecto a 701.955¢
      let fifthDev = 0;
      if (t0) {
        const semi = (nj - ni + 12) % 12; // debería ser 7
        const cents = semi * 100 + t0.offsets[nj] - t0.offsets[ni];
        fifthDev = Math.abs(cents - PURE_FIFTH);
      }
      const alpha = t0 ? Math.max(0.2, 1 - fifthDev / 12) : 0.4;
      ctx.strokeStyle = `rgba(148,163,184,${alpha.toFixed(2)})`;
      ctx.lineWidth = t0 ? Math.max(1, 3 - fifthDev / 4) : 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }

  // ── Aristas de tercera mayor (verticales) ──
  for (let row = 0; row < ROWS - 1; row++) {
    for (let col = 0; col < COLS; col++) {
      const ni = LATTICE_GRID[row][col];
      const nj = LATTICE_GRID[row + 1][col];
      const {x:x1,y:y1} = nodeXY(row, col);
      const {x:x2,y:y2} = nodeXY(row + 1, col);
      let maj3Dev = 0;
      if (t0) {
        const semi = (nj - ni + 12) % 12; // debería ser 4
        const cents = semi * 100 + t0.offsets[nj] - t0.offsets[ni];
        maj3Dev = Math.abs(cents - PURE_MAJ3);
      }
      const alpha = t0 ? Math.max(0.15, 1 - maj3Dev / 20) : 0.3;
      ctx.strokeStyle = `rgba(96,165,250,${alpha.toFixed(2)})`;
      ctx.lineWidth = t0 ? Math.max(1, 3 - maj3Dev / 6) : 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── Nodos ──
  const nodeInfo = [];
  const fSz = Math.min(11, Math.max(9, Math.round(R * 0.65)));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const ni = LATTICE_GRID[row][col];
      const {x, y} = nodeXY(row, col);
      const isHover = canvas._hoverNode && canvas._hoverNode.ni === ni;
      const col0 = deviationColor(ni);

      // Sombra en hover
      if (isHover) {
        ctx.shadowColor = col0; ctx.shadowBlur = 12;
      }

      // Círculo relleno
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? col0 : (t0 ? col0 + '33' : '#1e293b');
      ctx.fill();
      ctx.strokeStyle = col0; ctx.lineWidth = isHover ? 2.5 : 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Etiqueta de nota
      ctx.fillStyle = isHover ? '#0f172a' : '#e2e8f0';
      ctx.font = `${isHover ? 'bold ' : ''}${fSz}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(NOTES[ni], x, y);

      // Offset en cents debajo del nodo (solo si hay temperamento)
      if (t0) {
        const off = t0.offsets[ni];
        ctx.fillStyle = '#6b7280'; ctx.font = `${fSz - 2}px monospace`;
        ctx.fillText(`${off >= 0 ? '+' : ''}${off.toFixed(1)}`, x, y + R + 8);
      }

      nodeInfo.push({ ni, px: x, py: y });
    }
  }
  canvas._nodeInfo = nodeInfo;

  // ── Tooltip hover ──
  if (canvas._hoverNode && t0) {
    const { ni, px, py } = canvas._hoverNode;
    const freq = noteFreq(ni, t0.offsets, pitchA, octaveShift);
    const off  = t0.offsets[ni];
    const txt  = `${NOTES[ni]}  ${freq.toFixed(2)} Hz  ${off >= 0 ? '+' : ''}${off.toFixed(2)}¢`;
    const txW  = ctx.measureText(txt).width + 16;
    const txX  = Math.min(W - txW - 4, Math.max(4, px - txW / 2));
    const txY  = py - R - 28;
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.beginPath();
    ctx.roundRect(txX, txY, txW, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = `${fSz}px monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, txX + 8, txY + 10);
  }

  // ── Leyenda de aristas ──
  const legY = H - 6;
  ctx.font = `${fSz - 1}px monospace`; ctx.textBaseline = 'alphabetic';
  ctx.strokeStyle = 'rgba(148,163,184,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(PAD, legY - 4); ctx.lineTo(PAD + 18, legY - 4); ctx.stroke();
  ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left';
  ctx.fillText('quinta', PAD + 22, legY);
  ctx.strokeStyle = 'rgba(96,165,250,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(PAD + 70, legY - 4); ctx.lineTo(PAD + 88, legY - 4); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText('3ª mayor', PAD + 92, legY);
}

// ══════════════════════════════════════════════
// MAPA DE TRÍADAS
// ══════════════════════════════════════════════
// 24 tríadas: 12 mayores + 12 menores
// Pureza = |dev3ª| + |dev5ª| (menor = más pura)
// Dos vistas: rueda (círculo de quintas) y grid (12×2)

// Orden cromático de notas para el grid
const TRIAD_CHROMA = [0,1,2,3,4,5,6,7,8,9,10,11]; // C C# D ... B
// Orden por círculo de quintas para la rueda
const TRIAD_FIFTHS = [0,7,2,9,4,11,6,1,8,3,10,5];  // C G D A E B F# C# Ab Eb Bb F

// Calcula las 24 tríadas de un temperamento
// Retorna array de {root, type:'M'|'m', dev3, dev5, purity, cents3, cents5}
function _computeTriads(t) {
  const triads = [];
  for (let root = 0; root < 12; root++) {
    // Mayor: 3ª mayor (4 semitonos) + 5ª justa (7 semitonos)
    const m3i  = (root + 4) % 12;
    const p5i  = (root + 7) % 12;
    const cents3M = 4*100 + t.offsets[m3i] - t.offsets[root];
    const cents5M = 7*100 + t.offsets[p5i] - t.offsets[root];
    const dev3M = cents3M - PURE_MAJ3;
    const dev5M = cents5M - PURE_FIFTH;
    triads.push({ root, type:'M', dev3:dev3M, dev5:dev5M,
                  purity: Math.abs(dev3M) + Math.abs(dev5M), cents3:cents3M, cents5:cents5M });
    // Menor: 3ª menor (3 semitonos) + 5ª justa (7 semitonos)
    const mn3i = (root + 3) % 12;
    const cents3m = 3*100 + t.offsets[mn3i] - t.offsets[root];
    const cents5m = cents5M; // misma quinta
    const dev3m = cents3m - PURE_MIN3;
    const dev5m = dev5M;
    triads.push({ root, type:'m', dev3:dev3m, dev5:dev5m,
                  purity: Math.abs(dev3m) + Math.abs(dev5m), cents3:cents3m, cents5:cents5m });
  }
  return triads;
}

// Color según pureza (cents totales de desviación)
function _triadColor(purity) {
  if (purity <  4) return '#4ade80';
  if (purity <  8) return '#a3e635';
  if (purity < 14) return '#facc15';
  if (purity < 22) return '#fb923c';
  return '#f87171';
}

let _triadsMode = 'wheel'; // 'wheel' | 'grid'

function viewTriads(act) {
  const btnStyle = (active) =>
    `font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;border:1px solid #334155;` +
    (active ? 'background:#1e40af;color:#e2e8f0' : 'background:transparent;color:#6b7280');

  document.getElementById('content').innerHTML = panel(
    'Mapa de tríadas <small style="color:#4b5563;font-size:10px;font-weight:400">— pureza de las 24 tríadas (mayores + menores)</small>',
    `<div style="display:flex;gap:6px;margin-bottom:8px">
       <button id="triads-btn-wheel" style="${btnStyle(_triadsMode==='wheel')}" onclick="setTriadsMode('wheel')">Rueda</button>
       <button id="triads-btn-grid"  style="${btnStyle(_triadsMode==='grid')}"  onclick="setTriadsMode('grid')">Grid</button>
     </div>
     <canvas id="c-triads" style="width:100%;display:block;cursor:pointer;touch-action:none"></canvas>`,
    'width:100%'
  );
  requestAnimationFrame(() => {
    const cv = document.getElementById('c-triads');
    if (!cv) return;
    const redraw = () => _drawTriads(cv, act);
    redraw();
    cv._redraw = redraw;
    attachPanelResize(cv);

    // Hover
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect();
      const nx = _nodeAtTriad(cv, e.clientX - r.left, e.clientY - r.top);
      if (JSON.stringify(nx) !== JSON.stringify(cv._hoverTriad)) { cv._hoverTriad = nx; redraw(); }
    });
    cv.addEventListener('pointerleave', () => { cv._hoverTriad = null; redraw(); });

    // Click → reproducir tríada
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const hit = _nodeAtTriad(cv, e.clientX - r.left, e.clientY - r.top);
      if (!hit || !act[0]) return;
      const t = act[0];
      const intervals = hit.type === 'M' ? [0,4,7] : [0,3,7];
      const freqs = intervals.map(semi => noteFreq((hit.root + semi) % 12, t.offsets, pitchA, octaveShift));
      playFreqs(freqs);
    });
  });
}

function setTriadsMode(mode) {
  _triadsMode = mode;
  ['wheel','grid'].forEach(m => {
    const b = document.getElementById(`triads-btn-${m}`);
    if (b) {
      const active = m === mode;
      b.style.background = active ? '#1e40af' : 'transparent';
      b.style.color = active ? '#e2e8f0' : '#6b7280';
    }
  });
  const cv = document.getElementById('c-triads');
  if (cv?._redraw) cv._redraw();
}

function _nodeAtTriad(cv, mx, my) {
  if (!cv._triadHits) return null;
  for (const h of cv._triadHits) {
    if (_triadsMode === 'wheel') {
      const dx = mx - h.cx, dy = my - h.cy;
      if (dx*dx + dy*dy <= h.r*h.r) return h;
    } else {
      if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) return h;
    }
  }
  return null;
}

function _drawTriads(canvas, act) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth || 500;
  const isWheel = _triadsMode === 'wheel';
  const H   = isWheel ? Math.round(Math.min(W, 420)) : Math.round(Math.min(W * 0.45, 200));
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const t0 = act[0];
  const triads = t0 ? _computeTriads(t0) : null;
  // Para comparación, segundo y tercer temperamento
  const t1 = act[1] ? _computeTriads(act[1]) : null;
  const t2 = act[2] ? _computeTriads(act[2]) : null;

  canvas._triadHits = [];

  if (isWheel) {
    _drawTriadsWheel(ctx, W, H, triads, t1, t2, act, canvas);
  } else {
    _drawTriadsGrid(ctx, W, H, triads, t1, t2, act, canvas);
  }
}

function _drawTriadsWheel(ctx, W, H, triads, t1, t2, act, canvas) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.min(cx, cy) - 10;
  // Anillos: mayores fuera, menores dentro
  const rOuter = maxR * 0.95;
  const rMid   = maxR * 0.58;
  const rInner = maxR * 0.22;
  const segR_M = (rOuter - rMid) / 2;   // radio de celda mayor
  const segR_m = (rMid - rInner) / 2;   // radio de celda menor
  const fSz = Math.min(11, Math.max(8, Math.round(maxR * 0.06)));

  // 12 sectores por círculo de quintas
  const N = 12;
  const angleStep = (Math.PI * 2) / N;
  const gapAngle  = 0.04;

  TRIAD_FIFTHS.forEach((rootIdx, i) => {
    const angle = -Math.PI / 2 + i * angleStep; // empieza arriba
    const aStart = angle + gapAngle / 2;
    const aEnd   = angle + angleStep - gapAngle / 2;
    const aMid   = (aStart + aEnd) / 2;

    // ── Sector mayor (anillo exterior) ──
    const triadM = triads?.find(tr => tr.root === rootIdx && tr.type === 'M');
    const fillM  = triadM ? _triadColor(triadM.purity) : '#1e293b';
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, aStart, aEnd);
    ctx.arc(cx, cy, rMid,   aEnd,   aStart, true);
    ctx.closePath();
    ctx.fillStyle = fillM + '99';
    ctx.fill();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.stroke();

    // ── Sector menor (anillo interior) ──
    const triadm = triads?.find(tr => tr.root === rootIdx && tr.type === 'm');
    const fillm  = triadm ? _triadColor(triadm.purity) : '#1e293b';
    ctx.beginPath();
    ctx.arc(cx, cy, rMid,   aStart, aEnd);
    ctx.arc(cx, cy, rInner, aEnd,   aStart, true);
    ctx.closePath();
    ctx.fillStyle = fillm + '99';
    ctx.fill();
    ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1;
    ctx.stroke();

    // ── Etiqueta nota (entre los dos anillos → en el borde de rMid) ──
    const lbR = rMid + (rOuter - rMid) * 0.48;
    const lx  = cx + Math.cos(aMid) * lbR;
    const ly  = cy + Math.sin(aMid) * lbR;
    ctx.fillStyle = '#e2e8f0'; ctx.font = `bold ${fSz}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(NOTES[rootIdx], lx, ly);

    // ── Etiqueta nota menor (entre los dos anillos → en el borde de rInner) ──
    const lbRm = rInner + (rMid - rInner) * 0.48;
    const lxm  = cx + Math.cos(aMid) * lbRm;
    const lym  = cy + Math.sin(aMid) * lbRm;
    ctx.fillStyle = '#cbd5e1'; ctx.font = `${fSz - 1}px monospace`;
    ctx.fillText(NOTES[rootIdx] + 'm', lxm, lym);

    // Hit areas
    const hitRM = (rOuter + rMid) / 2;
    const hitrm = (rMid + rInner) / 2;
    if (triadM) canvas._triadHits.push({ ...triadM, cx: cx + Math.cos(aMid)*hitRM, cy: cy + Math.sin(aMid)*hitRM, r: segR_M * 0.8 });
    if (triadm) canvas._triadHits.push({ ...triadm, cx: cx + Math.cos(aMid)*hitrm, cy: cy + Math.sin(aMid)*hitrm, r: segR_m * 0.8 });
  });

  // ── Hover tooltip ──
  const hov = canvas._hoverTriad;
  if (hov && triads) {
    const txt = `${NOTES[hov.root]}${hov.type==='M'?'':' m'}  3ª:${hov.dev3>=0?'+':''}${hov.dev3.toFixed(1)}¢  5ª:${hov.dev5>=0?'+':''}${hov.dev5.toFixed(1)}¢  Σ${hov.purity.toFixed(1)}¢`;
    const txW = ctx.measureText(txt).width + 16;
    const txX = Math.min(W - txW - 4, Math.max(4, hov.cx - txW / 2));
    const txY = Math.max(4, hov.cy - 28);
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.beginPath(); ctx.roundRect(txX, txY, txW, 20, 4); ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = `${fSz}px monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, txX + 8, txY + 10);
  }

  // ── Leyenda anillos ──
  ctx.font = `${fSz}px monospace`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('Mayores', cx, cy - rInner * 0.35);
  ctx.fillText('m', cx, cy + rInner * 0.35);

  // ── Escala de color ──
  _drawTriadColorLegend(ctx, W, H, fSz);
}

function _drawTriadsGrid(ctx, W, H, triads, t1, t2, act, canvas) {
  const fSz  = Math.min(11, Math.max(8, Math.round(W / 52)));
  const PAD  = 8;
  const labelW = fSz * 3.2;
  const gridW  = W - PAD * 2 - labelW;
  const cellW  = gridW / 12;
  // 2 filas por temperamento seleccionado (M + m), separadas por un pequeño gap
  const nTemps = act.length;
  const rowH   = Math.max(18, Math.round((H - PAD * 2 - fSz * 2 - 10) / (nTemps * 2)));

  // Cabecera: nombre de notas
  ctx.font = `${fSz}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  TRIAD_CHROMA.forEach((ni, col) => {
    const x = PAD + labelW + col * cellW + cellW / 2;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(NOTES[ni], x, PAD + fSz / 2);
  });

  const allTriadSets = [triads, t1, t2].filter(Boolean);
  allTriadSets.forEach((trs, ti) => {
    const baseY = PAD + fSz + 6 + ti * (rowH * 2 + 6);

    ['M','m'].forEach((type, ri) => {
      const rowY = baseY + ri * rowH;

      // Etiqueta fila
      ctx.fillStyle = COLORS[act.indexOf(act[ti])] || '#94a3b8';
      ctx.font = `${fSz - 1}px monospace`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(type === 'M' ? (ti === 0 ? 'Mayor' : 'M') : (ti === 0 ? 'Menor' : 'm'),
                   PAD + labelW - 4, rowY + rowH / 2);

      TRIAD_CHROMA.forEach((rootIdx, col) => {
        const tr = trs.find(t => t.root === rootIdx && t.type === type);
        const x  = PAD + labelW + col * cellW;
        const fill = tr ? _triadColor(tr.purity) : '#1e293b';

        ctx.fillStyle = fill + 'bb';
        ctx.fillRect(x + 1, rowY + 1, cellW - 2, rowH - 2);
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 0.5; ctx.setLineDash([]);
        ctx.strokeRect(x + 1, rowY + 1, cellW - 2, rowH - 2);

        // Valor numérico si hay espacio
        if (tr && cellW > 28 && rowH > 14) {
          ctx.fillStyle = '#0f172a'; ctx.font = `${fSz - 2}px monospace`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(tr.purity.toFixed(1), x + cellW / 2, rowY + rowH / 2);
        }

        // Hit area
        if (tr) canvas._triadHits.push({ ...tr, x: x+1, y: rowY+1, w: cellW-2, h: rowH-2 });
      });
    });

    // Nombre del temperamento a la derecha
    if (act[ti]) {
      ctx.fillStyle = COLORS[ti] || '#94a3b8';
      ctx.font = `${fSz - 1}px monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(shortName(act[ti], 18), PAD + labelW, PAD + fSz + 6 + ti * (rowH * 2 + 6) - fSz - 1);
    }
  });

  // ── Hover tooltip ──
  const hov = canvas._hoverTriad;
  if (hov) {
    const txt = `${NOTES[hov.root]}${hov.type==='M'?'':' m'}  3ª:${hov.dev3>=0?'+':''}${hov.dev3.toFixed(1)}¢  5ª:${hov.dev5>=0?'+':''}${hov.dev5.toFixed(1)}¢  Σ${hov.purity.toFixed(1)}¢`;
    const txW = ctx.measureText(txt).width + 16;
    const txX = Math.min(W - txW - 4, Math.max(4, hov.x - 4));
    const txY = Math.max(4, hov.y - 24);
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.beginPath(); ctx.roundRect(txX, txY, txW, 20, 4); ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = `${fSz}px monospace`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, txX + 8, txY + 10);
  }

  _drawTriadColorLegend(ctx, W, H, fSz);
}

function _drawTriadColorLegend(ctx, W, H, fSz) {
  const steps = [
    { label:'<4¢', color:'#4ade80' }, { label:'<8¢', color:'#a3e635' },
    { label:'<14¢', color:'#facc15' }, { label:'<22¢', color:'#fb923c' },
    { label:'≥22¢', color:'#f87171' },
  ];
  let lx = W - (steps.length * 42) - 4;
  ctx.font = `${fSz - 1}px monospace`; ctx.textBaseline = 'alphabetic';
  steps.forEach(s => {
    ctx.fillStyle = s.color + '99';
    ctx.fillRect(lx, H - fSz - 6, 10, 10);
    ctx.strokeStyle = s.color; ctx.lineWidth = 0.5; ctx.setLineDash([]);
    ctx.strokeRect(lx, H - fSz - 6, 10, 10);
    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'left';
    ctx.fillText(s.label, lx + 13, H - 4);
    lx += 42;
  });
}

// ─── TONNETZ ───
function viewTonnetz(act) {
  let html = '';
  act.forEach((temp, ti) => {
    html += panel(
      `Tonnetz — <span style="color:${COLORS[ti]}">${temp.name}</span>`,
      `<canvas id="tz-${ti}" style="width:100%;cursor:pointer;display:block"></canvas>
       <div style="margin-top:4px;font-size:9px;color:#4b5563;text-align:center">→ quinta &nbsp;↗ 3ª Mayor &nbsp;↘ 3ª menor &nbsp;·&nbsp; ▲ tríada mayor &nbsp;▽ tríada menor</div>
       <div id="tz-nfo-${ti}" style="margin-top:8px;min-height:1.8em;font-size:clamp(14px,4vw,18px);color:var(--text);text-align:center;font-weight:500;letter-spacing:0.2px">pulsa una nota o región para oír</div>
       <div class="grad-bar" style="margin-top:6px">
         <span>tríada pura</span>
         <div style="height:10px;border-radius:3px;flex:1;min-width:60px;background:linear-gradient(to right,hsl(142,65%,30%),hsl(50,80%,30%),hsl(0,85%,30%))"></div>
         <span>tríada impura</span>
       </div>`,
      'width:100%'
    );
  });
  document.getElementById('content').innerHTML = html;
  act.forEach((temp, ti) => {
    requestAnimationFrame(() => {
      const cv = document.getElementById(`tz-${ti}`);
      if (cv) {
        const nfo = document.getElementById(`tz-nfo-${ti}`);
        _initTonnetz(cv, nfo, temp, ti);
        cv._redraw = () => _initTonnetz(cv, nfo, temp, ti);
        attachPanelResize(cv);
      }
    });
  });
}

function _initTonnetz(canvas, nfoEl, temp, ti) {
  const NC = 11, NR = 4;
  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.clientWidth || 560;
  const MX   = 14, MY = 16;
  const stepW = (W - MX * 2) / (NC - 1 + (NR - 1) * 0.5);
  // If panel has explicit height, scale step to fill Y axis too
  const panel = canvas.closest('.panel');
  let stepH = Infinity;
  if (panel?.style.height) {
    const availH = _availCanvasH(canvas);
    if (availH > 40) stepH = (availH - MY * 2) / ((NR - 1) * Math.sqrt(3) / 2);
  }
  const step = Math.min(stepW, stepH);
  const HS   = step * Math.sqrt(3) / 2;
  const H    = (NR - 1) * HS + MY * 2;
  const R    = Math.min(step * 0.28, 13);

  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const gx = (c, r) => MX + c * step + r * step * 0.5;
  const gy = r => MY + (NR - 1 - r) * HS;
  const ni = (c, r) => ((c * 7 + r * 4) % 12 + 12) % 12;

  // Interval deviations from just
  const devI  = (root, semi) => semi * 100 + temp.offsets[(root + semi) % 12] - temp.offsets[root];
  const devM3 = root => devI(root, 4) - 386.314;
  const devm3 = root => devI(root, 3) - 315.641;
  const devP5 = root => devI(root, 7) - 701.955;

  function triColor(root, isMaj) {
    const dt = Math.abs(isMaj ? devM3(root) : devm3(root));
    const df = Math.abs(devP5(root));
    const t  = Math.min(1, (dt * 0.65 + df * 0.35) / 18);
    const h  = t < 0.5 ? 142 - t * 184 : 50 - (t - 0.5) * 100;
    return `hsl(${h.toFixed(0)},${(60 + t*25).toFixed(0)}%,${(28 + (1-t)*8).toFixed(0)}%)`;
  }

  // Precompute triangles
  const tris = [];
  for (let c = 0; c < NC - 1; c++) {
    for (let r = 0; r < NR - 1; r++) {
      tris.push({ isMaj: true,  root: ni(c, r),
        ns: [ni(c,r),   ni(c+1,r), ni(c,r+1)],
        xs: [gx(c,r),   gx(c+1,r), gx(c,r+1)],
        ys: [gy(r),     gy(r),     gy(r+1)]  });
      tris.push({ isMaj: false, root: ni(c, r+1),
        ns: [ni(c+1,r), ni(c,r+1), ni(c+1,r+1)],
        xs: [gx(c+1,r), gx(c,r+1), gx(c+1,r+1)],
        ys: [gy(r),     gy(r+1),   gy(r+1)]    });
    }
  }

  // Draw
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  tris.forEach(t => {
    ctx.fillStyle = triColor(t.root, t.isMaj);
    ctx.beginPath();
    ctx.moveTo(t.xs[0], t.ys[0]); ctx.lineTo(t.xs[1], t.ys[1]); ctx.lineTo(t.xs[2], t.ys[2]);
    ctx.closePath(); ctx.fill();
  });

  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.7;
  tris.forEach(t => {
    ctx.beginPath();
    ctx.moveTo(t.xs[0], t.ys[0]); ctx.lineTo(t.xs[1], t.ys[1]); ctx.lineTo(t.xs[2], t.ys[2]);
    ctx.closePath(); ctx.stroke();
  });

  for (let c = 0; c < NC; c++) {
    for (let r = 0; r < NR; r++) {
      const n = ni(c, r), x = gx(c, r), y = gy(r);
      ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle = '#1a2535'; ctx.fill();
      ctx.strokeStyle = COLORS[ti]; ctx.lineWidth = 1.2; ctx.stroke();
      const lbl = NOTES[n];
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `${Math.max(7, R * (lbl.length > 1 ? 0.68 : 0.82))}px system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lbl, x, y);
    }
  }

  // Interaction
  function ptInTri(px, py, t) {
    const s = (ax,ay,bx,by) => (px-bx)*(ay-by) - (ax-bx)*(py-by);
    const d1=s(t.xs[0],t.ys[0],t.xs[1],t.ys[1]);
    const d2=s(t.xs[1],t.ys[1],t.xs[2],t.ys[2]);
    const d3=s(t.xs[2],t.ys[2],t.xs[0],t.ys[0]);
    return !((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0));
  }

  function nearNode(mx, my) {
    let best = null, bd = Infinity;
    for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) {
      const d = Math.hypot(mx - gx(c,r), my - gy(r));
      if (d < bd) { bd = d; best = { n: ni(c,r) }; }
    }
    return bd < R * 2 ? best : null;
  }

  canvas.addEventListener('pointerdown', e => {
    const rc = canvas.getBoundingClientRect();
    const mx = (e.clientX - rc.left) * (W / rc.width);
    const my = (e.clientY - rc.top)  * (H / rc.height);
    const nd = nearNode(mx, my);
    if (nd) {
      playNote(nd.n, temp.offsets);
      const off = temp.offsets[nd.n];
      if (nfoEl) nfoEl.textContent = `${NOTES[nd.n]}  offset: ${off>=0?'+':''}${off.toFixed(2)}¢`;
      return;
    }
    const tr = tris.find(t => ptInTri(mx, my, t));
    if (tr) {
      playFreqs(tr.ns.map(n => noteFreq(n, temp.offsets, pitchA, octaveShift)));
      const rn = NOTES[tr.root], type = tr.isMaj ? 'mayor' : 'menor';
      const dt = (tr.isMaj ? devM3 : devm3)(tr.root), df = devP5(tr.root);
      const s = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '¢';
      if (nfoEl) nfoEl.textContent = `${rn} ${type}  ·  ${tr.isMaj ? '3ª M' : '3ª m'}: ${s(dt)}  ·  5ª: ${s(df)}`;
    }
  });
}

// ─── MAPA / SCATTER ───
function viewScatter() {
  if (!_scatterPts) {
    _scatterPts = all.map((temp, idx) => {
      let minM3 = Infinity;
      for (let i = 0; i < 12; i++) {
        const d = Math.abs(400 + temp.offsets[(i+4)%12] - temp.offsets[i] - 386.314);
        if (d < minM3) minM3 = d;
      }
      let maxP5 = 0;
      for (let i = 0; i < 12; i++) {
        const d = Math.abs(700 + temp.offsets[(i+7)%12] - temp.offsets[i] - 701.955);
        if (d > maxP5) maxP5 = d;
      }
      return { idx, x: minM3, y: maxP5, src: temp.source, name: temp.name };
    });
  }
  document.getElementById('content').innerHTML = panel(
    `Cartografía de temperamentos (${all.length})`,
    `<canvas id="scat-cv" style="width:100%;cursor:grab;display:block;touch-action:none"></canvas>
     <div id="scat-resize" class="chart-resize-handle" title="Arrastra para cambiar altura"></div>
     <div id="scat-nfo" style="margin-top:4px;min-height:1.4em;font-size:10px;color:var(--muted);text-align:center">pulsa un punto para seleccionarlo · rueda/pinch para zoom · arrastra para mover</div>
     <div style="margin-top:4px;display:flex;gap:14px;justify-content:center;flex-wrap:wrap;font-size:10px;color:#6b7280">
       <span><span style="color:#60a5fa">●</span> Scala</span>
       <span><span style="color:#fb923c">●</span> GrandOrgue</span>
       <span><span style="color:#a78bfa">●</span> Otros</span>
       <span style="color:#4b5563">← 3ªM mejor &nbsp;↓ 5ª mejor</span>
     </div>`,
    'width:100%');
  requestAnimationFrame(() => {
    const cv = document.getElementById('scat-cv');
    if (!cv) return;
    _initScatter(cv);
    cv._redraw = () => _initScatter(cv);
    attachPanelResize(cv);
    // Handle de resize — registrado una sola vez, fuera de _initScatter
    const scatHandle = document.getElementById('scat-resize');
    if (scatHandle) {
      scatHandle.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        scatHandle.setPointerCapture(ev.pointerId);
        const startY = ev.clientY, startH = cv.clientHeight || parseInt(cv.dataset.userH||'0',10) || Math.round(cv.clientWidth*0.62);
        function onMove(e) {
          const newH = Math.max(140, startH + e.clientY - startY);
          cv.style.height = newH + 'px'; // estira visualmente el bitmap durante el drag
        }
        function onUp() {
          scatHandle.removeEventListener('pointermove', onMove);
          scatHandle.removeEventListener('pointerup', onUp);
          cv.dataset.userH = cv.clientHeight; // guarda la altura pedida por el usuario
          cv.style.height = ''; // resetea inline para que _initScatter calcule desde dataset
          _initScatter(cv);
        }
        scatHandle.addEventListener('pointermove', onMove, { passive: true });
        scatHandle.addEventListener('pointerup', onUp);
      });
    }
  });
}

function _initScatter(canvas) {
  const pts   = _scatterPts;
  const nfoEl = document.getElementById('scat-nfo');
  const dpr   = window.devicePixelRatio || 1;
  const W     = canvas.clientWidth || 580;
  const panel = canvas.closest('.panel');
  // Prioridad de altura:
  // 1. Si el panel fue redimensionado (resize nativo o handle), usar el espacio disponible
  // 2. Si el canvas tiene altura explícita en px (drag del handle scatter), usarla
  // 3. Fallback: proporción del ancho
  const availH = panel?.style.height ? _availCanvasH(canvas) : 0;
  const explicitH = canvas.dataset.userH ? parseInt(canvas.dataset.userH, 10) : 0;
  const H = availH > 80 ? Math.round(availH) : explicitH > 80 ? explicitH : Math.round(Math.min(W * 0.62, 370));
  const MX = 44, MY = 10, MR = 10, MB = 28;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const plotW = W - MX - MR, plotH = H - MY - MB;

  const xs = pts.map(p=>p.x).sort((a,b)=>a-b);
  const ys = pts.map(p=>p.y).sort((a,b)=>a-b);
  const fullMaxX = Math.ceil(xs[Math.floor(xs.length*0.96)] / 5) * 5;
  const fullMaxY = Math.ceil(ys[Math.floor(ys.length*0.96)] / 5) * 5;

  // ── Viewport state (data units) ──
  let vMinX = 0, vMaxX = fullMaxX, vMinY = 0, vMaxY = fullMaxY;

  const toX   = v  => MX + (v - vMinX) / (vMaxX - vMinX) * plotW;
  const toY   = v  => MY + plotH - (v - vMinY) / (vMaxY - vMinY) * plotH;
  const fromX = cx => vMinX + (cx - MX) / plotW * (vMaxX - vMinX);
  const fromY = cy => vMinY + (1 - (cy - MY) / plotH) * (vMaxY - vMinY);
  const isZoomed = () => vMinX > 0.01 || vMaxX < fullMaxX * 0.99 || vMinY > 0.01 || vMaxY < fullMaxY * 0.99;

  function niceStep(range) {
    const raw = range / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return n < 1.5 ? mag : n < 3.5 ? 2*mag : n < 7.5 ? 5*mag : 10*mag;
  }

  function zoomAround(cxPx, cyPx, factor) {
    const dx = fromX(cxPx), dy = fromY(cyPx);
    vMinX = dx + (vMinX-dx)*factor; vMaxX = dx + (vMaxX-dx)*factor;
    vMinY = dy + (vMinY-dy)*factor; vMaxY = dy + (vMaxY-dy)*factor;
    draw();
  }
  function pan(dxPx, dyPx) {
    const dxD = dxPx/plotW*(vMaxX-vMinX), dyD = dyPx/plotH*(vMaxY-vMinY);
    vMinX -= dxD; vMaxX -= dxD; vMinY += dyD; vMaxY += dyD;
    draw();
  }
  function resetZoom() { vMinX=0; vMaxX=fullMaxX; vMinY=0; vMaxY=fullMaxY; draw(); }

  const SRC_COL = { 'Scala':'#60a5fa', 'GrandOrgue':'#fb923c' };
  let hovPt = null;

  function draw() {
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0,0,W,H);

    // Grid with adaptive tick step
    const xStep = niceStep(vMaxX - vMinX), yStep = niceStep(vMaxY - vMinY);
    ctx.lineWidth = 0.6;
    const xStart = Math.ceil(vMinX/xStep)*xStep;
    for (let v = xStart; v <= vMaxX+xStep*0.01; v += xStep) {
      const x = toX(v); if (x < MX-1 || x > MX+plotW+1) continue;
      ctx.strokeStyle='#1e2a3a'; ctx.beginPath(); ctx.moveTo(x,MY); ctx.lineTo(x,MY+plotH); ctx.stroke();
      ctx.fillStyle='#4b5563'; ctx.font='9px system-ui'; ctx.textAlign='center';
      ctx.fillText((Math.round(v*10)/10)+'¢', x, MY+plotH+14);
    }
    const yStart = Math.ceil(vMinY/yStep)*yStep;
    for (let v = yStart; v <= vMaxY+yStep*0.01; v += yStep) {
      const y = toY(v); if (y < MY-1 || y > MY+plotH+1) continue;
      ctx.strokeStyle='#1e2a3a'; ctx.beginPath(); ctx.moveTo(MX,y); ctx.lineTo(MX+plotW,y); ctx.stroke();
      ctx.fillStyle='#4b5563'; ctx.font='9px system-ui'; ctx.textAlign='right';
      ctx.fillText((Math.round(v*10)/10)+'¢', MX-4, y+3);
    }
    ctx.strokeStyle='#374151'; ctx.lineWidth=1; ctx.strokeRect(MX,MY,plotW,plotH);

    // Axis labels
    ctx.fillStyle='#6b7280'; ctx.font='10px system-ui'; ctx.textAlign='center';
    ctx.fillText('mejor 3ªM (mín. desv. de justa)', MX+plotW/2, H-2);
    ctx.save(); ctx.translate(11,MY+plotH/2); ctx.rotate(-Math.PI/2);
    ctx.fillText('peor 5ª (desv. máx.)', 0, 0); ctx.restore();

    // Clip to plot area
    ctx.save();
    ctx.beginPath(); ctx.rect(MX, MY, plotW, plotH); ctx.clip();

    // ET crosshairs
    const etPt = pts.find(p=>p.name==='Equal temperament'&&p.src==='GrandOrgue')||pts.find(p=>p.name.toLowerCase()==='equal temperament');
    if (etPt) {
      ctx.strokeStyle='#334155'; ctx.lineWidth=0.8; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(toX(etPt.x),MY); ctx.lineTo(toX(etPt.x),MY+plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MX,toY(etPt.y)); ctx.lineTo(MX+plotW,toY(etPt.y)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle='#475569'; ctx.font='9px system-ui'; ctx.textAlign='left';
      ctx.fillText('ET', toX(etPt.x)+3, MY+11);
    }

    // Points by color (batch)
    const byCol = {};
    pts.forEach(p => {
      if (selected.some(s=>s&&s.name===p.name)) return;
      const col = SRC_COL[p.src]||'#a78bfa';
      (byCol[col]=byCol[col]||[]).push(p);
    });
    Object.entries(byCol).forEach(([col,ps]) => {
      ctx.fillStyle = col+'55'; ctx.beginPath();
      ps.forEach(p => { ctx.moveTo(toX(p.x)+2,toY(p.y)); ctx.arc(toX(p.x),toY(p.y),2,0,Math.PI*2); });
      ctx.fill();
    });

    if (hovPt && !selected.some(s=>s&&s.name===hovPt.name)) {
      ctx.beginPath(); ctx.arc(toX(hovPt.x),toY(hovPt.y),5,0,Math.PI*2);
      ctx.fillStyle='#e2e8f0'; ctx.fill();
    }
    selected.filter(Boolean).forEach((t,si) => {
      const p=pts.find(pt=>pt.name===t.name); if(!p) return;
      ctx.beginPath(); ctx.arc(toX(p.x),toY(p.y),7,0,Math.PI*2);
      ctx.fillStyle=COLORS[si]; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    });

    ctx.restore(); // end clip

    // Tooltip (fuera del clip para que no se corte)
    if (hovPt) {
      const tx=Math.max(MX+2,Math.min(toX(hovPt.x)+8,W-160));
      const ty=Math.max(MY+16,toY(hovPt.y)-20);
      ctx.font='10px system-ui';
      const tw=Math.min(ctx.measureText(hovPt.name).width+10,W-MX-8);
      ctx.fillStyle='rgba(15,23,42,0.92)'; ctx.fillRect(tx,ty,tw,17);
      ctx.fillStyle='#e2e8f0'; ctx.textAlign='left'; ctx.fillText(hovPt.name,tx+5,ty+12);
    }

    // Botón reset zoom (esquina superior derecha del plot)
    if (isZoomed()) {
      const bx=MX+plotW-44, by=MY+3, bw=42, bh=14;
      ctx.fillStyle='rgba(30,41,59,0.9)'; ctx.fillRect(bx,by,bw,bh);
      ctx.strokeStyle='#334155'; ctx.lineWidth=0.5; ctx.strokeRect(bx,by,bw,bh);
      ctx.fillStyle='#60a5fa'; ctx.font='9px system-ui'; ctx.textAlign='center';
      ctx.fillText('↺ reset', bx+bw/2, by+10);
    }
  }

  function nearPt(mx, my, thr) {
    let best=null, bd=thr;
    pts.forEach(p => {
      const px=toX(p.x), py=toY(p.y);
      if (px<MX||px>MX+plotW||py<MY||py>MY+plotH) return;
      const d=Math.hypot(mx-px,my-py); if(d<bd){bd=d;best=p;}
    });
    return best;
  }

  function selectPt(np) {
    if (!np) return;
    hovPt=np;
    const t=all[np.idx], already=selected.some(s=>s&&s.name===t.name);
    selected = already ? [null,null,null] : [t,null,null];
    lastSelected = already ? null : t;
    if(!already) savePrefs({selectedName:t.name});
    renderBadges(); refreshList(); draw();
    if(nfoEl) nfoEl.textContent = already ? 'pulsa un punto para seleccionarlo'
      : `${t.name} [${t.source}]  ·  3ªM: ${np.x.toFixed(1)}¢  ·  5ª: ${np.y.toFixed(1)}¢`;
  }

  draw();

  // ── Mouse wheel zoom ──
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rc=canvas.getBoundingClientRect(), scX=W/rc.width, scY=H/rc.height;
    const cx=(e.clientX-rc.left)*scX, cy=(e.clientY-rc.top)*scY;
    if (cx<MX||cx>MX+plotW||cy<MY||cy>MY+plotH) return;
    zoomAround(cx, cy, e.deltaY>0 ? 1.2 : 1/1.2);
  }, {passive:false});

  // ── Mouse drag (pan) + click (select) ──
  let _mDown=false, _mX=0, _mY=0, _mMoved=false;
  canvas.addEventListener('mousedown', e => {
    _mDown=true; _mX=e.clientX; _mY=e.clientY; _mMoved=false;
    canvas.style.cursor='grabbing';
  });
  const _onMouseMove = e => {
    if (!canvas.isConnected) return;
    if (_mDown) {
      const dx=e.clientX-_mX, dy=e.clientY-_mY;
      if (!_mMoved && Math.hypot(dx,dy)<4) return;
      _mMoved=true; _mX=e.clientX; _mY=e.clientY;
      pan(dx, dy);
    } else {
      const rc=canvas.getBoundingClientRect();
      const np=nearPt((e.clientX-rc.left)*(W/rc.width),(e.clientY-rc.top)*(H/rc.height),12);
      canvas.style.cursor = np ? 'crosshair' : 'grab';
      if(np!==hovPt){hovPt=np;draw();}
    }
  };
  const _onMouseUp = () => { if (!canvas.isConnected) return; _mDown=false; canvas.style.cursor='grab'; };
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mouseup', _onMouseUp);

  canvas.addEventListener('mouseleave', () => { if(!_mDown){hovPt=null;draw();} });

  canvas.addEventListener('click', e => {
    if (_mMoved) return;
    const rc=canvas.getBoundingClientRect(), scX=W/rc.width, scY=H/rc.height;
    const cx=(e.clientX-rc.left)*scX, cy=(e.clientY-rc.top)*scY;
    // Reset zoom button
    if (isZoomed() && cx>MX+plotW-44&&cx<MX+plotW-2&&cy>MY+3&&cy<MY+17) { resetZoom(); return; }
    selectPt(nearPt(cx, cy, 15));
  });

  canvas.addEventListener('dblclick', resetZoom);

  // ── Touch: pinch zoom + pan + tap ──
  let _tc={}, _pinchDist=null, _pinchMid=null, _tStart=null, _tMoved=false;

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t=>{_tc[t.identifier]={x:t.clientX,y:t.clientY};});
    const ids=Object.keys(_tc);
    if (ids.length===1) { _tStart={x:_tc[ids[0]].x,y:_tc[ids[0]].y}; _tMoved=false; }
    if (ids.length===2) {
      const [a,b]=ids.map(id=>_tc[id]);
      _pinchDist=Math.hypot(a.x-b.x,a.y-b.y);
      _pinchMid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    }
  },{passive:false});

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    Array.from(e.changedTouches).forEach(t=>{_tc[t.identifier]={x:t.clientX,y:t.clientY};});
    const ids=Object.keys(_tc);
    const rc=canvas.getBoundingClientRect(), scX=W/rc.width, scY=H/rc.height;
    if (ids.length>=2) {
      const [a,b]=ids.slice(0,2).map(id=>_tc[id]);
      const dist=Math.hypot(a.x-b.x,a.y-b.y);
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if (_pinchDist) {
        const cx=(mid.x-rc.left)*scX, cy=(mid.y-rc.top)*scY;
        zoomAround(cx,cy,_pinchDist/dist);
        if (_pinchMid) pan((mid.x-_pinchMid.x)*scX,(mid.y-_pinchMid.y)*scY);
      }
      _pinchDist=dist; _pinchMid=mid;
    } else if (ids.length===1&&_tStart) {
      const t=_tc[ids[0]];
      const dx=t.x-_tStart.x, dy=t.y-_tStart.y;
      if (!_tMoved&&Math.hypot(dx,dy)<5) return;
      _tMoved=true; pan(dx*scX,dy*scY); _tStart={x:t.x,y:t.y};
    }
  },{passive:false});

  canvas.addEventListener('touchend', e => {
    Array.from(e.changedTouches).forEach(t=>{delete _tc[t.identifier];});
    const ids=Object.keys(_tc);
    if (ids.length<2){_pinchDist=null;_pinchMid=null;}
    if (ids.length===0&&!_tMoved&&_tStart) {
      const rc=canvas.getBoundingClientRect(), scX=W/rc.width, scY=H/rc.height;
      const touch=e.changedTouches[0];
      const cx=(touch.clientX-rc.left)*scX, cy=(touch.clientY-rc.top)*scY;
      if (isZoomed()&&cx>MX+plotW-44&&cx<MX+plotW-2&&cy>MY+3&&cy<MY+17){resetZoom();}
      else selectPt(nearPt(cx,cy,15));
    }
    if (ids.length===0){_tStart=null;_tMoved=false;}
  },{passive:false});

  // Doble tap para reset
  let _lastTap=0;
  canvas.addEventListener('touchend', e=>{
    if(e.changedTouches.length===1&&Object.keys(_tc).length===0){
      const now=Date.now(); if(now-_lastTap<300){resetZoom();} _lastTap=now;
    }
  },{passive:false});
}

// ─── TECLADO ───
function viewKeyboard() {
  const tempName = selected.find(Boolean)?.name ?? '—';
  document.getElementById('content').innerHTML = `
    <div class="panel" style="width:100%">
      <div id="kb-controls">
        <!-- Modo -->
        <div style="display:flex;gap:4px">
          <button class="kb-mode${KB.mode==='normal'?' sel':''}" data-mode="normal" onclick="KB.setMode('normal')">Normal</button>
          <button class="kb-mode${KB.mode==='legato'?' sel':''}" data-mode="legato" onclick="KB.setMode('legato')">Legato</button>
          <button class="kb-mode${KB.mode==='chord'?' sel':''}"  data-mode="chord"  onclick="KB.setMode('chord')">Acorde</button>
        </div>
        <!-- Octava teclado -->
        <div style="display:flex;align-items:center;gap:5px">
          <button class="icon-btn" onclick="KB.shiftOct(-1)">◀</button>
          <span id="kb-oct-lbl" style="font-size:11px;color:var(--muted);white-space:nowrap">Oct. ${KB.octave}–${KB.octave+2}</span>
          <button class="icon-btn" onclick="KB.shiftOct(+1)">▶</button>
        </div>
        <!-- Semitono (legato) -->
        <div id="kb-semi-btns" style="display:flex;align-items:center;gap:4px">
          <button class="icon-btn" onclick="KB.shiftSemitone(-1)" style="padding:4px 12px;font-size:15px">−</button>
          <span style="font-size:10px;color:var(--muted);white-space:nowrap">Semitono</span>
          <button class="icon-btn" onclick="KB.shiftSemitone(+1)" style="padding:4px 12px;font-size:15px">+</button>
        </div>
        <!-- Limpiar acorde -->
        <button id="kb-clear-btn" class="icon-btn" onclick="KB.clearAll()"
          style="display:${KB.mode==='chord'?'inline-block':'none'};opacity:${KB.chordMap.size>0?'1':'0.4'}">
          Limpiar ✕
        </button>
        <!-- Pantalla completa -->
        <button id="kb-fs-btn" class="icon-btn" onclick="toggleKbFullscreen()" title="Pantalla completa" style="margin-left:auto;display:flex;align-items:center;justify-content:center;padding:4px 8px">
          ${document.body.classList.contains('kb-fullscreen') ? ICON_COLLAPSE : ICON_EXPAND}
        </button>
      </div>

      <!-- La + Temperamento en la misma fila -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:#4b5563;margin-bottom:10px">
        <span style="color:var(--muted)">La =</span>
        <input id="kb-pitch-input" type="number" value="${pitchA}" min="390" max="470" step="0.1"
          style="width:58px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;text-align:center;outline:none"
          onchange="setPitchAGlobal(this.value)"
          onkeydown="if(event.key==='Enter')setPitchAGlobal(this.value)">
        <span style="color:var(--muted)">Hz</span>
        <span style="color:var(--border)">·</span>
        Temperamento: <span style="color:var(--c0)">${tempName}</span>
        ${!selected.find(Boolean) ? '<span style="color:#f87171"> — selecciona uno en la lista</span>' : ''}
      </div>

      <!-- Piano -->
      <div id="kb-wrap"></div>

      <!-- Nota activa -->
      <div id="kb-lbl">—</div>

      <!-- Leyenda modos -->
      <div style="margin-top:16px;font-size:10px;color:#4b5563;line-height:1.8">
        <b style="color:#6b7280">Normal</b> — suena solo mientras se pulsa &nbsp;·&nbsp;
        <b style="color:#6b7280">Legato</b> — la nota sigue hasta que se pulsa otra &nbsp;·&nbsp;
        <b style="color:#6b7280">Acorde</b> — las notas se acumulan; pulsa de nuevo para quitar
      </div>
    </div>`;
  KB.render();
}

// ══════════════════════════════════════════════
// AFINADOR — DETECCIÓN DE PITCH (MPM — McLeod Pitch Method)
// detectPitch, _refineFFT → vienen de core.js

// Wrapper de findClosestNote (core.js) que inyecta el estado global de la app.
// Usar const (no function) para no sobrescribir window.findClosestNote con recursión infinita.
const _appFindNote = (freq) => {
  const off = (lastSelected ?? selected.find(Boolean))?.offsets ?? new Array(12).fill(0);
  return window.findClosestNote(freq, pitchA, off);
};

// ══════════════════════════════════════════════
// AFINADOR — TUNER OBJECT
// ══════════════════════════════════════════════
const TUNER = {
  mode: 'auto',    // 'auto' | 'manual'
  targetNi: 9, targetOct: 4,
  tunerOct: 4,
  _refNi: null, _refOct: null,
  refOn: false, refOsc: null, refGain: null,
  micOn: false, micStream: null, analyser: null,
  vizMode: 'needle',
  strobePhase: 0, prevStrobePhase: 0, lastTs: 0, rafId: null,
  _wavePhase: 0, _smoothedError: 0,
  _needlePos: 0, _needleVel: 0,  // simulación física muelle-masa para la aguja
  _emojiCents: 50,                // promedio lento para el emoji (τ=2s)
  detectedFreq: null, detectedCents: null, clarity: 0, rms: 0,
  _lastFreq: 440, _lastNi: 9, _lastOct: 4,  // último pitch válido (A4 inicial)
  _octCandidate: null, _octCandidateMs: 0,  // candidato de octava pendiente de confirmar
  _buf: null, _freqBuf: null,  // buffers pre-reservados
  _freqHistory: [],  // historial para filtro de mediana temporal

  getTargetFreq() {
    const off = (lastSelected ?? selected.find(Boolean))?.offsets ?? new Array(12).fill(0);
    return pitchA * Math.pow(2, (ET_FROM_A[this.targetNi] + off[this.targetNi] + (this.targetOct - 4) * 1200) / 1200);
  },

  setMode(m) {
    // Si salimos de manual y el sonido lo puso el teclado (no el botón ref.), pararlo
    if (this.mode === 'manual' && m !== 'manual' && !this.refOn) this.stopRef();
    this.mode = m;
    savePrefs({ tunerMode: m });
    this.strobePhase = 0; this.prevStrobePhase = 0; this._octCandidate = null; this._octCandidateMs = 0; this._freqHistory.length = 0;
    if (document.getElementById('tuner-screen')) {
      cancelAnimationFrame(this.rafId); this.rafId = null;
      closeTunerMenu();
      buildTunerScreen(); return;
    }
    document.querySelectorAll('.tmode-btn').forEach(b => b.classList.toggle('sel', b.dataset.tmode === m));
    const kw = document.getElementById('tuner-kb-wrap');
    if (kw) kw.style.display = m === 'manual' ? 'block' : 'none';
    const mc = document.getElementById('tuner-manual-ctrl');
    if (mc) mc.style.display = m === 'manual' ? 'flex' : 'none';
  },

  setTarget(ni, oct) {
    // Toggle: volver a pulsar la nota que suena la apaga
    if (ni === this.targetNi && oct === this.targetOct && this.refOn) {
      this.stopRef(); return;
    }
    this.targetNi = ni; this.targetOct = oct;
    this.strobePhase = 0; this.prevStrobePhase = 0; this._octCandidate = null; this._octCandidateMs = 0; this._freqHistory.length = 0;
    this.updateTargetDisplay();
    document.querySelectorAll('[data-tni]').forEach(el =>
      el.classList.toggle('ka', +el.dataset.tni === ni && +el.dataset.toct === oct));
    // En modo manual el teclado siempre suena (con o sin "Nota ref.")
    if (this.mode === 'manual' || this.refOn) {
      if (this.refOsc) {
        // Legato: cambio suave de frecuencia sin reataque
        this.refOsc.frequency.setTargetAtTime(this.getTargetFreq(), getCtx().currentTime, 0.015);
      } else {
        this.startRef();
      }
    }
  },

  updateTargetDisplay() {
    const nEl = document.getElementById('tuner-big-note');
    const fEl = document.getElementById('tuner-target-hz');
    if (nEl) nEl.textContent = NOTES[this.targetNi] + this.targetOct;
    if (fEl) fEl.textContent = this.getTargetFreq().toFixed(3) + ' Hz';
  },

  shiftOct(d) {
    this.tunerOct = Math.max(1, Math.min(7, this.tunerOct + d));
    document.querySelectorAll('#tuner-oct-lbl,#tuner-oct-lbl2').forEach(el => el.textContent = 'Oct ' + this.tunerOct);
    savePrefs({ tunerOct: this.tunerOct });
    this.renderMiniKb();
  },

  shiftSemitone(d) {
    let ni = this.targetNi + d;
    let oct = this.targetOct;
    if (ni > 11) { ni = 0; oct++; }
    else if (ni < 0) { ni = 11; oct--; }
    if (oct < 1 || oct > 8) return;
    if (oct < this.tunerOct) { this.tunerOct = oct; document.querySelectorAll('#tuner-oct-lbl,#tuner-oct-lbl2').forEach(el => el.textContent = 'Oct ' + this.tunerOct); }
    else if (oct > this.tunerOct + 1) { this.tunerOct = oct - 1; document.querySelectorAll('#tuner-oct-lbl,#tuner-oct-lbl2').forEach(el => el.textContent = 'Oct ' + this.tunerOct); }
    this.setTarget(ni, oct);
    this.renderMiniKb();
  },

  toggleRef() {
    if (this.refOn) this.stopRef(); else this.startRef();
  },
  startRef() {
    this.refOn = true;
    const btn = document.getElementById('ref-btn');
    if (btn) { btn.textContent = '♪ Silenciar'; btn.classList.add('sel'); }
    const ctx = getCtx(), now = ctx.currentTime;
    this.refGain = ctx.createGain();
    this.refGain.gain.setValueAtTime(0, now);
    this.refGain.gain.linearRampToValueAtTime(0.60, now + 0.025);
    this.refGain.connect(masterGain);
    this.refOsc = ctx.createOscillator();
    const rf = this.getTargetFreq();
    _applyWave(this.refOsc, ctx, currentWave, rf);
    this.refOsc.frequency.value = rf;
    this.refOsc.connect(this.refGain);
    this.refOsc.start(now);
  },
  stopRef() {
    this.refOn = false;
    const btn = document.getElementById('ref-btn');
    if (btn) { btn.textContent = '♪ Sonar nota'; btn.classList.remove('sel'); }
    if (this.refOsc) {
      const now = audioCtx?.currentTime ?? 0;
      this.refGain.gain.linearRampToValueAtTime(0, now + 0.05);
      setTimeout(() => { try { this.refOsc.stop(); this.refOsc.disconnect(); this.refGain.disconnect(); } catch(e){} }, 80);
      this.refOsc = null; this.refGain = null;
    }
  },

  async toggleMic() {
    if (this.micOn) this.stopMic(); else await this.startMic();
  },
  async startMic() {
    try {
      getCtx(); // Crear/reanudar AudioContext durante el gesto de usuario (antes del await)
      const stream = await navigator.mediaDevices.getUserMedia(
        { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.micStream = stream;
      const ctx = getCtx();
      const src = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;
      src.connect(this.analyser);
      this.micOn = true;
      requestWakeLock();
      localStorage.setItem('micAutoStart', '1');
      document.querySelectorAll('.mic-toggle-track').forEach(t => t.style.background = '#3b82f6');
      document.querySelectorAll('.mic-toggle-thumb').forEach(t => t.style.left = '16px');
      document.querySelectorAll('.mic-toggle-lbl').forEach(t => { t.style.color = '#93c5fd'; });
      // Quitar el botón grande del overlay
      const ov = document.getElementById('strobe-overlay');
      if (ov) ov.innerHTML = '';
      if (!this.rafId) { this.lastTs = performance.now(); this.loop(this.lastTs); }
    } catch(e) {
      document.querySelectorAll('.mic-toggle-lbl').forEach(t => { t.textContent = 'Sin permiso'; });
      alert('No se pudo acceder al micrófono:\n' + e.message);
    }
  },
  stopMic() {
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch(e){} this.analyser = null; }
    this.micOn = false;
    if (!DT?.micOn) releaseWakeLock();
    document.querySelectorAll('.mic-toggle-track').forEach(t => t.style.background = '#334155');
    document.querySelectorAll('.mic-toggle-thumb').forEach(t => t.style.left = '2px');
    document.querySelectorAll('.mic-toggle-lbl').forEach(t => { t.style.color = '#64748b'; });
  },

  stop() {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.stopMic();
    this.stopRef();
    this.detectedFreq = null; this.detectedCents = null; this.clarity = 0;
  },

  loop(ts) {
    if (!document.getElementById('strobe-canvas')) { this.stop(); return; }
    this.rafId = requestAnimationFrame(t => this.loop(t));
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;

    let freqError = 0;
    if (this.analyser) {
      // Buffers pre-reservados: evita allocar Float32Array cada frame (reduce GC)
      if (!this._buf || this._buf.length !== this.analyser.fftSize) {
        this._buf = new Float32Array(this.analyser.fftSize);
        this._freqBuf = new Float32Array(this.analyser.frequencyBinCount);
      }
      const buf = this._buf;
      this.analyser.getFloatTimeDomainData(buf);
      this.analyser.getFloatFrequencyData(this._freqBuf);
      // RMS sobre los primeros 1024 muestras (rápido)
      let rmsSum = 0;
      const rmsN = Math.min(1024, buf.length);
      for (let i = 0; i < rmsN; i++) rmsSum += buf[i] * buf[i];
      this.rms = Math.sqrt(rmsSum / rmsN);

      const p = detectPitch(buf, getCtx().sampleRate);
      // Refinar frecuencia con interpolación parabólica sobre FFT nativa (coste JS ≈ 0)
      if (p && p.clarity >= 0.15) p.freq = _refineFFT(p.freq, this._freqBuf, getCtx().sampleRate);
      if (p && p.clarity >= 0.15) {
        this.detectedFreq = p.freq;
        this._lastFreq = p.freq;
        this._lastNi = this.targetNi; this._lastOct = this.targetOct;
        this.clarity = p.clarity;


        if (this.mode === 'auto') {
          // Detección de nota: usar freq cruda para que los cambios reales de octava puedan acumularse
          const c = _appFindNote(p.freq);
          const OCT_HOLD_MS = 200;
          if (c.ni !== this.targetNi) {
            // Cambio de nota: aceptar inmediatamente
            this.targetNi = c.ni; this.targetOct = c.oct;
            this._octCandidate = null; this._octCandidateMs = 0;
          } else if (c.oct !== this.targetOct) {
            // Misma nota, distinta octava: requiere confirmación durante OCT_HOLD_MS
            if (this._octCandidate === c.oct) {
              this._octCandidateMs += dt * 1000;
              if (this._octCandidateMs >= OCT_HOLD_MS) {
                this.targetOct = c.oct;
                this._octCandidate = null; this._octCandidateMs = 0;
              }
            } else {
              this._octCandidate = c.oct; this._octCandidateMs = dt * 1000;
            }
          } else {
            this._octCandidate = null; this._octCandidateMs = 0;
          }
          this.updateTargetDisplay();
        }
        const tf = this.getTargetFreq();
        // Snap solo para waterfall: evitar pliegues por armónicos sin bloquear detección de octava
        let snapFreq = p.freq;
        if (snapFreq > 0) { // guarda: frecuencia negativa o cero causa bucle infinito
          while (snapFreq < tf * Math.SQRT1_2) snapFreq *= 2;
          while (snapFreq > tf * Math.SQRT2)   snapFreq /= 2;
        } else { snapFreq = tf; }
        // Filtro de mediana temporal en cents (N=9): estabiliza la visualización
        // sin afectar a la identificación de nota/octava.
        // Resetea si el pitch ha saltado > 80 cents (cambio real de nota).
        const rawCents = 1200 * Math.log2(snapFreq / tf);
        const H = this._freqHistory;
        if (H.length && Math.abs(rawCents - H[H.length - 1]) > 80) H.length = 0;
        H.push(rawCents);
        if (H.length > 9) H.shift();
        const sc = H.slice().sort((a, b) => a - b);
        this.detectedCents = sc[sc.length >> 1];
        freqError = snapFreq - tf;
        if (this.refOn && this.refOsc) {
          const now = getCtx().currentTime;
          const noteChanged = (this.targetNi !== this._refNi || this.targetOct !== this._refOct);
          this._refNi = this.targetNi; this._refOct = this.targetOct;
          if (noteChanged) {
            // Nota nueva: salto inmediato
            this.refOsc.frequency.cancelScheduledValues(now);
            this.refOsc.frequency.setValueAtTime(tf, now);
          } else {
            // Misma nota: cancelar automatizaciones acumuladas antes de fijar nueva
            this.refOsc.frequency.cancelScheduledValues(now);
            this.refOsc.frequency.setValueAtTime(this.refOsc.frequency.value, now);
            this.refOsc.frequency.setTargetAtTime(tf, now, 0.08);
          }
        }
      } else {
        this.detectedFreq = null; this.detectedCents = null; this.clarity = 0;
      }
    }

    this.prevStrobePhase = this.strobePhase;
    this.strobePhase += 2 * Math.PI * freqError * dt;
    // Fase suavizada para la forma de onda (tau=0.3s filtra el jitter del detector)
    const _wAlpha = Math.exp(-dt / 0.3);
    this._smoothedError = this._smoothedError * _wAlpha + freqError * (1 - _wAlpha);
    this._wavePhase += 2 * Math.PI * this._smoothedError * dt;
    // Aguja: simulación muelle-masa amortiguado (near-critically damped)
    const _nTarget = this.detectedCents !== null ? Math.max(-50, Math.min(50, this.detectedCents)) : 0;
    const _spring = 30, _damp = 18;  // omega_n≈5.5 Hz, zeta≈1.64 (sobreamortiguado, lento y suave)
    this._needleVel += (_spring * (_nTarget - this._needlePos) - _damp * this._needleVel) * dt;
    this._needlePos += this._needleVel * dt;
    // Emoji: promedio lento independiente (τ=2s) para que no parpadee
    const _eAlpha = Math.exp(-dt / 2.0);
    const _eTarget = this.detectedCents !== null ? Math.abs(this.detectedCents) : 50;
    this._emojiCents = this._emojiCents * _eAlpha + _eTarget * (1 - _eAlpha);
    this.renderStrobe();
    this.updateStatus();
  },

  setVizMode(mode) {
    this.vizMode = mode;
    savePrefs({ tunerVizMode: mode });
    this.strobePhase = 0; this.prevStrobePhase = 0;
    this._wavePhase = 0; this._smoothedError = 0;
    this._needlePos = 0; this._needleVel = 0; this._emojiCents = 50;
    const cv = document.getElementById('strobe-canvas');
    if (cv) { const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height); }
  },

  renderStrobe() {
    if (this.vizMode === 'waveform') { this.renderWaveformStrobe(); return; }
    if (this.vizMode === 'needle')   { this.renderNeedle(); return; }

    const canvas = document.getElementById('strobe-canvas');
    if (!canvas) return;
    const W = canvas.clientWidth || 400;
    const H = canvas.clientHeight || 220;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').fillStyle = '#000';
      canvas.getContext('2d').fillRect(0, 0, W, H);
    }
    const ctx = canvas.getContext('2d');

    const SCROLL = 40;
    ctx.drawImage(canvas, 0, 0, W, H - SCROLL, 0, SCROLL, W, H - SCROLL);

    const strip = ctx.createImageData(W, SCROLL);
    const d = strip.data;

    const STRIPES = 6;
    const has     = this.detectedFreq !== null;

    for (let s = 0; s < SCROLL; s++) {
      const alpha = s / SCROLL;
      const phase = this.strobePhase * (1 - alpha) + this.prevStrobePhase * alpha;
      for (let x = 0; x < W; x++) {
        const val = (Math.sin((x / W) * 2 * Math.PI * STRIPES - phase * STRIPES) + 1) / 2;
        const v   = has ? Math.round(val * 255) : Math.round(val * 18);
        const i   = (s * W + x) * 4;
        d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
      }
    }
    ctx.putImageData(strip, 0, 0);
  },

  renderNeedle() {
    const canvas = document.getElementById('strobe-canvas');
    if (!canvas) return;
    const W = canvas.clientWidth || 400;
    const H = canvas.clientHeight || 220;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    const ov = document.getElementById('strobe-overlay');
    if (ov) ov.innerHTML = '';

    const has  = this.detectedFreq !== null;
    const nc   = this._needlePos;
    const raw  = this.detectedCents ?? 0;
    const absC = Math.abs(raw);

    // Color de aguja según afinación
    const arcCol = (a) => {
      if (a < 2)  return [74, 222, 128];
      if (a < 8)  { const t=(a-2)/6; return [Math.round(74+t*181), Math.round(222-t*62), 0]; }
      if (a < 25) { const t=(a-8)/17; return [255, Math.round(160-t*160), 0]; }
      return [239, 68, 68];
    };
    const [nr,ng,nb] = has ? arcCol(absC) : [71,85,105];
    const col = `rgb(${nr},${ng},${nb})`;

    // Geometría: pivot en 88% de H, R acotado para que el arco quepa
    const cx = W / 2;
    // R acotado por ancho Y por alto: deja espacio arriba para nota y abajo para cents
    const R  = Math.min(W * 0.44, H * 0.58);
    const cy = Math.min(H * 0.88, R + H * 0.30);

    // c cents → ángulo. c=-50 → π (izq), c=0 → 1.5π (arriba), c=50 → 2π (der)
    // Corrección: el ángulo 0 en canvas es a la derecha, π/2 abajo, π izq, 3π/2 arriba
    const toAngle = (c) => Math.PI + (Math.max(-50, Math.min(50, c)) + 50) / 100 * Math.PI;

    // Arco de fondo — degradado suave rojo→naranja→verde→naranja→rojo
    // Usando el punto MEDIO del segmento para que el verde esté exactamente en c=0
    const ARC_STEPS = 120;
    const arcLW = Math.max(7, Math.round(R * 0.13));
    ctx.lineWidth = arcLW;
    ctx.lineCap = 'butt';
    for (let i = 0; i < ARC_STEPS; i++) {
      const tmid = (i + 0.5) / ARC_STEPS;        // punto MEDIO del segmento
      const cents = (tmid - 0.5) * 100;           // -50..+50, simétrico
      const av = Math.abs(cents);
      // degradado continuo apagado: verde oscuro en centro, rojo oscuro en extremos
      let rr, gg, bb;
      if (av < 5)       { const t=av/5;      rr=Math.round(t*80);  gg=Math.round(80-t*20); bb=Math.round(t*5); }
      else if (av < 15) { const t=(av-5)/10;  rr=Math.round(80+t*100); gg=Math.round(60-t*40); bb=0; }
      else              { const t=(av-15)/35; rr=Math.round(180+t*60); gg=Math.round(20-t*10); bb=0; }
      const a1 = toAngle(cents - 50/ARC_STEPS);
      const a2 = toAngle(cents + 50/ARC_STEPS);
      ctx.beginPath();
      ctx.arc(cx, cy, R, a1, a2, false);
      ctx.strokeStyle = `rgb(${rr},${gg},${bb})`;
      ctx.stroke();
    }

    // Ticks y etiquetas
    const ticks = [
      {c:-50,major:true},{c:-25,major:true},{c:-10,major:false},{c:-5,major:false},
      {c:0,major:true},
      {c:5,major:false},{c:10,major:false},{c:25,major:true},{c:50,major:true}
    ];
    ticks.forEach(({c: tc, major}) => {
      const a   = toAngle(tc);
      const cos = Math.cos(a), sin = Math.sin(a);
      const len = major ? arcLW * 1.8 : arcLW * 1.1;
      const r0  = R - arcLW * 0.5 - len;
      const r1  = R + arcLW * 0.5 + 2;
      ctx.beginPath();
      ctx.moveTo(cx + r0*cos, cy + r0*sin);
      ctx.lineTo(cx + r1*cos, cy + r1*sin);
      ctx.lineWidth   = major ? 2 : 1;
      ctx.strokeStyle = tc === 0 ? '#93c5fd' : '#64748b';
      ctx.lineCap = 'round';
      ctx.stroke();
      if (major) {
        const lr = R - arcLW * 0.5 - len - R * 0.09;
        ctx.fillStyle = tc === 0 ? '#93c5fd' : '#94a3b8';
        ctx.font = `${Math.round(R * 0.10)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(tc === 0 ? '0' : (tc > 0 ? '+' : '') + tc, cx + lr*cos, cy + lr*sin);
      }
    });

    // Aguja
    const needleA = toAngle(nc);
    ctx.beginPath();
    ctx.moveTo(cx - R*0.08*Math.cos(needleA), cy - R*0.08*Math.sin(needleA));
    ctx.lineTo(cx + R*0.85*Math.cos(needleA), cy + R*0.85*Math.sin(needleA));
    ctx.lineWidth   = 2.5;
    ctx.strokeStyle = has ? col : '#475569';
    ctx.lineCap     = 'round';
    if (has && absC < 5) { ctx.shadowBlur = 16; ctx.shadowColor = col; }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Pivote
    ctx.beginPath();
    ctx.arc(cx, cy, arcLW * 0.38, 0, 2*Math.PI);
    ctx.fillStyle = '#1e293b'; ctx.fill();
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1.5; ctx.stroke();

    // Nota — centrada en el espacio entre la cima del arco y el borde superior
    const dispNi  = has ? this.targetNi  : this._lastNi;
    const dispOct = has ? this.targetOct : this._lastOct;
    const arcTop  = cy - R - arcLW * 0.5;  // borde exterior del arco
    const noteY   = arcTop / 2;            // centro del espacio disponible arriba
    const notePx  = Math.round(Math.min(arcTop * 0.65, R * 0.42));
    ctx.fillStyle = has ? col : '#374151';
    ctx.font = `bold ${notePx}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(NOTES[dispNi] + dispOct, cx, noteY);

    // Cents throttled a 4fps
    const nowMs = performance.now();
    if (!this._needleTextTs || nowMs - this._needleTextTs > 250) {
      this._needleTextTs = nowMs;
      this._needleTextStr = has ? (raw >= 0 ? '+' : '') + raw.toFixed(1) + '¢' : '—';
    }
    ctx.fillStyle = col;
    ctx.font = `${Math.round(Math.min(H * 0.065, R * 0.13))}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(this._needleTextStr || '—', cx, cy + arcLW * 0.6 + 4);
  },

  renderWaveformStrobe() {
    const canvas = document.getElementById('strobe-canvas');
    if (!canvas) return;
    const W = canvas.clientWidth || 400;
    const H = canvas.clientHeight || 220;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, W, H);

    // Línea central de referencia
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const buf = this._buf;
    if (!buf) return;

    const has = this.detectedFreq !== null;
    const sampleRate = getCtx().sampleRate;
    const targetFreq = this.getTargetFreq();
    const periodSamples = sampleRate / targetFreq;
    // Mostrar 3 períodos de la onda (estirado a todo el ancho)
    const displaySamples = Math.min(Math.round(periodSamples * 6), buf.length - 1);

    // Offset estroboscópico suavizado: filtra el jitter del detector de pitch
    const phaseShiftSamples = (this._wavePhase / (2 * Math.PI)) * periodSamples;
    const startSample = ((Math.round(phaseShiftSamples) % buf.length) + buf.length) % buf.length;

    // Color según afinación
    const c = this.detectedCents;
    const absCents = Math.abs(c ?? 0);
    let col;
    if (!has)            col = 'rgba(100,116,139,0.5)';
    else if (absCents < 2)  col = '#4ade80';
    else if (absCents < 8)  col = `rgb(${Math.round(74+(absCents-2)/6*181)},${Math.round(222-(absCents-2)/6*62)},0)`;
    else if (absCents < 25) col = `rgb(255,${Math.round(160-(absCents-8)/17*160)},0)`;
    else col = '#ef4444';

    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    if (has && absCents < 5) { ctx.shadowBlur = 10; ctx.shadowColor = col; }
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const si = (startSample + Math.round((x / W) * displaySamples)) % buf.length;
      const y = H / 2 - buf[si] * (H * 0.42);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  },

  updateStatus() {
    // Signal bar: cada frame. Texto: máx 4 veces/seg
    const now = performance.now();
    const textReady = !this._lastTextTs || (now - this._lastTextTs) > 250;

    const has = this.detectedFreq !== null;
    const c   = this.detectedCents;
    const absCents = Math.abs(c ?? 0);

    // Color según afinación
    let col;
    if (!has) { col = 'rgba(200,200,200,0.45)'; }
    else if (absCents < 2)  { col = '#4ade80'; }
    else if (absCents < 8)  { const t=(absCents-2)/6; col=`rgb(${Math.round(74+t*181)},${Math.round(222-t*62)},${Math.round(128*(1-t))})`; }
    else if (absCents < 25) { const t=(absCents-8)/17; col=`rgb(255,${Math.round(160-t*160)},0)`; }
    else { col = '#ef4444'; }

    // En modo aguja el canvas gestiona todo el display; el overlay ya se limpia en renderNeedle
    if (this.vizMode === 'needle') {
      // Solo actualizar barra de señal y elementos de desktop (cents-needle, etc.)
      const sigFil = document.getElementById('signal-fill');
      if (sigFil) { const s=Math.min(1,this.rms*10); sigFil.style.width=(s*100)+'%'; sigFil.style.background=s>0.6?'#4ade80':s>0.2?'#fbbf24':'#ef4444'; }
      return;
    }

    // Overlay superpuesto — texto throttled a 4 fps
    if (textReady) {
      this._lastTextTs = now;
      const ov = document.getElementById('strobe-overlay');
      if (ov) {
        // Siempre mostrar última nota conocida; atenuada si no hay detección activa
        const dispNi  = has ? this.targetNi  : this._lastNi;
        const dispOct = has ? this.targetOct : this._lastOct;
        const noteCol = has ? col : 'rgba(180,180,180,0.35)';
        const centsStr = has && c !== null ? (c >= 0 ? '+' : '') + c.toFixed(1) + '¢' : '';
        const freqStr  = has ? this.detectedFreq.toFixed(1) + ' Hz'
                              : this._lastFreq.toFixed(1) + ' Hz';
        ov.innerHTML = `
          <span style="font-size:clamp(80px,22vw,180px);font-weight:bold;color:${noteCol};text-shadow:0 0 16px rgba(0,0,0,0.95),0 0 4px rgba(0,0,0,1);line-height:1">${NOTES[dispNi] + dispOct}</span>
          ${centsStr ? `<span style="font-size:clamp(32px,8vw,64px);color:${col};margin-top:6px;background:rgba(0,0,0,0.45);border-radius:6px;padding:2px 10px;backdrop-filter:blur(2px)">${centsStr}</span>` : ''}
          <span style="font-size:clamp(20px,5vw,40px);color:${has?'rgba(200,200,200,0.9)':'rgba(150,150,150,0.3)'};margin-top:4px;background:rgba(0,0,0,0.45);border-radius:6px;padding:2px 10px;backdrop-filter:blur(2px)">${freqStr}</span>`;
      }
    }

    // Signal bar
    const sigFil = document.getElementById('signal-fill');
    if (sigFil) {
      const s = Math.min(1, this.rms * 10);
      sigFil.style.width = (s * 100) + '%';
      sigFil.style.background = s > 0.6 ? '#4ade80' : s > 0.2 ? '#fbbf24' : '#ef4444';
    }

    // Needle y status (solo desktop)
    const needle = document.getElementById('cents-needle');
    if (needle) {
      const pct = has && c !== null ? 50 + Math.max(-50, Math.min(50, c)) * 0.9 : 50;
      needle.style.left = pct + '%';
      needle.style.background = !has ? '#374151' : absCents < 2 ? '#4ade80' : absCents < 10 ? '#fbbf24' : '#f87171';
    }
    const cEl = document.getElementById('det-cents');
    if (cEl) { cEl.textContent = has && c !== null ? (c >= 0 ? '+' : '') + c.toFixed(1) + '¢' : '—'; cEl.style.color = col; }
    const fEl = document.getElementById('det-freq');
    if (fEl) fEl.textContent = has ? this.detectedFreq.toFixed(1) + ' Hz' : '—';
    const nEl = document.getElementById('det-note-auto');
    if (nEl) nEl.textContent = has ? NOTES[this.targetNi] + this.targetOct : '—';
  },

  renderMiniKb() {
    const wrap = document.getElementById('tuner-mini-kb');
    if (!wrap) return;
    const mob = isMobile();
    const nO = 2;
    const availW = mob ? (window.innerWidth - 16) : Math.max(320, (document.getElementById('tuner-kb-wrap')?.clientWidth || 400) - 16);
    const W = Math.max(mob ? 20 : 26, Math.floor(availW / (nO * 7)));
    const H = Math.min(mob ? 72 : 96, Math.round(W * 2.8));
    const BW = Math.round(W * 0.58), BH = Math.round(H * 0.62);
    const WN  = [0,2,4,5,7,9,11], BK = [{ni:1,cx:1},{ni:3,cx:2},{ni:6,cx:4},{ni:8,cx:5},{ni:10,cx:6}];
    const WL  = ['C','D','E','F','G','A','B'];
    let html = `<div style="position:relative;height:${H+2}px;width:${W*7*nO+1}px;user-select:none">`;
    for (let o = 0; o < nO; o++) {
      const oct = this.tunerOct + o;
      const ox  = o * W * 7;
      WN.forEach((ni, wi) => {
        const act = ni === this.targetNi && oct === this.targetOct;
        html += `<div class="kw${act?' ka':''}" style="left:${ox+wi*W}px;width:${W-1}px;height:${H}px" data-tni="${ni}" data-toct="${oct}" onclick="TUNER.setTarget(${ni},${oct})"><span class="klbl" style="font-size:8px">${ni===0?'C'+oct:WL[wi]}</span></div>`;
      });
      BK.forEach(({ni, cx}) => {
        const act = ni === this.targetNi && oct === this.targetOct;
        html += `<div class="kb2${act?' ka':''}" style="left:${ox+cx*W-BW/2}px;width:${BW}px;height:${BH}px" data-tni="${ni}" data-toct="${oct}" onclick="TUNER.setTarget(${ni},${oct})"></div>`;
      });
    }
    html += '</div>';
    wrap.innerHTML = html;
  }
};

// ─── VISTA AFINADOR ───
function toggleTunerMenu() {
  const m = document.getElementById('tuner-menu');
  if (!m) return;
  const opening = m.style.display === 'none';
  m.style.display = opening ? 'flex' : 'none';
  if (opening) {
    // Cierra al pulsar fuera del menú
    setTimeout(() => {
      document.addEventListener('pointerdown', function _close(e) {
        if (!m.contains(e.target) && !e.target.closest('[onclick="toggleTunerMenu()"]')) {
          m.style.display = 'none';
          document.removeEventListener('pointerdown', _close);
        }
      });
    }, 0);
  }
}
function closeTunerMenu() {
  const m = document.getElementById('tuner-menu');
  if (m) m.style.display = 'none';
}
function showAbout() {
  const el = document.getElementById('about-modal');
  document.getElementById('about-version').textContent = APP_VERSION;
  el.style.display = 'flex';
}
function hideAbout() {
  document.getElementById('about-modal').style.display = 'none';
}
function tunerTempName() {
  const t = lastSelected ?? selected.find(Boolean);
  return t ? t.name : '(sin temperamento)';
}

function exitTuner() {
  TUNER.stop();
  document.getElementById('tuner-screen')?.remove();
}

function buildTunerScreen() {
  document.getElementById('tuner-screen')?.remove();
  const isManual = TUNER.mode === 'manual';
  const sc = document.createElement('div');
  sc.id = 'tuner-screen';
  // En desktop el sidebar (280px) es estático: el tuner-screen no debe taparlo
  if (!isMobile()) {
    sc.style.left  = '280px';
    sc.style.width = 'calc(100% - 280px)';
  }
  sc.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;gap:8px;padding:0 10px;background:#0f172a;flex-shrink:0;height:46px;box-sizing:border-box">
      <button onclick="exitTuner()" style="background:none;border:none;color:#93c5fd;font-size:24px;cursor:pointer;line-height:1;padding:0 4px">‹</button>
      <span id="tuner-temp-name" style="flex:1;font-size:11px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${tunerTempName()}</span>
      <div id="signal-bar" style="width:44px"><div id="signal-fill"></div></div>
      <button onclick="toggleTunerMenu()" style="background:none;border:none;color:#93c5fd;cursor:pointer;padding:4px;display:flex;flex-direction:column;gap:4px">
        <span style="width:18px;height:2px;background:currentColor;display:block;border-radius:1px"></span>
        <span style="width:18px;height:2px;background:currentColor;display:block;border-radius:1px"></span>
        <span style="width:18px;height:2px;background:currentColor;display:block;border-radius:1px"></span>
      </button>
      <!-- Menú desplegable -->
      <div id="tuner-menu" style="display:none;position:absolute;top:46px;right:0;width:240px;background:#1e293b;border:1px solid #334155;border-radius:0 0 0 10px;z-index:10;padding:10px;box-sizing:border-box;flex-direction:column;gap:8px">
        <div style="font-size:10px;color:#64748b;margin-bottom:2px">MODO</div>
        <div style="display:flex;gap:6px">
          <button class="tmode-btn${isManual?'':' sel'}" data-tmode="auto" onclick="TUNER.setMode('auto')" style="flex:1;font-size:12px">Auto</button>
          <button class="tmode-btn${isManual?' sel':''}" data-tmode="manual" onclick="TUNER.setMode('manual')" style="flex:1;font-size:12px">Manual</button>
        </div>
        <div style="border-top:1px solid #334155;padding-top:8px;margin-top:2px">
          <div style="font-size:10px;color:#64748b;margin-bottom:4px">VISUALIZACIÓN</div>
          <select onchange="TUNER.setVizMode(this.value)" style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer">
            <option value="waterfall"${TUNER.vizMode==='waterfall'?' selected':''}>Estroboscopio waterfall</option>
            <option value="waveform"${TUNER.vizMode==='waveform'?' selected':''}>Forma de onda estroboscópica</option>
            <option value="needle"${TUNER.vizMode==='needle'?' selected':''}>Aguja</option>
          </select>
        </div>
        <div id="tmenu-oct" style="display:${isManual?'flex':'none'};align-items:center;gap:8px;margin-top:2px">
          <span style="font-size:10px;color:#64748b;flex:1">Octava</span>
          <button class="icon-btn" onclick="TUNER.shiftOct(-1)" style="padding:2px 8px">◀</button>
          <span id="tuner-oct-lbl" style="font-size:12px;color:#cbd5e1;min-width:36px;text-align:center">Oct ${TUNER.tunerOct}</span>
          <button class="icon-btn" onclick="TUNER.shiftOct(+1)" style="padding:2px 8px">▶</button>
        </div>
        <div style="border-top:1px solid #334155;padding-top:8px;margin-top:2px">
          <div style="font-size:10px;color:#64748b;margin-bottom:4px">TEMPERAMENTO</div>
          <div style="font-size:11px;color:#93c5fd;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${tunerTempName()}</div>
          <button onclick="closeTunerMenu();openSidebar()" style="width:100%;background:#1d4ed8;border:none;color:#fff;border-radius:6px;padding:7px;cursor:pointer;font-size:12px">☰ Cambiar temperamento</button>
        </div>
        <div style="border-top:1px solid #334155;padding-top:8px;margin-top:2px;display:flex;gap:6px">
          <button id="ref-btn" class="icon-btn${TUNER.refOn?' sel':''}" onclick="TUNER.toggleRef()" style="flex:1;font-size:12px">♪ Nota ref.</button>
          <label onclick="TUNER.toggleMic()" style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;user-select:none;padding:4px 6px;border-radius:6px">
            <span style="font-size:14px">🎤</span>
            <div class="mic-toggle-track" style="position:relative;width:34px;height:18px;background:${TUNER.micOn?'#3b82f6':'#334155'};border-radius:9px;transition:background 0.2s;flex-shrink:0">
              <div class="mic-toggle-thumb" style="position:absolute;top:2px;left:${TUNER.micOn?'16px':'2px'};width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s"></div>
            </div>
            <span class="mic-toggle-lbl" style="font-size:11px;color:${TUNER.micOn?'#93c5fd':'#64748b'}">Mic</span>
          </label>
        </div>
        <div style="border-top:1px solid #334155;padding-top:8px;margin-top:2px">
          <div style="font-size:10px;color:#64748b;margin-bottom:4px">La (Hz)</div>
          <div style="display:flex;align-items:center;gap:6px">
            <input type="number" id="tuner-pitch-input" value="${pitchA}" min="1" max="9999" step="0.1"
              style="flex:1;background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:5px 8px;font-size:13px;text-align:center;outline:none"
              oninput="const _v=parseFloat(this.value);if(_v>0){pitchA=_v;savePrefs({pitchA:_v});}document.getElementById('pitch-input').value=this.value;if(TUNER.refOsc)TUNER.refOsc.frequency.setTargetAtTime(TUNER.getTargetFreq(),getCtx().currentTime,0.01)">
          </div>
        </div>
        ${!window.matchMedia('(display-mode: standalone)').matches ? `<div style="border-top:1px solid #334155;padding-top:8px;margin-top:2px">
          <button onclick="(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen())" style="width:100%;background:#0f172a;border:1px solid #334155;color:#94a3b8;border-radius:6px;padding:7px;cursor:pointer;font-size:12px">⛶ Pantalla completa</button>
        </div>` : ''}
        <div style="border-top:1px solid #1e293b;padding-top:8px;margin-top:2px;text-align:center">
          <button onclick="closeTunerMenu();showAbout()" style="background:none;border:none;color:#475569;font-size:10px;cursor:pointer;padding:2px 8px">ℹ Acerca de…</button>
        </div>
      </div>
    </div>
    <div style="position:relative;flex:1;min-height:0">
      <canvas id="strobe-canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block"></canvas>
      <div id="strobe-overlay" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
        ${!TUNER.micOn ? `<button onclick="TUNER.toggleMic()" style="pointer-events:auto;background:rgba(29,78,216,0.92);border:3px solid #60a5fa;border-radius:50%;width:min(180px,40vw);height:min(180px,40vw);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;box-shadow:0 0 40px rgba(96,165,250,0.4)">
          <span style="font-size:clamp(48px,12vw,80px);line-height:1">🎤</span>
          <span style="font-size:clamp(13px,3.5vw,18px);color:#bfdbfe;font-weight:600">Iniciar mic</span>
        </button>` : ''}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;padding:0 14px;background:#0f172a;flex-shrink:0;height:42px;box-sizing:border-box">
      <span style="font-size:11px;color:#64748b">${isManual?'Manual':'Auto'}</span>
      <div style="flex:1"></div>
      <label onclick="TUNER.toggleMic()" style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">
        <span style="font-size:14px">🎤</span>
        <div class="mic-toggle-track" style="position:relative;width:34px;height:18px;background:${TUNER.micOn?'#3b82f6':'#334155'};border-radius:9px;transition:background 0.2s;flex-shrink:0">
          <div class="mic-toggle-thumb" style="position:absolute;top:2px;left:${TUNER.micOn?'16px':'2px'};width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s"></div>
        </div>
        <span class="mic-toggle-lbl" style="font-size:11px;color:${TUNER.micOn?'#93c5fd':'#64748b'}">Mic</span>
      </label>
    </div>
    <div id="tuner-kb-wrap" style="display:${isManual?'block':'none'};background:#0f172a;flex-shrink:0;padding:4px 8px 8px;box-sizing:border-box">
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:5px">
        <button class="icon-btn" onclick="TUNER.shiftOct(-1)" style="padding:2px 14px;font-size:14px">◀</button>
        <span id="tuner-oct-lbl2" style="font-size:12px;color:#cbd5e1;min-width:44px;text-align:center">Oct ${TUNER.tunerOct}</span>
        <button class="icon-btn" onclick="TUNER.shiftOct(+1)" style="padding:2px 14px;font-size:14px">▶</button>
        <span style="width:16px"></span>
        <button class="icon-btn" onclick="TUNER.shiftSemitone(-1)" style="padding:2px 10px;font-size:14px;color:#93c5fd">−</button>
        <span style="font-size:10px;color:#64748b;white-space:nowrap">Semi</span>
        <button class="icon-btn" onclick="TUNER.shiftSemitone(+1)" style="padding:2px 10px;font-size:14px;color:#93c5fd">+</button>
      </div>
      <div id="tuner-mini-kb" style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px"></div>
    </div>`;
  document.body.appendChild(sc);

  // Swipe horizontal en el afinador → cicla modo de visualización
  const VIZ_MODES = ['waterfall', 'waveform', 'needle'];
  let _tsx = 0, _tsy = 0;
  sc.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _tsx = e.touches[0].clientX; _tsy = e.touches[0].clientY;
  }, { passive: true });
  sc.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _tsx;
    const dy = e.changedTouches[0].clientY - _tsy;
    if (Math.abs(dx) < window.innerWidth * 0.6 || Math.abs(dx) < Math.abs(dy) * 4) return;
    const cur = VIZ_MODES.indexOf(TUNER.vizMode);
    const next = dx < 0
      ? VIZ_MODES[(cur + 1) % VIZ_MODES.length]
      : VIZ_MODES[(cur + VIZ_MODES.length - 1) % VIZ_MODES.length];
    TUNER.setVizMode(next);
    // Actualizar el select del menú si está visible
    const sel = document.querySelector('#tuner-menu select');
    if (sel) sel.value = next;
  }, { passive: true });

  if (isManual) TUNER.renderMiniKb();
  requestAnimationFrame(() => {
    const cv = document.getElementById('strobe-canvas');
    cv.width = cv.clientWidth || window.innerWidth;
    cv.height = cv.clientHeight || 300;
    cv.getContext('2d').fillStyle = '#000';
    cv.getContext('2d').fillRect(0, 0, cv.width, cv.height);
    if (!TUNER.rafId) { TUNER.lastTs = performance.now(); TUNER.loop(TUNER.lastTs); }
  });
}

// ══════════════════════════════════════════════
// MEDIDOR DE TEMPERAMENTO
// ══════════════════════════════════════════════
// MEDIDOR DE TEMPERAMENTO
// ══════════════════════════════════════════════
const NOTES_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const DT = {
  notes: new Array(12).fill(null),  // cents vs ET, null = sin medir
  mode: 'auto',          // 'auto' | 'manual'
  _targetNi: -1,         // nota objetivo en modo manual
  micOn: false, micStream: null, analyser: null,
  rafId: null, lastAnalysis: 0,
  _stableNi: -1, _stableCount: 0, _stableCents: 0, _stableFreq: 0, _buf: null,
  _captureA: false,      // auto mode: capturando La para calibrar pitchA
  _suggSources: null,    // Set de fuentes activas para sugerencias (null = todas)
  _statusLock: 0,        // timestamp hasta el que no sobreescribir el status
  STABLE_FRAMES: 18,     // ~1.8 s a ≈100 ms/análisis

  getOffsets()    { return this.notes.map(v => v === null ? 0 : v); },
  measuredCount() { return this.notes.filter(v => v !== null).length; },

  setMode(m) {
    this.mode = m;
    this._captureA = false;
    this._targetNi = -1; this._stableNi = -1; this._stableCount = 0;
    document.querySelectorAll('.dt-mode-btn').forEach(b =>
      b.classList.toggle('sel', b.dataset.m === m));
    this._renderKeyboard();
    this._updatePitchRow();
    this._updateStatus(m === 'manual' ? 'Pulsa una tecla para seleccionar nota' : '—');
  },

  // ── pitchA: cambiar referencia y recalcular todos los offsets medidos ──
  setPitchA(newVal) {
    const newP = Math.round(parseFloat(newVal) * 100) / 100;
    if (isNaN(newP) || newP < 390 || newP > 470) return;
    const shift = 1200 * Math.log2(pitchA / newP);
    for (let ni = 0; ni < 12; ni++) {
      if (this.notes[ni] !== null) this.notes[ni] = Math.round((this.notes[ni] + shift) * 10) / 10;
    }
    setPitchAGlobal(newP);   // actualiza pitchA global + todos los inputs
    this._renderKeyboard();
    this._updatePitchRow();
  },

  // Normalizar: tomar la frecuencia real de A medida como nueva referencia → A queda a 0
  normalize() {
    if (this.notes[9] === null) return;
    const aFreq = pitchA * Math.pow(2, this.notes[9] / 1200);
    this.setPitchA(aFreq);
    this.notes[9] = 0;  // forzar 0 exacto (evitar residuo por redondeo)
    this._renderKeyboard();
    this._updatePitchRow();
    this._updateStatus(`✓ Normalizado — La: ${pitchA} Hz`);
  },

  async startCaptureA() {
    this._captureA = true;
    this._stableNi = -1; this._stableCount = 0;
    this._updatePitchRow();
    this._updateStatus('Toca La en tu instrumento…');
    if (!this.micOn) await this.startMic();
  },
  stopCaptureA() {
    this._captureA = false;
    this._stableNi = -1; this._stableCount = 0;
    this._updatePitchRow();
    this._updateStatus('—');
  },

  _updatePitchRow() {
    const el = document.getElementById('dt-pitch-row');
    if (!el) return;
    const canNorm = this.notes[9] !== null && this.notes[9] !== 0;
    const captureBtn = this.mode === 'auto'
      ? (this._captureA
          ? `<button class="icon-btn" onclick="DT.stopCaptureA()" style="font-size:10px;color:#f87171;border-color:#b91c1c;margin-left:4px">✕ Cancelar</button>`
          : `<button class="icon-btn" onclick="DT.startCaptureA()" style="font-size:10px;margin-left:4px">🎤 Tomar La</button>`)
      : '';
    el.innerHTML =
      `<span style="font-size:11px;color:var(--muted)">La ref:</span>
       <input id="dt-pitch-input" type="number" value="${pitchA}" step="0.01" min="390" max="470"
         style="width:64px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;text-align:center;outline:none"
         onchange="DT.setPitchA(this.value)" onkeydown="if(event.key==='Enter')DT.setPitchA(this.value)">
       <span style="font-size:11px;color:var(--muted)">Hz</span>`
      + captureBtn
      + (canNorm ? `<button class="icon-btn" onclick="DT.normalize()" style="font-size:10px;margin-left:4px;color:#fcd34d;border-color:#b45309">Normalizar A→0</button>` : '');
  },

  // ── Mic ──────────────────────────────────────
  async toggleMic() { this.micOn ? this.stopMic() : await this.startMic(); },
  async startMic() {
    try {
      getCtx(); // Crear/reanudar AudioContext durante el gesto de usuario (antes del await)
      const stream = await navigator.mediaDevices.getUserMedia(
        { audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
      this.micStream = stream;
      const ctx = getCtx();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0;
      ctx.createMediaStreamSource(stream).connect(this.analyser);
      this.micOn = true;
      requestWakeLock();
      document.querySelectorAll('.dt-mic-track').forEach(e => e.style.background='#3b82f6');
      document.querySelectorAll('.dt-mic-thumb').forEach(e => e.style.left='16px');
      if (!this.rafId) this._scheduleLoop();
    } catch(e) { alert('Sin acceso al micrófono:\n' + e.message); }
  },
  stopMic() {
    if (this.micStream) { this.micStream.getTracks().forEach(t => t.stop()); this.micStream = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch(_){} this.analyser = null; }
    this.micOn = false;
    if (!TUNER?.micOn) releaseWakeLock();
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    document.querySelectorAll('.dt-mic-track').forEach(e => e.style.background='#334155');
    document.querySelectorAll('.dt-mic-thumb').forEach(e => e.style.left='2px');
    this._captureA = false;
    this._stableNi = -1; this._stableCount = 0;
    this._renderKeyboard(); this._updateStatus('—');
  },

  // ── Loop de detección ────────────────────────
  _scheduleLoop() {
    this.rafId = requestAnimationFrame(ts => {
      if (!document.getElementById('dt-kb-wrap')) { this.stopMic(); return; }
      this._scheduleLoop();
      if (ts - this.lastAnalysis < 90) return;
      this.lastAnalysis = ts;
      this._analyze();
    });
  },
  _analyze() {
    if (!this.analyser) return;
    const bufLen = this.analyser.fftSize;
    if (!this._buf || this._buf.length !== bufLen) {
      this._buf = new Float32Array(bufLen);
      this._freqBuf = new Float32Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getFloatTimeDomainData(this._buf);
    this.analyser.getFloatFrequencyData(this._freqBuf);
    // RMS para indicador de nivel
    let rmsSum = 0;
    for (let i = 0; i < Math.min(1024, bufLen); i++) rmsSum += this._buf[i] * this._buf[i];
    const rms = Math.sqrt(rmsSum / Math.min(1024, bufLen));
    const res = detectPitch(this._buf, this.analyser.context.sampleRate);
    if (!res || res.clarity < 0.15) {
      if (this._stableNi !== -1) { this._stableNi = -1; this._stableCount = 0; this._renderKeyboard(); }
      // En manual sin nota seleccionada: mostrar instrucción, no "escuchando"
      if (this.mode === 'manual' && this._targetNi < 0) {
        this._updateStatus('Pulsa una tecla para seleccionar nota');
        return;
      }
      const lvl = Math.min(100, Math.round(rms * 1000));
      this._updateStatus(lvl > 1 ? `🎤 ${lvl}% — escuchando…` : (this._captureA ? 'Toca La en tu instrumento…' : '—'));
      return;
    }
    // Refinar frecuencia con interpolación parabólica sobre FFT nativa
    res.freq = _refineFFT(res.freq, this._freqBuf, this.analyser.context.sampleRate);
    const { freq } = res;
    const { ni } = _appFindNote(freq);

    // ── captureA mode: tomar cualquier pitch estable como nueva referencia La ──
    if (this._captureA) {
      // Estabilidad sobre frecuencia directa
      if (this._stableNi === 0 && this._stableFreq > 0) {
        const ratio = freq / this._stableFreq;
        if (ratio < 0.95 || ratio > 1.05) {
          this._stableCount = 1; this._stableFreq = freq;
        } else {
          this._stableCount++;
          this._stableFreq = this._stableFreq * 0.8 + freq * 0.2;
        }
      } else {
        this._stableNi = 0; this._stableCount = 1; this._stableFreq = freq;
      }
      const prog = Math.min(1, this._stableCount / this.STABLE_FRAMES);
      this._updateStatus(`🎤 ${this._stableFreq.toFixed(2)} Hz`, prog);
      if (this._stableCount >= this.STABLE_FRAMES) {
        // Normalizar a la octava de A4 (390–470 Hz)
        let aFreq = this._stableFreq;
        while (aFreq < 390) aFreq *= 2;
        while (aFreq > 470) aFreq /= 2;
        const oldPitchA = pitchA;
        this.setPitchA(aFreq);
        if (this.notes[9] !== null) this.notes[9] = 0;
        this._captureA = false;
        this._stableNi = -1; this._stableCount = 0;
        this._updateStatus(`✓ La: ${oldPitchA.toFixed(2)} → ${pitchA.toFixed(2)} Hz`);
        this._statusLock = Date.now() + 3000;
        this._updatePitchRow();
        this._renderKeyboard();
      }
      return;
    }

    // ── Medición ──
    // En manual: solo medir si hay nota seleccionada
    if (this.mode === 'manual' && this._targetNi < 0) {
      this._updateStatus('Pulsa una tecla para seleccionar nota');
      return;
    }
    const measureNi = (this.mode === 'manual') ? this._targetNi : ni;

    // Calcular offset en cents vs ET puro de la nota objetivo
    const { oct } = _appFindNote(freq);
    const etFreq = pitchA * Math.pow(2, (ET_FROM_A[measureNi] + (oct - 4) * 1200) / 1200);
    const cents  = 1200 * Math.log2(freq / etFreq);

    if (measureNi === this._stableNi) {
      // Resetear si el pitch saltó más de 80¢ (nota inestable / cambio de nota)
      if (Math.abs(cents - this._stableCents) > 80) {
        this._stableNi = measureNi; this._stableCount = 1; this._stableCents = cents; this._stableFreq = freq;
      } else {
        this._stableCount++;
        this._stableCents = this._stableCents * 0.75 + cents * 0.25;
        this._stableFreq  = this._stableFreq  * 0.75 + freq  * 0.25;
      }
    } else {
      this._stableNi = measureNi; this._stableCount = 1; this._stableCents = cents; this._stableFreq = freq;
    }
    const prog = Math.min(1, this._stableCount / this.STABLE_FRAMES);
    const sign  = this._stableCents >= 0 ? '+' : '';
    this._updateStatus(`${NOTES_NAMES[measureNi]}  ${sign}${this._stableCents.toFixed(1)}¢`, prog);
    this._renderKeyboard();

    if (this._stableCount >= this.STABLE_FRAMES) {
      this.notes[measureNi] = Math.round(this._stableCents * 10) / 10;
      this._stableNi = -1; this._stableCount = 0;
      if (this.mode === 'manual') this._targetNi = -1;
      const cnt = document.getElementById('dt-count');
      if (cnt) cnt.textContent = this.measuredCount() + '/12';
      const sp = document.getElementById('dt-save-row');
      if (sp) sp.style.display = this.measuredCount() > 0 ? 'flex' : 'none';
      // Manual: al medir A, fijar pitchA a la frecuencia real detectada (offset queda en 0)
      if (measureNi === 9 && this.mode === 'manual') {
        let aFreq = this._stableFreq;
        while (aFreq < 390) aFreq *= 2;
        while (aFreq > 470) aFreq /= 2;
        const oldPitchA = pitchA;
        this.setPitchA(aFreq);
        this.notes[9] = 0;
        this._updateStatus(`✓ La: ${oldPitchA.toFixed(2)} → ${pitchA.toFixed(2)} Hz`);
        this._statusLock = Date.now() + 3000;  // bloquear loop 3s DESPUÉS de mostrar
      }
      this._renderKeyboard();
      this._updatePitchRow();
      this._renderSuggestions();
    }
  },

  _updateStatus(txt, prog) {
    if (this._statusLock && Date.now() < this._statusLock && prog === undefined) return;
    const el = document.getElementById('dt-status');
    if (el) el.textContent = txt;
    const bar = document.getElementById('dt-bar-fill');
    if (bar) bar.style.width = ((prog ?? 0) * 100) + '%';
  },

  // ── Teclado de piano (1 octava) ──────────────
  tapKey(ni) {
    if (this.mode === 'manual') {
      // Si ya medida: borrar; si no: apuntar
      if (this.notes[ni] !== null) {
        this.notes[ni] = null;
        this._renderKeyboard();
        const cnt = document.getElementById('dt-count');
        if (cnt) cnt.textContent = this.measuredCount() + '/12';
        const sp = document.getElementById('dt-save-row');
        if (sp) sp.style.display = this.measuredCount() > 0 ? 'flex' : 'none';
        this._clearExport();
        this._renderSuggestions();
      } else {
        this._targetNi = (this._targetNi === ni ? -1 : ni);
        this._stableNi = -1; this._stableCount = 0;
        this._renderKeyboard();
        this._updateStatus(this._targetNi < 0 ? 'Pulsa una tecla para seleccionar nota'
          : `Toca ${NOTES_NAMES[ni]} en tu instrumento`);
      }
    } else {
      // Auto: borrar si medida
      if (this.notes[ni] !== null) {
        this.notes[ni] = null;
        this._renderKeyboard();
        const cnt = document.getElementById('dt-count');
        if (cnt) cnt.textContent = this.measuredCount() + '/12';
        const sp = document.getElementById('dt-save-row');
        if (sp) sp.style.display = this.measuredCount() > 0 ? 'flex' : 'none';
        this._clearExport();
        this._renderSuggestions();
      }
    }
  },

  _renderKeyboard() {
    const wrap = document.getElementById('dt-kb-wrap');
    if (!wrap) return;
    const mob   = isMobile();
    const landscape = mob && window.innerWidth > window.innerHeight;
    // En horizontal: limitar altura del teclado a ~40% del alto disponible
    const maxKbH = landscape ? Math.round(window.innerHeight * 0.38) : (mob ? 170 : 210);
    // availW: en horizontal el teclado no puede ser más ancho de lo que permite maxKbH
    const maxWfromH = Math.round(maxKbH / 3.4) * 7;
    const availW = mob
      ? Math.min(window.innerWidth - 20, maxWfromH)
      : Math.min(500, (wrap.clientWidth || 500) - 8);
    const W  = Math.floor(availW / 7);      // 7 teclas blancas
    const H  = Math.min(maxKbH, Math.round(W * 3.4));
    const BW = Math.round(W * 0.6);
    const BH = Math.round(H * 0.62);
    const WN = [0,2,4,5,7,9,11];
    const BK = [{ni:1,cx:1},{ni:3,cx:2},{ni:6,cx:4},{ni:8,cx:5},{ni:10,cx:6}];

    const keyHtml = (ni, x, w, h, isBlack) => {
      const measured   = this.notes[ni] !== null;
      const detecting  = this._stableNi === ni;
      const isTarget   = this.mode === 'manual' && this._targetNi === ni;
      const prog       = detecting ? Math.min(1, this._stableCount / this.STABLE_FRAMES)
                       : (measured ? 1 : 0);
      const val        = measured ? this.notes[ni] : (detecting ? this._stableCents : null);
      const valStr     = val !== null ? (val >= 0 ? '+' : '') + val.toFixed(1) + '¢' : '';

      const fillColor  = measured ? 'rgba(74,222,128,0.45)' : 'rgba(96,165,250,0.40)';
      let bg, border, labelColor, valColor;
      if (isBlack) {
        bg = measured ? '#0f3320' : isTarget ? '#0c2a50' : 'linear-gradient(180deg,#333 0%,#111 70%)';
        border = measured ? '#4ade80' : isTarget ? '#60a5fa' : '#000';
        labelColor = measured ? '#4ade80' : isTarget ? '#93c5fd' : '#ccc';
        valColor   = measured ? '#4ade80' : detecting ? '#93c5fd' : 'transparent';
      } else {
        bg = measured ? 'linear-gradient(175deg,#d4f7d4 0%,#a6e8a6 100%)'
           : isTarget  ? 'linear-gradient(175deg,#dbeafe 0%,#93c5fd 100%)'
           : 'linear-gradient(175deg,#fdfaf4 0%,#ece7db 90%)';
        border = measured ? '#4ade80' : isTarget ? '#3b82f6' : '#999';
        labelColor = measured ? '#166534' : isTarget ? '#1e40af' : '#555';
        valColor   = measured ? '#166534' : detecting ? 'var(--accent)' : 'transparent';
      }

      const fs  = isBlack ? '8px' : '10px';
      const fvs = isBlack ? '8px' : '9px';
      const z   = isBlack ? 1 : 0;
      const br  = isBlack ? 4 : 6;
      const shadow = isBlack ? '0 5px 8px rgba(0,0,0,.65)' : '0 4px 6px rgba(0,0,0,.25)';
      const borderTop = isBlack ? 'none' : '2px solid #bbb';

      return `<div data-ni="${ni}" onclick="DT.tapKey(${ni})"
        style="position:absolute;left:${x}px;width:${w}px;height:${h}px;z-index:${z};
               background:${bg};border:1.5px solid ${border};border-top:${borderTop};
               border-radius:0 0 ${br}px ${br}px;cursor:pointer;-webkit-tap-highlight-color:transparent;
               display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
               padding-bottom:5px;overflow:hidden;box-shadow:${shadow};transition:border-color 0.15s,background 0.15s;">
        <div style="position:absolute;bottom:0;left:0;right:0;height:${prog*100}%;background:${fillColor};transition:height 0.12s;pointer-events:none;border-radius:0 0 ${br}px ${br}px"></div>
        <span style="font-size:${fs};font-weight:700;color:${labelColor};z-index:1;pointer-events:none;line-height:1.2">${NOTES_NAMES[ni]}</span>
        <span style="font-size:${fvs};color:${valColor};z-index:1;pointer-events:none;line-height:1.1">${valStr || ' '}</span>
      </div>`;
    };

    let html = `<div style="position:relative;height:${H}px;width:${W*7}px;user-select:none;touch-action:manipulation">`;
    WN.forEach((ni, wi) => { html += keyHtml(ni, wi*W, W-1, H, false); });
    BK.forEach(({ni,cx}) => { html += keyHtml(ni, cx*W-BW/2, BW, BH, true); });
    html += '</div>';
    wrap.innerHTML = html;
  },

  reset() {
    this.notes = new Array(12).fill(null);
    this._captureA = false;
    this._targetNi = -1; this._stableNi = -1; this._stableCount = 0;
    this._renderKeyboard(); this._updatePitchRow(); this._updateStatus('—');
    this._clearExport();
    const ni = document.getElementById('dt-name-input'); if (ni) ni.value = '';
    const cnt = document.getElementById('dt-count'); if (cnt) cnt.textContent = '0/12';
    const sp = document.getElementById('dt-save-row'); if (sp) sp.style.display = 'none';
  },
  save() {
    const nameEl = document.getElementById('dt-name-input');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    if (this.measuredCount() === 0) return;
    // Normalizar: A = 0 cents (restar el valor de La a todos)
    const raw = this.getOffsets();
    const aOffset = raw[9] || 0;
    const offsets = raw.map(v => Math.round((v - aOffset) * 10) / 10);
    addUserTemp(name, offsets, '');
    const t = all.find(x => x.name === name && x.source === 'Usuario');
    if (t) { selected[0] = t; lastSelected = t; renderBadges(); }
    this._showExport(name, offsets);
  },
  _showExport(name, offsets) {
    const ep = document.getElementById('dt-export-panel');
    if (!ep) return;
    ep.style.display = 'flex'; ep.dataset.name = name; ep.dataset.offsets = offsets.join(',');
  },
  _clearExport() { const ep = document.getElementById('dt-export-panel'); if (ep) ep.style.display='none'; },
  shareUrl() {
    const ep = document.getElementById('dt-export-panel'); if (!ep) return;
    const t = all.find(x => x.name === ep.dataset.name && x.source === 'Usuario');
    if (t) { showShareDialog(t); return; }
    // fallback
    const offsets = ep.dataset.offsets.split(',').map(Number);
    const url = _tempShareUrl(ep.dataset.name, offsets);
    const text = _tempShareText(ep.dataset.name, offsets);
    if (navigator.share) navigator.share({ title: ep.dataset.name, text: text + '\n\n' + url }).catch(() => this._copyToClipboard(text + '\n\n' + url));
    else this._copyToClipboard(text + '\n\n' + url);
  },
  downloadJson() {
    const ep = document.getElementById('dt-export-panel'); if (!ep) return;
    const blob = new Blob([JSON.stringify({ name:ep.dataset.name, offsets:ep.dataset.offsets.split(',').map(Number), source:'Usuario' }, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = ep.dataset.name.replace(/[^a-z0-9_\-]/gi,'_') + '.json'; a.click(); URL.revokeObjectURL(a.href);
  },
  importJson() {
    const inp = document.createElement('input'); inp.type='file'; inp.accept='.json';
    inp.onchange = async () => {
      try {
        const obj = JSON.parse(await inp.files[0].text());
        if (!obj.name || !Array.isArray(obj.offsets) || obj.offsets.length !== 12) throw new Error('Formato incorrecto');
        addUserTemp(obj.name.trim(), obj.offsets.map(Number)); alert('Importado: ' + obj.name);
      } catch(e) { alert('Error al importar:\n' + e.message); }
    };
    inp.click();
  },
  _copyToClipboard(txt) {
    navigator.clipboard?.writeText(txt).then(() => alert('Enlace copiado al portapapeles'))
      .catch(() => prompt('Copia este enlace:', txt));
  },

  // ── Similitud de temperamentos ────────────────
  // Métrica: RMSE centrada en la media sobre las notas medidas.
  // Centrar elimina el nivel absoluto de afinación; lo que cuenta es el
  // *patrón* de desigualdades — exactamente lo que define un temperamento.
  getSuggestions(n = 8) {
    const measured = this.notes;
    const idxs = measured.map((_,i) => i).filter(i => measured[i] !== null);
    if (idxs.length < 3) return [];
    const mMean = idxs.reduce((s,i) => s + measured[i], 0) / idxs.length;
    const sources = this._suggSources;
    const MAIN_SRCS = ['Scala','GrandOrgue','Asselin','Usuario'];
    const pool = sources === null ? all : all.filter(t => {
      if (sources.has('Favoritos') && favs.has(t.name)) return true;
      if (sources.has(t.source)) return true;
      if (sources.has('Otros') && !MAIN_SRCS.includes(t.source)) return true;
      return false;
    });
    return pool
      .map(t => {
        const rMean = idxs.reduce((s,i) => s + t.offsets[i], 0) / idxs.length;
        const rms = Math.sqrt(
          idxs.reduce((s,i) => s + (measured[i] - mMean - (t.offsets[i] - rMean)) ** 2, 0) / idxs.length
        );
        return { t, dist: Math.round(rms * 10) / 10 };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, n);
  },

  _allSources() {
    const MAIN_SRCS = ['Scala','GrandOrgue','Asselin','Usuario'];
    const raw = [...new Set(all.map(t => t.source))];
    const srcs = MAIN_SRCS.filter(s => raw.includes(s));
    if (raw.some(s => !MAIN_SRCS.includes(s))) srcs.push('Otros');
    if (favs.size > 0) srcs.unshift('Favoritos');
    return srcs;
  },
  toggleSuggSource(src) {
    if (this._suggSources === null) {
      // pasar de "todas" a "todas excepto src"
      const all_srcs = new Set(this._allSources());
      all_srcs.delete(src);
      this._suggSources = all_srcs;
    } else {
      if (this._suggSources.has(src)) this._suggSources.delete(src);
      else this._suggSources.add(src);
      // si están todas activas, volver a null
      const total = this._allSources();
      if (total.every(s => this._suggSources.has(s))) this._suggSources = null;
    }
    savePrefs({ dtSuggSources: this._suggSources ? [...this._suggSources] : null });
    this._renderSuggestions();
  },

  _renderSuggestions() {
    const el = document.getElementById('dt-suggestions');
    if (!el) return;
    const n = this.measuredCount();

    // ── Chips de filtro de fuentes ──
    const allSrcs = this._allSources();
    const chips = allSrcs.map(src => {
      const active = this._suggSources === null || this._suggSources.has(src);
      const isFav = src === 'Favoritos';
      const col = active ? (isFav ? '#fbbf24' : '#60a5fa') : '#374151';
      const bg  = active ? (isFav ? 'rgba(251,191,36,0.15)' : 'rgba(96,165,250,0.15)') : 'transparent';
      return `<button onclick="DT.toggleSuggSource('${src}')"
        style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid ${col};background:${bg};color:${col};cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent">
        ${isFav ? '★ ' : ''}${src}
      </button>`;
    }).join('');
    const filterRow = `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">${chips}</div>`;

    if (n < 3) {
      el.innerHTML = filterRow + `<div style="font-size:11px;color:#4b5563;text-align:center;padding:10px 0">
        Mide al menos 3 notas para ver sugerencias (${n}/3)
      </div>`;
      return;
    }
    const sugs = this.getSuggestions(8);
    const maxDist = Math.max(...sugs.map(s => s.dist), 1);
    const hdr = `<div style="font-size:10px;color:#6b7280;margin-bottom:8px;font-weight:600;letter-spacing:.6px;display:flex;justify-content:space-between">
      <span>TEMPERAMENTOS MÁS CERCANOS</span>
      <span style="font-weight:400">${n} nota${n>1?'s':''} medida${n>1?'s':''}</span>
    </div>`;
    const rows = sugs.map(({t, dist}) => {
      const tidx = all.indexOf(t);
      const isSel = selected.some(s => s && s.name === t.name);
      const barW  = Math.max(3, Math.round((1 - dist / (maxDist * 1.15)) * 100));
      const col   = dist < 2 ? '#4ade80' : dist < 5 ? '#60a5fa' : dist < 10 ? '#f59e0b' : '#6b7280';
      return `<div onclick="DT.selectSuggested(${tidx})"
        style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;
               border:1px solid ${isSel?'#3b82f6':'transparent'};
               background:${isSel?'rgba(59,130,246,0.1)':'rgba(255,255,255,0.02)'};
               margin-bottom:4px;-webkit-tap-highlight-color:transparent">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.name}</div>
          <div style="height:3px;background:#1e293b;border-radius:2px;margin-top:4px;overflow:hidden">
            <div style="width:${barW}%;height:100%;background:${col};border-radius:2px;transition:width 0.3s"></div>
          </div>
        </div>
        <div style="font-size:11px;color:${col};flex-shrink:0;min-width:38px;text-align:right;font-variant-numeric:tabular-nums">~${dist.toFixed(1)}¢</div>
        <div style="font-size:9px;color:#4b5563;flex-shrink:0;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.source}</div>
      </div>`;
    }).join('');
    el.innerHTML = filterRow + hdr + (sugs.length ? rows : '<div style="font-size:11px;color:#4b5563;text-align:center;padding:8px 0">Sin resultados con los filtros activos</div>');
  },

  selectSuggested(idx) {
    const t = all[idx];
    if (!t) return;
    const ei = selected.findIndex(s => s && s.name === t.name);
    if (ei >= 0) {
      selected[ei] = null;  // deseleccionar si ya estaba
    } else {
      // añadir al primer hueco libre (sin tocar selected[0] si hay mediciones guardadas)
      const free = selected.findIndex(s => !s);
      if (free >= 0) selected[free] = t;
      else selected = [t, null, null];
      lastSelected = t;
      savePrefs({ selectedName: t.name });
    }
    renderBadges(); refreshList();
    this._renderSuggestions();  // actualizar resaltado sin re-renderizar el medidor
  }
};

function viewMedidor() {
  document.getElementById('content').innerHTML = `
    <div class="panel" style="width:100%;max-width:560px">

      <!-- Controles superiores -->
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <label onclick="DT.toggleMic()" style="display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none">
          <span style="font-size:15px">🎤</span>
          <div class="dt-mic-track" style="position:relative;width:34px;height:18px;background:${DT.micOn?'#3b82f6':'#334155'};border-radius:9px;flex-shrink:0">
            <div class="dt-mic-thumb" style="position:absolute;top:2px;left:${DT.micOn?'16px':'2px'};width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s"></div>
          </div>
        </label>
        <button class="dt-mode-btn icon-btn${DT.mode==='auto'?' sel':''}" data-m="auto"  onclick="DT.setMode('auto')">Auto</button>
        <button class="dt-mode-btn icon-btn${DT.mode==='manual'?' sel':''}" data-m="manual" onclick="DT.setMode('manual')">Manual</button>
        <span style="flex:1"></span>
        <span id="dt-count" style="font-size:11px;color:var(--muted)">${DT.measuredCount()}/12</span>
        <button class="icon-btn" onclick="DT.importJson()" style="font-size:11px">⬆</button>
        <button class="icon-btn" onclick="DT.reset()">↺ Reiniciar</button>
      </div>

      <!-- Fila pitchA + normalizar -->
      <div id="dt-pitch-row" style="display:flex;align-items:center;gap:6px;background:#0f172a;border-radius:6px;padding:7px 10px;margin-bottom:12px;min-height:34px"></div>

      <!-- Teclado de piano -->
      <div id="dt-kb-wrap" style="overflow-x:auto;padding-bottom:6px;margin-bottom:10px;-webkit-overflow-scrolling:touch"></div>

      <!-- Barra de estabilidad + estado -->
      <div style="background:#0f172a;border-radius:4px;height:5px;overflow:hidden;margin-bottom:5px">
        <div id="dt-bar-fill" style="height:100%;width:0%;background:var(--accent);transition:width 0.1s;border-radius:4px"></div>
      </div>
      <div id="dt-status" style="text-align:center;font-size:12px;color:var(--muted);min-height:1.5em;margin-bottom:14px">—</div>

      <!-- Guardar (aparece cuando hay notas) -->
      <div id="dt-save-row" style="display:${DT.measuredCount()>0?'flex':'none'};align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <input id="dt-name-input" type="text" placeholder="Nombre del temperamento…"
          style="flex:1;min-width:140px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:12px;outline:none"
          onkeydown="if(event.key==='Enter')DT.save()">
        <button class="icon-btn" onclick="DT.save()" style="background:#1d4ed8;color:#fff;border-color:#1d4ed8">Guardar</button>
      </div>

      <!-- Exportar (tras guardar) -->
      <div id="dt-export-panel" style="display:none;gap:8px;flex-wrap:wrap">
        <button class="icon-btn" onclick="DT.shareUrl()">📤 Compartir enlace</button>
        <button class="icon-btn" onclick="DT.downloadJson()">⬇ Descargar .json</button>
      </div>

      <!-- Sugerencias de temperamentos cercanos -->
      <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <div id="dt-suggestions"></div>
      </div>

    </div>`;

  DT._updatePitchRow();
  DT._renderKeyboard();
  DT._renderSuggestions();
  if (DT.micOn && !DT.rafId) DT._scheduleLoop();
  // Auto-arrancar mic si el usuario ya lo autorizó antes, o si nunca lo ha activado (primera vez)
  if (!DT.micOn) {
    const _micPref = localStorage.getItem('micAutoStart');
    if (_micPref === null || _micPref === '1') DT.startMic();
  }
}

function viewTuner() {
  document.getElementById('content').innerHTML = '';
  buildTunerScreen();
  // Auto-arrancar mic si el usuario ya lo autorizó antes, o si nunca lo ha activado (primera vez)
  const _micPref = localStorage.getItem('micAutoStart');
  if (_micPref === null || _micPref === '1') {
    TUNER.startMic();
  }
}

// ══════════════════════════════════════════════
// RESIZE
// ══════════════════════════════════════════════
let lastMobile = isMobile();
let _kbResizeTimer = null;
function _onResize() {
  WS.onResize();
  const m = isMobile();
  if (m !== lastMobile) { lastMobile = m; renderContent(); return; }
  // Misma clase de dispositivo (e.g. rotación en móvil): re-renderizar teclados visibles
  clearTimeout(_kbResizeTimer);
  _kbResizeTimer = setTimeout(() => {
    if (activeTab === 'keyboard') KB.render();
    if (document.getElementById('tuner-mini-kb')) TUNER.renderMiniKb();
    if (document.getElementById('dt-kb-wrap')) DT._renderKeyboard();
  }, 120);
}
window.addEventListener('resize', _onResize);
// orientationchange llega antes que resize en algunos navegadores móviles
screen.orientation?.addEventListener('change', _onResize);

// ══════════════════════════════════════════════
// WIRE-UP DE HANDLERS (reemplaza inline onclick/onchange del HTML estático)
// ══════════════════════════════════════════════
document.getElementById('overlay').addEventListener('click', closeSidebar);
document.getElementById('overlay').addEventListener('touchend', closeSidebar, { passive: true });
document.getElementById('fav-btn').addEventListener('click', toggleFavFilter);
document.getElementById('sidebar-about-btn').addEventListener('click', showAbout);
document.getElementById('hamburger').addEventListener('click', openSidebar);
document.getElementById('content-fullscreen-close').addEventListener('click', toggleContentFullscreen);
document.getElementById('kb-fs-close').addEventListener('click', toggleKbFullscreen);
document.getElementById('desk-fullscreen-btn').addEventListener('click', toggleContentFullscreen);
// ── FAB drag-to-move ─────────────────────────────────────────────────────────
(function() {
  const fab = document.getElementById('tuner-fab');
  const menu = document.getElementById('tools-fab-menu');
  const STORE_KEY = 'fabPos';

  // Restaurar posición guardada
  function applyPos(pos) {
    fab.style.left   = pos.x + 'px';
    fab.style.top    = pos.y + 'px';
    fab.style.right  = 'auto';
    fab.style.bottom = 'auto';
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved) applyPos(saved);
  } catch(e) {}

  let dragStartX, dragStartY, fabStartX, fabStartY, dragged = false, isDown = false;

  fab.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    dragged = false;
    isDown = true;
    const r = fab.getBoundingClientRect();
    // Fijar left/top antes del drag para evitar salto al cambiar de right/bottom
    fab.style.left   = r.left + 'px';
    fab.style.top    = r.top  + 'px';
    fab.style.right  = 'auto';
    fab.style.bottom = 'auto';
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    fabStartX  = r.left;
    fabStartY  = r.top;
    fab.setPointerCapture(e.pointerId);
    fab.classList.add('fab-dragging');
    menu.style.display = 'none';
  });

  fab.addEventListener('pointermove', e => {
    if (!isDown) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragged && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragged = true;
    const newX = Math.max(0, Math.min(window.innerWidth  - fab.offsetWidth,  fabStartX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - fab.offsetHeight, fabStartY + dy));
    fab.style.left   = newX + 'px';
    fab.style.top    = newY + 'px';
    fab.style.right  = 'auto';
    fab.style.bottom = 'auto';
  });

  fab.addEventListener('pointerup', e => {
    isDown = false;
    fab.classList.remove('fab-dragging');
    fab.releasePointerCapture(e.pointerId);
    if (dragged) {
      // Guardar posición
      localStorage.setItem(STORE_KEY, JSON.stringify({ x: fab.offsetLeft, y: fab.offsetTop }));
      return; // no abrir menú si fue drag
    }
    // Click: abrir/cerrar menú
    e.stopPropagation();
    const r = fab.getBoundingClientRect();
    // Posicionar menú encima o debajo según espacio
    if (r.top > window.innerHeight / 2) {
      menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      menu.style.top    = 'auto';
    } else {
      menu.style.top    = (r.bottom + 8) + 'px';
      menu.style.bottom = 'auto';
    }
    menu.style.left  = r.left + 'px';
    menu.style.right = 'auto';
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    if (menu.style.display === 'block') {
      setTimeout(() => {
        document.addEventListener('click', function h() {
          menu.style.display = 'none';
          document.removeEventListener('click', h);
        });
      }, 0);
    }
  });

  fab.addEventListener('pointercancel', () => {
    isDown = false;
    fab.classList.remove('fab-dragging');
    dragged = false;
  });
})();

function openTuner() {
  document.getElementById('tools-fab-menu').style.display = 'none';
  viewTuner();
}
function openMedidor() {
  document.getElementById('tools-fab-menu').style.display = 'none';
  // Crear overlay a pantalla completa igual que el tuner
  document.getElementById('medidor-screen')?.remove();
  const sc = document.createElement('div');
  sc.id = 'medidor-screen';
  if (!isMobile()) {
    sc.style.left  = '280px';
    sc.style.width = 'calc(100% - 280px)';
  }
  // Barra superior con botón ‹ de cierre
  sc.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:0 10px;background:#0f172a;border-bottom:1px solid #1e293b;flex-shrink:0;height:46px;box-sizing:border-box">
      <button onclick="exitMedidor()" style="background:none;border:none;color:#93c5fd;font-size:24px;cursor:pointer;line-height:1;padding:0 4px">‹</button>
      <span style="font-size:14px;color:#94a3b8;font-weight:600">Medidor de afinación</span>
    </div>
    <div id="medidor-body" style="flex:1;overflow-y:auto;padding:16px;box-sizing:border-box"></div>`;
  document.body.appendChild(sc);

  // Volcar el contenido del medidor en el body del overlay
  const bodyEl = sc.querySelector('#medidor-body');
  bodyEl.innerHTML = `
    <div style="width:100%;max-width:560px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <label onclick="DT.toggleMic()" style="display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none">
          <span style="font-size:15px">🎤</span>
          <div class="dt-mic-track" style="position:relative;width:34px;height:18px;background:${DT.micOn?'#3b82f6':'#334155'};border-radius:9px;flex-shrink:0">
            <div class="dt-mic-thumb" style="position:absolute;top:2px;left:${DT.micOn?'16px':'2px'};width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s"></div>
          </div>
        </label>
        <button class="dt-mode-btn icon-btn${DT.mode==='auto'?' sel':''}" data-m="auto"  onclick="DT.setMode('auto')">Auto</button>
        <button class="dt-mode-btn icon-btn${DT.mode==='manual'?' sel':''}" data-m="manual" onclick="DT.setMode('manual')">Manual</button>
        <span style="flex:1"></span>
        <span id="dt-count" style="font-size:11px;color:var(--muted)">${DT.measuredCount()}/12</span>
        <button class="icon-btn" onclick="DT.importJson()" style="font-size:11px">⬆</button>
        <button class="icon-btn" onclick="DT.reset()">↺ Reiniciar</button>
      </div>
      <div id="dt-pitch-row" style="display:flex;align-items:center;gap:6px;background:#0f172a;border-radius:6px;padding:7px 10px;margin-bottom:12px;min-height:34px"></div>
      <div id="dt-kb-wrap" style="overflow-x:auto;padding-bottom:6px;margin-bottom:10px;-webkit-overflow-scrolling:touch"></div>
      <div style="background:#0f172a;border-radius:4px;height:5px;overflow:hidden;margin-bottom:5px">
        <div id="dt-bar-fill" style="height:100%;width:0%;background:var(--accent);transition:width 0.1s;border-radius:4px"></div>
      </div>
      <div id="dt-status" style="text-align:center;font-size:12px;color:var(--muted);min-height:1.5em;margin-bottom:14px">—</div>
      <div id="dt-save-row" style="display:${DT.measuredCount()>0?'flex':'none'};align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <input id="dt-name-input" type="text" placeholder="Nombre del temperamento…"
          style="flex:1;min-width:140px;background:var(--bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;font-size:12px;outline:none"
          onkeydown="if(event.key==='Enter')DT.save()">
        <button class="icon-btn" onclick="DT.save()" style="background:#1d4ed8;color:#fff;border-color:#1d4ed8">Guardar</button>
      </div>
      <div id="dt-export-panel" style="display:none;gap:8px;flex-wrap:wrap">
        <button class="icon-btn" onclick="DT.shareUrl()">📤 Compartir enlace</button>
        <button class="icon-btn" onclick="DT.downloadJson()">⬇ Descargar .json</button>
      </div>
      <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <div id="dt-suggestions"></div>
      </div>
    </div>`;

  DT._updatePitchRow();
  DT._renderKeyboard();
  DT._renderSuggestions();
  if (DT.micOn && !DT.rafId) DT._scheduleLoop();
  if (!DT.micOn) {
    const _micPref = localStorage.getItem('micAutoStart');
    if (_micPref === null || _micPref === '1') DT.startMic();
  }
}

function exitMedidor() {
  DT.stopMic();
  document.getElementById('medidor-screen')?.remove();
}
document.getElementById('oct-down-btn').addEventListener('click', () => octShift(-1));
document.getElementById('oct-up-btn').addEventListener('click', () => octShift(+1));
document.getElementById('chart-play-mode-label').addEventListener('click', toggleChartPlayMode);
document.getElementById('top-toggle').addEventListener('click', () => toggleTopBar());
document.getElementById('about-modal').addEventListener('click', e => { if (e.target === e.currentTarget) hideAbout(); });
document.getElementById('about-close-btn').addEventListener('click', hideAbout);
document.getElementById('share-cancel-btn').addEventListener('click', closeShareDialog);
document.getElementById('share-confirm-btn').addEventListener('click', confirmShare);
document.getElementById('update-apply-btn').addEventListener('click', applyUpdate);
document.getElementById('update-toast-dismiss').addEventListener('click', dismissUpdateToast);
document.getElementById('pitch-input').addEventListener('change', e => setPitchAGlobal(e.target.value));

// ══════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════
// Inicializar iconos SVG en botones estáticos
document.getElementById('desk-fullscreen-btn').innerHTML = ICON_EXPAND;

loadData();
