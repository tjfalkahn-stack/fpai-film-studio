#!/usr/bin/env bash
# FPAI Film Studio — RunPod ComfyUI bootstrap
#
# Installs the photoreal character-still stack onto the official
# runpod/comfyui:1.4.7-cuda13.0 Pod. Safe to rerun. Does not start
# generation. Does not enable Film Studio live flags.
#
# Usage (on the Pod, after cloning this repo or copying this directory):
#   bash deploy/runpod-comfyui/bootstrap.sh
#   bash deploy/runpod-comfyui/bootstrap.sh --verify-only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${ROOT}/models.manifest.json"
VERIFY_ONLY=0
UPDATE_NODES=0

for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=1 ;;
    --update-nodes) UPDATE_NODES=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "Missing model manifest: $MANIFEST" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to read ${MANIFEST}" >&2
  exit 1
fi

json_get() {
  python3 - "$MANIFEST" "$1" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
data = json.load(open(path, encoding="utf-8"))
cur = data
for part in key.split("."):
    if part.isdigit():
        cur = cur[int(part)]
    else:
        cur = cur[part]
if isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

file_size() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    echo 0
    return
  fi
  stat -c%s "$path" 2>/dev/null || stat -f%z "$path"
}

detect_comfy_root() {
  if [[ -n "${COMFYUI_PATH:-}" && -f "${COMFYUI_PATH}/main.py" ]]; then
    echo "$COMFYUI_PATH"
    return
  fi
  local candidate
  for candidate in \
    /workspace/ComfyUI \
    /workspace/runpod-slim/ComfyUI \
    /ComfyUI \
    /opt/ComfyUI \
    "$HOME/ComfyUI"
  do
    if [[ -f "${candidate}/main.py" ]]; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

ensure_dir() {
  mkdir -p "$1"
}

link_or_use() {
  local persist_path="$1"
  local comfy_path="$2"
  ensure_dir "$(dirname "$persist_path")"
  ensure_dir "$(dirname "$comfy_path")"
  if [[ -e "$comfy_path" || -L "$comfy_path" ]]; then
    return 0
  fi
  ln -s "$persist_path" "$comfy_path"
}

download_if_needed() {
  local url="$1"
  local dest="$2"
  local min_bytes="$3"
  local size
  size="$(file_size "$dest")"
  if [[ "$size" -ge "$min_bytes" ]]; then
    echo "SKIP $(basename "$dest") (${size} bytes already present)"
    return 0
  fi
  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    echo "MISSING $(basename "$dest") (have ${size}, need >= ${min_bytes})"
    return 1
  fi
  echo "DOWNLOAD $(basename "$dest")"
  ensure_dir "$(dirname "$dest")"
  local tmp="${dest}.part"
  local headers=()
  if [[ -n "${HF_TOKEN:-}" ]]; then
    headers+=(-H "Authorization: Bearer ${HF_TOKEN}")
  fi
  if [[ "$size" -gt 0 && -f "$dest" ]]; then
    mv "$dest" "$tmp"
  fi
  curl -L --fail --retry 8 --retry-delay 4 --retry-all-errors \
    -C - --progress-bar \
    "${headers[@]}" \
    -o "$tmp" "$url"
  size="$(file_size "$tmp")"
  if [[ "$size" -lt "$min_bytes" ]]; then
    echo "ERROR: $(basename "$dest") is ${size} bytes; expected at least ${min_bytes}." >&2
    exit 1
  fi
  mv "$tmp" "$dest"
  echo "OK $(basename "$dest") (${size} bytes)"
}

clone_node() {
  local repo="$1"
  local dest="$2"
  if [[ -d "$dest/.git" || -d "$dest" ]]; then
    if [[ "$UPDATE_NODES" -eq 1 && "$VERIFY_ONLY" -eq 0 && -d "$dest/.git" ]]; then
      echo "UPDATE $(basename "$dest")"
      git -C "$dest" fetch --depth 1 origin HEAD
      git -C "$dest" reset --hard FETCH_HEAD
    else
      echo "SKIP custom node $(basename "$dest") (already present)"
    fi
    return 0
  fi
  if [[ "$VERIFY_ONLY" -eq 1 ]]; then
    echo "MISSING custom node $(basename "$dest")"
    return 1
  fi
  echo "CLONE $repo"
  git clone --depth 1 "$repo" "$dest"
}

PERSIST_ROOT="${FPAI_COMFY_PERSIST:-/workspace/fpai-comfy}"
COMFY_ROOT="$(detect_comfy_root || true)"
if [[ -z "$COMFY_ROOT" ]]; then
  echo "Could not find ComfyUI (main.py). Set COMFYUI_PATH if this Pod uses a non-standard layout." >&2
  exit 1
fi

echo "ComfyUI root: $COMFY_ROOT"
echo "Persistent root: $PERSIST_ROOT"
echo "Stack: $(json_get stackId)"

ensure_dir "$PERSIST_ROOT/models/checkpoints"
ensure_dir "$PERSIST_ROOT/models/clip_vision"
ensure_dir "$PERSIST_ROOT/models/ipadapter"
ensure_dir "$PERSIST_ROOT/models/vae"
ensure_dir "$PERSIST_ROOT/custom_nodes"
ensure_dir "$COMFY_ROOT/models/checkpoints"
ensure_dir "$COMFY_ROOT/models/clip_vision"
ensure_dir "$COMFY_ROOT/models/ipadapter"
ensure_dir "$COMFY_ROOT/models/vae"
ensure_dir "$COMFY_ROOT/custom_nodes"
ensure_dir "$COMFY_ROOT/input/fpai"
ensure_dir "$COMFY_ROOT/output"

MISSING=0
MODEL_COUNT="$(python3 - "$MANIFEST" <<'PY'
import json, sys
print(len(json.load(open(sys.argv[1], encoding="utf-8"))["models"]))
PY
)"

