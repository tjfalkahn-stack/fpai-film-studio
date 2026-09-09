# Character Factory Comfy executor

This slice connects Character Factory plans to a dedicated ComfyUI still-image workflow without reusing the video workflow.

## Private workflow

Export a ComfyUI API-format still workflow and store it at:

`comfy/workflows/character-still.json`

Supported placeholders:

- `__FPAI_PROMPT__`
- `__FPAI_WIDTH__`
- `__FPAI_HEIGHT__`
- `__FPAI_SEED__`
- `__FPAI_FILENAME_PREFIX__`

The workflow must emit an image output (`image/png` or `image/jpeg`).

## Server-only configuration

- `COMFYUI_BASE_URL`
- `COMFYUI_API_KEY` secret when required
- `COMFYUI_CHARACTER_WORKFLOW_KEY=comfy/workflows/character-still.json`
- `COMFYUI_CHARACTER_WORKFLOW_NAME=fpai-character-still-v1`
- `COMFYUI_CHARACTER_COST_PER_IMAGE_USD`

The cost value is operator-configured and is used by benchmark accounting. Use `0` only when the actual still-image infrastructure has no marginal metered charge.

## Autonomous runner

`runCharacterFactoryPlan` processes every job sequentially, polls Comfy, downloads the resulting image, passes it to an image-QC callback, automatically retries failures up to the configured attempt cap, and emits both `character.json` and `manifest.json` data structures.

The QC callback is deliberately a dependency rather than a hard-coded model. It must return the five metrics Character Factory already scores: identity, anatomy, framing, wardrobe, and artifactFree. This lets FPAI plug in the selected local or hosted vision evaluator without changing the generation executor.

No new live-render switch is enabled by this PR. Before Benchmark 001 can spend GPU/provider money, the actual private still workflow and the QC evaluator must be configured and smoke-tested against Marcus references.