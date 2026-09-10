# FPAI Film Studio — Render Engine Foundation

The new **Film Engine** workspace adds a persisted mock script-to-delivery workflow. See [Film Engine foundation, verification and remaining activation work](docs/FILM_ENGINE_FOUNDATION.md). It integrates the multi-photo Character Bible and preserves the original Enemies Closer seed and browser production. No live provider or final encoding is implied.

Start with [local testing and deployment](docs/RENDER_ENGINE_SETUP.md) and the [repository audit](docs/RENDER_FOUNDATION_AUDIT.md). Mock renders execute with zero provider spend; Veo Fast is implemented behind disabled server gates. Existing production UI and seed data are preserved.

The remaining v1.2 sections describe the retained economy planner. Executable providers and server cost controls are documented in the foundation runbook.

The [mock verification report](docs/MOCK_RENDER_VERIFICATION.md) includes the completed Shot 027 browser test, screenshots, 54 passing tests and deployment limits. Both live gates remain disabled.

## Retained Generation Economy Engine

## Generation Economy Engine

FPAI Film Studio v1.2 turns paid AI video generation into a controlled production pipeline instead of an unrestricted **Generate** button.

The application compiles every shot into a generation plan, selects the lowest expected-cost route, enforces continuity and budget gates, blocks duplicate requests, records reusable footage, and learns the actual cost per usable second from reviewed takes.

This branch is intentionally **dry-run first**. It can create queue reservations and complete generation packages, but it cannot contact Google or spend money until a server-side adapter is connected and provider execution is explicitly enabled.

## What is implemented

### 1. Animatic and continuity gates

Paid work is blocked until:

- the scene animatic is locked;
- the shot timing is approved;
- required character reference sets are complete and locked;
- selected production assets pass preflight;
- the request is not a duplicate;
- the shot still has attempts remaining; and
- the next request stays inside shot and production ceilings.

### 2. Shot Cost Compiler

Every shot receives normalized economy metadata:

- motion method: local, still, generative, or clip-vault reuse;
- shot class: generic, identity, multi-character, visible dialogue, vehicle, action, or hero;
- identity risk and motion complexity;
- final edit duration and provider-billed duration;
- selected model, resolution, price per second, and API surface;
- expected attempts, one-attempt cost, expected cost, and maximum exposure;
- shot cap, maximum attempts, local-audio strategy, and native-detail requirement;
- deterministic request hash for idempotency.

### 3. Expected-Cost Router

The router compares routes by **expected cost per usable result**, not just the advertised price per generated second.

It begins with safe priors and then uses reviewed ledger history after a route has enough samples. A lower-priced route can therefore lose to a higher-priced route when the higher-priced route consistently produces more usable footage in fewer attempts.

Current route catalog, captured on September 3, 2026:

| Route | Output policy | Planning rate |
|---|---:|---:|
| Local Composite | Local | $0.00/sec |
| Still + Local Motion | Local | $0.00/sec |
| Clip Vault Reuse | Reuse | $0.00/sec |
| Gemini Omni Flash 720p | Flexible 3–10 seconds | about $0.10/sec |
| Veo 3.1 Lite 720p | Fixed 8 seconds | $0.05/sec |
| Veo 3.1 Lite 1080p | Fixed 8 seconds | $0.08/sec |
| Veo 3.1 Fast 720p | Fixed 8 seconds | $0.10/sec |
| Veo 3.1 Fast 1080p | Fixed 8 seconds | $0.12/sec |
| Veo 3.1 Fast 4K | Fixed 8 seconds | $0.30/sec |
| Veo 3.1 Standard 720p/1080p | Fixed 8 seconds | $0.40/sec |
| Veo 3.1 Standard 4K | Fixed 8 seconds | $0.60/sec |

The pricing table is configuration data, not a billing guarantee. Confirm current Google pricing before enabling live execution.

Official references:

- Gemini API video generation overview: https://ai.google.dev/gemini-api/docs/video
- Gemini Omni Flash model: https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash
- Veo generation guide: https://ai.google.dev/gemini-api/docs/veo
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing

### 4. Duration-aware planning

The engine does not assume that every provider bills the final edited duration.

