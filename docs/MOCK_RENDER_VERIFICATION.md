# Mock render verification — 2026-09-07

**PASS: Shot 027 completed the browser workflow with $0 external API spend.**

Branch: `astra/mock-render-e2e-verification`, based on merged PR #5 / `main` commit `5a624524da7627869b71749ae191cb44aa03c29e`. This pass does not deploy or merge anything. `LIVE_RENDERING_ENABLED=false` and `MOCK_E2E_VERIFIED=false` remain in both checked-in render configurations, as requested.

## Browser evidence

Used the supported supervised preview and the provided Chrome browser. This runs the actual React UI, Vite's local API proxy and the actual mock-only Worker with local D1/R2. It does **not** prove the deployed Cloudflare Access login/service binding is configured. The preview restriction from the original foundation attempt did not block this pass.

Opened **Enemies Closer → Scenes → Scene 001**, then **Shots → #027 — Marcus hero reveal**. Final edit stays **4.5 seconds**, with an **8-second, 720p, 16:9** mock source.

| Check | Observed result | Screenshot |
|---|---|---|
| Target | Shot #027, Marcus hero reveal, original 4.5-second timing and camera | [Shot](mock-e2e/shot-027.jpg) |
| Quote and submission | Mock selected, $0.00 estimate, $10 session / $20 project ceilings; Generate creates queued job | [Queued](mock-e2e/queued.jpg) |
| Polling | Running state observed for the generated job | [Running](mock-e2e/running.jpg) |
| Completion | Completed job, $0.00 actual cost, take added with authenticated asset route | [Completed](mock-e2e/completed.jpg) |
| Video | Loaded 1280×720, 8-second video; play/pause, seeking and mute/unmute work | [Playback and seeking](mock-e2e/playable.jpg) |
| Approve | Approved state; repeated approval keeps the take count and zero-cost ledger unchanged | [Approved](mock-e2e/approved.jpg) |
| Reject | Rejected state; review persists after reload | [Rejected](mock-e2e/rejected.jpg) |
| Cancel | Canceled, $0.00 actual cost, no fourth take | [Canceled](mock-e2e/canceled.jpg) |
| Ledger | Three completed mocks plus one canceled mock; $0.00 actual, $0.00 queued, no production budget adjustments | [Budget](mock-e2e/budget.jpg) |

The screenshots cover successive checks of the same shot, not a single composite or fabricated state. Browser job IDs:

- `57b44993-c77f-492d-80a4-9acc1deabf07`: first completed mock after the HTTP fix; queued/completed captures. This original fixture was video-only.
- `0403b989-4ba3-4aca-baec-c734dc7befb7`: audio-enabled fixture; playback, seeking, mute/unmute, approve/reject and reload checks. Final review is Approved.
- `fca30a3b-82d6-46d0-9c8c-fe7969406669`: running screenshot; reloaded while active and recovered to a completed third take without resubmission.
- `b59733bc-1d30-4536-b359-019ea6ae7fbc`: canceled through the UI; no take added.

Playback measurements from the rendered video element: `readyState=4`, duration `8`, dimensions `1280×720`, progressing time to `7.803336`, seek back to `3.095890`; mute changed `false → true → false`. A final play/pause check changed `paused: false → true` at `0.002806 → 0.015152` seconds and remained paused. Native video controls are enabled. FFprobe confirms H.264 video plus AAC audio, total duration 8.000 seconds. The audio is a quiet synthetic 440 Hz test tone; no voices or external media were generated.

Completed takes and their video routes survived reload. Rejection survived reload; subsequent approval also survived the active-render reload. The final browser state contains three takes and four render ledger rows, all at $0.00. No cast reference, character lock, scene animatic, production budget or shot timing was edited.

Selecting **Veo 3.1 Fast** in the same panel displayed the configured **$0.80** quote for 8 seconds at 720p, the server-disabled message, and a disabled Generate button. This quote is local tariff calculation, not a Google request or a newly verified provider price. Returned to Mock without submitting Veo.

Also opened Characters, Scenes, Assets, Router, Continuity, Economy, Takes and Budget successfully. This is a navigation smoke check; existing personal uploads on another browser/origin were not accessible here. Browser extension metadata warnings were unrelated to application rendering.

## Bugs fixed

