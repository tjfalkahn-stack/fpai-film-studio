FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    COMFY_ROOT=/workspace/ComfyUI \
    FPAI_STATE_ROOT=/workspace/fpai-state

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fpai

RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git /opt/ComfyUI && \
    pip install --no-cache-dir -r /opt/ComfyUI/requirements.txt

COPY deploy/comfy-engine/requirements-proxy.txt /opt/fpai/requirements-proxy.txt
RUN pip install --no-cache-dir -r /opt/fpai/requirements-proxy.txt

COPY deploy/comfy-engine/proxy.py /opt/fpai/proxy.py
COPY deploy/comfy-engine/start.sh /opt/fpai/start.sh
COPY deploy/comfy-engine/workflows /opt/fpai/workflows
RUN chmod +x /opt/fpai/start.sh

EXPOSE 8000
ENTRYPOINT ["/opt/fpai/start.sh"]
