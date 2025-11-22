#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PY_BIN="${PYTHON_BIN:-python3}"
mkdir -p py
$PY_BIN -m venv py/.venv
source py/.venv/bin/activate
pip install --upgrade pip
pip install pyobjc-framework-Quartz
echo "✅ Listo. Da permiso de Accesibilidad al intérprete: $(which python3)"
