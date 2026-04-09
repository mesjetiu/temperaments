// ── RuuviScanner — integración BLE con RuuviTag Data Format 5 ──
// Web Bluetooth API (Chrome Android / Chrome desktop con flag)
//
// Lee temperatura via notificaciones GATT sobre el servicio UART Nordic.
// RuuviTag en modo RAW v5 envía el payload por esta característica.
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

  let _device    = null;
  let _server    = null;
  let _char      = null;
  let _streaming = false;
  let _savedName = null;
  let _offset    = 0;
  let _cb        = null;

  // ── Parser RAW v5 ────────────────────────────────────────────────────────
  // Busca el byte 0x05 en cualquier posición del buffer.
  // Bytes siguientes: temp int16 big-endian × 0.005 °C
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

  // ── Notificación GATT ────────────────────────────────────────────────────
  function _onNotification(event) {
    const buf = event.target.value.buffer;
    const dv  = new DataView(buf);

    // Log para diagnóstico: mostrar bytes en hex
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    console.log('[Ruuvi] notification bytes:', hex);

    const tempC = _parseRawV5(buf);
    console.log('[Ruuvi] tempC parsed:', tempC, '| _cb:', typeof _cb);

    if (tempC === null) return;
    if (typeof _cb === 'function') _cb(tempC + _offset);
  }

  // ── Conectar GATT ────────────────────────────────────────────────────────
  async function _connectGatt() {
    _server = await _device.gatt.connect();
    const svc = await _server.getPrimaryService(RUUVI_SERVICE);
    _char = await svc.getCharacteristic(RUUVI_CHAR_TX);
    _char.addEventListener('characteristicvaluechanged', _onNotification);
    await _char.startNotifications();
    _streaming = true;
    _notifyStatus('connected');
    console.log('[Ruuvi] GATT connected, notifications started');
  }

  // ── Desconexión inesperada ────────────────────────────────────────────────
  async function _onDisconnected() {
    _streaming = false;
    _char = null;
    _server = null;
    _notifyStatus('disconnected');
    console.log('[Ruuvi] disconnected, retrying in 2s...');
    await new Promise(r => setTimeout(r, 2000));
    if (_device?.gatt) {
      try { await _connectGatt(); } catch (_) {}
    }
  }

  function _notifyStatus(status) {
    if (typeof window.RuuviScanner?.onStatus === 'function') window.RuuviScanner.onStatus(status);
  }

  return {
    get streaming() { return _streaming; },
    get deviceName() { return _device?.name ?? _savedName ?? null; },

    set onTemperature(cb) { _cb = cb; },
    get onTemperature()   { return _cb; },

    onStatus: null,

    get offset() { return _offset; },
    setOffset(n) { _offset = isFinite(n) ? n : 0; },

    async connect() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth no disponible en este navegador.');

      // Intentar reconexión silenciosa
      if (navigator.bluetooth.getDevices) {
        try {
          const devices = await navigator.bluetooth.getDevices();
          const ruuvi = devices.find(d => d.name?.startsWith(RUUVI_NAME_PREFIX));
          if (ruuvi) {
            _device = ruuvi;
            _savedName = ruuvi.name;
            _device.addEventListener('gattserverdisconnected', _onDisconnected);
            await _connectGatt();
            return;
          }
        } catch (_) {}
      }

      _device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
        optionalServices: [RUUVI_SERVICE],
      });
      _savedName = _device.name;
      _device.addEventListener('gattserverdisconnected', _onDisconnected);
      await _connectGatt();
    },

    disconnect() {
      _streaming = false;
      if (_char) {
        try { _char.stopNotifications(); } catch (_) {}
        _char.removeEventListener('characteristicvaluechanged', _onNotification);
        _char = null;
      }
      if (_device?.gatt?.connected) {
        try { _device.gatt.disconnect(); } catch (_) {}
      }
      _server = null;
      _notifyStatus('disconnected');
    },
  };
})();
