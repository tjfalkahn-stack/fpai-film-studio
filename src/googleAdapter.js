export function createGoogleVideoAdapter({ baseUrl = "", token = "", fetchImpl = fetch } = {}) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  const headers = (ownerOverride = false) => ({
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(ownerOverride ? { "x-fpai-owner-override": "confirm" } : {}),
  });

  async function request(path, init = {}) {
    const response = await fetchImpl(`${root}${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Adapter request failed with HTTP ${response.status}.`);
    return payload;
  }

  return {
    health() {
      return request("/health");
    },
    submit({ packet, project, ownerOverride = false }) {
      if (!packet?.gate?.generateAllowed) throw new Error(packet?.gate?.executionBlockers?.[0] || "Server execution gate is not open.");
      const { shot, plan } = packet;
      return request("/api/generation-jobs", {
        method: "POST",
        headers: headers(ownerOverride),
        body: JSON.stringify({
          requestHash: plan.requestHash,
          projectId: project.id,
          sceneId: shot.scene,
          shotId: shot.id,
          ownerOverride,
          plan: {
            routeId: plan.route.id,
            prompt: plan.prompt,
            jobs: plan.jobs.map((job) => ({
              jobIndex: job.jobIndex,
              model: job.model,
              resolution: job.resolution,
              durationSeconds: job.durationSeconds,
            })),
          },
        }),
      });
    },
    status(jobId) {
      return request(`/api/generation-jobs/${encodeURIComponent(jobId)}`, { headers: headers(false) });
    },
    mediaUrl(jobId) {
      return `${root}/api/generation-jobs/${encodeURIComponent(jobId)}/media`;
    },
  };
}
