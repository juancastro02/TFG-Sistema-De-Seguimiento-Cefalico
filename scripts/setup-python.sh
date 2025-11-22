#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PY_BIN="${PYTHON_BIN:-python3}"

echo "➡️ Creando venv en py/.venv con ${PY_BIN}"
mkdir -p py
$PY_BIN -m venv py/.venv

echo "➡️ Activando venv e instalando dependencias"
# shellcheck source=/dev/null
source py/.venv/bin/activate
pip install --upgrade pip wheel
pip install -r py/requirements.txt

echo "✅ Listo. En macOS, da permiso de Accesibilidad al intérprete:"
which python3

echo "ℹ️ Si tu app no puede controlar el mouse, abrí:"
echo "   Preferencias del Sistema → Seguridad y privacidad → Accesibilidad"
echo "   y agregá el binario anterior."
