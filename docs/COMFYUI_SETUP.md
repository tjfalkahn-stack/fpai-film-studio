# ComfyUI render engine for FPAI Film Studio

Film Studio treats ComfyUI as a server-side renderer behind the existing render adapter. The browser never receives the ComfyUI API key or workflow graph. Mock and Veo remain available; ComfyUI is an additional route.

## What this first pass supports

- Comfy API v2 job submission and polling.
- Up to three PNG/JPEG Character Bible references.
- References are uploaded beneath the proxy's allowlisted `input/fpai/` root.
- 4, 6, or 8 second source clips.
- 720p or 1080p, 16:9 or 9:16.
- MP4 output into the existing Takes and Salvage workflow.
- Durable Film Studio request idempotency and the existing D1/R2 render ledger.
- Comfy job cancellation with conservative configured-cost accounting.
- Comfy Cloud, Comfy serverless, or a self-hosted `comfy-api-proxy` endpoint that serves the v2 API.

This pass intentionally does not expose the Comfy node graph in the Film Studio UI. Film Studio remains the production interface.

## 1. Build the Comfy workflow

Create and test the workflow in ComfyUI, then export the **API-format** workflow JSON. The v2 jobs endpoint rejects the normal UI-format export containing top-level `nodes` / `links`.

Use these literal placeholders wherever Film Studio should inject shot values:

| Placeholder | Injected value |
| --- | --- |
| `__FPAI_PROMPT__` | Shot render prompt |
| `__FPAI_DURATION__` | 4, 6, or 8 |
| `__FPAI_ASPECT_RATIO__` | `16:9` or `9:16` |
| `__FPAI_WIDTH__` | 1280/1920 or portrait equivalent |
| `__FPAI_HEIGHT__` | 720/1080 or portrait equivalent |
| `__FPAI_REFERENCE_1__` | First uploaded Character Bible asset |
| `__FPAI_REFERENCE_2__` | Second uploaded Character Bible asset |
| `__FPAI_REFERENCE_3__` | Third uploaded Character Bible asset |

Reference placeholders must occupy the complete workflow input value. Film Studio replaces them with Comfy `core/ASSET` objects after uploading the selected references.

The workflow must commit a `video/mp4` output. Other Comfy output types remain a future Film Studio asset-pipeline expansion.

## 2. Store the workflow privately

The default private R2 key is:

```text
comfy/workflows/video.json
```

Upload the exported API workflow to the existing `fpai-film-studio-generation-media` bucket at that key. The provider also accepts a server-only `COMFYUI_WORKFLOW_JSON` value for tests/small workflows, but R2 is the recommended production location.

## 3. Configure the render adapter

Add these values to the private `wrangler.toml` under `[vars]`:

```toml
COMFYUI_BASE_URL = "https://YOUR-COMFYUI-DEPLOYMENT"
COMFYUI_WORKFLOW_KEY = "comfy/workflows/video.json"
COMFYUI_WORKFLOW_NAME = "fpai-character-video-v1"
COMFYUI_COST_PER_SECOND_USD = "0"
```

`COMFYUI_BASE_URL` must be HTTPS in deployed environments. Local HTTP is accepted only for `localhost` / `127.0.0.1` when `LOCAL_DEV="true"`.

Set `COMFYUI_COST_PER_SECOND_USD` to the rate you want Film Studio to reserve and record for this workflow. Do not leave it at zero for a metered cloud/serverless deployment if you want the Film Studio budget ledger to represent provider spend.

If the Comfy deployment requires an API key, store it only on the render-adapter Worker:

```bash
npx wrangler secret put COMFYUI_API_KEY --config wrangler.toml
```

Do not add the key to Vite variables, browser storage, GitHub, the workflow JSON, or the frontend Worker.

## 4. Keep the live gate closed for verification

Keep these values disabled while configuring Comfy:

```toml
LIVE_RENDERING_ENABLED = "false"
MOCK_E2E_VERIFIED = "false"
```

Run the existing Mock smoke test first. Then verify the Comfy deployment and workflow privately. Only after that should both flags be set to `true` and the render adapter redeployed.

Film Studio will then list **ComfyUI · Workflow** in the existing Generate Take renderer selector. Character continuity, shot timing, animatic lock, attempt limits, accepted quote, session ceiling, project ceiling, and selected references remain enforced exactly like the paid Veo path.

## 5. Expected job flow

```text
Generate Take
  -> Film Studio reserves estimated cost in D1
  -> selected Character Bible images are loaded from browser media
  -> render adapter stores the private request input in R2
  -> references are uploaded to Comfy /api/v2/assets
  -> workflow placeholders become prompt/dimensions/core/ASSET references
  -> workflow is submitted to /api/v2/jobs
  -> Film Studio polls /api/v2/jobs/{id}
  -> succeeded MP4 output is downloaded through /api/v2/assets/{id}/content
  -> MP4 is copied into Film Studio R2
  -> take appears in Takes and Salvage
```

Comfy job submissions are treated as non-repeatable after an ambiguous network outcome. Film Studio marks an uncertain start for reconciliation rather than blindly submitting the workflow again.

## 6. Cancellation and accounting

Comfy v2 supports cancellation. A running Comfy render can therefore use Film Studio's Cancel render action. The provider conservatively records the full Film Studio configured estimate for a canceled running job because consumed GPU time may still be billable before cancellation takes effect. A queued Film Studio job that has not reached Comfy can still be canceled at zero cost.

## 7. Rollback

To stop all new paid/live generation immediately:

```toml
LIVE_RENDERING_ENABLED = "false"
```

Redeploy the render adapter. Existing stored takes remain available. Do not delete D1 reservations for uncertain jobs until the Comfy deployment is reconciled.
