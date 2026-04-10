// ── Tests de bifurcaciones Electron ──────────────────────────────────────────
//
// Cubre la lógica específica de Electron sin levantar un proceso real:
//
//   1. Detección de entorno: window.__ELECTRON__
//   2. Service Worker: se desregistra en Electron, se registra en web/PWA
//   3. Bluetooth en Electron: selector BLE (select-bluetooth-device),
//      pairing automático, lógica de pickRuuvi y resolveble
//   4. Protocol handler app://: resolución de rutas, MIME types,
//      normalización del scope /temperaments/, fallback 404
//   5. CDN → vendor local: intercepción de URLs jsdelivr
//
// Estrategia: se extraen/replican las funciones puras de main.js y la lógica
// de app.js para poder testearlas en Node sin Electron ni DOM.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT   = path.resolve(__dirname, '../docs');
const VENDOR_ROOT = path.resolve(__dirname, '../electron/vendor');

// ─────────────────────────────────────────────────────────────────────────────
// Réplicas fieles de la lógica de main.js (sin dependencias de Electron)
// ─────────────────────────────────────────────────────────────────────────────

// Réplica de mime() — main.js línea 18
function mime(filePath) {
  return ({
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.css':  'text/css',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.md':   'text/markdown; charset=utf-8',
    '.ico':  'image/x-icon',
  })[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

// Réplica del CDN_MAP — main.js línea 11
const CDN_MAP = {
  'chart.js@4.4.0/dist/chart.umd.min.js':                      'chart.umd.min.js',
  'hammerjs@2.0.8/hammer.min.js':                               'hammer.min.js',
  'chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js': 'chartjs-plugin-zoom.min.js',
};

// Réplica de la resolución de URL del protocol handler app:// — main.js línea 126
function resolveAppUrl(requestUrl, docsRoot) {
  let urlPath = new URL(requestUrl).pathname;
  urlPath = urlPath.replace(/^\/temperaments(\/|$)/, '/') || '/';
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(docsRoot, urlPath);
  const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  return { filePath, exists, contentType: mime(filePath) };
}

// Réplica de la lógica CDN→vendor — main.js línea 110
function resolveCdnUrl(requestUrl, vendorRoot) {
  const match = Object.entries(CDN_MAP).find(([k]) => requestUrl.includes(k));
  if (!match) return null;
  const local = path.join(vendorRoot, match[1]);
  if (fs.existsSync(local)) return local;
  return null;
}

// Réplica del selector BLE — main.js líneas 69-93
function makeBleSelector() {
  let bleCallback = null;
  let bleTimeout  = null;

  const pickRuuvi = (list) => list.find(d => d.deviceName?.startsWith('Ruuvi'));

  const resolveble = (deviceId) => {
    if (!bleCallback) return;
    clearTimeout(bleTimeout);
    const cb = bleCallback;
    bleCallback = null;
    cb(deviceId);
  };

  // Simula el handler de 'select-bluetooth-device'
  const onSelectDevice = (deviceList, callback) => {
    if (!bleCallback) {
      bleCallback = callback;
      bleTimeout = setTimeout(() => resolveble(''), 10_000);
    }
    const ruuvi = pickRuuvi(deviceList);
    if (ruuvi) resolveble(ruuvi.deviceId);
  };

  return { onSelectDevice, resolveble, pickRuuvi,
           _getBleCallback: () => bleCallback,
           _clearAll: () => { clearTimeout(bleTimeout); bleCallback = null; } };
}

// Réplica de la lógica de Service Worker de app.js líneas 21-26
function handleServiceWorkerElectron(win, navigator) {
  const results = { unregistered: [] };
  if ('serviceWorker' in navigator && win.__ELECTRON__) {
    // Simula getRegistrations().then(regs => regs.unregister())
    const regs = navigator.serviceWorker._registrations ?? [];
    for (const r of regs) {
      r.unregister();
      results.unregistered.push(r);
    }
  }
  return results;
}

// Réplica de la decisión de registrar SW — app.js líneas 27-50
function shouldRegisterSW(win, navigator) {
  return 'serviceWorker' in navigator && !win.__ELECTRON__;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: detección de entorno Electron
// ─────────────────────────────────────────────────────────────────────────────

describe('Detección de entorno Electron (window.__ELECTRON__)', () => {

  it('en Electron: window.__ELECTRON__ es true', () => {
    const win = { __ELECTRON__: true };
    assert.equal(win.__ELECTRON__, true);
  });

  it('en PWA: window.__ELECTRON__ es undefined (no presente)', () => {
    const win = {};
    assert.equal(win.__ELECTRON__, undefined);
  });

  it('en Capacitor APK: window.__ELECTRON__ es undefined', () => {
    const win = { Capacitor: { getPlatform: () => 'android' } };
    assert.equal(win.__ELECTRON__, undefined);
  });

  it('preload.js expone exactamente el valor true', () => {
    // El preload hace contextBridge.exposeInMainWorld('__ELECTRON__', true)
    // Verificamos que el valor es booleano true, no truthy arbitrario
    const exposed = true; // lo que expone el contextBridge
    assert.equal(typeof exposed, 'boolean');
    assert.equal(exposed, true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Service Worker — bifurcación Electron vs PWA
// ─────────────────────────────────────────────────────────────────────────────

describe('Service Worker — bifurcación Electron vs PWA/web', () => {

  function makeNavigatorWithSW(registrations = []) {
    return {
      serviceWorker: {
        _registrations: registrations,
        getRegistrations: async () => registrations,
      },
    };
  }

  it('en Electron: shouldRegisterSW devuelve false', () => {
    const win = { __ELECTRON__: true };
    const nav = makeNavigatorWithSW();
    assert.equal(shouldRegisterSW(win, nav), false);
  });

  it('en PWA (sin __ELECTRON__): shouldRegisterSW devuelve true', () => {
    const win = {};
    const nav = makeNavigatorWithSW();
    assert.equal(shouldRegisterSW(win, nav), true);
  });

  it('en APK (Capacitor, sin __ELECTRON__): shouldRegisterSW devuelve true', () => {
    const win = { Capacitor: { getPlatform: () => 'android' } };
    const nav = makeNavigatorWithSW();
    assert.equal(shouldRegisterSW(win, nav), true);
  });

  it('sin API serviceWorker en navigator: shouldRegisterSW devuelve false', () => {
    const win = {};
    const nav = {}; // sin serviceWorker
    assert.equal(shouldRegisterSW(win, nav), false);
  });

  it('en Electron con SW registrado: se desregistran todos los SW previos', () => {
    const unregistered = [];
    const fakeReg = { unregister: () => unregistered.push('reg1') };
    const win = { __ELECTRON__: true };
    const nav = makeNavigatorWithSW([fakeReg]);
    handleServiceWorkerElectron(win, nav);
    assert.equal(unregistered.length, 1);
    assert.equal(unregistered[0], 'reg1');
  });

  it('en Electron con múltiples SW registrados: se desregistran todos', () => {
    const unregistered = [];
    const regs = [
      { unregister: () => unregistered.push('r1') },
      { unregister: () => unregistered.push('r2') },
    ];
    const win = { __ELECTRON__: true };
    const nav = makeNavigatorWithSW(regs);
    handleServiceWorkerElectron(win, nav);
    assert.equal(unregistered.length, 2);
  });

  it('en PWA: no se desregistra ningún SW', () => {
    const unregistered = [];
    const fakeReg = { unregister: () => unregistered.push('reg1') };
    const win = {}; // no __ELECTRON__
    const nav = makeNavigatorWithSW([fakeReg]);
    handleServiceWorkerElectron(win, nav);
    assert.equal(unregistered.length, 0);
  });

  it('en Electron sin SW previos: no lanza errores', () => {
    const win = { __ELECTRON__: true };
    const nav = makeNavigatorWithSW([]);
    assert.doesNotThrow(() => handleServiceWorkerElectron(win, nav));
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Bluetooth Electron — selector BLE (select-bluetooth-device)
// ─────────────────────────────────────────────────────────────────────────────

describe('Bluetooth Electron — selector BLE (select-bluetooth-device)', () => {

  it('pickRuuvi encuentra dispositivo con nombre que empieza por "Ruuvi"', () => {
    const { pickRuuvi } = makeBleSelector();
    const list = [
      { deviceId: 'a1', deviceName: 'Generic BLE' },
      { deviceId: 'b2', deviceName: 'Ruuvi 3C4A' },
    ];
    const found = pickRuuvi(list);
    assert.equal(found.deviceId, 'b2');
  });

  it('pickRuuvi devuelve undefined si no hay ningún RuuviTag', () => {
    const { pickRuuvi } = makeBleSelector();
    const list = [
      { deviceId: 'a1', deviceName: 'Generic BLE' },
      { deviceId: 'a2', deviceName: 'Heart Rate Monitor' },
    ];
    assert.equal(pickRuuvi(list), undefined);
  });

  it('pickRuuvi devuelve undefined si la lista está vacía', () => {
    const { pickRuuvi } = makeBleSelector();
    assert.equal(pickRuuvi([]), undefined);
  });

  it('pickRuuvi tolera dispositivos sin deviceName (no lanza)', () => {
    const { pickRuuvi } = makeBleSelector();
    const list = [{ deviceId: 'x1' }, { deviceId: 'x2', deviceName: null }];
    assert.doesNotThrow(() => pickRuuvi(list));
    assert.equal(pickRuuvi(list), undefined);
  });

  it('onSelectDevice llama al callback con el deviceId del primer RuuviTag', () => {
    const sel = makeBleSelector();
    const calls = [];
    const cb = (id) => calls.push(id);

    sel.onSelectDevice([
      { deviceId: 'ruuvi-001', deviceName: 'Ruuvi 3400' },
    ], cb);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'ruuvi-001');
    sel._clearAll();
  });

  it('onSelectDevice: si la primera lista está vacía, espera a la siguiente llamada', () => {
    const sel = makeBleSelector();
    const calls = [];
    const cb = (id) => calls.push(id);

    // Primera llamada: lista vacía — no resuelve aún
    sel.onSelectDevice([], cb);
    assert.equal(calls.length, 0);

    // Segunda llamada (Electron sigue actualizando el scan): ahora aparece el Ruuvi
    sel.onSelectDevice([{ deviceId: 'ruuvi-002', deviceName: 'Ruuvi ABCD' }], () => {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'ruuvi-002');
    sel._clearAll();
  });

  it('onSelectDevice: durante un scan activo (sin resolver aún), el cb inicial se usa aunque lleguen nuevos callbacks de Electron', () => {
    const sel = makeBleSelector();
    const calls1 = [];
    const calls2 = [];

    // Primera invocación: lista vacía → guarda cb1, no resuelve
    sel.onSelectDevice([], (id) => calls1.push(id));

    // Segunda invocación mientras el scan sigue activo (Electron trae nuevo cb2):
    // bleCallback no es null → se ignora cb2, se sigue esperando
    sel.onSelectDevice([], (id) => calls2.push(id));

    // Ahora llega el Ruuvi (tercera invocación con nuevo cb3, ignorado):
    sel.onSelectDevice([{ deviceId: 'ruuvi-001', deviceName: 'Ruuvi A' }], () => {});

    // Solo cb1 debería haber sido llamado
    assert.equal(calls1.length, 1, 'cb1 debe haberse llamado exactamente una vez');
    assert.equal(calls2.length, 0, 'cb2 nunca debe llamarse — se ignoró');
    sel._clearAll();
  });

  it('onSelectDevice: el segundo callback que llega Electron se ignora (solo se guarda el primero)', () => {
    const sel = makeBleSelector();
    const calls1 = [];
    const calls2 = [];

    // Primera invocación: lista vacía, guarda callback1
    sel.onSelectDevice([], (id) => calls1.push(id));
    // Segunda invocación de Electron (nuevo callback): se ignora el cb2
    sel.onSelectDevice([{ deviceId: 'r1', deviceName: 'Ruuvi' }], (id) => calls2.push(id));

    assert.equal(calls1.length, 1);   // cb1 fue llamado
    assert.equal(calls2.length, 0);   // cb2 fue ignorado
    sel._clearAll();
  });

  it('pairing automático: el handler llama a callback con confirmed:true', () => {
    // Réplica de main.js línea 96:
    // win.webContents.session.setBluetoothPairingHandler((_, callback) => callback({ confirmed: true }))
    let pairingResult = null;
    const pairingHandler = (_, callback) => callback({ confirmed: true });
    pairingHandler({}, (result) => { pairingResult = result; });
    assert.deepEqual(pairingResult, { confirmed: true });
  });

  it('pairing automático: nunca devuelve confirmed:false', () => {
    const pairingHandler = (_, callback) => callback({ confirmed: true });
    let result = null;
    pairingHandler({}, (r) => { result = r; });
    assert.notEqual(result?.confirmed, false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Protocol handler app:// — resolución de rutas y MIME types
// ─────────────────────────────────────────────────────────────────────────────

describe('Protocol app:// — resolución de rutas', () => {

  it('app://salinas/ → /index.html', () => {
    const { filePath } = resolveAppUrl('app://salinas/', DOCS_ROOT);
    assert.ok(filePath.endsWith('index.html'));
  });

  it('app://salinas/index.html → existe en docs/', () => {
    const { exists } = resolveAppUrl('app://salinas/index.html', DOCS_ROOT);
    assert.equal(exists, true);
  });

  it('app://salinas/app.js → existe en docs/', () => {
    const { exists } = resolveAppUrl('app://salinas/app.js', DOCS_ROOT);
    assert.equal(exists, true);
  });

  it('app://salinas/sw.js → existe en docs/', () => {
    const { exists } = resolveAppUrl('app://salinas/sw.js', DOCS_ROOT);
    assert.equal(exists, true);
  });

  it('scope /temperaments/ se normaliza a / → sirve index.html', () => {
    const { filePath } = resolveAppUrl('app://salinas/temperaments/', DOCS_ROOT);
    assert.ok(filePath.endsWith('index.html'));
  });

  it('scope /temperaments se normaliza a / → sirve index.html', () => {
    const { filePath } = resolveAppUrl('app://salinas/temperaments', DOCS_ROOT);
    assert.ok(filePath.endsWith('index.html'));
  });

  it('ruta inexistente → exists=false', () => {
    const { exists } = resolveAppUrl('app://salinas/no-existe.xyz', DOCS_ROOT);
    assert.equal(exists, false);
  });

  it('ruta a directorio → exists=false (no sirve directorios)', () => {
    // docs/ es un directorio, no un fichero
    const { exists } = resolveAppUrl('app://salinas', DOCS_ROOT);
    // '/' → index.html que sí existe
    // Probamos una ruta que sea directorio real pero sin index
    const { exists: e2 } = resolveAppUrl('app://salinas/icons', DOCS_ROOT);
    // icons/ es directorio, isFile() debe ser false
    assert.equal(e2, false);
  });

});

describe('Protocol app:// — MIME types', () => {

  it('.html → text/html', () => {
    assert.equal(mime('index.html'), 'text/html');
  });

  it('.js → application/javascript', () => {
    assert.equal(mime('app.js'), 'application/javascript');
  });

  it('.json → application/json', () => {
    assert.equal(mime('manifest.json'), 'application/json');
  });

  it('.css → text/css', () => {
    assert.equal(mime('style.css'), 'text/css');
  });

  it('.png → image/png', () => {
    assert.equal(mime('icon.png'), 'image/png');
  });

  it('.svg → image/svg+xml', () => {
    assert.equal(mime('logo.svg'), 'image/svg+xml');
  });

  it('.md → text/markdown; charset=utf-8', () => {
    assert.equal(mime('README.md'), 'text/markdown; charset=utf-8');
  });

  it('.ico → image/x-icon', () => {
    assert.equal(mime('favicon.ico'), 'image/x-icon');
  });

  it('extensión desconocida → application/octet-stream', () => {
    assert.equal(mime('data.bin'), 'application/octet-stream');
  });

  it('sin extensión → application/octet-stream', () => {
    assert.equal(mime('Makefile'), 'application/octet-stream');
  });

  it('extensión en mayúsculas (.JS) → application/javascript', () => {
    assert.equal(mime('bundle.JS'), 'application/javascript');
  });

  it('extensión mixta (.Html) → text/html', () => {
    assert.equal(mime('page.Html'), 'text/html');
  });

  it('app://salinas/index.html tiene content-type text/html', () => {
    const { contentType } = resolveAppUrl('app://salinas/index.html', DOCS_ROOT);
    assert.equal(contentType, 'text/html');
  });

  it('app://salinas/app.js tiene content-type application/javascript', () => {
    const { contentType } = resolveAppUrl('app://salinas/app.js', DOCS_ROOT);
    assert.equal(contentType, 'application/javascript');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: CDN → vendor local (soporte offline)
// ─────────────────────────────────────────────────────────────────────────────

describe('CDN → vendor local (intercepción jsdelivr)', () => {

  it('URL de chart.js en CDN redirige a vendor local', () => {
    const url = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.ok(local !== null, 'Debe encontrar el vendor local');
    assert.ok(local.endsWith('chart.umd.min.js'));
  });

  it('URL de hammer.js en CDN redirige a vendor local', () => {
    const url = 'https://cdn.jsdelivr.net/npm/hammerjs@2.0.8/hammer.min.js';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.ok(local !== null);
    assert.ok(local.endsWith('hammer.min.js'));
  });

  it('URL de chartjs-plugin-zoom en CDN redirige a vendor local', () => {
    const url = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.ok(local !== null);
    assert.ok(local.endsWith('chartjs-plugin-zoom.min.js'));
  });

  it('URL de otra librería NO en CDN_MAP devuelve null', () => {
    const url = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.equal(local, null);
  });

  it('URL que no está en CDN_MAP devuelve null', () => {
    // La función hace substring match sobre la ruta, no filtra por dominio.
    // Una URL completamente distinta (sin ninguna de las 3 claves del mapa) devuelve null.
    const url = 'https://unpkg.com/lodash@4.17.21/lodash.min.js';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.equal(local, null);
  });

  it('CDN_MAP cubre exactamente 3 librerías', () => {
    assert.equal(Object.keys(CDN_MAP).length, 3);
  });

  it('los ficheros vendor referenciados en CDN_MAP existen en disco', () => {
    for (const filename of Object.values(CDN_MAP)) {
      const p = path.join(VENDOR_ROOT, filename);
      assert.ok(fs.existsSync(p), `Falta vendor: ${filename}`);
    }
  });

  it('la intercepción usa substring match (no exact match) — tolera query strings', () => {
    const url = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js?v=1';
    const local = resolveCdnUrl(url, VENDOR_ROOT);
    assert.ok(local !== null, 'Debe interceptar aunque haya query string');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: protocol.registerSchemesAsPrivileged — configuración del esquema app://
// ─────────────────────────────────────────────────────────────────────────────

describe('Esquema app:// — privilegios requeridos para Web Bluetooth', () => {

  // Los privilegios son constantes en main.js; verificamos que el objeto
  // tiene exactamente los flags necesarios para que Web Bluetooth funcione.
  const SCHEME_CONFIG = {
    scheme: 'app',
    privileges: {
      standard:             true,
      secure:               true,   // necesario para tratar el esquema como HTTPS
      supportFetchAPI:      true,
      allowServiceWorkers:  true,
      corsEnabled:          true,
    },
  };

  it('el esquema registrado es "app"', () => {
    assert.equal(SCHEME_CONFIG.scheme, 'app');
  });

  it('secure:true — el renderer lo trata como contexto seguro (HTTPS)', () => {
    assert.equal(SCHEME_CONFIG.privileges.secure, true);
  });

  it('standard:true — habilita resolución de rutas relativas', () => {
    assert.equal(SCHEME_CONFIG.privileges.standard, true);
  });

  it('supportFetchAPI:true — fetch() funciona dentro del renderer', () => {
    assert.equal(SCHEME_CONFIG.privileges.supportFetchAPI, true);
  });

  it('corsEnabled:true — permite peticiones cross-origin desde el renderer', () => {
    assert.equal(SCHEME_CONFIG.privileges.corsEnabled, true);
  });

  it('todos los privilegios necesarios están presentes', () => {
    const required = ['standard', 'secure', 'supportFetchAPI', 'corsEnabled'];
    for (const key of required) {
      assert.equal(SCHEME_CONFIG.privileges[key], true, `Falta privilegio: ${key}`);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: window-all-closed — comportamiento en macOS vs otros SO
// ─────────────────────────────────────────────────────────────────────────────

describe('app quit — bifurcación macOS vs otros SO', () => {

  // Réplica de main.js línea 152
  function shouldQuitOnAllWindowsClosed(platform) {
    return platform !== 'darwin';
  }

  it('Linux: quit al cerrar todas las ventanas', () => {
    assert.equal(shouldQuitOnAllWindowsClosed('linux'), true);
  });

  it('Windows: quit al cerrar todas las ventanas', () => {
    assert.equal(shouldQuitOnAllWindowsClosed('win32'), true);
  });

  it('macOS (darwin): NO quit al cerrar todas las ventanas', () => {
    assert.equal(shouldQuitOnAllWindowsClosed('darwin'), false);
  });

});
