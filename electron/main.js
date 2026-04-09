'use strict';
const { app, BrowserWindow, protocol, session } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Rutas ────────────────────────────────────────────────────────────────────
const DOCS_ROOT   = path.resolve(__dirname, '../docs');
const VENDOR_ROOT = path.resolve(__dirname, 'vendor');

// ── Mapa de CDN → vendor local ───────────────────────────────────────────────
const CDN_MAP = {
  'chart.js@4.4.0/dist/chart.umd.min.js':                      'chart.umd.min.js',
  'hammerjs@2.0.8/hammer.min.js':                               'hammer.min.js',
  'chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js': 'chartjs-plugin-zoom.min.js',
};

// ── MIME types ───────────────────────────────────────────────────────────────
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

// ── Protocol app:// ───────────────────────────────────────────────────────────
// Necesario para que el Service Worker funcione (file:// no lo permite).
// El esquema se marca como "secure" → el renderer lo trata como HTTPS →
// Web Bluetooth queda habilitado sin flags adicionales.
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard:          true,
    secure:            true,
    supportFetchAPI:   true,
    allowServiceWorkers: true,
    corsEnabled:       true,
  },
}]);

// ── Crear ventana ─────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width:  1280,
    height: 800,
    minWidth:  700,
    minHeight: 500,
    title: 'Salinas',
    icon: path.join(DOCS_ROOT, 'icon-512.png'),
    webPreferences: {
      preload:             path.join(__dirname, 'preload.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      // Web Bluetooth requiere este flag en Electron 20+
      enableBlinkFeatures: 'WebBluetooth',
    },
  });

  // ── Handler BLE: selector de dispositivos ────────────────────────────────
  // Sin este handler, requestDevice() se queda esperando indefinidamente.
  // Auto-seleccionamos el primer RuuviTag que aparezca en el scan.
  win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();

    const pickRuuvi = (list) => list.find(d => d.deviceName?.startsWith('Ruuvi'));

    const ruuvi = pickRuuvi(deviceList);
    if (ruuvi) {
      callback(ruuvi.deviceId);
      return;
    }

    // Lista vacía al inicio del scan — esperar hasta 10 s a que aparezca
    const timeout = setTimeout(() => {
      win.webContents.removeAllListeners('select-bluetooth-device');
      callback('');
    }, 10_000);

    win.webContents.on('select-bluetooth-device', (ev2, list2, cb2) => {
      ev2.preventDefault();
      const r = pickRuuvi(list2);
      if (r) {
        clearTimeout(timeout);
        win.webContents.removeAllListeners('select-bluetooth-device');
        cb2(r.deviceId);
      }
    });
  });

  // ── Pairing automático (Electron 20+) ────────────────────────────────────
  win.webContents.session.setBluetoothPairingHandler?.((_, callback) => {
    callback({ confirmed: true });
  });

  win.loadURL('app://salinas/');
}

// ── Arranque ──────────────────────────────────────────────────────────────────
app.whenReady().then(() => {

  // Intercepción de CDN → vendor local (soporte offline)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['https://cdn.jsdelivr.net/*'] },
    (details, callback) => {
      const match = Object.entries(CDN_MAP).find(([k]) => details.url.includes(k));
      if (match) {
        const local = path.join(VENDOR_ROOT, match[1]);
        if (fs.existsSync(local)) {
          callback({ redirectURL: `file://${local}` });
          return;
        }
      }
      callback({});
    }
  );

  // Registrar protocol app://
  protocol.handle('app', (request) => {
    let urlPath = new URL(request.url).pathname;

    // El manifest.json usa /temperaments/ como scope → normalizar a /
    // Ojo: solo quitar el prefijo si va seguido de / o es el path completo
    urlPath = urlPath.replace(/^\/temperaments(\/|$)/, '/') || '/';
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(DOCS_ROOT, urlPath);
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    if (exists) {
      return new Response(
        fs.readFileSync(filePath),
        { headers: { 'Content-Type': mime(filePath) } }
      );
    }
    return new Response('Not found', { status: 404 });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