- Gemini Omni Flash requests are planned inside the current 3–10 second output range.
- Veo 3.1 requests are planned as fixed 8-second blocks.
- Longer shots split into the minimum legal number of requests.
- One-attempt cost is computed from provider-billed seconds, not timeline seconds.

This prevents a three-second Veo shot from being incorrectly priced as three seconds when the provider produces an eight-second clip.

### 5. Budget Governor

Default generation controls for the 27-minute proof of concept:

- target: **$125**;
- working ceiling: **$200**;
- emergency ceiling: **$250**;
- default maximum attempts per shot: **2**;
- owner override required above the working ceiling;
- owner override required for Veo Standard and 4K;
- no request may exceed its shot cap;
- no request may exceed the emergency ceiling.

The owner can edit these assumptions in the Economy dashboard. Production-budget accounting remains separate from the narrower generation budget.

### 6. Clip Salvage Vault

A generated clip is not treated as simply good or bad. Reviewers can record:

- generated duration;
- usable duration;
- exact usable ranges such as `0-2.4, 5.1-7.0`;
- continuity score;
- approval status;
- reusable asset ID;
- salvage notes and future uses.

Overlapping ranges are merged, ranges are clamped to source duration, and the ledger records actual cost per usable second. Salvaged clips can be routed back into later shots at zero additional generation cost.

### 7. Generation Ledger

Ledger entries now preserve:

- project, scene, shot, take, and generation IDs;
- provider, model, route, and shot class;
- estimated and actual cost;
- request, generated, and usable seconds;
- attempt number and attempt ceiling;
- request hash;
- approval and generation status;
- salvage status and reusable asset ID;
- structured metadata for reporting and future server reconciliation.

### 8. Safe queue behavior

The economy queue remains a browser planning feature. The new **Generate Take** panel executes through `/api/renders`. Both `LIVE_RENDERING_ENABLED` and `MOCK_E2E_VERIFIED` default to `false` on the server. Configuring credentials alone cannot enable live generation. See the foundation runbook for server ceilings, authentication and mock verification.

## 27-minute planning forecast

The default planning model uses:

- 1,620-second final runtime;
- 60% requiring paid generative motion;
- 1.3 edited seconds produced per source second;
- 1.8 generation attempts per accepted source second;
- $0.08 blended planning rate;
- 15% duration-rounding and hero-shot overhead.

That produces a planning forecast of approximately **$123.82**, compared with a naive four-pass model of **$518.40**. This is a configurable planning target—not a guaranteed invoice. Actual cost will come from the generation ledger and usable-footage review.

## Application areas

- **Overview:** production readiness and economy summary.
- **Economy:** forecast controls, budget targets, compiler output, and route performance.
- **Characters:** canonical identity, profile, full-body, expression, and wardrobe references, plus a per-character **Reference Library** of individual photos stored in R2/D1.
- **Scenes:** animatic lock and scene status.
- **Shots:** route, billed duration, cost, attempt limits, reuse, and local-repair controls.
- **Takes:** generated footage review, salvage timecodes, continuity scoring, and approval.
- **Assets:** production asset locks and reusable footage.
- **Continuity:** preflight blockers and package readiness.
- **Router:** full route catalog and learned actual economics.
- **Budget:** production ledger, generation reservations, actual spend, and audit history.

## Local development

Requirements:

- Node.js 22 or newer;
- npm.

```bash
npm ci
npm test
npm run build
```

For local development:

```bash
npm run dev
```

## Server adapter contract

The implemented provider-neutral render contract, Cloudflare setup, cost accounting and remaining production-state limitations are in [the render runbook](docs/RENDER_ENGINE_SETUP.md). The older `/api/generation-jobs` submission path is disabled so it cannot bypass the atomic render cost guard. Existing adapter code remains for historical integration context.

## Tests

The current suite covers:

- canonical character references and lock migration;
- multi-photo character reference libraries, coverage, lock versions, and deterministic shot selection;
- production-budget locking and audit history;
- economy metadata in ledger entries;
- Omni flexible duration and Veo fixed-duration planning;
- shot classification and default routing;
- provider learning from actual usable footage;
- deterministic request hashes;
- animatic, continuity, duplicate, attempt, shot-cap, owner, and production budget gates;
- dry-run queue versus live execution separation;
- salvage timecode parsing, clamping, merging, and reuse;
- the 27-minute generation forecast.
