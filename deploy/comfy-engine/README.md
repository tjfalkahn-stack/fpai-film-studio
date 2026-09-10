# FPAI Comfy Engine (optional / legacy)

New environments should use a **stock ComfyUI** instance, preferably [RunPod’s built-in ComfyUI Pod template](../../docs/RUNPOD_COMFYUI.md). Film Studio now calls native `/upload/image`, `/prompt`, `/history/{id}`, `/view`, and `/interrupt` directly. The custom FPAI GHCR image and `/api/v2` proxy are **not required**.

This directory remains as an optional GPU-side wrapper for operators who still want a FastAPI façade in front of localhost ComfyUI. It is not the Character Factory or video-adapter integration path.

The optional wrapper historically exposed:

- `POST /api/v2/assets`
- `GET /api/v2/assets/{id}/content`
- `POST /api/v2/jobs`
- `GET /api/v2/jobs/{id}`
- `POST /api/v2/jobs/{id}/cancel`
- `GET /health`

Film Studio no longer depends on that surface.

## Preferred activation (native RunPod)

1. Deploy RunPod’s ComfyUI template with HTTP 8188.
2. Run `bash deploy/runpod-comfyui/bootstrap.sh` on the Pod (see [RUNPOD_COMFYUI.md](../../docs/RUNPOD_COMFYUI.md)).
3. Set Film Studio `COMFYUI_BASE_URL` to `https://<POD_ID>-8188.proxy.runpod.net`.
4. Keep `CHARACTER_FACTORY_LIVE_ENABLED=false` and `LIVE_RENDERING_ENABLED=false` until a private one-still Jasmine test succeeds.
5. After that still, set `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` from the observed rate before any Marcus matrix.

## Workflow strategy

Character Factory uses a Film Studio–owned photoreal identity graph (RealVisXL V5.0 + IPAdapter Plus, multiple Character Bible references). The stock DreamShaper starter demo is not used. The SDXL text-only file in `workflows/character-still-sdxl-api.json` is a historical baseline only.
