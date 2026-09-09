#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace}"
COMFY_ROOT="${COMFY_ROOT:-${WORKSPACE_ROOT}/ComfyUI}"
STATE_ROOT="${FPAI_STATE_ROOT:-${WORKSPACE_ROOT}/fpai-state}"
SOURCE_COMFY="/opt/ComfyUI"

mkdir -p "${WORKSPACE_ROOT}" "${STATE_ROOT}" "${WORKSPACE_ROOT}/models/checkpoints"

if [ ! -d "${COMFY_ROOT}/.git" ]; then
  echo "Initializing persistent ComfyUI workspace..."
  cp -a "${SOURCE_COMFY}" "${COMFY_ROOT}"
fi

mkdir -p "${COMFY_ROOT}/input/fpai" "${COMFY_ROOT}/output" "${COMFY_ROOT}/models/checkpoints"

if [ -n "${SDXL_CHECKPOINT_URL:-}" ] && [ ! -f "${COMFY_ROOT}/models/checkpoints/sd_xl_base_1.0.safetensors" ]; then
  echo "Downloading configured SDXL checkpoint..."
  curl -fL --retry 5 --retry-delay 3 "${SDXL_CHECKPOINT_URL}" -o "${COMFY_ROOT}/models/checkpoints/sd_xl_base_1.0.safetensors.part"
  mv "${COMFY_ROOT}/models/checkpoints/sd_xl_base_1.0.safetensors.part" "${COMFY_ROOT}/models/checkpoints/sd_xl_base_1.0.safetensors"
fi

if [ -z "${FPAI_COMFY_API_KEY:-}" ]; then
  echo "FPAI_COMFY_API_KEY is required." >&2
  exit 1
fi

cd "${COMFY_ROOT}"
python main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch &
COMFY_PID=$!

cleanup() {
  kill "${COMFY_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    echo "ComfyUI is ready."
    break
  fi
  if ! kill -0 "${COMFY_PID}" 2>/dev/null; then
    echo "ComfyUI exited during startup." >&2
    exit 1
  fi
  sleep 1
  if [ "$i" -eq 120 ]; then
    echo "ComfyUI did not become ready in time." >&2
    exit 1
  fi
done

cd /opt/fpai
exec uvicorn proxy:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
