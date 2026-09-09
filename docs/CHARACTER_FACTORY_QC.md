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
2. Export a working Comfy API-format still workflow.
3. Store it at `comfy/workflows/character-still.json` or set `COMFYUI_CHARACTER_WORKFLOW_JSON` server-side.
4. Set the real `COMFYUI_CHARACTER_COST_PER_IMAGE_USD` for the environment being tested.
5. Leave `CHARACTER_FACTORY_LIVE_ENABLED=false` while validating configuration.
6. Confirm the workflow produces a PNG or JPEG for a single dry smoke job.
7. Set `CHARACTER_FACTORY_LIVE_ENABLED=true` only for the controlled Marcus benchmark.
8. Run the Marcus plan and inspect `manifest.json` for first-pass rate, rejects, compute seconds, and actual configured spend.
9. If the benchmark passes, lock the workflow/model combination as Character Factory v1.

The remaining external dependency is the actual Comfy still workflow graph that matches the models installed on the target Comfy deployment. That graph should not be guessed in code because node classes and model filenames are deployment-specific.
