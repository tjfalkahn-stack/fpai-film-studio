# RunPod ComfyUI bootstrap

Installs the FPAI photoreal Character Factory stack onto the official RunPod ComfyUI Pod.

Do **not** run this from CI. Run it **on the Pod** after start. It does not generate images and does not enable Film Studio live flags.

```bash
bash deploy/runpod-comfyui/bootstrap.sh
bash deploy/runpod-comfyui/bootstrap.sh --verify-only
```

Details, cold-start order, and the Jasmine one-still test: [docs/RUNPOD_COMFYUI.md](../../docs/RUNPOD_COMFYUI.md).

Manifest: [models.manifest.json](models.manifest.json).
