# Render engine foundation audit — 2026-09-07

## Verification update — after PR #5

PR #5 merged into `main` at `5a624524da7627869b71749ae191cb44aa03c29e`. The follow-up pass starts from that commit. The complete mock browser flow now passes, with 54 automated tests and screenshot evidence in [MOCK_RENDER_VERIFICATION.md](MOCK_RENDER_VERIFICATION.md). Both live gates remain disabled by instruction. The original findings below are retained as historical audit context.

## Original repository baseline

Audited the tracked source, tests, manifests, SQL, documentation and all remote branch tips. `main` (`3d11813`) contains only the early UI; it is not the current full studio. The implementation is based on `feature/google-video-adapter-v1.3` at `d59874c`, which includes v1.2 economy work and the v1.3 Worker/service-binding bridge. The Forge branch ends at `ad524e7` and lacks the final bridge changes. No AGENTS.md or Sites hosting manifest was present.

The foundation was built on the adapter branch to retain the full production UI. PR #5 subsequently promoted that combined implementation into `main`.

## Existing functionality and findings

| Area | Baseline finding | Foundation result |
|---|---|---|
| Project state | Working browser state for Enemies Closer; v1.2 metadata migrations. No server production-state store. | Seed block and shot definitions unchanged byte-for-byte. Same storage key. |
| Character Bible | Canonical identity/front, profile, full body, expression, wardrobe uploads; drag/drop, expression bank, editable notes. IndexedDB media. | Preserved; additional legacy references such as rain are retained by normalization instead of silently discarded. |
| Character locks | Metadata completeness gate and manual lock; replacing/deleting required refs unlocks. It is not a visual identity validator. | Preserved. Live UI checks underlying stored media exists. Mock slate tests do not unlock or fabricate cast references. |
| References | Generation plans contain browser media keys; the old adapter did not transmit actual images. | Up to three explicitly selected PNG/JPEG reference payloads reach the provider. All Bible references remain stored. Payloads live in private R2, avoiding D1's row size limit. |
| Scenes | Existing Scene 001 and animatic approval/lock workflows. No timeline renderer. | Preserved. Live execution requires the owner's timing/continuity attestations. |
| Shots | Eight seeded shots; shot editor, classes, camera/prompt/economy options. Shot 027 has a 4.5-second edit. | Adds a render panel inside the existing drawer. Source duration is distinct from edit duration. |
| Takes | Upload, approval, rejection, salvage ranges and reuse exist. Upload cost defaulted to an estimate; approval could repeatedly add costs or consume an unrelated pending job. | Upload cost defaults to zero. Generated takes arrive after asset storage. Approval uses the exact take/render identity, is idempotent and does not create a second charge; rejection preserves spend. |
| Continuity | Metadata checks and asset warnings only; no image similarity, identity scoring, automated QA or versioned lock snapshots. | Clearly retained as preflight. Browser-owned state is not falsely described as an authoritative server production database. |
| Providers/router | Working economy planner and static provider catalog; `googleAdapter.js` was not connected to the UI. Local finish/reuse routes plan work, not executable renderers. | New provider interface and Mock/Veo Fast adapters. Existing catalog/planning features remain. Other models are not enabled for execution. |
| Backend | Existing D1/R2 Worker could start paid jobs when credentials were configured. Cost check then insert was non-atomic. Multiple planned segments could be priced while only one Veo sample was requested. No cancel route or explicit server live-disable flag. | One executable source clip per render; atomic cost reservation, full disabled default, operation tracking, normalized errors and cancellation semantics. Unsafe legacy create endpoint is fail-closed; legacy source and media-read functionality remain. |
| Frontend bridge | Server control token added to unauthenticated callers; CORS alone did not authorize a user. | Cloudflare Access signature/issuer/audience/expiry validation before forwarding. Browser never receives Gemini/control token. Cross-origin writes rejected. |
| Cost ledger | Browser planning ledger and D1 ledger disconnected. Estimated cost copied on completion; download failures could erase cost; no server session ceiling. | Authoritative render rows track estimated, reserved, actual usage cost and explicit billing basis; session/project ceilings include unresolved reservations. Legacy D1 liabilities count against the project cap. |
| Persistence | localStorage metadata + IndexedDB files; no sync/backup/quota recovery, and no background completion. D1/R2 existed only for adapter jobs. | Render jobs/references/output durable in D1/R2; browser restores recent jobs/takes on load and polls. Reviews remain browser-local. Worker restart recovery verified. |

## Architecture and cost semantics

`RenderPanel` → `renderClient` → authenticated frontend service binding → render service → provider interface → private R2 asset → existing take review.

