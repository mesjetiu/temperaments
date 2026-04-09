'use strict';
const { contextBridge } = require('electron');

// Expone una señal mínima al renderer para que el código de la app
// pueda detectar el entorno Electron si lo necesita en el futuro.
contextBridge.exposeInMainWorld('__ELECTRON__', true);
