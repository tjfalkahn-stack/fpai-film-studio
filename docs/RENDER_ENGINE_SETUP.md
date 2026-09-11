# Render foundation — local test and Cloudflare deployment

Live rendering is disabled by default. No Gemini key is needed to run Mock. Run this guide instead of the historical v1.3 instructions.

## Get the current source

PR #5 is merged into `main`. The browser verification pass and screenshots are in [MOCK_RENDER_VERIFICATION.md](MOCK_RENDER_VERIFICATION.md). Both live gates remain disabled, including after a successful mock test.

For a new checkout:

```bash
git clone https://github.com/tjfalkahn-stack/fpai-film-studio.git
cd fpai-film-studio
npm ci
npm test
npm run build
npm run dev
```

For an existing clean checkout:

```bash
git fetch origin
git switch main
git pull --ff-only
npm ci
npm test
npm run build
npm run dev
```

To review the verification fixes before that PR is merged, use `git switch --track origin/astra/mock-render-e2e-verification` after fetching. If that local branch already exists, use `git switch astra/mock-render-e2e-verification`.

Use Node 22.12+ or Node 24 and an OS supported by Cloudflare workerd. If your Mac is still running macOS 12.4, use a supported Linux development environment or upgrade macOS first; this pass does not remove Cloudflare's native runtime requirement.

