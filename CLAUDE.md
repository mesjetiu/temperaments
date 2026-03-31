# Salinas — instrucciones para Claude Code

## Deploy obligatorio con deploy.sh

**Siempre** usar `./deploy.sh "mensaje"` para publicar cambios, nunca hacer commit+push manual.

El script hace tres cosas imprescindibles para que la PWA se actualice:
1. Estampa el hash actual en `docs/sw.js` → `const CACHE = 'temp-<hash>'`
2. Estampa el hash y fecha en `docs/index.html` → `const APP_VERSION = '<hash> · <fecha>'`
3. Commitea ambos ficheros y hace push

```bash
./deploy.sh "descripción del cambio"
```

### Por qué es crítico

El navegador detecta un SW nuevo comparando `sw.js` byte a byte.
Si `sw.js` no cambia → no se instala nuevo SW → la PWA nunca se actualiza,
aunque `index.html` haya cambiado.

Sin el script, el usuario solo ve la nueva versión desinstalando y reinstalando la PWA.
