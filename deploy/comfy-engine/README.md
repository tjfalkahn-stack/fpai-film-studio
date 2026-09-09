# FPAI Comfy Engine

This directory contains the GPU-side ComfyUI runtime used by FPAI Film Studio. The goal is to keep ComfyUI in the engine room while FPAI Studio remains the production interface.

The target deployment is a dedicated cloud GPU or serverless GPU container. RunPod is the initial deployment target because it supports dedicated GPU Pods and serverless custom containers; the container itself is provider-neutral.

The engine exposes the small v2 compatibility surface already expected by Film Studio:

- `POST /api/v2/assets`
- `GET /api/v2/assets/{id}/content`
- `POST /api/v2/jobs`
- `GET /api/v2/jobs/{id}`
- `POST /api/v2/jobs/{id}/cancel`
- `GET /health`

Internally the proxy talks to stock ComfyUI on localhost. Film Studio never needs direct access to the Comfy node graph.

## First activation sequence

1. Build and deploy the container on a GPU with at least 24 GB VRAM for the initial SDXL workflow.
2. Mount persistent storage at `/workspace` so models and outputs survive restarts.
3. Set `FPAI_COMFY_API_KEY` on the GPU deployment and use the same value as the Film Studio Worker secret `COMFYUI_API_KEY`.
4. Set Film Studio `COMFYUI_BASE_URL` to the public HTTPS URL of this engine.
5. Keep `CHARACTER_FACTORY_LIVE_ENABLED=false` until the smoke workflow succeeds.
6. Run one Marcus still, review real GPU time and cost, then set `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` from the observed rate before the benchmark run.

## Security

Do not expose port 8188 publicly. Only the proxy port should be reachable from the internet. The proxy requires bearer auth for every `/api/v2/*` request. `/health` contains no secrets.

## Workflow strategy

The first packaged workflow is a baseline SDXL character-still graph that works with stock ComfyUI nodes. It gives us a real, runnable benchmark path first. Reference-image identity control is layered on next with a dedicated identity workflow once the target custom nodes/models are installed and verified on the live GPU.
