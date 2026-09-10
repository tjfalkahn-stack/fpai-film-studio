# Character Factory Comfy executor

This slice connects Character Factory plans to a dedicated ComfyUI still-image workflow without reusing the video workflow.

The executor speaks **native ComfyUI** (`/upload/image`, `/prompt`, `/history/{id}`, `/view`). It does not depend on the custom FPAI `/api/v2` GPU proxy. Preferred GPU setup: [RunPod’s built-in ComfyUI Pod template](RUNPOD_COMFYUI.md).

QC scoring, retries, accepted/rejected persistence, `character.json`, `manifest.json`, cost accounting, and `CHARACTER_FACTORY_LIVE_ENABLED` remain in Film Studio. ComfyUI only renders stills.

## Owned photoreal workflow

Film Studio builds an API-format identity graph in `src/characterStillWorkflow.js`. The owner does **not** export a graph from the ComfyUI canvas for Character Factory.

The graph loads **RealVisXL V5.0**, encodes Character Bible photographs with **IPAdapter Plus SDXL**, combines embeddings (`norm average`) so multiple references reinforce one identity, and saves a still.

Placeholders still work if you set an operator override (`COMFYUI_CHARACTER_WORKFLOW_JSON` or `COMFYUI_CHARACTER_WORKFLOW_KEY`):

- `__FPAI_PROMPT__`
- `__FPAI_NEGATIVE_PROMPT__`
- `__FPAI_WIDTH__`
- `__FPAI_HEIGHT__`
- `__FPAI_SEED__`
- `__FPAI_STEPS__`
- `__FPAI_CFG__`
- `__FPAI_FILENAME_PREFIX__`
- `__FPAI_REFERENCE_1__` … `__FPAI_REFERENCE_8__`

Leave those override vars unset in production so the owned graph is used.

The workflow must emit an image output (`image/png`, `image/jpeg`, or `image/webp`).

If the plan (or an individual job) includes `referenceImages` as inline PNG/JPEG objects — including Character Bible library assets resolved by the runtime — the executor uploads them with `POST /upload/image` into Comfy’s `input/fpai/` folder and wires `LoadImage` to `fpai/<name>.png`. Identity/front photographs are weighted above profile, full-body, wardrobe, and expression stills.

## Preflight

`GET /api/character-factory/preflight` (control-token auth) reports whether Comfy is actually ready. `createCharacterFactoryRuntime().run()` calls the same check **before** any paid still. Incomplete models, missing IPAdapter nodes, failed uploads, or an unreachable Pod abort the batch. Preflight does not enable live generation and does not run KSampler.

Bootstrap: `deploy/runpod-comfyui/bootstrap.sh`. Runbook: [RUNPOD_COMFYUI.md](RUNPOD_COMFYUI.md).

## Server-only configuration

- `COMFYUI_BASE_URL` — native Comfy origin (HTTPS; no credentials in the URL)
- `COMFYUI_API_KEY` secret when the Pod/proxy requires bearer auth
- `COMFYUI_CLIENT_ID` optional; otherwise a per-submit `fpai-<uuid>` is sent as `client_id`
- `COMFYUI_CHARACTER_WORKFLOW_NAME=fpai-character-still-photoreal-sdxl-v1`
- `COMFYUI_CHARACTER_COST_PER_IMAGE_USD`
- optional override: `COMFYUI_CHARACTER_WORKFLOW_KEY` / `COMFYUI_CHARACTER_WORKFLOW_JSON`

The cost value is operator-configured and is used by benchmark accounting. Use `0` only until the first controlled still measures real GPU time.

Do not put the Comfy URL, API key, or client ID in Vite variables, browser storage, or the frontend Worker.

## Autonomous runner

`runCharacterFactoryPlan` processes every job sequentially, polls Comfy history, downloads the resulting image through `/view`, passes it to an image-QC callback, automatically retries failures up to the configured attempt cap, and emits both `character.json` and `manifest.json` data structures.

The QC callback is deliberately a dependency rather than a hard-coded model. It must return the five metrics Character Factory already scores: identity, anatomy, framing, wardrobe, and artifactFree.

No live-render switch is enabled by this path. `CHARACTER_FACTORY_LIVE_ENABLED` stays independent of the video `LIVE_RENDERING_ENABLED` gate and remains `false` in the repo. The first controlled GPU test is a **single Jasmine still** (see the RunPod runbook), not the full Marcus matrix.
