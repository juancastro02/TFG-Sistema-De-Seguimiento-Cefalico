#!/usr/bin/env bash
set -euo pipefail

echo "🎤 Configurando sistema de comandos de voz..."

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)

# 1. Verificar dependencias
echo "➡️ Verificando dependencias..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "✓ macOS detectado"
  
  # Verificar Homebrew
  if ! command -v brew >/dev/null 2>&1; then
    echo -e "${RED}❌ Homebrew no está instalado${NC}"
    echo "Instala Homebrew desde: https://brew.sh"
    exit 1
  fi
  
  # Verificar herramientas de compilación
  if ! command -v make >/dev/null 2>&1; then
    echo "➡️ Instalando herramientas de compilación..."
    xcode-select --install || true
  fi
  
  # Instalar sox (opcional pero recomendado)
  if ! command -v sox >/dev/null 2>&1; then
    echo "➡️ Instalando sox para procesamiento de audio..."
    brew install sox
  fi

  # Instalar SDL2 (requerido para whisper-stream)
  if ! brew list sdl2 >/dev/null 2>&1; then
    echo "➡️ Instalando SDL2 (requerido para streaming de audio)..."
    brew install sdl2
  else
    echo "✓ SDL2 encontrado"
  fi
else
  echo -e "${RED}❌ Solo macOS está soportado actualmente${NC}"
  exit 1
fi

# 2. Compilar whisper.cpp
echo "➡️ Compilando whisper.cpp..."

if [ ! -d "whisper.cpp" ]; then
  echo -e "${RED}❌ Directorio whisper.cpp no encontrado${NC}"
  exit 1
fi

cd whisper.cpp

# Limpiar build anterior si existe
if [ -d "build" ]; then
  echo "🗑️ Limpiando build anterior..."
  rm -rf build
fi

# Crear directorio de build
mkdir -p build
cd build

# Configurar con CMake (incluimos soporte SDL2 para streaming)
echo "⚙️ Configurando con CMake..."
cmake .. \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_COREML=OFF \
  -DWHISPER_METAL=ON \
  -DGGML_METAL=ON \
  -DWHISPER_SDL2=ON

# Compilar
echo "🔨 Compilando (esto puede tardar unos minutos)..."
cmake --build . --config Release -j 4

# Detectar binario de streaming
HF_STREAM_BIN_REL=""

if [ -f "bin/whisper-stream" ]; then
  HF_STREAM_BIN_REL="bin/whisper-stream"
elif [ -f "bin/stream" ]; then
  HF_STREAM_BIN_REL="bin/stream"
fi

if [ -z "${HF_STREAM_BIN_REL}" ]; then
  echo -e "${RED}❌ Error: No se compiló ningún binario de streaming (ni 'whisper-stream' ni 'stream')${NC}"
  echo "Revisá el log de CMake para ver si encontró SDL2 correctamente."
  exit 1
fi

# Crear symlink de compatibilidad 'stream' -> 'whisper-stream' si hace falta
if [ "${HF_STREAM_BIN_REL}" = "bin/whisper-stream" ] && [ ! -f "bin/stream" ]; then
  echo "🔗 Creando alias 'bin/stream' -> 'bin/whisper-stream' para compatibilidad..."
  (cd bin && ln -sf whisper-stream stream)
fi

echo -e "${GREEN}✓ whisper.cpp compilado correctamente (${HF_STREAM_BIN_REL})${NC}"

# 3. Descargar modelo
cd "$ROOT_DIR"
echo "➡️ Descargando modelo de Whisper..."

mkdir -p models

# Descargar modelo base (español / multi) en formato ggml
if [ ! -f "models/ggml-base.bin" ]; then
  echo "📥 Descargando ggml-base.bin..."
  cd models
  curl -L -O https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
  cd ..
  echo -e "${GREEN}✓ Modelo descargado${NC}"
else
  echo "✓ Modelo ya existe"
fi

# 4. Probar configuración
echo ""
echo "🧪 Probando configuración..."

STREAM_BIN_PATH="./whisper.cpp/build/${HF_STREAM_BIN_REL}"

if "${STREAM_BIN_PATH}" -h > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Whisper (streaming) funciona correctamente${NC}"
else
  echo -e "${YELLOW}⚠️ Advertencia: El binario de streaming se compiló, pero el test -h falló${NC}"
fi

# 5. Instrucciones finales
echo ""
echo -e "${GREEN}✅ Configuración completada${NC}"
echo ""
echo "📋 Comandos de voz disponibles:"
echo "   • 'click' o 'clic' → Click izquierdo"
echo "   • 'doble' → Doble click"
echo "   • 'derecha' o 'menú' → Click derecho"
echo "   • 'arriba' o 'subir' → Scroll arriba"
echo "   • 'abajo' o 'bajar' → Scroll abajo"
echo "   • 'pausar' → Pausar sistema"
echo "   • 'continuar' → Reanudar sistema"
echo ""
echo "🎤 Asegúrate de dar permisos de micrófono a la app en:"
echo "   Preferencias del Sistema → Privacidad y Seguridad → Micrófono"
echo ""
