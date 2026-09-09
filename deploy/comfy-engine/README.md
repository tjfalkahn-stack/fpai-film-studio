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
2. Set Film Studio `COMFYUI_BASE_URL` to `https://<POD_ID>-8188.proxy.runpod.net`.
3. Keep `CHARACTER_FACTORY_LIVE_ENABLED=false` and `LIVE_RENDERING_ENABLED=false` until a private smoke still succeeds.
4. Run one Marcus still, review real GPU time and cost, then set `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` from the observed rate before the benchmark run.

## Workflow strategy

The first packaged workflow is a baseline SDXL character-still graph that works with stock ComfyUI nodes. It gives us a real, runnable benchmark path first. Reference-image identity control is layered on next with a dedicated identity workflow once the target custom nodes/models are installed and verified on the live GPU.
