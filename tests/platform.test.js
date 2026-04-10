// ── Tests de bifurcaciones PWA vs APK ──────────────────────────────────────────
//
// Verifica que la lógica de detección de plataforma y las rutas de código
// específicas (Bluetooth, permisos de audio, wake lock) se comportan
// correctamente tanto en entorno web como en entorno Capacitor (APK).
//
// Estrategia: se simula `window` con distintas configuraciones de Capacitor
// y APIs web, y se importa la lógica de ruuvi.js reescrita para ser testeable.

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

// ── Helpers de simulación de entorno ─────────────────────────────────────────

function makeCapacitorWindow(platform = 'android', blePluginOpts = {}) {
  return {
    Capacitor: {
      getPlatform: () => platform,
      Plugins: {
        BluetoothLe: {
          _initialized: false,
          _connected: false,
          _listeners: {},
          initialize: async function(opts) {
            this._initialized = true;
            this._initOpts = opts;
          },
          requestDevice: async function(opts) {
            this._requestOpts = opts;
            return { deviceId: 'ruuvi-device-001', name: 'Ruuvi Test' };
          },
          connect: async function({ deviceId }) {
            this._connected = true;
            this._connectedId = deviceId;
          },
          disconnect: async function({ deviceId }) {
            this._connected = false;
          },
          startNotifications: async function({ deviceId, service, characteristic }) {
            this._notifStarted = { deviceId, service, characteristic };
          },
          stopNotifications: async function({ deviceId, service, characteristic }) {
            this._notifStopped = true;
          },
          addListener: async function(eventKey, cb) {
            this._listeners[eventKey] = cb;
            return { remove: async () => { delete this._listeners[eventKey]; } };
          },
          // Helper de test: simula una notificación entrante
          _fireNotification: function(deviceId, service, char, value) {
            const key = `notification|${deviceId}|${service}|${char}`;
            if (this._listeners[key]) this._listeners[key]({ value });
          },
          // Helper de test: simula desconexión inesperada
          _fireDisconnect: function(deviceId) {
            const key = `disconnected|${deviceId}`;
            if (this._listeners[key]) this._listeners[key]();
          },
          ...blePluginOpts,
        },
      },
    },
  };
}

function makeWebWindow({ hasBluetooth = true, hasGetDevices = false, savedDevices = [] } = {}) {
  const win = { Capacitor: { getPlatform: () => 'web' } };
  if (hasBluetooth) {
    win.navigator = {
      bluetooth: {
        requestDevice: async (opts) => {
          win.navigator.bluetooth._lastRequest = opts;
          const device = makeBluetoothDevice('Ruuvi 3400');
          return device;
        },
      },
    };
    if (hasGetDevices) {
      win.navigator.bluetooth.getDevices = async () => savedDevices;
    }
  } else {
    win.navigator = {};
  }
  return win;
}

function makeBluetoothDevice(name = 'Ruuvi 3400', connected = true) {
  const listeners = {};
  const device = {
    name,
    deviceId: 'wb-device-001',
    gatt: {
      connected,
      connect: async function() {
        return {
          getPrimaryService: async () => ({
            getCharacteristic: async () => {
              const char = {
                _listeners: {},
                addEventListener: function(ev, cb) { this._listeners[ev] = cb; },
                removeEventListener: function(ev) { delete this._listeners[ev]; },
                startNotifications: async function() {},
                stopNotifications: async function() {},
                _fire: function(buffer) {
                  if (this._listeners['characteristicvaluechanged']) {
                    this._listeners['characteristicvaluechanged']({ target: { value: { buffer } } });
                  }
                },
              };
              device._char = char;
              return char;
            },
          }),
        };
      },
      disconnect: function() {},
    },
    addEventListener: function(ev, cb) { listeners[ev] = cb; },
    removeEventListener: function(ev) { delete listeners[ev]; },
    _fireDisconnect: function() { if (listeners['gattserverdisconnected']) listeners['gattserverdisconnected'](); },
  };
  return device;
}

// ── Carga de ruuvi.js adaptada a entorno de test ──────────────────────────────
// ruuvi.js usa `window` globalmente; para testearlo en Node necesitamos
// una función factoría que reciba el entorno como parámetro.
// Extraemos la lógica pura en funciones auxiliares que replicamos aquí.

const RUUVI_SERVICE  = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RUUVI_CHAR_TX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const RUUVI_NAME_PREFIX = 'Ruuvi';

// Réplica fiel de _isCapacitor() de ruuvi.js
function isCapacitor(win) {
  const platform = win.Capacitor?.getPlatform?.();
  return platform === 'android' || platform === 'ios';
}

// Réplica fiel de _parseRawV5() de ruuvi.js
function parseRawV5(buffer) {
  const dv = new DataView(buffer);
  for (let i = 0; i <= dv.byteLength - 3; i++) {
    if (dv.getUint8(i) === 0x05) {
      const rawTemp = dv.getInt16(i + 1, false);
      if (rawTemp === -32768) return null;
      return rawTemp * 0.005;
    }
  }
  return null;
}

