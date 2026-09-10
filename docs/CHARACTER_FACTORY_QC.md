# Character Factory QC activation

This slice gives FPAI Character Factory a server-side visual QC brain and a complete runtime that can generate a character image in ComfyUI, judge it, reject or accept it, retry under a cap, and persist the final Character Bible package.

## Evaluator

Character QC uses the existing server-side `GEMINI_API_KEY`. The browser never receives the key or the raw QC prompt.

Default model:

```text
gemini-2.5-flash
```

Override with:

```text
CHARACTER_QC_MODEL=<supported multimodal Gemini model>
```

The evaluator returns the exact metrics expected by `scoreCharacterResult`:

- identity
- anatomy
- framing
- wardrobe
- artifactFree

Scores are clamped to 0..1. The existing Character Factory pass gate remains authoritative.

## Live gate

No autonomous image spend occurs unless this is explicitly enabled:

```text
CHARACTER_FACTORY_LIVE_ENABLED=true
```

Recommended first benchmark settings:

```text
CHARACTER_FACTORY_MAX_ATTEMPTS=3
CHARACTER_FACTORY_WIDTH=1024
CHARACTER_FACTORY_HEIGHT=1024
CHARACTER_FACTORY_POLL_MS=1500
```

Keep the broader Film Studio video live gate separate. Character Factory still generation should be proven with Marcus before any autonomous video generation is expanded.

## Storage

Accepted and rejected images are persisted separately in `GENERATION_MEDIA`:

```text
character-factory/<character-id>/accepted/...
character-factory/<character-id>/rejected/...
character-factory/<character-id>/character.json
character-factory/<character-id>/manifest.json
```

This gives the benchmark a durable record of retries, failed images, accepted images, QC scores, compute time, and configured generation cost.

## Marcus Benchmark 001 activation order

1. Deploy native ComfyUI (RunPod’s built-in ComfyUI Pod template is the supported path; see [RUNPOD_COMFYUI.md](RUNPOD_COMFYUI.md)).
2. On the Pod, run `bash deploy/runpod-comfyui/bootstrap.sh`, then restart ComfyUI.
3. Call `GET /api/character-factory/preflight` and confirm `ready: true`. Do not enable live flags while preflight is red.
4. Set the real `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` after the first controlled still (one Jasmine image), not before.
5. Leave `CHARACTER_FACTORY_LIVE_ENABLED=false` in the repo and in production until that one-still test is scheduled.
6. Film Studio owns the photoreal identity workflow; do not export a canvas graph unless you are deliberately overriding it.
7. Set `CHARACTER_FACTORY_LIVE_ENABLED=true` only for the scheduled GPU session, run the single Jasmine still, then turn the flag off. Only then consider Marcus Benchmark 001.
8. Inspect `manifest.json` for first-pass rate, rejects, compute seconds, and configured spend.

The remaining external dependency is a running RunPod Pod with the bootstrapped RealVisXL + IPAdapter stack. Node names are not guessed at runtime; Film Studio builds the graph.