`npm run dev` creates both additive local SQL schemas, starts the mock-only Worker at `127.0.0.1:8787`, and starts Vite at `127.0.0.1:5173`. No remote D1/R2 or Gemini services are used. Open [local Film Studio](http://127.0.0.1:5173/). Stop both processes with Ctrl-C. Local render state lives under ignored `.wrangler/`; production state uses the existing browser origin's localStorage/IndexedDB.

## Repeatable browser smoke test — required on the deployed environment before live enablement

1. Open **Shots → #027 — Marcus hero reveal**. Confirm Scene 001 and the existing 4.5-second final edit.
2. In **Generate Take**, leave Renderer on **Mock · $0**, Source duration **8 seconds**, Resolution **720p**, Aspect ratio **16:9**. References are optional for a mock slate; do not change Marcus's existing locks just to run the test.
3. Confirm the estimate is **$0.00** and click **Generate Take · $0.00** once.
4. Observe `queued → running → completed`. A test slate with a quiet synthetic test tone should appear under **Takes and Salvage**. Test play/pause, seeking and mute/unmute. It is explicitly labeled as a mock, not a generated character scene.
5. Approve the take; approve it again. There should still be one take and one zero-dollar render ledger record. Reject it; the shot must no longer count as approved. Approve it again if desired.
6. Refresh the app, open Shot 027 and confirm its take, review status and video remain. Also refresh while a new mock render is running and verify recovery.
7. Start a mock render and cancel it. Confirm canceled status, no resulting take and $0 actual cost.
8. Change **Renderer** to **Veo 3.1 Fast**. The workflow stays the same. An 8-second 720p quote is $0.80 at the captured tariff; Generate remains disabled. Do not enable live mode during this test.
9. Check **Characters**, **Scenes**, **Economy**, **Router**, **Assets**, **Budget** and existing uploads. The seed, character references and production budgets should remain intact.

The existing **Preview Cost-Control Package / Queue** remains a planning queue and does not execute providers. Executable renders are created through the new **Generate Take** controls.

## Deploy on Cloudflare with live rendering still off

These commands deploy to your existing Cloudflare account only when you run them. They were not executed remotely in this pass.

1. Authenticate and identify existing resources:

```bash
npx wrangler login
npx wrangler d1 list
npx wrangler r2 bucket list
```

Reuse `fpai-film-studio-generation` and `fpai-film-studio-generation-media` if already present. Only if absent:

```bash
npx wrangler d1 create fpai-film-studio-generation
npx wrangler r2 bucket create fpai-film-studio-generation-media
```

2. Create the ignored private configuration without overwriting an existing one:

```bash
cp -n wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml`: enter the existing D1 database ID, verify R2 bucket name and `ALLOWED_ORIGINS`, and add/update **all** foundation variables if using an older config:

```toml
LIVE_RENDERING_ENABLED = "false"
MOCK_E2E_VERIFIED = "false"
RENDER_PROJECT_ID = "enemies-closer-ep01"
RENDER_PROJECT_CEILING_USD = "20"
RENDER_SESSION_CEILING_USD = "10"
RENDER_SESSION_ID = "foundation-01"
MAX_SINGLE_JOB_USD = "4"
```

Put these under the existing `[vars]` section. These server ceilings govern real reservations; editing the browser's production budget does not raise them. Session IDs are operator-controlled: keep the same ID across restarts and deployments for the same spending session.

3. Apply both additive schemas. Neither clears production data.

`worker/character-schema.sql` is repeatable `CREATE TABLE IF NOT EXISTS`. Re-applying it adds the Character Bible `character_canonical_slots` table when missing and does **not** delete Reference Library photos or reset coverage.

```bash
npx wrangler d1 execute fpai-film-studio-generation --config wrangler.toml --remote --file=worker/schema.sql
npx wrangler d1 execute fpai-film-studio-generation --config wrangler.toml --remote --file=worker/render-schema.sql
npx wrangler d1 execute fpai-film-studio-generation --config wrangler.toml --remote --file=worker/character-schema.sql
```

4. Configure a Cloudflare Access **self-hosted application** covering the entire frontend hostname, with an Allow policy restricted to the owner. Put its team domain and application AUD in `wrangler.frontend.toml` as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Keep the `VIDEO_ADAPTER` service binding. The frontend verifies the JWT itself and returns 401 if these are absent or incorrect. Protect every alternate hostname, including workers.dev; an unprotected hostname still fails closed at the Worker.

5. If not already set, store the same strong private control token on **both** Workers using the interactive secret prompts. Keep the existing token if both services already share one. Never put it in browser code or Vite variables:

```bash
npx wrangler secret put FPAI_CONTROL_TOKEN --config wrangler.toml
npx wrangler secret put FPAI_CONTROL_TOKEN --config wrangler.frontend.toml
```

No Gemini key is needed for mock deployment. If Workers already have secrets, these commands replace them; use them only when setting or deliberately rotating the token.

6. Validate and deploy the adapter first, then the frontend:

```bash
npm test
npm run build
npx wrangler deploy --dry-run --config wrangler.toml
npx wrangler deploy --dry-run --config wrangler.frontend.toml
npm run render:deploy
npx wrangler deploy --config wrangler.frontend.toml
```

7. Check the deployed adapter's `/health` URL printed by Wrangler. `liveExecutionReady` and `liveRenderingEnabled` must both be `false`. Sign in to the frontend through Access and repeat the mock smoke test. Test signed-in playback as well as an unauthenticated API request (must receive 401).

## Manual Veo enablement — later, only after mock browser verification

Leave this section unexecuted for the foundation pass. Neither merging nor setting a Gemini secret enables rendering by itself.

- Complete the browser smoke test and verify your account has access to `veo-3.1-fast-generate-preview`.
- Verify the [current Google price](https://ai.google.dev/gemini-api/docs/pricing). Update `worker/providers/veo.js` rates if needed and rerun tests.
- Set the server-only key through `npx wrangler secret put GEMINI_API_KEY --config wrangler.toml`.
- Set `MOCK_E2E_VERIFIED = "true"` and `LIVE_RENDERING_ENABLED = "true"` under `[vars]` in the private `wrangler.toml`, retaining conservative session/project ceilings. Redeploy only the adapter with `npm run render:deploy`.
- Reopen the shot panel to refresh provider configuration. Choose Veo Fast, complete the existing character/timing/animatic preflight and explicitly select up to three reference images. Review the quote before Generate.

[Google's Veo specification](https://ai.google.dev/gemini-api/docs/veo) requires an 8-second source when using reference images or 1080p. Shot 027's 4.5-second edit remains unchanged. Trim/salvage the generated 8-second source in the existing take workflow.

To disable again, set `LIVE_RENDERING_ENABLED = "false"` and redeploy the adapter. Existing reservations remain; already submitted operations may continue at Google. The switch stops new submissions, Google polling and downloads from this Worker—it cannot revoke a provider-side charge.

## Seedance 2.0 (fal.ai) — prepared, not enabled

Seedance is a first-class video renderer beside ComfyUI and Veo. It is **not** live in this repository. `SEEDANCE_LIVE_ENABLED` stays `false`. `LIVE_RENDERING_ENABLED` stays `false`. `MOCK_E2E_VERIFIED` is not part of Seedance authorization and stays `false`. Do not set `FAL_KEY` during review. Quotes work without a key; submission does not.

The isolated Seedance controlled-test path is provider-scoped. Enabling it does **not** open Veo or Comfy live rendering.

Authorization for that single job (all required):

1. `SEEDANCE_LIVE_ENABLED=true`
2. Authenticated owner control token (`FPAI_CONTROL_TOKEN`)
3. Worker secret `FAL_KEY`
4. Hard allowlist: Enemies Closer / Scene 001 / `seedance-fast` / reference-to-video / 6 seconds / 720p / audio on / shot `seedance-001-jasmine-mikey`
5. Estimated spend ≤ **$1.46**
6. Maximum **one** Seedance generation. After that job is reserved, a second Seedance job fails closed.

`LIVE_RENDERING_ENABLED` must remain `false` for this test. Do not set `MOCK_E2E_VERIFIED=true` to authorize Seedance.

After merge, adding the secret (still does not spend money until `SEEDANCE_LIVE_ENABLED` is explicitly enabled for the allowlisted job):

```bash
npx wrangler secret put FAL_KEY --config wrangler.toml
```

Copy these `[vars]` from `wrangler.example.toml` if they are missing. Leave the live flags false:

```toml
LIVE_RENDERING_ENABLED = "false"
MOCK_E2E_VERIFIED = "false"
SEEDANCE_LIVE_ENABLED = "false"
SEEDANCE_FAST_720P_PER_SECOND_USD = "0.2419"
SEEDANCE_STANDARD_720P_PER_SECOND_USD = "0.3024"
SEEDANCE_STANDARD_1080P_PER_SECOND_USD = "0.682"
```

Optional later: `SEEDANCE_STANDARD_REFERENCE_VIDEO_720P_PER_SECOND_USD`, `SEEDANCE_WEBHOOK_URL` + `SEEDANCE_WEBHOOK_SECRET`. Webhook completion is supported; polling `GET /api/renders/:id` remains the default. Never put `FAL_KEY` in Vite, browser code, or `wrangler` `[vars]`.

The first controlled Enemies Closer Scene 001 plan is `benchmarks/enemies-closer.scene-001.seedance.plan.json` (`execute: false`). Regenerating the file does not call fal.ai:

```bash
npm run seedance:first-test
```

## API contract

| Route | Purpose |
|---|---|
| `GET /health` | Non-secret configuration readiness. |
| `GET /api/renderers` | Provider capabilities and server ceilings. |
| `POST /api/renders` | Quote (`estimateOnly:true`) or reserve a render. |
| `GET /api/renders` | Recover recent jobs, active first. |
| `GET /api/renders/:id` | Advance/poll a job and return normalized status. |
| `POST /api/webhooks/fal` | Optional fal.ai completion callback. Requires `SEEDANCE_WEBHOOK_SECRET`. Does not start jobs. |
| `GET /api/renders/:id/asset` | Authenticated MP4 with byte-range playback. |
| `GET/POST /api/projects/:projectId/characters/:characterId/references` | List or upload individual character reference photos (JPG/PNG/WebP) into private R2. Metadata stays in D1. |
| `PATCH/DELETE /api/projects/:projectId/characters/:characterId/references/:id` | Update tags/approval/primary/order or delete one photo. |
| `GET .../references/:id/asset` | Authenticated original image bytes. |
| `GET/POST /api/projects/:projectId/characters/:characterId/lock` | Read or rebuild a versioned Character Lock manifest. Rebuild does not train a model or start a paid render. |
| `POST .../reference-selection` | Deterministic shot reference selection preview. |

Request inputs: `projectId`, `sceneId`, `shotId`, `provider` (`mock` / `comfy-video` / `seedance-fast` / `seedance-standard` / `veo-fast`), `prompt`, `referenceImages:[{mimeType,data}]` (legacy inline), optional `characterIds` / `shotSubject` / `shotContext` for library selection, optional Seedance `generateAudio`, `seed`, `endFrameImage`, `environmentReferences`, `referenceVideos`, `aspectRatio`, `duration`, `resolution`; submissions also require `requestKey` and `acceptedCost`. Live requests require an owner-attested `continuity` snapshot.

The generation contract always preserves the full ordered selection (asset IDs, reasons, lock version) on the render. **Veo Fast still accepts at most three PNG/JPEG images.** Seedance accepts up to nine Character Bible / scene references and can consume a reference video or end frame. Mock records the full set (primary + up to five supporting by default; `CHARACTER_REFERENCE_SUPPORTING_LIMIT`) and does not pretend extra images were sent to a live model. If a provider `maxReferences` is 1, only the Primary Identity image is transmitted.

Output `render`: `id`/`renderId`, `operationId`, `status`, `estimatedCost`, nullable `actualCost`, `reservedCost`, `costBasis`, `outputAsset`, structured `error`, `debug.characterReferenceSelection`, scope and output settings. Google costs are completed usage at the quote tariff, pending invoice reconciliation. Unknown outcomes retain reservations; do not manually cancel them as free.

## Operator reconciliation

For a stuck `starting`/`uncertain` row, inspect the provider account and the D1 row privately. Recover and verify the operation ID if available before resuming tracking. Do not clear a reservation or retry generation based only on a timeout. This pass intentionally provides no automatic retry or pretend refund for ambiguous submissions.

Keep the app open while a live render completes so the temporary provider asset is downloaded promptly. Background polling and invoice reconciliation are follow-up work, documented in the audit.