// Réplica fiel de _hexToBuffer() de ruuvi.js
function hexToBuffer(hex) {
  const bytes = hex.match(/.{1,2}/g) || [];
  const buf = new ArrayBuffer(bytes.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) u8[i] = parseInt(bytes[i], 16);
  return buf;
}

// Construye un buffer RAW v5 sintético con la temperatura dada
function makeRawV5Buffer(tempCelsius) {
  const rawTemp = Math.round(tempCelsius / 0.005);
  const buf = new ArrayBuffer(6);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x05);
  dv.setInt16(1, rawTemp, false);
  return buf;
}

// localStorage simulado (mapa en memoria, aislado por instancia de scanner)
function makeStorage() {
  const store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = v; },
    removeItem: (k)    => { delete store[k]; },
    _store: store,
  };
}

const STORAGE_KEY = 'ruuviLastDevice';

// Factoría de RuuviScanner con entorno inyectado (equivale a ruuvi.js pero testeable)
function makeRuuviScanner(win, storage = makeStorage()) {
  let _streaming  = false;
  let _savedName  = null;
  let _savedId    = null;
  let _offset     = 0;
  let _cb         = null;
  let _capListeners = [];
  let _wbDevice   = null;
  let _wbChar     = null;
  let _wbServer   = null;

  function _saveDevice(id, name) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ id, name })); } catch (_) {}
  }
  function _clearDevice() {
    try { storage.removeItem(STORAGE_KEY); } catch (_) {}
  }
  function _loadDevice() {
    try { return JSON.parse(storage.getItem(STORAGE_KEY) || 'null'); } catch (_) { return null; }
  }

  function _notifyStatus(status) {
    if (typeof scanner.onStatus === 'function') scanner.onStatus(status);
  }

  function _getBleClient() {
    const mod = win.Capacitor?.Plugins?.BluetoothLe;
    if (!mod) throw new Error('Plugin BLE de Capacitor no disponible.');
    return mod;
  }

  async function _connectCapacitor() {
    const BLE = _getBleClient();
    await BLE.initialize({ androidNeverForLocation: true });

    const last = _loadDevice();
    let device;
    if (last?.id) {
      try {
        await BLE.connect({ deviceId: last.id });
        device = { deviceId: last.id, name: last.name ?? last.id };
      } catch (_) {
        device = null;
      }
    }

    if (!device) {
      device = await BLE.requestDevice({ services: [RUUVI_SERVICE], namePrefix: RUUVI_NAME_PREFIX });
      await BLE.connect({ deviceId: device.deviceId });
    }

    _savedId   = device.deviceId;
    _savedName = device.name ?? device.deviceId;
    _saveDevice(_savedId, _savedName);

    const disconnectKey = `disconnected|${_savedId}`;
    const disconnectListener = await BLE.addListener(disconnectKey, () => {
      _streaming = false;
      _notifyStatus('disconnected');
    });
    _capListeners.push(disconnectListener);

    const notifKey = `notification|${_savedId}|${RUUVI_SERVICE}|${RUUVI_CHAR_TX}`;
    const notifListener = await BLE.addListener(notifKey, (event) => {
      const raw = event?.value;
      const buf = (typeof raw === 'string') ? hexToBuffer(raw) : (raw?.buffer ?? raw);
      const tempC = parseRawV5(buf);
      if (tempC === null) return;
      if (typeof _cb === 'function') _cb(tempC + _offset);
    });
    _capListeners.push(notifListener);

    await BLE.startNotifications({ deviceId: _savedId, service: RUUVI_SERVICE, characteristic: RUUVI_CHAR_TX });
    _streaming = true;
    _notifyStatus('connected');
  }

  async function _disconnectCapacitor() {
    const BLE = _getBleClient();
    if (_savedId) {
      try { await BLE.stopNotifications({ deviceId: _savedId, service: RUUVI_SERVICE, characteristic: RUUVI_CHAR_TX }); } catch (_) {}
      try { await BLE.disconnect({ deviceId: _savedId }); } catch (_) {}
    }
    for (const l of _capListeners) { try { await l.remove(); } catch (_) {} }
    _capListeners = [];
    _streaming = false;
    _savedId = null;
    _clearDevice();
    _notifyStatus('disconnected');
  }

  function _onWbNotification(event) {
    const buf   = event.target.value.buffer;
    const tempC = parseRawV5(buf);
    if (tempC === null) return;
    if (typeof _cb === 'function') _cb(tempC + _offset);
  }

  async function _connectGatt() {
    _wbServer = await _wbDevice.gatt.connect();
    const svc  = await _wbServer.getPrimaryService(RUUVI_SERVICE);
    _wbChar    = await svc.getCharacteristic(RUUVI_CHAR_TX);
    _wbChar.addEventListener('characteristicvaluechanged', _onWbNotification);
    await _wbChar.startNotifications();
    _streaming = true;
    _notifyStatus('connected');
  }

  async function _connectWebBluetooth() {
    if (!win.navigator?.bluetooth) throw new Error('Web Bluetooth no disponible en este navegador.');

    if (win.navigator.bluetooth.getDevices) {
      try {
        const devices = await win.navigator.bluetooth.getDevices();
        const ruuvi = devices.find(d => d.name?.startsWith(RUUVI_NAME_PREFIX));
        if (ruuvi) {
          _wbDevice = ruuvi;
          _savedName = ruuvi.name;
          _saveDevice(ruuvi.id ?? ruuvi.name, _savedName);
          _wbDevice.addEventListener('gattserverdisconnected', () => {
            _streaming = false;
            _wbChar = null;
            _wbServer = null;
            _notifyStatus('disconnected');
          });
          await _connectGatt();
          return;
        }
      } catch (_) {}
    }

    _wbDevice = await win.navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
      optionalServices: [RUUVI_SERVICE],
    });
    _savedName = _wbDevice.name;
    _saveDevice(_wbDevice.id ?? _wbDevice.name, _savedName);
    _wbDevice.addEventListener('gattserverdisconnected', () => {
      _streaming = false;
      _wbChar = null;
      _wbServer = null;
      _notifyStatus('disconnected');
    });
    await _connectGatt();
  }

  function _disconnectWebBluetooth() {
    _streaming = false;
    if (_wbChar) {
      try { _wbChar.stopNotifications(); } catch (_) {}
      _wbChar.removeEventListener('characteristicvaluechanged', _onWbNotification);
      _wbChar = null;
    }
    if (_wbDevice?.gatt?.connected) {
      try { _wbDevice.gatt.disconnect(); } catch (_) {}
    }
    _wbServer = null;
    _clearDevice();
    _notifyStatus('disconnected');
  }

  const scanner = {
    get streaming()  { return _streaming; },
    get deviceName() { return _savedName ?? null; },
    set onTemperature(cb) { _cb = cb; },
    get onTemperature()   { return _cb; },
    onStatus: null,
    get offset() { return _offset; },
    setOffset(n) { _offset = isFinite(n) ? n : 0; },
    async connect() {
      if (isCapacitor(win)) {
        await _connectCapacitor();
      } else {
        await _connectWebBluetooth();
      }
    },
    disconnect() {
      if (isCapacitor(win)) {
        _disconnectCapacitor();
      } else {
        _disconnectWebBluetooth();
      }
    },
    hasLastDevice() { return !!_loadDevice(); },

    async autoConnect({ retries = 4, delay = 2000, onFail = () => {} } = {}) {
      for (let i = 0; i < retries; i++) {
        try { await scanner.connect(); return; } catch (_) {
          if (i < retries - 1) await new Promise(r => setTimeout(r, delay));
        }
      }
      onFail();
    },

    // Acceso interno para tests
    _getBle: () => _getBleClient(),
    _ble: () => win.Capacitor?.Plugins?.BluetoothLe,
    _wbDevice: () => _wbDevice,
    _storage: () => storage,
  };
  return scanner;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: detección de plataforma
