// ── RuuviScanner — integración BLE con RuuviTag Data Format 5 ──
// Web Bluetooth API (Chrome Android / Chrome desktop con flag)
//
// Estrategia de lectura:
//   RuuviTag transmite los datos RAW v5 en los advertisement packets BLE,
//   NO por notificaciones GATT. Usamos device.watchAdvertisements() para
//   recibirlos una vez que el dispositivo está autorizado.
//
// Uso:
//   await RuuviScanner.connect()          → autoriza y empieza a escuchar advertisements
//   RuuviScanner.disconnect()
//   RuuviScanner.setOffset(n)             → offset de calibración en °C
//   RuuviScanner.onTemperature = cb       → callback(tempCelsius) cada lectura
//   RuuviScanner.streaming                → true si hay conexión activa

window.RuuviScanner = (() => {

  // ── Constantes BLE RuuviTag ──────────────────────────────────────────────
  // Filtro por nombre de fabricante para requestDevice
  const RUUVI_NAME_PREFIX = 'Ruuvi';
  // Manufacturer ID de Ruuvi Innovations (0x0499)
  const RUUVI_MANUFACTURER_ID = 0x0499;

  // ── Estado interno ───────────────────────────────────────────────────────
  let _device    = null;
  let _streaming = false;
  let _savedName = null;

  // ── Callback público ─────────────────────────────────────────────────────
  let _cb = null;

  // ── Parser RAW v5 ────────────────────────────────────────────────────────
  // Data Format 5 spec: https://docs.ruuvi.com/communication/bluetooth-advertisements/data-format-5-rawv2
  // Los datos llegan como DataView en manufacturerData del advertisement.
  // El primer byte del payload del manufacturer es el data format: 0x05
  // Bytes 1-2: temperatura int16 big-endian, unidad 0.005 °C
  function _parseManufacturerData(dataView) {
    if (!dataView || dataView.byteLength < 3) return null;
    if (dataView.getUint8(0) !== 0x05) return null;

    const rawTemp = dataView.getInt16(1, false); // big-endian
    if (rawTemp === -32768) return null; // valor inválido
    return rawTemp * 0.005;
  }

  // ── Manejador de advertisement ───────────────────────────────────────────
  function _onAdvertisement(event) {
    let dataView = null;

    // manufacturerData es un Map<number, DataView>
    if (event.manufacturerData?.has(RUUVI_MANUFACTURER_ID)) {
      dataView = event.manufacturerData.get(RUUVI_MANUFACTURER_ID);
    } else if (event.manufacturerData?.size > 0) {
      // Fallback: tomar el primer entry (algunos FW no usan el ID oficial)
      dataView = event.manufacturerData.values().next().value;
    }

    if (!dataView) return;

    const tempC = _parseManufacturerData(dataView);
    if (tempC === null) return;

    const adjusted = tempC + (_offset ?? 0);
    if (typeof _cb === 'function') _cb(adjusted);
  }

  // ── Iniciar escucha de advertisements ────────────────────────────────────
  async function _startWatching() {
    if (!_device) return;
    _device.addEventListener('advertisementreceived', _onAdvertisement);
    await _device.watchAdvertisements();
    _streaming = true;
    _notifyStatus('connected');
  }

  // ── Detener escucha ──────────────────────────────────────────────────────
  function _stopWatching() {
    if (!_device) return;
    _device.removeEventListener('advertisementreceived', _onAdvertisement);
    try { _device.unwatchAdvertisements?.(); } catch (_) {}
    _streaming = false;
  }

  // ── Utilidades ───────────────────────────────────────────────────────────
  let _offset = 0;

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

    /** Offset de calibración en °C. */
    get offset() { return _offset; },
    setOffset(n) {
      _offset = isFinite(n) ? n : 0;
    },

    /**
     * Autoriza el dispositivo y empieza a escuchar advertisements.
     * Si ya hay un dispositivo autorizado (getDevices), reconecta sin picker.
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
            _savedName = _device.name;
            await _startWatching();
            return;
          }
        } catch (_) { /* continuar con picker */ }
      }

      // Picker estándar
      _device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: RUUVI_NAME_PREFIX }],
      });
      _savedName = _device.name;
      await _startWatching();
    },

    /** Desconecta limpiamente. */
    disconnect() {
      _stopWatching();
      _notifyStatus('disconnected');
    },
  };
})();
