// ── RuuviScanner — integración BLE con RuuviTag Data Format 5 ──
// Web Bluetooth API (Chrome Android / Chrome desktop con flag)
//
// Estrategia de lectura:
//   1. watchAdvertisements() si el navegador lo soporta (Chrome desktop 79+)
//   2. Fallback: polling GATT readValue() cada 10s sobre la característica TX
//
// Uso:
//   await RuuviScanner.connect()          → conecta y empieza a leer temperatura
//   RuuviScanner.disconnect()
//   RuuviScanner.setOffset(n)             → offset de calibración en °C
//   RuuviScanner.onTemperature = cb       → callback(tempCelsius) cada lectura
//   RuuviScanner.streaming                → true si hay conexión activa

window.RuuviScanner = (() => {

  // ── Constantes BLE RuuviTag ──────────────────────────────────────────────
  const RUUVI_SERVICE         = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RUUVI_CHAR_TX         = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const RUUVI_NAME_PREFIX     = 'Ruuvi';
  const RUUVI_MANUFACTURER_ID = 0x0499;
  const POLL_INTERVAL_MS      = 10_000; // 10 s entre lecturas GATT

  // ── Estado interno ───────────────────────────────────────────────────────
  let _device    = null;
  let _server    = null;
  let _char      = null;
  let _streaming = false;
  let _savedName = null;
  let _pollTimer = null;
  let _offset    = 0;

  // ── Callback público ─────────────────────────────────────────────────────
  let _cb = null;

  // ── Parser RAW v5 desde manufacturerData (watchAdvertisements) ───────────
  // El primer byte del payload manufacturer es el data format: 0x05
  // Bytes 1-2: temperatura int16 big-endian, unidad 0.005 °C
  function _parseManufacturerData(dataView) {
    if (!dataView || dataView.byteLength < 3) return null;
    if (dataView.getUint8(0) !== 0x05) return null;
    const rawTemp = dataView.getInt16(1, false);
    if (rawTemp === -32768) return null;
    return rawTemp * 0.005;
  }

  // ── Parser RAW v5 desde ArrayBuffer GATT (polling) ───────────────────────
  // La característica TX puede contener el mismo payload RAW v5.
  // Buscamos el byte 0x05 en el buffer por si hay cabecera previa.
  function _parseGattBuffer(buffer) {
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

  // ── Emitir temperatura ───────────────────────────────────────────────────
  function _emit(tempC) {
    if (typeof _cb === 'function') _cb(tempC + _offset);
  }

  // ── Modo 1: watchAdvertisements ───────────────────────────────────────────
  function _onAdvertisement(event) {
    let dv = null;
    if (event.manufacturerData?.has(RUUVI_MANUFACTURER_ID)) {
      dv = event.manufacturerData.get(RUUVI_MANUFACTURER_ID);
    } else if (event.manufacturerData?.size > 0) {
      dv = event.manufacturerData.values().next().value;
    }
    if (!dv) return;
    const tempC = _parseManufacturerData(dv);
    if (tempC !== null) _emit(tempC);
  }

  async function _startAdvertisements() {
    _device.addEventListener('advertisementreceived', _onAdvertisement);
    await _device.watchAdvertisements();
    _streaming = true;
    _notifyStatus('connected');
  }

  // ── Modo 2: polling GATT ──────────────────────────────────────────────────
  async function _connectGatt() {
    _server = await _device.gatt.connect();
    const svc = await _server.getPrimaryService(RUUVI_SERVICE);
    _char = await svc.getCharacteristic(RUUVI_CHAR_TX);
  }

  async function _pollOnce() {
    if (!_char || !_streaming) return;
    try {
      const value = await _char.readValue();
      const tempC = _parseGattBuffer(value.buffer);
      if (tempC !== null) _emit(tempC);
    } catch (e) {
      // Si el GATT se desconectó, detener polling
      if (!_device?.gatt?.connected) {
        _streaming = false;
        clearInterval(_pollTimer);
        _pollTimer = null;
        _notifyStatus('disconnected');
      }
    }
  }

  function _startPolling() {
    _streaming = true;
    _notifyStatus('connected');
    _pollOnce(); // lectura inmediata
    _pollTimer = setInterval(_pollOnce, POLL_INTERVAL_MS);
  }

  function _stopPolling() {
    clearInterval(_pollTimer);
    _pollTimer = null;
    if (_char) {
      _char = null;
    }
    if (_device?.gatt?.connected) {
      try { _device.gatt.disconnect(); } catch (_) {}
    }
    _server = null;
  }

  // ── Utilidades ───────────────────────────────────────────────────────────
  function _notifyStatus(status) {
    if (typeof window.RuuviScanner?.onStatus === 'function') window.RuuviScanner.onStatus(status);
  }

  async function _connectDevice(device) {
    _device = device;
    _savedName = device.name;

    // Intentar watchAdvertisements primero
    if (typeof _device.watchAdvertisements === 'function') {
      try {
        await _startAdvertisements();
        return;
      } catch (_) { /* fallback */ }
    }

    // Fallback: polling GATT
    await _connectGatt();
    _startPolling();
  }

  // ── API pública ──────────────────────────────────────────────────────────
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
          if (ruuvi) { await _connectDevice(ruuvi); return; }
        } catch (_) {}
      }

      // Picker estándar
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
        optionalServices: [RUUVI_SERVICE],
      });
      await _connectDevice(device);
    },

    disconnect() {
      _streaming = false;
      if (_pollTimer) {
        _stopPolling();
      } else if (_device) {
        _device.removeEventListener('advertisementreceived', _onAdvertisement);
        try { _device.unwatchAdvertisements?.(); } catch (_) {}
      }
      _notifyStatus('disconnected');
    },
  };
})();
