# Higgsfield video provider

Adds Kling 3.0 Standard and Pro image-to-video to Generate Take and the production connection status panel. Both use exactly one composed Shot Start Frame, 5 or 10 seconds, portrait or landscape. The model endpoint determines output tier; framing follows the input image. Character Bible references are not silently substituted for the start frame.

## Server setup

In Cloudflare, open Workers & Pages → `fpai-film-studio-video-adapter` → Settings → Variables and Secrets.

Add a **secret** named `HF_CREDENTIALS` with the full `KEY_ID:KEY_SECRET` value from Higgsfield. Never place this value in frontend variables, source, screenshots, or a PR.

Configure these plain variables with the current rates for the exact model and sound setting shown in your account (USD per output second):

- `HIGGSFIELD_KLING3_STANDARD_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_STANDARD_AUDIO_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_PRO_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_PRO_AUDIO_RATE_PER_SECOND_USD`

Unset prices reject quotes for that setting. Do not substitute a promotional starting price for an unverified audio price. Audio defaults off in the UI.

After configuration and deployment, set `HIGGSFIELD_LIVE_ENABLED=true` when ready to enable submissions. The existing project/session/job caps, authentication, continuity approvals and Yard trial restrictions still apply. Integration alone does not authorize or start a paid render. Existing provider gates and secrets are unchanged.

## Behavior and limits

- Server uploads the selected image using Higgsfield presigned storage, then submits the documented Kling endpoint.
- Queue stores the returned status URL and polls it; API credentials only go to api.higgsfield.ai.
- Lost responses, server errors and malformed successful submissions remain uncertain; their budget reservation is retained. No automatic resubmission.
- Duplicate pending shots and unacknowledged uncertain jobs block another paid attempt across LTX, Veo and Higgsfield.
- Completed video passes through the existing R2 output persistence and shot download workflow.
- Ledger amounts are configured-rate estimates, not invoiced charges. Failed/moderated/canceled jobs conservatively retain the estimated charge until reconciled against Higgsfield billing.
- Studio does not expose provider-side cancellation after submission. Polling and downloads continue if the live gate is turned off.
- Initial scope: Kling 3.0 Standard/Pro image-to-video. Other Higgsfield catalog models are not yet integrated.

## Verification

Mocked provider tests exercise audio-specific quotes, start-frame selection, credential isolation, submission payloads, ambiguous outcomes, polling and output download. No paid provider call is needed for this suite.

Sources checked 2026-09-28:
- https://open.higgsfield.ai/models/kling-video/v3.0/pro/image-to-video/api-reference
- https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference
- https://docs.higgsfield.ai/docs/concepts/file-uploads
- https://docs.higgsfield.ai/docs/concepts/requests
