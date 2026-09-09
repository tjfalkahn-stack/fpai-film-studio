# Character Factory Comfy executor

This slice connects Character Factory plans to a dedicated ComfyUI still-image workflow without reusing the video workflow.

The executor speaks **native ComfyUI** (`/upload/image`, `/prompt`, `/history/{id}`, `/view`). It does not depend on the custom FPAI `/api/v2` GPU proxy. Preferred GPU setup: [RunPod’s built-in ComfyUI Pod template](RUNPOD_COMFYUI.md).

QC scoring, retries, accepted/rejected persistence, `character.json`, `manifest.json`, cost accounting, and `CHARACTER_FACTORY_LIVE_ENABLED` remain in Film Studio. ComfyUI only renders stills.

## Private workflow

Export a ComfyUI API-format still workflow and store it at:

`comfy/workflows/character-still.json`

Supported placeholders:

- `__FPAI_PROMPT__`
- `__FPAI_WIDTH__`
- `__FPAI_HEIGHT__`
- `__FPAI_SEED__`
- `__FPAI_FILENAME_PREFIX__`
- `__FPAI_REFERENCE_1__` / `__FPAI_REFERENCE_2__` / `__FPAI_REFERENCE_3__` (optional identity stills)

The workflow must emit an image output (`image/png`, `image/jpeg`, or `image/webp`).

If the plan (or an individual job) includes `referenceImages` as inline PNG/JPEG objects, the executor uploads them with `POST /upload/image` into Comfy’s `input/fpai/` folder and injects the returned filenames into the reference placeholders.

## Server-only configuration

- `COMFYUI_BASE_URL` — native Comfy origin (HTTPS; no credentials in the URL)
- `COMFYUI_API_KEY` secret when the Pod/proxy requires bearer auth
- `COMFYUI_CLIENT_ID` optional; otherwise a per-submit `fpai-<uuid>` is sent as `client_id`
- `COMFYUI_CHARACTER_WORKFLOW_KEY=comfy/workflows/character-still.json`
- `COMFYUI_CHARACTER_WORKFLOW_NAME=fpai-character-still-v1`
- `COMFYUI_CHARACTER_COST_PER_IMAGE_USD`

The cost value is operator-configured and is used by benchmark accounting. Use `0` only when the actual still-image infrastructure has no marginal metered charge.

Do not put the Comfy URL, API key, or client ID in Vite variables, browser storage, or the frontend Worker.

## Autonomous runner

`runCharacterFactoryPlan` processes every job sequentially, polls Comfy history, downloads the resulting image through `/view`, passes it to an image-QC callback, automatically retries failures up to the configured attempt cap, and emits both `character.json` and `manifest.json` data structures.

The QC callback is deliberately a dependency rather than a hard-coded model. It must return the five metrics Character Factory already scores: identity, anatomy, framing, wardrobe, and artifactFree. This lets FPAI plug in the selected local or hosted vision evaluator without changing the generation executor.

No new live-render switch is enabled by this path. `CHARACTER_FACTORY_LIVE_ENABLED` stays independent of the video `LIVE_RENDERING_ENABLED` gate. Before Benchmark 001 can spend GPU/provider money, the actual private still workflow and the QC evaluator must be configured and smoke-tested against Marcus references.
