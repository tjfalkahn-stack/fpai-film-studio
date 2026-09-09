import hashlib
import json
import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

COMFY_URL = os.getenv("COMFY_INTERNAL_URL", "http://127.0.0.1:8188")
COMFY_ROOT = Path(os.getenv("COMFY_ROOT", "/workspace/ComfyUI")).resolve()
STATE_ROOT = Path(os.getenv("FPAI_STATE_ROOT", "/workspace/fpai-state")).resolve()
INPUT_ROOT = (COMFY_ROOT / "input").resolve()
OUTPUT_ROOT = (COMFY_ROOT / "output").resolve()
API_KEY = os.getenv("FPAI_COMFY_API_KEY", "")

STATE_ROOT.mkdir(parents=True, exist_ok=True)
INPUT_ROOT.mkdir(parents=True, exist_ok=True)
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="FPAI Comfy Engine", version="1.0.0")
client = httpx.AsyncClient(base_url=COMFY_URL, timeout=45.0)


def require_auth(authorization: str | None = Header(default=None)) -> None:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="Engine authentication is not configured")
    expected = f"Bearer {API_KEY}"
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def safe_path(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(status_code=400, detail="Unsafe file path")
    return target


def state_file(kind: str, item_id: str) -> Path:
    digest = hashlib.sha256(item_id.encode()).hexdigest()
    return STATE_ROOT / f"{kind}-{digest}.json"


def save_state(kind: str, item_id: str, data: dict[str, Any]) -> None:
    path = state_file(kind, item_id)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    tmp.replace(path)


def load_state(kind: str, item_id: str) -> dict[str, Any] | None:
    path = state_file(kind, item_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def normalize_asset_value(value: Any) -> Any:
    if isinstance(value, list):
        return [normalize_asset_value(v) for v in value]
    if isinstance(value, dict):
        if value.get("__type") == "core/ASSET":
            info = value.get("info") or {}
            file_path = info.get("file_path")
            if not file_path:
                raise HTTPException(status_code=400, detail="Invalid core/ASSET reference")
            return str(file_path).removeprefix("input/")
        return {k: normalize_asset_value(v) for k, v in value.items()}
    return value


def output_records(prompt_id: str, history: dict[str, Any]) -> list[dict[str, Any]]:
    outputs = history.get("outputs") or {}
    records: list[dict[str, Any]] = []
    for node_output in outputs.values():
        for key, media_type in (("images", "image"), ("gifs", "image"), ("videos", "video")):
            for item in node_output.get(key, []) or []:
                filename = item.get("filename")
                if not filename:
                    continue
                subfolder = item.get("subfolder") or ""
                item_type = item.get("type") or "output"
                content_type = (
                    "video/mp4" if media_type == "video" or str(filename).lower().endswith(".mp4")
                    else "image/jpeg" if str(filename).lower().endswith((".jpg", ".jpeg"))
                    else "image/png"
                )
                asset_id = f"out-{hashlib.sha256(f'{prompt_id}:{item_type}:{subfolder}:{filename}'.encode()).hexdigest()[:32]}"
                record = {
                    "id": asset_id,
                    "prompt_id": prompt_id,
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": item_type,
                    "content_type": content_type,
                    "media_type": media_type,
                }
                save_state("asset", asset_id, record)
                records.append(record)
    return records


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await client.aclose()


@app.get("/health")
async def health() -> dict[str, Any]:
    try:
        response = await client.get("/system_stats")
        response.raise_for_status()
        stats = response.json()
        return {
            "ok": True,
            "engine": "fpai-comfy-engine-v1",
            "comfy": "ready",
            "devices": stats.get("devices", []),
        }
    except Exception:
        return JSONResponse(status_code=503, content={"ok": False, "engine": "fpai-comfy-engine-v1", "comfy": "unavailable"})


@app.post("/api/v2/assets", dependencies=[Depends(require_auth)])
async def upload_asset(
    file: UploadFile = File(...),
    content_type: str = Form(default="application/octet-stream"),
    file_path: str = Form(...),
) -> dict[str, Any]:
    relative = str(file_path).removeprefix("input/")
    target = safe_path(INPUT_ROOT, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Asset exceeds 25 MB")
    target.write_bytes(data)
    asset_id = str(uuid.uuid4())
    record = {
        "id": asset_id,
        "kind": "input",
        "file_path": relative,
        "content_type": content_type or file.content_type or "application/octet-stream",
        "size": len(data),
    }
    save_state("asset", asset_id, record)
    return {
        "id": asset_id,
        "hash": hashlib.sha256(data).hexdigest(),
        "file_path": relative,
    }


@app.get("/api/v2/assets/{asset_id}/content", dependencies=[Depends(require_auth)])
async def asset_content(asset_id: str):
    record = load_state("asset", asset_id)
    if not record:
        raise HTTPException(status_code=404, detail="Asset not found")
    if record.get("kind") == "input":
        path = safe_path(INPUT_ROOT, record["file_path"])
    else:
        relative = str(Path(record.get("subfolder") or "") / record["filename"])
        path = safe_path(OUTPUT_ROOT, relative)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Asset file is missing")
    return FileResponse(path, media_type=record.get("content_type") or "application/octet-stream", filename=path.name)


@app.post("/api/v2/jobs", dependencies=[Depends(require_auth)])
async def create_job(payload: dict[str, Any]):
    workflow = payload.get("workflow")
    if not isinstance(workflow, dict) or not workflow:
        raise HTTPException(status_code=400, detail="API-format workflow is required")
    workflow = normalize_asset_value(workflow)
    client_id = f"fpai-{uuid.uuid4()}"
    try:
        response = await client.post("/prompt", json={"prompt": workflow, "client_id": client_id})
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:1000]
        raise HTTPException(status_code=502, detail=f"ComfyUI rejected workflow: {detail}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="ComfyUI submission failed") from exc
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise HTTPException(status_code=502, detail="ComfyUI did not return prompt_id")
    save_state("job", prompt_id, {"id": prompt_id, "client_id": client_id, "created_at": time.time(), "status": "queued"})
    return JSONResponse(status_code=201, content={"id": prompt_id, "status": "queued"})


@app.get("/api/v2/jobs/{job_id}", dependencies=[Depends(require_auth)])
async def job_status(job_id: str) -> dict[str, Any]:
    try:
        response = await client.get(f"/history/{job_id}")
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to read ComfyUI history") from exc
    history = payload.get(job_id)
    if not history:
        return {"id": job_id, "status": "running", "outputs": []}
    status = history.get("status") or {}
    status_text = status.get("status_str") or ""
    completed = bool(status.get("completed"))
    if not completed and status_text in {"error", "failed"}:
        return {
            "id": job_id,
            "status": "failed",
            "error": {"code": "COMFY_JOB_FAILED", "message": "ComfyUI reported a failed workflow"},
            "outputs": [],
        }
    if not completed:
        return {"id": job_id, "status": "running", "outputs": []}
    records = output_records(job_id, history)
    outputs = [
        {
            "id": record["id"],
            "type": record["media_type"],
            "content_type": record["content_type"],
            "name": record["filename"],
        }
        for record in records
    ]
    return {"id": job_id, "status": "succeeded", "outputs": outputs}


@app.post("/api/v2/jobs/{job_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_job(job_id: str) -> dict[str, Any]:
    try:
        await client.post("/interrupt")
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Unable to interrupt ComfyUI") from exc
    save_state("job", job_id, {"id": job_id, "status": "canceled", "updated_at": time.time()})
    return {"id": job_id, "status": "canceled"}