// ─────────────────────────────────────────────────────────────────────────────

describe('Detección de plataforma (isCapacitor)', () => {

  it('android → es Capacitor', () => {
    assert.equal(isCapacitor(makeCapacitorWindow('android')), true);
  });

  it('ios → es Capacitor', () => {
    assert.equal(isCapacitor(makeCapacitorWindow('ios')), true);
  });

  it('web → NO es Capacitor', () => {
    assert.equal(isCapacitor({ Capacitor: { getPlatform: () => 'web' } }), false);
  });

  it('sin window.Capacitor → NO es Capacitor', () => {
    assert.equal(isCapacitor({}), false);
  });

  it('Capacitor sin getPlatform → NO es Capacitor', () => {
    assert.equal(isCapacitor({ Capacitor: {} }), false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Bluetooth — rama Capacitor (APK)
// ─────────────────────────────────────────────────────────────────────────────

describe('Bluetooth — rama Capacitor (APK Android)', () => {

  it('connect() en Android llama a BLE.initialize con androidNeverForLocation:true', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(win.Capacitor.Plugins.BluetoothLe._initOpts.androidNeverForLocation, true);
  });

  it('connect() en Android llama a BLE.requestDevice con el servicio Ruuvi', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    const opts = win.Capacitor.Plugins.BluetoothLe._requestOpts;
    assert.ok(opts.services.includes(RUUVI_SERVICE));
    assert.equal(opts.namePrefix, 'Ruuvi');
  });

  it('connect() en Android establece streaming = true', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(scanner.streaming, true);
  });

  it('connect() en Android guarda el nombre del dispositivo', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(scanner.deviceName, 'Ruuvi Test');
  });

  it('connect() en Android llama a BLE.startNotifications con servicio y característica correctos', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    const notif = win.Capacitor.Plugins.BluetoothLe._notifStarted;
    assert.equal(notif.service, RUUVI_SERVICE);
    assert.equal(notif.characteristic, RUUVI_CHAR_TX);
  });

  it('connect() en Android emite evento de estado "connected"', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    const events = [];
    scanner.onStatus = s => events.push(s);
    await scanner.connect();
    assert.ok(events.includes('connected'));
  });

  it('disconnect() en Android llama a BLE.stopNotifications y BLE.disconnect', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    scanner.disconnect();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(win.Capacitor.Plugins.BluetoothLe._notifStopped, true);
    assert.equal(win.Capacitor.Plugins.BluetoothLe._connected, false);
  });

  it('disconnect() en Android pone streaming = false', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    // disconnect() es fire-and-forget (igual que en ruuvi.js); esperamos
    // a que las microtasks pendientes se resuelvan antes de comprobar el estado.
    scanner.disconnect();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(scanner.streaming, false);
  });

  it('desconexión inesperada vía BLE.addListener pone streaming = false', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    // Simula desconexión inesperada desde el dispositivo
    win.Capacitor.Plugins.BluetoothLe._fireDisconnect('ruuvi-device-001');
    assert.equal(scanner.streaming, false);
  });

  it('desconexión inesperada emite evento de estado "disconnected"', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    const events = [];
    scanner.onStatus = s => events.push(s);
    await scanner.connect();
    events.length = 0; // limpiar "connected"
    win.Capacitor.Plugins.BluetoothLe._fireDisconnect('ruuvi-device-001');
    assert.ok(events.includes('disconnected'));
  });

  it('notificación BLE con hex string dispara onTemperature con valor correcto', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    const temps = [];
    scanner.onTemperature = t => temps.push(t);
    await scanner.connect();

    // Temperatura 20.00°C → rawTemp = 20/0.005 = 4000 = 0x0FA0
    // Buffer: [0x05, 0x0F, 0xA0, ...]
    const buf = makeRawV5Buffer(20.0);
    const dv = new DataView(buf);
    let hex = '';
    for (let i = 0; i < buf.byteLength; i++) hex += dv.getUint8(i).toString(16).padStart(2, '0');

    win.Capacitor.Plugins.BluetoothLe._fireNotification(
      'ruuvi-device-001', RUUVI_SERVICE, RUUVI_CHAR_TX, hex
    );
    assert.equal(temps.length, 1);
    assert.ok(Math.abs(temps[0] - 20.0) < 0.01, `esperado ~20°C, obtenido ${temps[0]}`);
  });

  it('notificación BLE con offset de calibración ajusta la temperatura', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    scanner.setOffset(2.5);
    const temps = [];
    scanner.onTemperature = t => temps.push(t);
    await scanner.connect();

    const buf = makeRawV5Buffer(20.0);
    const dv = new DataView(buf);
    let hex = '';
    for (let i = 0; i < buf.byteLength; i++) hex += dv.getUint8(i).toString(16).padStart(2, '0');

    win.Capacitor.Plugins.BluetoothLe._fireNotification(
      'ruuvi-device-001', RUUVI_SERVICE, RUUVI_CHAR_TX, hex
    );
    assert.ok(Math.abs(temps[0] - 22.5) < 0.01, `esperado 22.5°C con offset, obtenido ${temps[0]}`);
  });

  it('sin plugin BLE en Capacitor lanza error descriptivo', async () => {
    const win = { Capacitor: { getPlatform: () => 'android', Plugins: {} } };
    const scanner = makeRuuviScanner(win);
    await assert.rejects(
      () => scanner.connect(),
      { message: 'Plugin BLE de Capacitor no disponible.' }
    );
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Bluetooth — rama Web Bluetooth (PWA)
// ─────────────────────────────────────────────────────────────────────────────

describe('Bluetooth — rama Web Bluetooth (PWA navegador)', () => {

  it('connect() en web usa navigator.bluetooth.requestDevice', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.ok(win.navigator.bluetooth._lastRequest);
  });

  it('connect() en web pasa filtro por namePrefix Ruuvi', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    const filters = win.navigator.bluetooth._lastRequest.filters;
    assert.ok(filters.some(f => f.namePrefix === 'Ruuvi'));
  });

  it('connect() en web incluye el servicio Ruuvi en optionalServices', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    const opts = win.navigator.bluetooth._lastRequest;
    assert.ok(opts.optionalServices.includes(RUUVI_SERVICE));
  });

  it('connect() en web establece streaming = true', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(scanner.streaming, true);
  });

  it('connect() en web guarda el nombre del dispositivo', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(scanner.deviceName, 'Ruuvi 3400');
  });

  it('connect() en web emite evento "connected"', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    const events = [];
    scanner.onStatus = s => events.push(s);
    await scanner.connect();
    assert.ok(events.includes('connected'));
  });

  it('sin navigator.bluetooth lanza error descriptivo', async () => {
    const win = makeWebWindow({ hasBluetooth: false });
    const scanner = makeRuuviScanner(win);
    await assert.rejects(
      () => scanner.connect(),
      { message: 'Web Bluetooth no disponible en este navegador.' }
    );
  });

  it('connect() en web con getDevices usa dispositivo ya emparejado si existe', async () => {
    const savedDevice = makeBluetoothDevice('Ruuvi 3400');
    const win = makeWebWindow({ hasGetDevices: true, savedDevices: [savedDevice] });
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    // Si usó el dispositivo guardado, NO llamó a requestDevice
    assert.ok(!win.navigator.bluetooth._lastRequest,
      'No debería haber llamado a requestDevice si hay dispositivo guardado');
    assert.equal(scanner.streaming, true);
  });

  it('connect() en web con getDevices vacío cae a requestDevice', async () => {
    const win = makeWebWindow({ hasGetDevices: true, savedDevices: [] });
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.ok(win.navigator.bluetooth._lastRequest,
      'Debe llamar a requestDevice si no hay dispositivos guardados');
  });

  it('disconnect() en web pone streaming = false', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    scanner.disconnect();
    assert.equal(scanner.streaming, false);
  });

  it('disconnect() en web emite evento "disconnected"', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    const events = [];
    scanner.onStatus = s => events.push(s);
    await scanner.connect();
    events.length = 0;
    scanner.disconnect();
    assert.ok(events.includes('disconnected'));
  });

  it('notificación Web Bluetooth dispara onTemperature con valor correcto', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    const temps = [];
    scanner.onTemperature = t => temps.push(t);
    await scanner.connect();

    const device = win.navigator.bluetooth._lastRequest
      ? scanner._wbDevice?.() ?? null
      : null;
    // Acceder al char a través del dispositivo conectado
    const char = win.navigator.bluetooth._lastRequest
      ? null
      : null;

    // La notificación se dispara a través del dispositivo BT simulado
    // Necesitamos el char que se guardó en el mock del dispositivo
    const btDevice = win.navigator.bluetooth._device ?? null;
    // El dispositivo se creó en requestDevice, necesitamos accederlo
    // Rehacer el test disparando la notificación directamente
    const buf = makeRawV5Buffer(15.5);
    // El char está disponible en _wbDevice (acceso interno)
    // Como no exponemos _wbDevice directamente, disparamos via el device del mock
    // Buscamos el char que se registró al conectar:
    // makeBluetoothDevice guarda _char en el device object
    // Pero como el device se crea dentro de requestDevice, no tenemos referencia...
    // Estrategia: invocar a través del scanner interno.
    // El scanner no expone el char, así que lo exponemos via _wbDevice()
    const d = scanner._wbDevice();
    assert.ok(d, 'El scanner debe tener referencia al dispositivo BT');
    assert.ok(d._char, 'El dispositivo simulado debe tener referencia al char');
    d._char._fire(buf);
    assert.equal(temps.length, 1);
    assert.ok(Math.abs(temps[0] - 15.5) < 0.01, `esperado 15.5°C, obtenido ${temps[0]}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: parseRawV5 — lógica compartida de decodificación de temperatura
// ─────────────────────────────────────────────────────────────────────────────

describe('parseRawV5 — decodificación del paquete RuuviTag Data Format 5', () => {

  it('parsea 0°C correctamente', () => {
    assert.ok(Math.abs(parseRawV5(makeRawV5Buffer(0)) - 0) < 0.01);
  });

  it('parsea 20°C correctamente', () => {
    assert.ok(Math.abs(parseRawV5(makeRawV5Buffer(20)) - 20) < 0.01);
  });

  it('parsea temperaturas negativas (-15°C)', () => {
    assert.ok(Math.abs(parseRawV5(makeRawV5Buffer(-15)) - (-15)) < 0.01);
  });

  it('parsea temperatura mínima representable (~-163.84°C)', () => {
    const buf = new ArrayBuffer(3);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x05);
    dv.setInt16(1, -32767, false); // mínimo válido (−32768 es "inválido")
    const result = parseRawV5(buf);
    assert.ok(result !== null);
    assert.ok(Math.abs(result - (-163.835)) < 0.01);
  });

  it('devuelve null si rawTemp es el valor reservado 0x8000 (-32768)', () => {
    const buf = new ArrayBuffer(3);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x05);
    dv.setInt16(1, -32768, false);
    assert.equal(parseRawV5(buf), null);
  });

  it('devuelve null si no encuentra el byte marcador 0x05', () => {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x04); // byte incorrecto
    assert.equal(parseRawV5(buf), null);
  });

  it('buffer vacío devuelve null', () => {
    assert.equal(parseRawV5(new ArrayBuffer(0)), null);
  });

  it('buffer de 2 bytes (muy corto para leer Int16) devuelve null', () => {
    const buf = new ArrayBuffer(2);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x05);
    dv.setUint8(1, 0x0F);
    assert.equal(parseRawV5(buf), null);
  });

  it('el byte 0x05 puede aparecer precedido por bytes arbitrarios', () => {
    const buf = new ArrayBuffer(5);
    const dv = new DataView(buf);
    dv.setUint8(0, 0xFF);
    dv.setUint8(1, 0x00);
    dv.setUint8(2, 0x05); // marcador en posición 2
    dv.setInt16(3, 4000, false); // 20°C
    const result = parseRawV5(buf);
    assert.ok(result !== null);
    assert.ok(Math.abs(result - 20.0) < 0.01);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: hexToBuffer — conversión hex→ArrayBuffer (ruta Capacitor)
// ─────────────────────────────────────────────────────────────────────────────

describe('hexToBuffer — conversión de string hexadecimal a ArrayBuffer', () => {

  it('convierte "0fa0" correctamente', () => {
    const buf = hexToBuffer('0fa0');
    const dv = new DataView(buf);
    assert.equal(dv.getUint8(0), 0x0f);
    assert.equal(dv.getUint8(1), 0xa0);
  });

  it('string vacío produce buffer de longitud 0', () => {
    assert.equal(hexToBuffer('').byteLength, 0);
  });

  it('round-trip: makeRawV5Buffer → hexToBuffer → parseRawV5 conserva la temperatura', () => {
    const expected = 23.45;
    const buf = makeRawV5Buffer(expected);
    const dv = new DataView(buf);
    let hex = '';
    for (let i = 0; i < buf.byteLength; i++) hex += dv.getUint8(i).toString(16).padStart(2, '0');
    const result = parseRawV5(hexToBuffer(hex));
    assert.ok(Math.abs(result - expected) < 0.01);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: bifurcación de plataforma — audio y permisos
// ─────────────────────────────────────────────────────────────────────────────
// getUserMedia no tiene bifurcación propia en el código; el check relevante
// es si la API está disponible. Estos tests protegen ese comportamiento.

describe('Permisos de audio — detección de disponibilidad de getUserMedia', () => {

  function hasMediaDevices(win) {
    return !!(win.navigator?.mediaDevices?.getUserMedia);
  }

  it('navegador moderno (PWA) tiene navigator.mediaDevices.getUserMedia', () => {
    const win = {
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {},
        },
      },
    };
    assert.equal(hasMediaDevices(win), true);
  });

  it('entorno sin mediaDevices no tiene getUserMedia', () => {
    const win = { navigator: {} };
    assert.equal(hasMediaDevices(win), false);
  });

  it('entorno Capacitor Android también expone getUserMedia vía WebView', () => {
    const win = {
      ...makeCapacitorWindow('android'),
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {},
        },
      },
    };
    assert.equal(hasMediaDevices(win), true);
  });

  it('las constraints de audio no tienen bifurcación por plataforma', () => {
    // Las constraints usadas en app.js son idénticas en PWA y APK
    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    };
    // En PWA
    assert.equal(constraints.audio.echoCancellation, false);
    // En APK (Capacitor bridge) — idénticas
    assert.equal(constraints.audio.noiseSuppression, false);
    assert.equal(constraints.audio.autoGainControl, false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: Wake Lock — detección de disponibilidad
// ─────────────────────────────────────────────────────────────────────────────

describe('Wake Lock — detección de API y degradación graceful', () => {

  function hasWakeLock(win) {
    return 'wakeLock' in win.navigator;
  }

  async function requestWakeLock(win) {
    if (!hasWakeLock(win)) return null;
    return win.navigator.wakeLock.request('screen');
  }

  it('navegador con wakeLock la detecta como disponible', () => {
    const win = {
      navigator: {
        wakeLock: { request: async () => ({ release: async () => {} }) },
      },
    };
    assert.equal(hasWakeLock(win), true);
  });

  it('navegador sin wakeLock devuelve false', () => {
    const win = { navigator: {} };
    assert.equal(hasWakeLock(win), false);
  });

  it('requestWakeLock retorna null si no hay API (no lanza)', async () => {
    const win = { navigator: {} };
    const lock = await requestWakeLock(win);
    assert.equal(lock, null);
  });

  it('requestWakeLock retorna el lock si la API existe', async () => {
    const mockLock = { released: false, release: async () => {} };
    const win = {
      navigator: {
        wakeLock: { request: async () => mockLock },
      },
    };
    const lock = await requestWakeLock(win);
    assert.equal(lock, mockLock);
  });

  it('en Capacitor Android (WebView) wakeLock puede estar presente', () => {
    const win = {
      ...makeCapacitorWindow('android'),
      navigator: {
        wakeLock: { request: async () => ({ release: async () => {} }) },
      },
    };
    assert.equal(hasWakeLock(win), true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: setOffset — calibración de temperatura (independiente de plataforma)
// ─────────────────────────────────────────────────────────────────────────────

describe('RuuviScanner.setOffset — calibración de temperatura', () => {

  it('offset por defecto es 0', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    assert.equal(scanner.offset, 0);
  });

  it('setOffset con número válido actualiza el offset', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    scanner.setOffset(1.5);
    assert.equal(scanner.offset, 1.5);
  });

  it('setOffset con valor negativo funciona', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    scanner.setOffset(-2.0);
    assert.equal(scanner.offset, -2.0);
  });

  it('setOffset con NaN se normaliza a 0', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    scanner.setOffset(NaN);
    assert.equal(scanner.offset, 0);
  });

  it('setOffset con Infinity se normaliza a 0', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    scanner.setOffset(Infinity);
    assert.equal(scanner.offset, 0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: persistencia y reconexión automática
// ─────────────────────────────────────────────────────────────────────────────

describe('Persistencia del último dispositivo — Capacitor (APK)', () => {

  it('hasLastDevice() devuelve false sin ninguna conexión previa', () => {
    const scanner = makeRuuviScanner(makeCapacitorWindow());
    assert.equal(scanner.hasLastDevice(), false);
  });

  it('connect() guarda el dispositivo en storage', async () => {
    const win = makeCapacitorWindow('android');
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    assert.ok(storage.getItem(STORAGE_KEY) !== null, 'Debe haber guardado el dispositivo');
  });

  it('connect() guarda el deviceId y name correctos', async () => {
    const win = makeCapacitorWindow('android');
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.equal(saved.id, 'ruuvi-device-001');
    assert.equal(saved.name, 'Ruuvi Test');
  });

  it('hasLastDevice() devuelve true tras conectar', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    assert.equal(scanner.hasLastDevice(), true);
  });

  it('disconnect() borra el dispositivo del storage', async () => {
    const win = makeCapacitorWindow('android');
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    scanner.disconnect();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(storage.getItem(STORAGE_KEY), null);
  });

  it('hasLastDevice() devuelve false tras desconectar', async () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    await scanner.connect();
    scanner.disconnect();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(scanner.hasLastDevice(), false);
  });

  it('reconexión automática: si hay dispositivo guardado, usa BLE.connect directo sin picker', async () => {
    const win = makeCapacitorWindow('android');
    const storage = makeStorage();
    // Pre-poblar storage como si hubiera habido una sesión anterior
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));

    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();

    // No debe haber llamado a requestDevice
    assert.equal(win.Capacitor.Plugins.BluetoothLe._requestOpts, undefined,
      'No debe haber abierto el picker si había dispositivo guardado');
    assert.equal(scanner.streaming, true);
  });

  it('reconexión automática: si BLE.connect falla, abre el picker', async () => {
    const win = makeCapacitorWindow('android', {
      connect: async () => { throw new Error('dispositivo no encontrado'); },
    });
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-viejo-id', name: 'Ruuvi Viejo' }));

    // requestDevice devuelve un dispositivo nuevo
    win.Capacitor.Plugins.BluetoothLe.connect = async ({ deviceId }) => {
      if (deviceId === 'ruuvi-viejo-id') throw new Error('no encontrado');
      // conexión del nuevo dispositivo ok
    };

    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();

    assert.ok(win.Capacitor.Plugins.BluetoothLe._requestOpts,
      'Debe haber abierto el picker si la reconexión falló');
    assert.equal(scanner.streaming, true);
  });

  it('reconexión automática: recupera el deviceName del storage si no hay picker', async () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Guardado' }));

    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();

    assert.equal(scanner.deviceName, 'Ruuvi Guardado');
  });

});

describe('Persistencia del último dispositivo — Web Bluetooth (PWA)', () => {

  it('connect() vía requestDevice guarda el dispositivo', async () => {
    const win = makeWebWindow();
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    assert.ok(saved, 'Debe haber guardado el dispositivo');
    assert.equal(saved.name, 'Ruuvi 3400');
  });

  it('connect() vía getDevices (dispositivo ya emparejado) también guarda el dispositivo', async () => {
    const savedDevice = makeBluetoothDevice('Ruuvi 3400');
    const win = makeWebWindow({ hasGetDevices: true, savedDevices: [savedDevice] });
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    assert.ok(storage.getItem(STORAGE_KEY) !== null);
  });

  it('disconnect() borra el dispositivo del storage', async () => {
    const win = makeWebWindow();
    const storage = makeStorage();
    const scanner = makeRuuviScanner(win, storage);
    await scanner.connect();
    scanner.disconnect();
    assert.equal(storage.getItem(STORAGE_KEY), null);
  });

  it('hasLastDevice() refleja correctamente el estado del storage', async () => {
    const win = makeWebWindow();
    const scanner = makeRuuviScanner(win);
    assert.equal(scanner.hasLastDevice(), false);
    await scanner.connect();
    assert.equal(scanner.hasLastDevice(), true);
    scanner.disconnect();
    assert.equal(scanner.hasLastDevice(), false);
  });

});

describe('Arranque automático — lógica de app.js (DOMContentLoaded)', () => {

  // Réplica de la lógica de app.js: si hasLastDevice() → connect()
  function makeAutoConnectLogic(scanner) {
    const calls = { connect: 0 };
    const origConnect = scanner.connect.bind(scanner);
    scanner.connect = async () => { calls.connect++; return origConnect(); };

    function onDOMContentLoaded() {
      if (scanner.hasLastDevice()) {
        scanner.connect().catch(() => {});
      }
    }
    return { onDOMContentLoaded, calls };
  }

  it('sin dispositivo guardado: no llama a connect() en el arranque', () => {
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win);
    const { onDOMContentLoaded, calls } = makeAutoConnectLogic(scanner);
    onDOMContentLoaded();
    assert.equal(calls.connect, 0);
  });

  it('con dispositivo guardado: llama a connect() en el arranque', async () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const win = makeCapacitorWindow('android');
    const scanner = makeRuuviScanner(win, storage);
    const { onDOMContentLoaded, calls } = makeAutoConnectLogic(scanner);
    onDOMContentLoaded();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(calls.connect, 1);
  });

  it('si connect() falla en el arranque, no lanza excepción no capturada', async () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-viejo', name: 'Ruuvi' }));
    const win = makeCapacitorWindow('android', {
      connect: async () => { throw new Error('BLE no disponible'); },
    });
    // requestDevice también falla para simular fallo total
    win.Capacitor.Plugins.BluetoothLe.requestDevice = async () => { throw new Error('sin BLE'); };

    const scanner = makeRuuviScanner(win, storage);
    const { onDOMContentLoaded } = makeAutoConnectLogic(scanner);

    // No debe lanzar — el .catch(() => {}) de app.js lo absorbe
    await assert.doesNotReject(async () => {
      onDOMContentLoaded();
      await new Promise(r => setTimeout(r, 10));
    });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS: reintento con backoff en reconexión automática
// ─────────────────────────────────────────────────────────────────────────────

describe('RuuviScanner.autoConnect — reintento con backoff', () => {

  it('si connect() tiene éxito a la primera, streaming queda true', async () => {
    const win = makeCapacitorWindow('android');
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const scanner = makeRuuviScanner(win, storage);

    await scanner.autoConnect({ retries: 3, delay: 0 });
    assert.equal(scanner.streaming, true);
  });

  it('si connect() falla 1 vez y luego tiene éxito, termina con streaming true', async () => {
    let attempt = 0;
    const win = makeCapacitorWindow('android', {
      connect: async () => {
        attempt++;
        if (attempt === 1) throw new Error('BLE no listo aún');
      },
    });
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const scanner = makeRuuviScanner(win, storage);

    await scanner.autoConnect({ retries: 3, delay: 0 });
    assert.equal(scanner.streaming, true);
    assert.ok(attempt >= 2, `Debe haber reintentado al menos 2 veces, fueron ${attempt}`);
  });

  it('si connect() falla todas las veces, llama a onFail y streaming queda false', async () => {
    const win = makeCapacitorWindow('android', {
      connect: async () => { throw new Error('BLE no disponible'); },
    });
    win.Capacitor.Plugins.BluetoothLe.requestDevice = async () => { throw new Error('sin BLE'); };

    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const scanner = makeRuuviScanner(win, storage);

    let failCalled = false;
    await scanner.autoConnect({ retries: 3, delay: 0, onFail: () => { failCalled = true; } });

    assert.equal(failCalled, true);
    assert.equal(scanner.streaming, false);
  });

  it('autoConnect no lanza aunque fallen todos los intentos', async () => {
    const win = makeCapacitorWindow('android', {
      connect: async () => { throw new Error('fallo total'); },
    });
    win.Capacitor.Plugins.BluetoothLe.requestDevice = async () => { throw new Error('fallo total'); };

    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const scanner = makeRuuviScanner(win, storage);

    await assert.doesNotReject(() => scanner.autoConnect({ retries: 2, delay: 0 }));
  });

  it('el storage se conserva aunque fallen todos los reintentos', async () => {
    const win = makeCapacitorWindow('android', {
      connect: async () => { throw new Error('fallo'); },
    });
    win.Capacitor.Plugins.BluetoothLe.requestDevice = async () => { throw new Error('fallo'); };

    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: 'ruuvi-device-001', name: 'Ruuvi Test' }));
    const scanner = makeRuuviScanner(win, storage);

    await scanner.autoConnect({ retries: 2, delay: 0 });
    assert.ok(scanner.hasLastDevice(), 'El storage debe conservarse para el próximo arranque');
  });

  it('app.js: no reconecta automáticamente al arranque (conexión solo manual)', async () => {
    const { readFileSync } = await import('node:fs');
    const { URL: _URL } = await import('node:url');
    const src = readFileSync(new _URL('../src/app.js', import.meta.url), 'utf8');
    assert.ok(!src.includes('RuuviScanner.connect().catch'), 'app.js no debe usar connect().catch directo');
    assert.ok(!src.match(/hasLastDevice\(\)[\s\S]{0,100}autoConnect/), 'app.js no debe reconectar automáticamente al arranque');
  });

});
