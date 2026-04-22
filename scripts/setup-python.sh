#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PY_BIN="${PYTHON_BIN:-python3}"
OS_NAME="$(uname -s)"

echo "➡️ Creando venv en py/.venv con ${PY_BIN}"
mkdir -p py
"${PY_BIN}" -m venv py/.venv

echo "➡️ Activando venv e instalando dependencias de Python"
# shellcheck source=/dev/null
source py/.venv/bin/activate
pip install --upgrade pip wheel
pip install -r py/requirements.txt

echo "✅ Entorno Python listo"

if [[ "${OS_NAME}" == "Darwin" ]]; then
  echo "ℹ️ macOS: da permiso de Accesibilidad al interprete:"
  which python3
fi

if [[ "${OS_NAME}" == "Linux" ]]; then
  echo "ℹ️ Ubuntu/Debian: asegurate de tener estos paquetes del sistema:"
  echo "   sudo apt install python3-venv python3-dev python3-tk scrot libxtst-dev libx11-dev"
  echo "ℹ️ Opcional para pruebas alternativas del mouse global:"
  echo "   sudo apt install xdotool"
  echo "ℹ️ Para control global del mouse se recomienda iniciar sesion en X11/XWayland."
fi
