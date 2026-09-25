# Yard spokesperson audio-driven take

Film Studio now has a `sync-lipsync-v3` render route for The Yard Is Home / scene YARD / shot SPK. It pairs the approved Shot Start Frame with a six-second PCM WAV and returns one MP4 whose mouth movement follows that recording. This is separate from the LTX image-to-video route, which can generate audio but does not accept the owner's WAV.

## Operator setup

1. Verify the current `fal-ai/sync-lipsync/v3/image-to-video` rate with fal.ai and set `SYNC3_RATE_PER_SECOND_USD` on the render Worker. The example rate is a configuration sample, not a billing guarantee.
2. Set `FAL_KEY` as a Worker secret. This provider does **not** spend Google AI Studio credit.
3. Keep `SYNC3_LIVE_ENABLED=false` until the Worker and frontend builds are deployed, the key and rate are confirmed, and the owner has reviewed the quoted amount. The route is isolated from the general `LIVE_RENDERING_ENABLED` and Seedance gates.
4. With the gate enabled, open The Yard Is Home → SPK. The existing shot migrates to a six-second edit length and the new lip-sync renderer is selected by default. Confirm the approved portrait is present as its Shot Start Frame. Upload `PV_Yard_VO_6s_Edit.wav`, inspect the quote, approve shot timing and scene animatic, then submit once.
5. Review the resulting take at normal speed and at first, middle, and last frames. Reject identity drift or poor mouth shapes. Do not submit a second paid take automatically.

The server permits only one SPK Sync-3 request at 720p, 9:16, six seconds, with one image, one WAV, and a quote no higher than $0.81. Its ordinary project/session and shot cost controls also apply. The audio bytes are staged in private render-input storage for the queued job and excluded from the D1 render metadata and public status response.

Provider schema and base64 data URI support: https://fal.ai/models/fal-ai/sync-lipsync/v3/image-to-video/api