1. **HTTP preview submission crashed before queueing:** `crypto.subtle.digest` and `crypto.randomUUID` are secure-context-only APIs. The browser showed `Cannot read properties of undefined (reading 'digest')`. The client now uses `getRandomValues` for request keys and a bounded local retry fingerprint only for HTTP mock requests. HTTPS retains the prior SHA-256 identity format so saved retries still match. Paid/unknown providers fail closed without SubtleCrypto. The Worker's SHA-256 input verification and atomic reservations are unchanged and remain authoritative.
2. **The fixture had no audio track:** added a quiet, locally synthesized AAC tone to the existing mock video. This enables actual mute/unmute testing. The production seed and renderer workflow are unchanged.

## Engineering results

**54 tests pass; 0 failures. Production build and both Worker dry runs pass.**

```bash
npm ci
npm test
npm run build
npx wrangler deploy --dry-run --config wrangler.example.toml
npx wrangler deploy --dry-run --config wrangler.frontend.toml
npm run dev
```

Dependencies were already installed from the existing lockfile for this pass; no dependency or lockfile changes were needed. The commands above are the clean-checkout reproduction path. See [the setup guide](RENDER_ENGINE_SETUP.md) for OS requirements and exact Cloudflare deployment commands. Dry runs do not deploy.

- Actual Worker runtime verifies `GET /health` returns 200 and live execution false; `GET /api/renderers` returns Mock/Veo Fast, live false and the default $10/$20 ceilings.
- Creation, status, cancellation, private asset retrieval and Worker restart recovery pass against local D1/R2.
- MP4 byte-range retrieval returns **206**, a valid `Content-Range`, and MP4 header bytes. Browser seeking passes too.
- Both session-limited and project-limited concurrency tests issue eight simultaneous synthetic reservations: **one accepted, seven rejected**, then cancel the accepted queued reservation. Duplicate request keys reserve once. No paid provider is started by these budget tests.
- A failed mock with missing stored references records **failed, actual $0, reserved $0, no asset and no take**. Failure is injected only in the isolated automated-test bucket; this failure path is not claimed as a browser test.
- Provider-failure and completed-but-undownloaded cases retain correct accounting. Existing Veo contract tests use injected responses/fetch stubs, never a real provider. No-network assertions cover mocks, disabled-live/legacy paths and ceiling tests.
- `/api/generation-jobs` paid submission remains blocked. Auth rejection and bridge header/token handling tests pass. Cloudflare Access deployment still needs its real configuration and deployed smoke test.
- Browser source/build scan passes for Gemini/control-secret identifiers, the local control token, and Google API-key patterns. No Gemini key was configured or committed.

## Seed integrity

The **entire `src/main.jsx` is byte-for-byte unchanged** from the starting merged commit. The seed block from `const seedShots =` to `function openMediaDB()` is **4,332 bytes**, SHA-256:

```text
e98237e3d5d217e0d65b317be76c047cd970e33f203988b65980df0aecf6dfe2
```

See [machine-readable proof](mock-e2e-seed-proof.json). `src/domain.js`, `src/economy.js`, styling, the server render service and both live gate configurations are unchanged as well.

## Changed files and remaining gates

| Files | Change |
|---|---|
| `src/RenderPanel.jsx`, `src/renderClient.js` | HTTP mock submission and safe request identity/key generation |
| `worker/providers/mock-video.js` | Audio-enabled local mock slate |
| `tests/render-client.test.js` | Four regressions for HTTP fallback, random IDs, HTTPS compatibility and paid fail-closed behavior |
| `tests/renders.test.js`, `tests/runtime.test.js` | Failed-mock zero-cost test, independent project concurrency test, runtime health/catalog assertions |
| `README.md`, `docs/RENDER_ENGINE_SETUP.md`, `docs/RENDER_FOUNDATION_AUDIT.md` | Remove stale publication blocker and point to verified workflow |
| This report, `mock-e2e-seed-proof.json`, `mock-e2e/*.jpg` | Browser and integrity evidence |

Remaining deployment steps: configure the actual D1/R2 bindings, owner Access application/team/AUD and shared server control token; deploy both Workers with both gates false; repeat signed-in mock playback and unauthenticated rejection on that environment. No Cloudflare resources were changed in this pass.

Veo remains untested live. Account/model access, current pricing and any manual live enablement require a later explicitly authorized step. Existing limits remain: browser-local production metadata/reviews, no background completion scheduler, and manual billing reconciliation. Local browser verification does not remove those limits or spend authorization requirements.
