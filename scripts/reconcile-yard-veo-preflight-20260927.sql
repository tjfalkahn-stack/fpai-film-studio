-- These two Lamar submissions used redirect: "error", which Cloudflare Workers
-- rejected synchronously before either HTTP request could reach Google.
-- Limit this correction to the screenshot-confirmed render IDs and exact state.
UPDATE renders
SET status = 'failed',
    reserved_cost = 0,
    actual_cost = 0,
    cost_basis = 'pre-submit-cloudflare-option-error',
    error_json = '{"code":"PRE_SUBMIT_FAILURE","message":"Cloudflare rejected the unsupported redirect option before contacting Google. No provider job was started.","retryable":true,"uncertain":false}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (
    'dbaab1be-09ea-4980-bb6e-951d673a2fa3',
    '7e558685-ccb4-4a73-b804-5a414cdc7848'
  )
  AND project_id = 'the-yard-homecoming'
  AND shot_id = 'LAMAR'
  AND provider = 'veo-fast'
  AND status = 'uncertain'
  AND operation_id IS NULL
  AND json_extract(error_json, '$.code') = 'PROVIDER_TRANSPORT';
