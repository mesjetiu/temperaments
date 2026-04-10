// ── RuuviScanner — integración BLE con RuuviTag Data Format 5 ──
//
// En Android (APK Capacitor) usa @capacitor-community/bluetooth-le.
// En navegador usa Web Bluetooth API (Chrome con flag o Chrome Android).
//
// Uso:
//   await RuuviScanner.connect()          → conecta y empieza notificaciones
//   RuuviScanner.disconnect()
//   RuuviScanner.setOffset(n)             → offset de calibración en °C
//   RuuviScanner.onTemperature = cb       → callback(tempCelsius) cada lectura
//   RuuviScanner.streaming                → true si hay conexión activa

window.RuuviScanner = (() => {

  const RUUVI_SERVICE     = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RUUVI_CHAR_TX     = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const RUUVI_NAME_PREFIX = 'Ruuvi';

  let _streaming  = false;
  let _savedName  = null;
  let _savedId    = null;   // deviceId para BLEClient
  let _offset     = 0;
  let _cb         = null;

  // ── Detección de entorno ─────────────────────────────────────────────────
  // En la WebView del APK, Capacitor.getPlatform() devuelve "android" o "ios".
  // En el navegador devuelve "web" o Capacitor no existe.
  function _isCapacitor() {
    const platform = window.Capacitor?.getPlatform?.();
    return platform === 'android' || platform === 'ios';
  }

  // ── Parser RAW v5 ────────────────────────────────────────────────────────
  function _parseRawV5(buffer) {
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

  function _hexToBuffer(hex) {
    const bytes = hex.match(/.{1,2}/g) || [];
    const buf = new ArrayBuffer(bytes.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) u8[i] = parseInt(bytes[i], 16);
    return buf;
  }

  function _notifyStatus(status) {
    if (typeof window.RuuviScanner?.onStatus === 'function') window.RuuviScanner.onStatus(status);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RAMA CAPACITOR (Android nativo)
  // ══════════════════════════════════════════════════════════════════════════

  function _getBleClient() {
    // Capacitor registra los plugins en window.Capacitor.Plugins
    const mod = window.Capacitor?.Plugins?.BluetoothLe;
    if (!mod) throw new Error('Plugin BLE de Capacitor no disponible.');
    return mod;
  }

  let _capListeners = [];

  async function _connectCapacitor() {
    const BLE = _getBleClient();

    await BLE.initialize({ androidNeverForLocation: true });

    const device = await BLE.requestDevice({
      services: [RUUVI_SERVICE],
      namePrefix: RUUVI_NAME_PREFIX,
    });

    _savedId   = device.deviceId;
    _savedName = device.name ?? device.deviceId;

    // Escuchar desconexión inesperada
    const disconnectKey = `disconnected|${_savedId}`;
    const disconnectListener = await BLE.addListener(disconnectKey, () => {
      _streaming = false;
      _notifyStatus('disconnected');
      console.log('[Ruuvi] disconnected (Capacitor BLE)');
    });
    _capListeners.push(disconnectListener);

    await BLE.connect({ deviceId: _savedId });

    // Suscribir notificaciones
    const notifKey = `notification|${_savedId}|${RUUVI_SERVICE}|${RUUVI_CHAR_TX}`;
    const notifListener = await BLE.addListener(notifKey, (event) => {
      // El valor llega como hex string desde el plugin nativo
      const raw = event?.value;
      const buf = (typeof raw === 'string') ? _hexToBuffer(raw) : (raw?.buffer ?? raw);
      const tempC = _parseRawV5(buf);
      if (tempC === null) return;
      if (typeof _cb === 'function') _cb(tempC + _offset);
    });
    _capListeners.push(notifListener);

    await BLE.startNotifications({ deviceId: _savedId, service: RUUVI_SERVICE, characteristic: RUUVI_CHAR_TX });

    _streaming = true;
    _notifyStatus('connected');
    console.log('[Ruuvi] Capacitor BLE connected, notifications started');
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
    _notifyStatus('disconnected');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RAMA WEB BLUETOOTH
  // ══════════════════════════════════════════════════════════════════════════

  let _wbDevice = null;
  let _wbChar   = null;
  let _wbServer = null;

  function _onWbNotification(event) {
    const buf   = event.target.value.buffer;
    const tempC = _parseRawV5(buf);
    if (tempC === null) return;
    if (typeof _cb === 'function') _cb(tempC + _offset);
  }

  async function _connectGatt() {
    _wbServer = await _wbDevice.gatt.connect();
    const svc = await _wbServer.getPrimaryService(RUUVI_SERVICE);
    _wbChar   = await svc.getCharacteristic(RUUVI_CHAR_TX);
    _wbChar.addEventListener('characteristicvaluechanged', _onWbNotification);
    await _wbChar.startNotifications();
    _streaming = true;
    _notifyStatus('connected');
    console.log('[Ruuvi] GATT connected, notifications started');
  }

  async function _onWbDisconnected() {
    _streaming = false;
    _wbChar   = null;
    _wbServer = null;
    _notifyStatus('disconnected');
    console.log('[Ruuvi] disconnected, retrying in 2s...');
    await new Promise(r => setTimeout(r, 2000));
    if (_wbDevice?.gatt) {
      try { await _connectGatt(); } catch (_) {}
    }
  }

  async function _connectWebBluetooth() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth no disponible en este navegador.');

    if (navigator.bluetooth.getDevices) {
      try {
        const devices = await navigator.bluetooth.getDevices();
        const ruuvi = devices.find(d => d.name?.startsWith(RUUVI_NAME_PREFIX));
        if (ruuvi) {
          _wbDevice = ruuvi;
          _savedName = ruuvi.name;
          _wbDevice.addEventListener('gattserverdisconnected', _onWbDisconnected);
          await _connectGatt();
          return;
        }
      } catch (_) {}
    }

    _wbDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
      optionalServices: [RUUVI_SERVICE],
    });
    _savedName = _wbDevice.name;
    _wbDevice.addEventListener('gattserverdisconnected', _onWbDisconnected);
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
    _notifyStatus('disconnected');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ══════════════════════════════════════════════════════════════════════════

  return {
    get streaming()  { return _streaming; },
    get deviceName() { return _savedName ?? null; },

    set onTemperature(cb) { _cb = cb; },
    get onTemperature()   { return _cb; },

    onStatus: null,

    get offset() { return _offset; },
    setOffset(n) { _offset = isFinite(n) ? n : 0; },

    async connect() {
      if (_isCapacitor()) {
        await _connectCapacitor();
      } else {
        await _connectWebBluetooth();
      }
    },

    disconnect() {
      if (_isCapacitor()) {
        _disconnectCapacitor();
      } else {
        _disconnectWebBluetooth();
      }
    },
  };
})();
