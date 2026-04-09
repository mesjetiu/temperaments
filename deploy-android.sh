#!/usr/bin/env bash
# deploy-android.sh — Sync + build APK debug + instalar en dispositivo conectado
# Uso: ./deploy-android.sh [--logs]
#   --logs  muestra logcat filtrado por la app tras instalar
set -e

export JAVA_HOME="/usr/lib/jvm/java-25-openjdk"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/35.0.0:$PATH"

APK="android/app/build/outputs/apk/debug/app-debug.apk"
PKG="es.carlosguerra.salinas"

# Comprobar dispositivo conectado
if ! adb devices | grep -q "device$"; then
  echo "✗ No se detecta ningún dispositivo Android por USB"
  exit 1
fi

echo "→ Sincronizando web assets con Capacitor..."
npx cap sync android

echo "→ Compilando APK debug..."
cd android
./gradlew assembleDebug --quiet
cd ..

echo "→ Instalando en el dispositivo..."
adb install -r "$APK"

echo "✓ Instalado: $PKG"

# Lanzar la app automáticamente
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 && echo "✓ App lanzada"

# Mostrar logs si se pide --logs
if [[ "$1" == "--logs" ]]; then
  echo ""
  echo "── Logcat (Ctrl+C para salir) ──────────────────────"
  adb logcat --pid="$(adb shell pidof -s "$PKG")" 2>/dev/null \
    || adb logcat -s "Capacitor" "chromium" "AndroidRuntime" "*:E"
fi
