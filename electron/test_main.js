// Verificar que este script lo ejecuta el runtime de Electron
console.log('electron runtime version:', process.versions?.electron ?? 'N/A');
console.log('process.type:', process.type ?? 'undefined');

// Ver si 'electron' está en los módulos nativos del runtime
const nativeModuleNames = process.moduleLoadList?.filter(m => m.startsWith('NativeModule')) ?? [];
console.log('native modules con electron:', nativeModuleNames.filter(m => m.includes('lectron')));

setTimeout(() => process.exit(0), 300);
