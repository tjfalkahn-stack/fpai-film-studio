# Jasmine realism lock v2

`fpai.character-realism-lock.v2` is the permanent default for every new photoreal live-action character created by Character Factory. Jasmine's approved close portraits are the visual benchmark: a recognizable single identity, natural skin and hair detail, believable optics and light, neutral color, and no illustration, CGI, game-engine, beauty-retouch, or contact-sheet look.

The lock is enforced in four places:

1. Every live-action Character Factory job receives the canonical positive realism prompt and exact identity-preservation contract when planned, and the runner restores the contract if a job prompt is shortened or altered later.
2. The anti-CGI negative prompt is always merged with job/operator exclusions; callers cannot replace it with a shorter prompt.
3. RealVisXL uses DPM++ 2M Karras at 50 steps and IPAdapter weight 0.90 by default.
4. Live generation requires an approved primary identity anchor. QC sees up to three highest-ranked canonical references and rejects a candidate unless both identity and photographic-realism scores are at least 0.90.

New versioned Character Reference locks, Character Factory plans, accepted-character manifests, and benchmark manifests all record the realism-lock ID and version. Existing character rows, reference assets, shots, and older manifests are left intact.

The lock covers both cinematic and vintage/period live-action creation. Explicit non-photoreal media such as animation or anime remain intentional opt-outs. The default medium is cinematic, so ordinary new-character plans receive this lock automatically. A legacy photoreal plan without the current lock ID is refused and must be rebuilt before any live generation.

## Canonical positive prompt

The source of truth is `src/characterRealismLock.js`. In readable form:

```text
A highly realistic live-action photograph of a real human being, captured in camera; grounded documentary and editorial photography rather than character art; natural unretouched skin with visible pores, fine facial hair, subtle tonal variation, normal human asymmetry, realistic under-eye texture, and age-appropriate detail; physically plausible light falloff, shadows, reflections, and catchlights; neutral color science with restrained contrast and saturation; authentic hair, fabric, and material texture; believable full-frame photographic optics with natural depth of field, focus transition, and very fine restrained grain; honest, unstylized, production-reference photography.

IDENTITY LOCK: Treat the highest-ranked primary identity anchor as the sole authority for the face and likeness. Preserve the exact facial geometry, eye shape and spacing, nose, lips, jawline, ears, hairline, skin tone, distinguishing marks, apparent age, and body proportions. Supporting references may inform only the requested angle, expression, body view, wardrobe, or pose; never average, blend, beautify, or reinterpret the identity. The result must unmistakably depict the same person as the primary identity anchor.
```

Shot framing, wardrobe, expression, lighting, lens, and character-specific protected traits are appended after this immutable base. Character-specific exclusions are routed to the model's negative-conditioning input instead of being repeated as positive prompt terms. Every requested view is generated as an individual native-resolution image. Character sheets and miniature panel crops are review/organization inputs, not generation masters.

## Why these instructions

- OpenAI's image-prompting guide recommends explicitly requesting a real photograph, naming visible skin and material detail, describing framing and texture, assigning each reference a role, and restating identity invariants during edits: https://developers.openai.com/api/docs/guides/image-prompting
- Google's first-party image guide recommends concrete subject/light/composition details, positive framing, camera control, and a reference + relationship + scenario structure for consistent characters: https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana
- The RealVisXL V5.0 model card recommends DPM++ 2M Karras at 50 or more sampling steps: https://huggingface.co/SG161222/RealVisXL_V5.0
- The IP-Adapter authors document that higher adapter scale improves image-reference consistency while lower scale increases diversity: https://github.com/tencent-ailab/IP-Adapter

There is no prompt that mathematically guarantees a perfect photograph or identical face. This lock therefore combines prompting, high-resolution identity references, model conditioning, manifest versioning, and automated rejection rather than trusting prompt wording alone.

## Safety and spend

This policy does not enable rendering. `CHARACTER_FACTORY_LIVE_ENABLED`, `LIVE_RENDERING_ENABLED`, and `SEEDANCE_LIVE_ENABLED` remain false in repository configuration. It does not start RunPod, deploy Workers, or submit a generation.
