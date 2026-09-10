# Native ComfyUI on RunPod

Film Studio talks to a **stock ComfyUI HTTP API**. ComfyUI is infrastructure only. The browser never receives the Comfy URL, API key, client ID, or workflow graph.

This is the supported GPU path. Do **not** deploy the custom FPAI GHCR Comfy image (`fpai-film-studio-comfy`) or the `/api/v2` proxy for new environments. Use RunPod’s built-in ComfyUI Pod template.

Live spend stays off until you explicitly enable it. This document does **not** turn on `CHARACTER_FACTORY_LIVE_ENABLED` or `LIVE_RENDERING_ENABLED`. Do **not** start the Pod while only preparing this repo. Do **not** submit a generation from bootstrap or preflight.

## Photoreal character stack (24GB)

Character Factory does **not** use the stock ComfyUI starter demo (`DreamShaper_8_pruned.safetensors`). Film Studio owns an API-format identity workflow and installs this stack:

| Role | File | Source | Approx size | Comfy location |
| --- | --- | ---: | ---: | --- |
| Checkpoint | `RealVisXL_V5.0_fp16.safetensors` | Hugging Face `SG161222/RealVisXL_V5.0` | 6.46 GiB | `models/checkpoints/` |
| CLIP vision (identity encoder) | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | Hugging Face `h94/IP-Adapter` SDXL image encoder, renamed | 2.35 GiB | `models/clip_vision/` |
| IPAdapter Plus SDXL | `ip-adapter-plus_sdxl_vit-h.safetensors` | Hugging Face `h94/IP-Adapter` | 0.79 GiB | `models/ipadapter/` |
| VAE | baked into RealVisXL V5.0 | n/a | 0 | CheckpointLoaderSimple output 2 |
| Custom nodes | `ComfyUI_IPAdapter_plus` | https://github.com/cubiq/ComfyUI_IPAdapter_plus | ~20 MiB | `custom_nodes/` |

**Disk footprint:** about **9.61 GiB** of model weights, plus ~20 MiB of custom nodes. Keep **12 GiB free** on `/workspace` before bootstrap.

**Why this stack:** cinematic photoreal humans (Marcus, Jasmine, Turner, Mikey) with realistic skin, full-body and close-up stills, and **multi-reference identity**. Several Character Bible photos (identity/front, profile, full body, expression, wardrobe) are CLIP-encoded, combined with **norm average**, and applied once so they reinforce one face rather than fighting each other. Flux / SD3.5 were rejected for this 24GB MIG partition because identity adapters need VRAM headroom.

Canonical filenames and URLs: `deploy/runpod-comfyui/models.manifest.json`. Film Studio graph: `src/characterStillWorkflow.js`. Example export: `deploy/runpod-comfyui/workflows/character-still-photoreal-api.json`.

IPAdapter preset: `PLUS (high strength)`. Sampler: DPM++ 2M Karras, 30 steps, CFG 6, 1024×1024 unless overridden.

## What Film Studio calls

The render adapter (Cloudflare Worker) uses only native ComfyUI routes:

| Film Studio step | Native ComfyUI |
| --- | --- |
| Upload Character Bible / identity stills | `POST /upload/image` (`type=input`, `subfolder=fpai`) |
| Submit the owned API-format workflow | `POST /prompt` with `{ prompt, client_id }` |
| Poll job status and outputs | `GET /history/{prompt_id}` |
| Download accepted media | `GET /view?filename=&subfolder=&type=` |
| Cancel a running/queued prompt | `POST /queue` `{ delete: [prompt_id] }` then `POST /interrupt` |
| Preflight | `GET /system_stats`, `GET /object_info/{node}`, `GET /queue`, `POST /upload/image` |

LoadImage nodes receive `fpai/<name>.png`. Do not edit nodes in the ComfyUI browser for Character Factory.

## Exact cold-start procedure

The Pod is expected to be **stopped** until you are ready to burn GPU time. Follow this order. Do not improvise in the Comfy canvas while the meter is running.

### 0. Before you start the Pod (laptop / this repo — GPU off)

1. Merge is **not** required to read the runbook, but the Worker preflight route and owned workflow must be deployed before Film Studio can certify the Pod.
2. Confirm Worker vars still say:
   - `CHARACTER_FACTORY_LIVE_ENABLED = "false"`
   - `LIVE_RENDERING_ENABLED = "false"`
   - `MOCK_E2E_VERIFIED = "false"`
