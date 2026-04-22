#!/usr/bin/env bash
set -euo pipefail

echo "🎤 Configurando sistema de comandos de voz..."

cd "$(dirname "$0")/.."
ROOT_DIR="$(pwd)"
OS_NAME="$(uname -s)"

if [[ ! -d whisper.cpp ]] || [[ -z "$(find whisper.cpp -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
  echo "❌ El directorio whisper.cpp esta vacio."
  echo "   Clona whisper.cpp dentro de ./whisper.cpp antes de ejecutar este script."
  exit 1
fi

if ! command -v cmake >/dev/null 2>&1; then
  echo "❌ Falta cmake."
  exit 1
fi

if [[ "${OS_NAME}" == "Darwin" ]]; then
  echo "ℹ️ macOS: si falta SDL2 o sox, instalalos con Homebrew:"
  echo "   brew install sdl2 sox"
  CMAKE_ARGS=(
    -DCMAKE_BUILD_TYPE=Release
    -DWHISPER_COREML=OFF
    -DWHISPER_METAL=ON
    -DGGML_METAL=ON
    -DWHISPER_SDL2=ON
  )
elif [[ "${OS_NAME}" == "Linux" ]]; then
  echo "ℹ️ Ubuntu/Debian: instala antes los paquetes del sistema:"
  echo "   sudo apt install build-essential cmake pkg-config libsdl2-dev libasound2-dev curl"
  CMAKE_ARGS=(
    -DCMAKE_BUILD_TYPE=Release
    -DWHISPER_COREML=OFF
    -DWHISPER_METAL=OFF
    -DGGML_METAL=OFF
    -DWHISPER_SDL2=ON
  )
else
  echo "❌ Sistema operativo no soportado por este script: ${OS_NAME}"
  exit 1
fi

echo "➡️ Compilando whisper.cpp..."
cd whisper.cpp
rm -rf build
mkdir -p build
cd build

cmake .. "${CMAKE_ARGS[@]}"
cmake --build . --config Release -j 4

HF_STREAM_BIN_REL=""
if [[ -f bin/whisper-stream ]]; then
  HF_STREAM_BIN_REL="bin/whisper-stream"
elif [[ -f bin/stream ]]; then
  HF_STREAM_BIN_REL="bin/stream"
fi

if [[ -z "${HF_STREAM_BIN_REL}" ]]; then
  echo "❌ No se genero ningun binario de streaming."
  exit 1
fi

if [[ "${HF_STREAM_BIN_REL}" == "bin/whisper-stream" && ! -f bin/stream ]]; then
  (cd bin && ln -sf whisper-stream stream)
fi

cd "${ROOT_DIR}"
mkdir -p models

if [[ ! -f models/ggml-base.bin ]]; then
  echo "📥 Descargando modelo ggml-base.bin..."
  curl -L -o models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
else
  echo "✓ Modelo base ya existe"
fi

if [[ ! -f models/ggml-large-v3-turbo.bin ]]; then
  echo "📥 Descargando modelo ggml-large-v3-turbo.bin..."
  curl -L -o models/ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
else
  echo "✓ Modelo large ya existe"
fi

echo "✅ Voz lista"
echo "   Binario: ./whisper.cpp/build/${HF_STREAM_BIN_REL}"
echo "   Modelos: ./models/ggml-base.bin y ./models/ggml-large-v3-turbo.bin"
