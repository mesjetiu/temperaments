// ── RuuviScanner — integración BLE con RuuviTag Data Format 5 ──
// Web Bluetooth API (Chrome Android / Chrome desktop con flag)
//
// Uso:
//   await RuuviScanner.connect()          → conecta y empieza notificaciones
//   RuuviScanner.disconnect()
//   RuuviScanner.setOffset(n)             → offset de calibración en °C
//   RuuviScanner.onTemperature = cb       → callback(tempCelsius) cada lectura
//   RuuviScanner.streaming                → true si hay conexión activa

window.RuuviScanner = (() => {

  // ── Constantes BLE RuuviTag ──────────────────────────────────────────────
  // Servicio UART Nordic (el único GATT que expone RuuviTag para lectura directa)
  const RUUVI_SERVICE    = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RUUVI_CHAR_TX    = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notificaciones → app
  // Filtro por nombre de fabricante para requestDevice
  const RUUVI_NAME_PREFIX = 'Ruuvi';

  // ── Estado interno ───────────────────────────────────────────────────────
  let _device    = null;
  let _server    = null;
  let _char      = null;
  let _offset    = 0;      // calibración manual °C
  let _streaming = false;
  let _savedName = null;   // para intentar reconexión automática

  // ── Callback público ─────────────────────────────────────────────────────
  // Asignar: RuuviScanner.onTemperature = (tempC) => { ... }
  let _cb = null;

  // ── Parser RAW v5 ────────────────────────────────────────────────────────
  // Data Format 5 spec: https://docs.ruuvi.com/communication/bluetooth-advertisements/data-format-5-rawv2
  // Los datos llegan como ArrayBuffer en la notificación GATT.
  // El payload RAW v5 empieza con 0x05.
  // Bytes 1-2 (offset 1 desde el 0x05): temperatura int16 big-endian, unidad 0.005 °C
  function _parseRawV5(buffer) {
    const dv = new DataView(buffer);
    // Buscar el byte 0x05 (puede que haya un header de 1-2 bytes según el FW)
    let start = -1;
    for (let i = 0; i < dv.byteLength - 2; i++) {
      if (dv.getUint8(i) === 0x05) { start = i; break; }
    }
    if (start < 0) return null;

    // Temperatura: bytes [start+1, start+2], signed int16 big-endian, × 0.005 °C
    if (start + 2 >= dv.byteLength) return null;
    const rawTemp = dv.getInt16(start + 1, false); // big-endian
    // Valor inválido: 0x8000
    if (rawTemp === -32768) return null;
    return rawTemp * 0.005;
  }

  // ── Manejo de notificación GATT ──────────────────────────────────────────
  function _onNotification(event) {
    const tempC = _parseRawV5(event.target.value.buffer);
    if (tempC === null) return;
    const adjusted = tempC + _offset;
    if (typeof _cb === 'function') _cb(adjusted);
  }

  // ── Manejo de desconexión inesperada ─────────────────────────────────────
  async function _onDisconnected() {
    _streaming = false;
    _char = null;
    _server = null;
    _notifyStatus('disconnected');
    // Intentar reconectar automáticamente si el usuario no desconectó
    if (_device && _device.gatt) {
      await _sleep(2000);
      try {
        await _reconnect();
      } catch (_) {
        // Fallo silencioso; el usuario puede reconectar manualmente desde el diálogo
      }
    }
  }

  async function _reconnect() {
    if (!_device) return;
    _notifyStatus('reconnecting');
    _server = await _device.gatt.connect();
    const svc  = await _server.getPrimaryService(RUUVI_SERVICE);
    _char = await svc.getCharacteristic(RUUVI_CHAR_TX);
    await _char.startNotifications();
    _char.addEventListener('characteristicvaluechanged', _onNotification);
    _streaming = true;
    _notifyStatus('connected');
  }

  // ── Utilidades ───────────────────────────────────────────────────────────
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function _notifyStatus(status) {
    if (typeof window.RuuviScanner?.onStatus === 'function') window.RuuviScanner.onStatus(status);
  }

  // ── API pública ──────────────────────────────────────────────────────────
  return {
    get streaming() { return _streaming; },
    get deviceName() { return _device?.name ?? _savedName ?? null; },

    /** Callback llamado con cada lectura: (tempCelsius: number) => void */
    set onTemperature(cb) { _cb = cb; },
    get onTemperature()   { return _cb; },

    /** Callback de estado: ('connected'|'disconnected'|'reconnecting') => void */
    onStatus: null,

    /** Offset de calibración en °C. Persiste a través de setOffset/getOffset. */
    get offset() { return _offset; },
    setOffset(n) {
      _offset = isFinite(n) ? n : 0;
    },

    /**
     * Abre el selector BLE y conecta al RuuviTag.
     * Si el navegador soporta getDevices() y ya hay un dispositivo autorizado,
     * intenta reconectar sin mostrar el picker.
     */
    async connect() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth no disponible en este navegador.');

      // Intentar reconexión silenciosa con dispositivo ya autorizado
      if (navigator.bluetooth.getDevices) {
        try {
          const devices = await navigator.bluetooth.getDevices();
          const ruuvi = devices.find(d => d.name?.startsWith(RUUVI_NAME_PREFIX));
          if (ruuvi) {
            _device = ruuvi;
            _device.addEventListener('gattserverdisconnected', _onDisconnected);
            await _reconnect();
            _savedName = _device.name;
            return;
          }
        } catch (_) { /* getDevices puede fallar, continuar con picker */ }
      }

      // Picker estándar
      _device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
        optionalServices: [RUUVI_SERVICE],
      });
      _savedName = _device.name;
      _device.addEventListener('gattserverdisconnected', _onDisconnected);
      await _reconnect();
    },

    /** Desconecta limpiamente. */
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
      // No limpiamos _device ni _savedName para permitir reconexión posterior
      _notifyStatus('disconnected');
    },
  };
})();