3. Set `COMFYUI_BASE_URL` only after the Pod is up (step 1). Leave live flags false.
4. Prepare Jasmine Character Bible photographs in Film Studio (identity/front plus profile / full-body / expression / wardrobe if you have them).
5. Optional: `npm run character:first-test` writes `benchmarks/jasmine.first-test.plan.json`. That command **does not generate**.

### 1. Start the Pod

1. Open the [RunPod ComfyUI template](https://console.runpod.io/hub/template/comfyui?id=cw3nka7d08) (`runpod/comfyui:1.4.7-cuda13.0` or the current official ComfyUI template).
2. GPU: **PRO 6000 MIG 24GB** (or another 24GB+ card).
3. Persistent volume: **`/workspace`**.
4. Expose HTTP **8188**. Do not use RunPod Serverless `/run`.
5. Start the Pod. Wait until the 8188 proxy is listed.

Public URL:

```text
https://<POD_ID>-8188.proxy.runpod.net
```

Open it once and confirm the ComfyUI canvas loads. Then leave the canvas alone.

### 2. Run / verify bootstrap (on the Pod)

SSH or web terminal on the Pod. Clone or copy this repo onto `/workspace` if it is not already there. Then:

```bash
cd /workspace/fpai-film-studio   # or wherever this repo lives on the volume
bash deploy/runpod-comfyui/bootstrap.sh
```

The script is safe to rerun. Existing files that already meet `minBytes` are skipped.

It installs checkpoints, CLIP vision, IPAdapter weights, and `ComfyUI_IPAdapter_plus` under `/workspace/fpai-comfy` and symlinks them into the detected ComfyUI tree (`COMFYUI_PATH` if set, otherwise `/workspace/ComfyUI`, `/ComfyUI`, …). It also creates `input/fpai`.

Verify without downloading:

```bash
bash deploy/runpod-comfyui/bootstrap.sh --verify-only
```

**Restart ComfyUI** after the first install so IPAdapter nodes register (stop/start the ComfyUI process, or stop/start the Pod if that is faster than hunting the process). A full Pod restart re-bills boot time; prefer restarting only the ComfyUI process when the template respawns it.

Do **not** search Comfy Manager. Do **not** download DreamShaper. Do **not** queue the starter text-to-image demo.

### 3. Verify preflight (Film Studio, still live-off)

On the Worker (after this branch is deployed to the adapter):

```http
GET /api/character-factory/preflight
Authorization: Bearer <FPAI_CONTROL_TOKEN>
```

`ready: true` means Comfy is reachable, RealVisXL V5.0 is installed, IPAdapter Plus nodes and weights are present, the owned workflow class types exist, `/queue` responds, and `POST /upload/image` into `fpai/` works.

If `ready: false`, **do not** enable live generation. The JSON `missing[]` entries name the component and the bootstrap action. Fix, restart ComfyUI, re-run preflight.

Preflight uploads a 1×1 PNG probe only. It does not run KSampler.

### 4. Verify models (on the Pod)

```bash
ls -lh /workspace/fpai-comfy/models/checkpoints/RealVisXL_V5.0_fp16.safetensors
ls -lh /workspace/fpai-comfy/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors
ls -lh /workspace/fpai-comfy/models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors
test -d /workspace/fpai-comfy/custom_nodes/ComfyUI_IPAdapter_plus && echo "IPAdapter node present"
cat /workspace/fpai-comfy/READY.json
```

Optional Comfy HTTP check (private shell, not the Film Studio frontend):

```bash
curl -fsS "$COMFYUI_BASE_URL/system_stats"
```

### 5. Verify Comfy

You already opened the canvas in step 1. After bootstrap + restart, `GET /object_info/IPAdapterUnifiedLoader` must return a node definition. Preflight covers this. Do not wire a graph by hand.

### 6. Controlled Film Studio test (Jasmine, one still)

**Do not execute this until you are in a dedicated paid session and have explicitly set `CHARACTER_FACTORY_LIVE_ENABLED=true` for that session only.** This repo keeps the flag false.

Test objective: one photoreal Jasmine still from her Character Bible photographs, proving:

- Comfy connectivity
- reference upload (`POST /upload/image` → `input/fpai/`)
- owned workflow submission (`POST /prompt`)
- identity conditioning (IPAdapter combined embeds)
- output retrieval (`GET /view`)
- QC, `character.json` / `manifest.json`, budget accounting

Hard cap: **one generated image**.

Prepared plan (not executed by CI or bootstrap):

```bash
npm run character:first-test
```

After merge / adapter deploy, with live flag **temporarily** true, run that single smoke plan through `createCharacterFactoryRuntime(env).run(plan)` using Jasmine’s stored Character Bible images. Inspect R2:

```text
character-factory/jasmine/accepted/...
character-factory/jasmine/rejected/...
character-factory/jasmine/character.json
character-factory/jasmine/manifest.json
```

Set `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` from observed GPU time **after** this one still, before any Marcus matrix.

Then set `CHARACTER_FACTORY_LIVE_ENABLED=false` again.

### 7. Stop the Pod

Stop the RunPod Pod as soon as the still is downloaded and the live flag is off. Film Studio cannot claw back GPU seconds already billed.

## Estimated GPU time for the first Jasmine still

| Phase | GPU must be on? | Typical duration |
| --- | --- | --- |
| Start Pod (models already on `/workspace`) | yes | 2–4 min |
| First bootstrap (download ~9.6 GiB) | yes | 4–12 min (Hugging Face speed) |
| Restart ComfyUI + preflight | yes | 1–2 min |
| One 1024² RealVisXL + IPAdapter still | yes | 15–45 s |
| Gemini QC + R2 package | GPU idle but Pod up | 10–20 s |
| Stop Pod | yes until stopped | 1 min |

**If `/workspace` already has the stack:** budget **about 8 minutes** of paid Pod time (start → preflight → one still → stop).

**Cold volume, first download:** budget **about 20 minutes**.

Do not leave the Pod up “just in case.”

## 1. Deploy RunPod’s ComfyUI Pod template

1. Open the [RunPod ComfyUI template](https://console.runpod.io/hub/template/comfyui?id=cw3nka7d08) for standard GPUs. For Blackwell GPUs use the [ComfyUI Blackwell Edition](https://console.runpod.io/hub/template/comfyui-blackwell-edition-5090-b200?id=2lv7ev3wfp).
2. Choose a GPU with 24 GB+ VRAM (PRO 6000 MIG 24GB is the current Character Factory target).
3. Keep HTTP port **8188** exposed.
4. Attach `/workspace` persistence so checkpoints survive stops.
5. Deploy on-demand.

Do not point Film Studio at RunPod **Serverless** `/run` or `/runsync`.

## 2. Film Studio configuration (server only)

```toml
COMFYUI_BASE_URL = "https://<POD_ID>-8188.proxy.runpod.net"
COMFYUI_CHARACTER_WORKFLOW_NAME = "fpai-character-still-photoreal-sdxl-v1"
COMFYUI_CHARACTER_COST_PER_IMAGE_USD = "0"
CHARACTER_FACTORY_LIVE_ENABLED = "false"
LIVE_RENDERING_ENABLED = "false"
MOCK_E2E_VERIFIED = "false"
```

Leave `COMFYUI_CHARACTER_WORKFLOW_KEY` and `COMFYUI_CHARACTER_WORKFLOW_JSON` **unset** so Film Studio submits the owned identity graph. Those vars are optional operator overrides only.

Optional:

```toml
COMFYUI_CLIENT_ID = "fpai-film-studio"
CHARACTER_FACTORY_STEPS = "30"
CHARACTER_FACTORY_CFG = "6"
```

If the Pod requires a bearer token, store it as a Worker secret (`npx wrangler secret put COMFYUI_API_KEY`). Never put the key, client ID, or Pod URL in frontend code.

`COMFYUI_BASE_URL` must be HTTPS in deployed environments. Local HTTP is accepted only for `localhost` / `127.0.0.1` when `LOCAL_DEV="true"`.

## 3. Spend gates

Character Factory will not submit stills unless `CHARACTER_FACTORY_LIVE_ENABLED=true` **and** preflight is ready **and** Character Bible reference images are attached.

Video Comfy jobs will not submit unless both `LIVE_RENDERING_ENABLED=true` and `MOCK_E2E_VERIFIED=true`.

QC, retries, accepted/rejected R2 layout, `character.json`, `manifest.json`, and budget accounting stay in Film Studio. ComfyUI only renders.

## 4. Auth and proxy notes

- Stock ComfyUI has no API key. Film Studio omits `Authorization` unless `COMFYUI_API_KEY` is set.
- Server-side Worker fetches do not send a browser `Origin`, which avoids the ComfyUI host/origin 403 that often hits **browser** scripts against `*.proxy.runpod.net`.
- Prefer the RunPod HTTPS proxy over a raw public TCP 8188.
- Stop the Pod when idle.

## 5. Rollback

Set `CHARACTER_FACTORY_LIVE_ENABLED = "false"` and/or `LIVE_RENDERING_ENABLED = "false"`, redeploy the adapter, and stop the Pod. Existing D1 reservations and R2 Character Factory packages remain; do not delete uncertain rows until you reconcile the Pod history.
