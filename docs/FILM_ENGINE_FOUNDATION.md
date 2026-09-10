# Film Engine foundation

## Completion status

A functional, server-persisted **mock script-to-delivery foundation** is implemented. It is not a finished autonomous filmmaking service. The engine can import supported documents, review structured scenes, preserve script revisions, plan shots, select Character Bible references, organize lyrics and dialogue, review mock takes, assemble versioned cuts, and download a truthful delivery manifest.

The remaining product work and external activation requirements are listed explicitly below. No production deployment, paid generation, remote migration, or live switch activation was performed.

## Repository and integration

- Repository: `tjfalkahn-stack/fpai-film-studio`
- Feature branch: `astra/autonomous-film-engine`
- Inspected main baseline: `e7495c6`
- Integrated Character Bible work: PR #14, `39f4e35`. The feature branch includes that commit; this task did not merge PR #14 into main.
- Domain/ingestion milestone: `f1b8860`
- Persistence/mock workflow milestone: `da738cd`
- Creator workspace/validation milestone: `d36d6c0`
- Pull request: https://github.com/tjfalkahn-stack/fpai-film-studio/pull/15

The original `const seedShots` and `const seed` source block is unchanged byte-for-byte. `tests/fixtures/film-seed.sha256` checks the inspected baseline. The engine links an immutable copy of browser production on an explicit owner action; it never writes back to the old localStorage production. It preserves legacy `sec`, `move`, `prompt`, `approved`, stable IDs, and locked status. The snapshot retains every original field, even fields outside the new engine model.

## Architecture

The existing React app opens a **Film Engine** workspace. The existing Cloudflare Access frontend bridge authenticates browser requests and keeps the control token server-side. The existing adapter authenticates and scopes all engine routes to `RENDER_PROJECT_ID`.

`src/film/engine.ts` is the strict TypeScript production domain: immutable script revisions, source ranges, scenes, graph, breakdown, shot order, continuity facts, cue/lyric versions, voice records, review transitions, editorial cuts and delivery manifests. `src/film/documents.js` handles UTF-8, FDX, DOCX and browser PDF text extraction. It never sends script content to an AI provider.

`worker/filmEngine.js` handles scoped source uploads, command validation, durable version storage, reference selection, mock jobs, private asset reads and delivery downloads. It reuses PR #14's Character Bible and the existing original mock video slate. Existing ComfyUI and Veo adapters remain available through their existing gated interfaces; the new engine only permits mock execution.

R2 holds original source bytes, immutable production snapshots and mock outputs. D1 holds source metadata, the current revision pointer, and a compact audit/idempotency log. A command writes a unique R2 snapshot, then atomically commits a D1 event and advances the head if the expected revision still matches. A competing edit gets 409. Reusing a request key with the same command returns the saved result; a different command gets 409. Unadopted snapshots are removed when a conflict is detected. A process crash between the R2 write and D1 commit can leave an unreferenced object, which should be cleaned up by a future maintenance task.

There is no long-running encoding inside a Worker request. Mock video jobs move through queued, processing, completed, needs review, approved/rejected, revision requested and locked states. Running or queued mock jobs can cancel. Storage failures become failed jobs with at most two explicit retries. Other capabilities produce labeled JSON mock packages, never fake audio, images or transcriptions. No auto-retry of a live or ambiguous paid submission is introduced.

## Migration and routes

Apply **`worker/film-schema.sql`** after the existing schema, render schema and Character Bible schema. It is additive and repeatable, with no seed updates or table drops. `scripts/dev.mjs` combines the four schemas into one local initialization to make preview startup reliable.

| Table | Purpose |
| --- | --- |
| `film_heads` | Current snapshot pointer and optimistic revision |
| `film_events` | Immutable command type, request hash, request key, revision and snapshot history |
| `film_sources` | Private asset metadata, original filename, version, project, source hash, category, provenance, permissions and processing status |

All paths below start with `/api/projects/:projectId/film`.

| Method/path | Result |
| --- | --- |
| `GET /` | Production state, source metadata, graph, continuity warnings and mock capability policy |
| `POST /commands` | Versioned operation; requires `requestKey`, `expectedRevision` and a validated command |
| `POST /sources` | Multipart original-file upload with rights/provenance metadata |
| `GET /sources/:id/asset` | Authenticated source download, scoped to the current project |
| `GET /sources/:id/text` | UTF-8/FDX/DOCX extraction; PDF text is extracted in the browser |
| `GET /jobs/:id/asset` | Authenticated mock video or explicitly labeled mock package |
| `GET /history` | Most recent 200 persisted revisions |
| `GET /delivery/:cutId` | Delivery JSON for an approved cut |

Character Bible routes and provider adapters from PR #14 remain in place. References included in a saved Character Lock cannot be physically deleted through the API; exclude them from future generations instead, preserving historical assets.

## Module coverage