- `/api/renders` accepts a provider-neutral request. `estimateOnly:true` computes a server quote without queueing or contacting Google. Submission requires a stable request key and the accepted quote.
- A server SHA-256 digest covers render inputs. Replaying the same key returns the existing render; changing its payload gives 409. Intentional new takes use new keys. Unknown submissions never automatically resubmit.
- A single D1 `INSERT ... SELECT` condition checks and reserves cost atomically. Server session IDs cannot be reset by a browser refresh or request field. Defaults: $10 session, $20 project, $4 per render. The existing $1,200 production budget/forecast is separate.
- Mock renders cost $0 and use an original, locally generated 8-second H.264 1280×720 test slate. It is not AI-generated Marcus footage. No model endpoints are used.
- A submitted Veo operation cannot be guaranteed canceled through this adapter. Queued work can cancel; running Veo cancellation returns 409 and keeps tracking/cost. Mock cancellation is supported.
- Missing or lost submission responses enter `uncertain`; crashes during submission become uncertain after two minutes. Reservations remain. Operators reconcile provider operations before deciding to release or retry.
- Google does not return a final invoice amount in the operation response. `actualCost` records successfully completed seconds at the quote's published tariff, with `costBasis: completed-usage-at-quoted-rate`. It is not invoice-confirmed billing. Failed/no-video provider outcomes record zero per published successful-generation billing; ambiguous outcomes stay pending.
- Charge is persisted before asset download. Retrieval failure keeps the completed charge and retries retrieval without regeneration. API responses expose only the authenticated asset route, never Google signed asset URLs or reference bytes.

## Verification and limits

The foundation baseline passed 48 automated tests. The follow-up pass now passes 54. Automated checks cover baseline regressions, zero-network mock lifecycle, actual workerd runtime and restart recovery, MP4 range responses, exact-take merge/review/idempotency, auth rejection, input validation, duplicate keys, concurrent budget reservations, disabled legacy/live execution, Veo payload mapping using injected responses, uncertain submission, failure accounting, paid asset-retrieval failure and large reference persistence. FFprobe confirms an 8.000-second H.264 1280×720 fixture. Client build and both Worker dry-run bundles pass.

The original foundation browser attempt was blocked by the preview environment. The follow-up pass successfully opened the supported preview, fixed HTTP-preview submission, and completed the Shot 027 browser workflow. Playback, seeking, mute/unmute, approval/rejection, cancellation and refresh recovery are verified. See the linked verification report for screenshots and exact limits. `MOCK_E2E_VERIFIED` and `LIVE_RENDERING_ENABLED` both remain `false` by instruction; a successful local test does not enable live rendering or verify the deployed Access setup.

## Remaining blockers / scope limits

1. The foundation is published and merged through PR #5; review the follow-up verification PR before deploying its HTTP-preview and mock-audio fixes.
2. Configure real Cloudflare bindings and owner Access application/audience, deploy with both live gates disabled, and repeat the browser smoke test through Access. No remote configuration, resource creation or deployment was performed in either pass.
3. Veo has only mocked contract tests, not a live smoke test. Verify account access, current model availability and price, then explicitly enable only when authorized to spend.
4. Invoice reconciliation is manual; Google operation responses provide no exact billed cost. No refund is invented for local cancellation/download failure.
5. Production metadata, references before render submission, approvals and salvage edits remain local to this browser/origin. LocalStorage quota/IndexedDB eviction and multi-user production sync are future persistence work.
6. Polling runs while the app is open. Reopening resumes jobs; no background scheduler downloads assets while every client is closed. Retrieve Google assets promptly before provider retention expires. The list returns 200 recent rows with active/unretrieved jobs first; individual IDs remain retrievable.
7. Server cost limits are authoritative, but character locks/shot timing/shot attempt caps are still owner-controlled local production metadata, not a multi-user authorization system. This is a single-project owner studio service, scoped by `RENDER_PROJECT_ID`.
8. Only Mock and Veo Fast execute. Omni, Lite, Standard, 4K, multi-segment assembly, local compositor, upscaler and automated continuity scoring remain planning/future integrations.
9. A crash before the D1 insert can leave an unreferenced input object; eventual orphan cleanup is maintenance work. Do not automatically expire inputs or outputs still referenced by a render.

## Changed files

| Files | Purpose |
|---|---|
| `worker/providers/{contract,index,mock,veo,mock-video}.js` | Provider interface, registry, original mock fixture and Google translation. |
| `worker/renders.js`, `worker/render-schema.sql` | Render routes, lifecycle, cost reservations, private references and assets. |
| `worker/index.js` | Integrates routes and live kill switch; closes unsafe legacy submission. |
| `frontend-worker/auth.js`, `frontend-worker/index.js` | Verified Access authentication and secure proxy/range forwarding. |
| `src/RenderPanel.jsx`, `src/renderClient.js`, `src/takeReview.js` | Render UI, server synchronization, take review/accounting. |
| `src/main.jsx`, `src/styles.css` | Integrates render controls inside existing workflow. |
| `src/domain.js`, `src/economy.js` | Preserves extra legacy references and excludes mock renders from paid-attempt counts. |
| `tests/*.test.js`, `frontend-worker/index.test.js` | Runtime, cost, security, adapters and review regression coverage. |
| `vite.config.js`, `scripts/dev.mjs`, `wrangler*.toml`, `package*.json`, `.gitignore` | Reproducible local build/test/deploy setup and ignored private configs. |
| `docs/*`, `README.md`, `VIDEO_ADAPTER_SETUP.md` | Audit, current runbook and historical-document corrections. |

## Primary references checked

- [Google Veo guide](https://ai.google.dev/gemini-api/docs/veo): model ID, REST operation payload, inline images, 4/6/8 seconds and 8-second reference/1080p requirement.
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing): Fast 720p $0.10/sec, 1080p $0.12/sec; successful-generation billing.
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): signed application identity validation.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): database row size constraints.
