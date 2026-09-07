> Historical v1.3 setup. For this branch, use [Render Engine Setup](docs/RENDER_ENGINE_SETUP.md). Legacy live submission is disabled; `/api/renders` is the supported execution path.

# FPAI Film Studio — Google Video Adapter Setup

This adapter keeps Gemini/Veo credentials and billable generation on the server. The Film Studio sends a budget-approved generation package to a Cloudflare Worker; the Worker re-validates the paid route, checks duplicate hashes and server-side spend ceilings in D1, starts Google generation, polls long-running Veo operations, and stores completed MP4 files in R2.

## 1. Create the Cloudflare resources

From the repo directory:

```bash
npx wrangler d1 create fpai-film-studio-generation
npx wrangler r2 bucket create fpai-film-studio-generation-media
```

The D1 command prints a database ID. Copy `wrangler.example.toml` to `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID` with that ID.

Set `ALLOWED_ORIGINS` to the Film Studio production origin. During local development you can temporarily use your local Vite origin, for example `http://localhost:5173`.

## 2. Create the D1 schema

```bash
npx wrangler d1 execute fpai-film-studio-generation --remote --file=worker/schema.sql
```

This creates:

- `generation_projects` — the authoritative generation target, working ceiling, and emergency ceiling.
- `generation_jobs` — idempotent request hashes, reservations, Google operation IDs, completion status, cost, and R2 output keys.

## 3. Add secrets — never commit them

Create a strong FPAI control token:

```bash
openssl rand -hex 32
```

Store it as a Worker secret:

```bash
npx wrangler secret put FPAI_CONTROL_TOKEN
```

Then store the Gemini API key:

```bash
npx wrangler secret put GEMINI_API_KEY
```

Do not put either secret in `.env`, source code, screenshots, GitHub issues, or browser localStorage.

## 4. Deploy the adapter

```bash
cp wrangler.example.toml wrangler.toml
# edit wrangler.toml with the D1 database ID and allowed Film Studio origin
npx wrangler deploy --config wrangler.toml
```

The deployed Worker should expose:

```text
GET  /health
POST /api/generation-jobs
GET  /api/generation-jobs/:id
GET  /api/generation-jobs/:id/media
```

Check configuration without spending money:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

`liveExecutionReady` must be `true` before a real request is attempted.

## 5. What the Worker enforces

The server does not trust the browser's cost number. It looks up the route in the shared `ROUTES` catalog and recalculates billable seconds and estimated cost.

It rejects a request when:

- the route is not a paid Google route known to Film Studio;
- model, resolution, or duration does not match that route;
- the same deterministic request hash already exists (the existing job is returned instead of creating another charge);
- the request exceeds `MAX_SINGLE_JOB_USD` (default `$4`);
- projected generation spend exceeds the emergency ceiling (default `$250`);
- projected spend exceeds the working ceiling (default `$200`) without a confirmed owner override;
- Veo Standard or 4K is requested without a confirmed owner override.

The default project generation target remains `$125`.

## 6. Google routing

### Gemini Omni Flash

`gemini-omni-1.1-flash` is sent through the Gemini Interactions API. Completed video bytes are immediately written to the `GENERATION_MEDIA` R2 bucket.

### Veo 3.1

Veo routes use `predictLongRunning`. The first request stores the Google operation name and returns a running FPAI job. Calling:

```text
GET /api/generation-jobs/:id
```

polls the Google operation. When Google marks it done, the Worker downloads the MP4 immediately, stores it in R2, clears the reservation, and marks the job completed.

This means browser refreshes do not create duplicate generations and the finished file is not left only on Google's temporary download URL.

## 7. Browser integration contract

`src/googleAdapter.js` exposes:

```js
const adapter = createGoogleVideoAdapter({
  baseUrl: "https://YOUR-WORKER.workers.dev",
  token: ownerSessionToken,
});

await adapter.health();
const result = await adapter.submit({ packet, project, ownerOverride });
const status = await adapter.status(result.job.id);
```

The client adapter will not submit while Film Studio's existing `generateAllowed` execution gate is closed.

For the first production test, do not enable broad automatic generation. Unlock exactly one low-cost test shot, keep the route on Lite/720p or Omni/720p, and confirm the D1 reservation, Google operation, R2 object, and final ledger entry before enabling additional shots.

## 8. First live test checklist

Before the first paid request verify all of these:

- `/health` returns `liveExecutionReady: true`.
- The selected shot's animatic timing is approved.
- The scene animatic is locked.
- Character continuity blockers are clear.
- The route and one-attempt cost look correct.
- The shot cap is above the one-attempt cost.
- Standard and 4K remain off.
- The request hash has not already been used.
- Only one shot is submitted.

After submission verify:

- D1 contains one `generation_jobs` row.
- Veo shows `running` until the long-running operation completes, or Omni completes directly.
- R2 receives the MP4.
- A second submission with the same request hash returns the existing job instead of generating again.

## Current safety state

The code is ready for deployment, but no Gemini key or Cloudflare resource identifier is committed. No live Google request is performed merely by merging this branch. Live execution begins only after the Cloudflare bindings and secrets above are configured and the Film Studio UI deliberately opens its existing execution gate.
