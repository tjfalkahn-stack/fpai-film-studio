FROM runpod/worker-comfyui:main-base

ENV PYTHONUNBUFFERED=1 \
    COMFY_ROOT=/workspace/ComfyUI \
    FPAI_STATE_ROOT=/workspace/fpai-state

WORKDIR /opt/fpai

COPY deploy/comfy-engine/requirements-proxy.txt /opt/fpai/requirements-proxy.txt
RUN python3.12 -m pip install --no-cache-dir -r /opt/fpai/requirements-proxy.txt

COPY deploy/comfy-engine/proxy.py /opt/fpai/proxy.py
COPY deploy/comfy-engine/start.sh /opt/fpai/start.sh
COPY deploy/comfy-engine/workflows /opt/fpai/workflows
RUN chmod +x /opt/fpai/start.sh

EXPOSE 8000
ENTRYPOINT ["/opt/fpai/start.sh"]
