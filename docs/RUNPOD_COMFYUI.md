# Native ComfyUI on RunPod

Film Studio talks to a **stock ComfyUI HTTP API**. ComfyUI is infrastructure only. The browser never receives the Comfy URL, API key, client ID, or workflow graph.

This is the supported GPU path. Do **not** deploy the custom FPAI GHCR Comfy image (`fpai-film-studio-comfy`) or the `/api/v2` proxy for new environments. Use RunPod’s built-in ComfyUI Pod template.

Live spend stays off until you explicitly enable it. This document does not turn on `CHARACTER_FACTORY_LIVE_ENABLED` or `LIVE_RENDERING_ENABLED`.

## What Film Studio calls

The render adapter (Cloudflare Worker) uses only native ComfyUI routes:

| Film Studio step | Native ComfyUI |
| --- | --- |
| Upload Character Bible / identity stills | `POST /upload/image` (`type=input`, `subfolder=fpai`) |
| Submit an API-format workflow | `POST /prompt` with `{ prompt, client_id }` |
| Poll job status and outputs | `GET /history/{prompt_id}` |
| Download accepted media | `GET /view?filename=&subfolder=&type=` |
| Cancel a running/queued prompt | `POST /queue` `{ delete: [prompt_id] }` then `POST /interrupt` |

LoadImage-style nodes receive the uploaded filename (`fpai/<name>.png`), not a custom `core/ASSET` object.

## 1. Deploy RunPod’s ComfyUI Pod template

1. Open the [RunPod ComfyUI template](https://console.runpod.io/hub/template/comfyui?id=cw3nka7d08) for standard GPUs (RTX 4090, L40, A100, …). For Blackwell GPUs (RTX 5090, B200) use the [ComfyUI Blackwell Edition](https://console.runpod.io/hub/template/comfyui-blackwell-edition-5090-b200?id=2lv7ev3wfp).
2. Choose a GPU with enough VRAM for the still/video workflow you will actually run (24 GB+ for the packaged SDXL character still).
3. Keep HTTP port **8188** exposed. The template also commonly exposes SSH (`22/tcp`) and an optional file browser (`8080/http`).
4. Attach a network volume if you want checkpoints and outputs to survive Pod stops.
5. Deploy on-demand. First boot can take a long time while the template initializes; later starts are faster.

Do not point Film Studio at RunPod **Serverless** `/run` or `/runsync`. Those are a different API. Character Factory and the video adapter require stock `/prompt`, `/history`, and `/view`.

## 2. Confirm native ComfyUI is reachable

In the RunPod console, open the Pod → **Connect** → **Connect to HTTP Service [Port 8188]**.

The public URL looks like:

```text
https://<POD_ID>-8188.proxy.runpod.net
```

Open that URL in a browser and confirm the ComfyUI canvas loads. That same origin is `COMFYUI_BASE_URL`.

Optional smoke from a private shell (not from the Film Studio frontend):

```bash
curl -fsS "$COMFYUI_BASE_URL/system_stats"
```

Install the checkpoint and custom nodes your exported API workflow actually names. The packaged SDXL still graph expects a stock `CheckpointLoaderSimple` + `SaveImage` graph; if the Pod’s checkpoint filename differs, export a matching API workflow rather than guessing node names in code.

## 3. Export an API-format workflow

In ComfyUI, export **API format** (not the UI `nodes` / `links` graph). Store stills at:

```text
comfy/workflows/character-still.json
```

and video (when used) at:

```text
comfy/workflows/video.json
```

inside the private `GENERATION_MEDIA` R2 bucket. Placeholder contract: [ComfyUI setup](COMFYUI_SETUP.md) and [Character Factory executor](CHARACTER_FACTORY_COMFY_EXECUTOR.md).

## 4. Configure Film Studio (server only)

On the render-adapter Worker, not in Vite or browser storage:

```toml
COMFYUI_BASE_URL = "https://<POD_ID>-8188.proxy.runpod.net"
COMFYUI_CHARACTER_WORKFLOW_KEY = "comfy/workflows/character-still.json"
COMFYUI_CHARACTER_WORKFLOW_NAME = "fpai-character-still-v1"
COMFYUI_CHARACTER_COST_PER_IMAGE_USD = "0"
CHARACTER_FACTORY_LIVE_ENABLED = "false"
LIVE_RENDERING_ENABLED = "false"
MOCK_E2E_VERIFIED = "false"
```

Optional, still server-only:

```toml
COMFYUI_CLIENT_ID = "fpai-film-studio"
```

If the Pod or a proxy in front of it requires a bearer token (some community templates use `WEB_TOKEN`), store it as a Worker secret:

```bash
npx wrangler secret put COMFYUI_API_KEY --config wrangler.toml
```

Never put `COMFYUI_API_KEY`, `COMFYUI_CLIENT_ID`, or the Pod URL into frontend code, GitHub, or workflow JSON.

`COMFYUI_BASE_URL` must be HTTPS in deployed environments. Local HTTP is accepted only for `localhost` / `127.0.0.1` when `LOCAL_DEV="true"`. Do not put credentials, query, or fragment in the base URL.

## 5. Keep spend gates closed until a private smoke test

Character Factory will not submit stills unless `CHARACTER_FACTORY_LIVE_ENABLED=true`.

Video Comfy jobs will not submit unless both `LIVE_RENDERING_ENABLED=true` and `MOCK_E2E_VERIFIED=true`.

Leave those false while you:

1. Confirm `/system_stats` on the Pod.
2. Queue one API-format still from the Comfy UI (or a private curl to `/prompt`) using the same checkpoint the workflow names.
3. Set `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` from observed GPU cost before any Marcus benchmark.

QC, retries, accepted/rejected R2 layout, `character.json`, `manifest.json`, and budget accounting stay in Film Studio. ComfyUI only renders.

## 6. Auth and proxy notes

- Stock ComfyUI has no API key. Film Studio omits `Authorization` unless `COMFYUI_API_KEY` is set.
- Server-side Worker fetches do not send a browser `Origin`, which avoids the ComfyUI host/origin 403 that often hits **browser** scripts against `*.proxy.runpod.net`.
- Prefer the RunPod HTTPS proxy over a raw public TCP 8188. If you terminate TLS yourself, still keep the key on the Worker.
- Stop the Pod when idle. Film Studio cannot revoke GPU time already consumed on RunPod.

## 7. Rollback

Set `CHARACTER_FACTORY_LIVE_ENABLED = "false"` and/or `LIVE_RENDERING_ENABLED = "false"`, redeploy the adapter, and stop the Pod. Existing D1 reservations and R2 Character Factory packages remain; do not delete uncertain rows until you reconcile the Pod history.
