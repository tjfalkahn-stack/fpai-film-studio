# FPAI Film Studio v1.2

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

The browser application can reserve a request in the ledger, but **live generation remains impossible in this branch** because:

- no API key is included;
- there is no client-side provider call;
- `serverAdapterConnected` defaults to `false`;
- `providerExecutionEnabled` defaults to `false`;
- the UI separately reports `queueAllowed` and `generateAllowed`.

This separation lets production staff validate cost, continuity, route, and payload before money can be spent.

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
- **Characters:** canonical identity, profile, full-body, expression, and wardrobe references.
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
npx vite
```

## Server adapter contract

The next live-integration layer should be a server-only endpoint such as:

```text
POST /api/generation-jobs
```

The server must never trust browser calculations. It should:

1. authenticate the production user and verify project access;
2. reload the authoritative scene, shot, continuity state, and budget ledger;
3. recalculate the route, legal duration, price, attempt count, and request hash;
4. enforce idempotency on the request hash;
5. reserve the maximum charge transactionally;
6. call the appropriate Google API surface;
7. poll the provider operation outside the browser request lifecycle;
8. download successful outputs immediately into durable project storage;
9. reconcile estimated versus actual cost;
10. release failed/canceled reservations;
11. return a provider-agnostic generation record to the client.

Suggested routing:

- `gemini-omni-1.1-flash` through the Gemini Interactions API;
- Veo models through `generateVideos`;
- API keys and credentials stored only as server secrets;
- provider responses normalized before entering the FPAI ledger.

No live provider adapter, credential, payment logic, or deployment is included in this pull request.

## Tests

The current suite covers:

- canonical character references and lock migration;
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

