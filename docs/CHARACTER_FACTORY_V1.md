# FPAI Character Factory v1

Character Factory v1 is the first autonomous-production layer above the existing FPAI Film Studio ComfyUI render engine.

The immediate benchmark is Marcus. The system must turn one canonical character specification into a deterministic production-reference matrix before paid video generation starts.

## What is implemented

- Machine-readable character profile normalization.
- First-class medium presets: cinematic, animation, anime, cartoon, comic, vintage, hybrid.
- Automatic Character Bible job matrix:
  - 8 canonical angle/body references.
  - expression matrix.
  - wardrobe matrix.
  - 4 continuity stress tests across lighting/lens conditions.
- Stable prompt construction that carries identity, proportions, protected traits, wardrobe, and negative traits into every job.
- QC scoring contract for identity, anatomy, framing, wardrobe, and artifact cleanliness.
- Benchmark accounting for retries, rejection count, compute seconds, cost, cost per accepted asset, first-pass rate, and final readiness.
- Marcus Benchmark 001 specification.
- Dry-run benchmark planner command. It creates the full plan without submitting a render.

## Benchmark 001: Marcus

Run:

```bash
npm run character:benchmark
```

Default input:

```text
benchmarks/marcus.character.json
```

Default output:

```text
benchmarks/output/marcus.cinematic.plan.json
```

The default Marcus specification explicitly protects his tall 6'2 apparent height and lean athletic proportions and rejects the short/squat drift observed during manual development.

To test another medium:

```bash
node scripts/character-factory-benchmark.mjs --medium anime
```

Supported medium IDs are `cinematic`, `animation`, `anime`, `cartoon`, `comic`, `vintage`, and `hybrid`.

## Pass criteria

Every required Character Bible job must receive an accepted asset. The benchmark is `ready` only when:

1. required-job acceptance rate is 100%, and
2. first-pass acceptance is at least 70%.

Individual candidate frames pass automatic QC only when the weighted quality score is at least 0.82, identity fidelity is at least 0.85, and anatomy is at least 0.80.

These thresholds are intentionally demanding. Character Factory is supposed to eliminate manual babysitting, not merely generate attractive images.

## Output package

The target package is:

```text
marcus/
  identity/
  angles/
  expressions/
  full_body/
  wardrobe/
  continuity_tests/
  rejected/
  character.json
  manifest.json
```

`character.json` is the machine-readable identity Bible. `manifest.json` is the benchmark ledger and acceptance history.

## Relationship to the existing ComfyUI engine

The repository contains a server-side native ComfyUI provider for video (`/prompt`, `/history`, `/view`) and a dedicated still-image Character Factory executor on the same API. Character Factory does not replace the video provider. It sits above rendering and creates the deterministic work packets, prompts, identity rules, medium choice, QC contract, and benchmark accounting. See [native RunPod ComfyUI setup](RUNPOD_COMFYUI.md).

The current benchmark planner is intentionally non-rendering. This lets the factory contract and Marcus matrix be tested without consuming GPU/API spend or weakening the existing live-render gate.

The still-image executor, photoreal identity workflow, RunPod bootstrap, and Comfy preflight now exist. Live generation remains disabled. The first authorized GPU action after merge is a **single Jasmine still**, not the full Marcus matrix. See [RUNPOD_COMFYUI.md](RUNPOD_COMFYUI.md).

## Why this is the foundation for script-to-studio

Once the same factory can create an unseen character from screenplay text, the higher-level pipeline can become:

```text
Script / Lyrics
  -> Story analysis
  -> Character discovery
  -> Character Factory
  -> World / location bible
  -> Medium + Production DNA
  -> Shot factory
  -> Director approval / budget gate
  -> Video generation
  -> QC
  -> Edit
  -> Finished shorts / episodes
```

The expensive video stage remains behind explicit authorization. Character and planning stages can run independently first.
