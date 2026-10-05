# Higgsfield video provider

Adds Kling 3.0 Standard and Pro (text or image), Seedance 2.5 (text or image), and Genjutsu Motion Transfer to Generate Take. Image routes use exactly one composed Shot Start Frame. Text routes send no image. Motion Transfer uses an uploaded MP4 (stored privately in R2) or a public HTTPS reference video URL, plus one to eight selected images. The model selector determines the endpoint and input shape.

## Server setup

In Cloudflare, open Workers & Pages → `fpai-film-studio-video-adapter` → Settings → Variables and Secrets.

Add a **secret** named `HF_CREDENTIALS` with the full `KEY_ID:KEY_SECRET` value from Higgsfield. Never place this value in frontend variables, source, screenshots, or a PR.

The app can quote with the published pre-discount rates using only the secret. These plain variables optionally override that estimate with your account's current rates (USD per output second):

- `HIGGSFIELD_KLING3_STANDARD_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_STANDARD_AUDIO_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_PRO_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_KLING3_PRO_AUDIO_RATE_PER_SECOND_USD`
- `HIGGSFIELD_SEEDANCE25_480P_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_SEEDANCE25_480P_AUDIO_RATE_PER_SECOND_USD`
- `HIGGSFIELD_SEEDANCE25_720P_SILENT_RATE_PER_SECOND_USD`
- `HIGGSFIELD_SEEDANCE25_720P_AUDIO_RATE_PER_SECOND_USD`
- `HIGGSFIELD_GENJUTSU_480P_RATE_PER_SECOND_USD`
- `HIGGSFIELD_GENJUTSU_720P_RATE_PER_SECOND_USD`
- `HIGGSFIELD_GENJUTSU_1080P_RATE_PER_SECOND_USD`

Audio defaults off in the UI. Published rates are estimates, not guaranteed provider charges. Confirm the amount in Higgsfield billing after a render; the ledger retains its estimate until reconciled.

The same four Kling rates apply to the corresponding text and image routes. Set only the rates for modes you intend to use. The owner explicitly accepts the quoted estimate before each submission. The separate `HIGGSFIELD_LIVE_ENABLED` switch and fixed shot, session, and project cost ceilings do not block Higgsfield; a pending job or unacknowledged uncertain job still prevents duplicate submission for the same shot. Other providers retain their own controls. The Yard trial routes remain separate.

## Behavior and limits

- Server sends stored PNG/JPEG frames as expiring HMAC-signed adapter URLs. Higgsfield's presigned upload is only a fallback when a render ID is missing. Worker fetches use `redirect: "manual"` so Cloudflare does not discard the upstream HTTP status before the origin is contacted.
- Direct Video Creation and the Shot Editor accept separate start and optional end images for Kling 3 image-to-video and Seedance 2.5 image-to-video. The adapter sends Kling's `last_image_url` or Seedance's `end_image_url`; other routes cannot receive an end frame.
- Genjutsu is motion transfer: it needs an uploaded MP4 or a source video URL, plus one to eight reference images, and does not use start/end frame controls.
- Queue stores the returned status URL and polls it; API credentials only go to api.higgsfield.ai.
- Lost responses, server errors and malformed successful submissions remain uncertain; their budget reservation is retained. No automatic resubmission.
- Duplicate pending shots and unacknowledged uncertain jobs block another paid attempt across LTX, Veo and Higgsfield.
- Completed video passes through the existing R2 output persistence and shot download workflow.
- Ledger amounts are configured-rate estimates, not invoiced charges. Failed/moderated/canceled jobs conservatively retain the estimated charge until reconciled against Higgsfield billing.
- Studio does not expose provider-side cancellation after submission. Polling and downloads continue if the live gate is turned off.
- Genjutsu quotes use the Source duration chosen in Film Studio. Enter the reference clip's rounded-up length; the provider charges for its actual input duration. Use the Higgsfield Playground if you need a route outside the seven choices currently listed.

## Verification

Mocked provider tests exercise audio-specific quotes, start-frame selection, credential isolation, submission payloads, ambiguous outcomes, polling and output download. No paid provider call is needed for this suite.

Sources checked 2026-09-28:
- https://open.higgsfield.ai/models/kling-video/v3.0/pro/image-to-video/api-reference
- https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference
- https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/api-reference
- https://open.higgsfield.ai/models/kling-video/v3.0/pro/text-to-video/api-reference
- https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference
- https://open.higgsfield.ai/models/bytedance/seedance-2.5/image-to-video/api-reference
- https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/playground
- https://docs.higgsfield.ai/docs/concepts/file-uploads
- https://docs.higgsfield.ai/docs/concepts/requests