| Requested module | Working foundation | Remaining depth |
| --- | --- | --- |
| Source Library | Private originals; PDF, DOCX, FDX, TXT/MD, images, lyrics, notes and audio uploads; versioned metadata, SHA-256, rights, provenance and production links | Resumable uploads, larger media and automated transcription |
| Script and Story Graph | Reviewable deterministic extraction, scenes, cast, dialogue, action, page/line ranges, explicit acts/sequences, estimates, graph and script diffs | Semantic story interpretation, inferred relationships/loglines, robust dual-dialogue layouts and OCR |
| Production Breakdown | Scene-linked cast, locations, sets, props, vehicles, wardrobe, injuries, sound, effects and safety-action candidates; edit/approve/reject/merge/split | Broader semantic extraction; existing rules are deliberately bounded |
| Character Factory | PR #14 multi-photo library, expressions/angles, versioned locks and shot-relevant reference selection; identity reasons retained in jobs | Rich biography/physical details use notes and structured bible facts; no new autonomous visual identity QA claim |
| World and Continuity | Versioned production requirements and facts, explained cross-shot changes and duplicate coverage warnings | Metadata checks only; no image identity, geography or physical-safety validation |
| Shot Planner | Stable IDs, chronological display numbers, preserved legacy timing, manual shots, initial scene coverage, alternatives, locks, source remapping and revisions | Cinematographer-level automatic coverage, storyboard generation and drag-and-drop reordering |
| Music and Lyrics | Song/cue briefs, sectioned lyrics, immutable lyric versions, mock suggestions, beats/mixes/stem references, cue ranges, ownership and clearance | Real AI songwriting/music synthesis; dedicated split-percentage editor and clearance workflow |
| Voice and Sound | Script-linked dialogue, casting/voice notes, consent, pronunciation, performance, versioned records and audio sources | Live voice, lip sync, automated transcription and audio editing |
| Orchestration | Capability validation, explicit mock queue, costs fixed at zero, idempotency, cancellation, retry/recovery, selected references and version provenance | Background queue consumer and real execution bindings for the additional capabilities |
| Generation Review | Compare visible takes; exact prompt/reference/cost inspection; approve, reject, request revision and lock; preserve approved media | Automatic shot regeneration from revision notes; per-shot operator still queues an intentional new job |
| Editorial | Approved video takes, trims, timeline positions, separate lanes, audio-level metadata, captions/titles/credits, duration, versioned cuts and review notes | Waveforms, playback of a composed timeline, transition encoding, measured audio duration validation and professional NLE interchange |
| Delivery | JSON package containing bibles, shot list, cue sheet, lyrics, dialogue, WebVTT content, stems, rights, costs, provenance, history, cut and runner manifest | Final MP4/MOV encoding, packaged individual files and runner execution/verification |

## Verification evidence

Final local results: **111 tests passed, 0 failed**. Strict TypeScript checking and the production frontend build passed. The existing 99 tests remain passing; 12 new tests cover the film domain, document ingestion, legacy preservation and real Worker workflow.

- Strict TypeScript check: `npm run typecheck` (new TypeScript domain; retained JavaScript is covered by tests and bundling).
- Full unit/integration suite: `npm test`.
- Focused domain and real Worker/D1/R2 workflow: `npm run test:film`.
- Production frontend build: `npm run build`.
- Machine-readable mock acceptance evidence: [`film-engine-mock-e2e.json`](film-engine-mock-e2e.json).
- Screenshot: [`film-engine-qa/overview.jpg`](film-engine-qa/overview.jpg).

The mock end-to-end test uploads a clearly labeled **test-only adaptation of existing Enemies Closer shot subjects**. It extracts Marcus, Turner, Jasmine and Mikey, retains sparse locked legacy shots, imports individual references, builds Jasmine's lock, selects identity/crying/angle references, saves a lyric cue and voice direction, creates a mock video, reviews it, trims it into a cut, adds captions and produces the delivery package. It verifies restart persistence, authorization, upload signatures, reference preservation, replay safety, stale revisions, concurrent edits, unsupported capabilities, disabled paid requests and a zero network-call count.

The complete original Enemies Closer screenplay was not present in this assignment or repository. The fixture is not represented as the original screenplay or an approved rewrite. Validate the complete script and the owner's current browser production after the owner imports them. The test demonstrates the engine flow, not full-film extraction accuracy.

Browser QA verified opening the existing studio, linking the current seed production, uploading a screenplay fixture, extracting and parsing text, approving the breakdown, showing source-review requirements, saving original lyrics and restoring saved data after a reload. The automated runtime test, rather than the browser pass, covers the complete render-to-delivery sequence. Browser screenshots are desktop evidence; tablet behavior uses responsive CSS but has not been independently tested on tablet hardware.

## Activation and operating limits

1. Review this PR together with PR #14; merge the Character Bible prerequisite first to reduce the remaining diff. No merge or production deployment was performed here.
2. Apply the additive schemas to the intended environment and deploy the reviewed frontend/adapter. Keep `LIVE_RENDERING_ENABLED=false`, and keep separate character-generation live gates disabled unless independently authorized.
3. Import the actual screenplay and link the owner's actual existing production; review the draft extraction and map sparse legacy shots to approved script scenes.
4. For future real generation, configure and test a provider capability adapter, current credentials/model availability and explicit server-side cost approval. The new engine intentionally rejects non-mock providers, even when old adapters have credentials. Enabling an environment flag alone does not activate these new capabilities.
5. Implement a bounded authenticated media runner for final assembly, then verify encoded assets before reporting a successful master. The current delivery states `masterEncoded: false` and `awaiting_runner`.

This is the existing single-owner, configured-project studio boundary, not a new multi-tenant identity system. Source uploads are capped at 24 MB; scripts at 350,000 characters; PDFs at 350 pages; expanded document XML at 4 MB; snapshots at 12 MB. Large histories should eventually use granular records and archival snapshots. Command saves are explicit and acknowledged; unsaved form edits are not durable autosaved production data. Source originals and approved versions are never silently replaced.

No paid image, video, music, voice or rendering request ran. The local verification health endpoint reported live rendering disabled. Tracked live flags remain false. No claim is made about unqueried production configuration, visual identity accuracy, legal clearance, or an encoded finished film.