for i in $(seq 0 $((MODEL_COUNT - 1))); do
  filename="$(json_get "models.${i}.filename")"
  directory="$(json_get "models.${i}.directory")"
  url="$(json_get "models.${i}.url")"
  min_bytes="$(json_get "models.${i}.minBytes")"
  persist_file="${PERSIST_ROOT}/models/${directory}/${filename}"
  comfy_file="${COMFY_ROOT}/models/${directory}/${filename}"

  if ! download_if_needed "$url" "$persist_file" "$min_bytes"; then
    MISSING=1
  fi
  if [[ -f "$persist_file" ]]; then
    if [[ "$persist_file" != "$comfy_file" ]]; then
      if [[ -e "$comfy_file" && ! -L "$comfy_file" ]]; then
        existing_size="$(file_size "$comfy_file")"
        if [[ "$existing_size" -ge "$min_bytes" ]]; then
          echo "SKIP Comfy copy of ${filename} (already in ${comfy_file})"
        else
          ln -sfn "$persist_file" "$comfy_file"
        fi
      else
        ln -sfn "$persist_file" "$comfy_file"
      fi
    fi
  fi
done

NODE_REPO="$(json_get customNodes.0.repo)"
NODE_ID="$(json_get customNodes.0.id)"
if ! clone_node "$NODE_REPO" "${PERSIST_ROOT}/custom_nodes/${NODE_ID}"; then
  MISSING=1
fi
if [[ -d "${PERSIST_ROOT}/custom_nodes/${NODE_ID}" ]]; then
  if [[ "${PERSIST_ROOT}/custom_nodes/${NODE_ID}" != "${COMFY_ROOT}/custom_nodes/${NODE_ID}" ]]; then
    if [[ ! -e "${COMFY_ROOT}/custom_nodes/${NODE_ID}" ]]; then
      ln -sfn "${PERSIST_ROOT}/custom_nodes/${NODE_ID}" "${COMFY_ROOT}/custom_nodes/${NODE_ID}"
    fi
  fi
fi

READY_FILE="${PERSIST_ROOT}/READY.json"
if [[ "$VERIFY_ONLY" -eq 0 && "$MISSING" -eq 0 ]]; then
  python3 - "$MANIFEST" "$READY_FILE" "$COMFY_ROOT" "$PERSIST_ROOT" <<'PY'
import json, os, sys, time
manifest = json.load(open(sys.argv[1], encoding="utf-8"))
ready = {
    "stackId": manifest["stackId"],
    "ready": True,
    "writtenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "comfyRoot": sys.argv[3],
    "persistRoot": sys.argv[4],
    "models": [],
    "liveGeneration": False,
    "note": "Bootstrap only. Film Studio live flags stay false. Restart ComfyUI so custom nodes load.",
}
for model in manifest["models"]:
    path = os.path.join(sys.argv[4], "models", model["directory"], model["filename"])
    size = os.path.getsize(path) if os.path.isfile(path) else 0
    ready["models"].append({"id": model["id"], "filename": model["filename"], "bytes": size, "path": path})
json.dump(ready, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
print(f"Wrote {sys.argv[2]}")
PY
fi

echo
echo "Bootstrap $([[ "$VERIFY_ONLY" -eq 1 ]] && echo verify || echo install) complete."
echo "Checkpoint: $(json_get models.0.filename)"
echo "CLIP vision: $(json_get models.1.filename)"
echo "IPAdapter: $(json_get models.2.filename)"
echo "Custom node: ${NODE_ID}"
echo "Character Bible upload folder: ${COMFY_ROOT}/input/fpai"
echo
echo "NEXT: restart ComfyUI so IPAdapter nodes register, then run Film Studio preflight."
echo "Do not enable CHARACTER_FACTORY_LIVE_ENABLED or LIVE_RENDERING_ENABLED from this script."
echo "Do not queue a generation from this script."

if [[ "$MISSING" -ne 0 ]]; then
  echo "Bootstrap is incomplete. Re-run without --verify-only after fixing missing files." >&2
  exit 1
fi
