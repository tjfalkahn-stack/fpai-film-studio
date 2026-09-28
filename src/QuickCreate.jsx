import React, { useEffect, useRef, useState } from "react";
import { renderIdentity, renderRequest, renderRequestKey } from "./renderClient.js";
import { START_FRAME_PROVIDER_LIMIT } from "./shotStartFrame.js";

const IMAGE_MODELS = [
  "higgsfield-kling-3-standard",
  "higgsfield-kling-3-pro",
  "higgsfield-seedance-2.5-image",
  "higgsfield-genjutsu-motion",
];

async function encodePhoto(file) {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose a PNG or JPEG picture.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a picture under 20 MB.");
  let image = file;
  if (file.size > START_FRAME_PROVIDER_LIMIT) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / bitmap.width, 1080 / bitmap.height);
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    for (const quality of [0.92, 0.86, 0.8, 0.72, 0.6]) {
      image = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (image?.size <= START_FRAME_PROVIDER_LIMIT) break;
    }
    if (!image || image.size > START_FRAME_PROVIDER_LIMIT) throw new Error("Picture could not be prepared under the provider's 2 MB limit.");
  }
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Picture could not be read."));
    reader.readAsDataURL(image);
  });
  return { mimeType: image.type, data };
}

export default function QuickCreate({ projectId, renders, onRender }) {
  const [catalog, setCatalog] = useState(null);
  const [provider, setProvider] = useState(IMAGE_MODELS[0]);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [reference, setReference] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [audio, setAudio] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef(null);
  const options = (catalog?.providers || []).filter((item) => IMAGE_MODELS.includes(item.id));
  const selected = options.find((item) => item.id === provider);
  const isMotion = selected?.inputKind === "motion";
  const jobs = renders.filter((item) => item.projectId === projectId && item.sceneId === "CREATE" && item.provider.startsWith("higgsfield-"));
  const uncertain = jobs.find((item) => item.status === "uncertain");

  useEffect(() => {
    renderRequest("/api/renderers").then(setCatalog).catch((cause) => setError(cause.message));
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function choosePhoto(file) {
    if (!file) return;
    setError("");
    setQuote(null);
    setPhoto(null);
    setPreview("");
    setReference(null);
    try {
      const encoded = await encodePhoto(file);
      setPhoto(file);
      setReference(encoded);
      setPreview(URL.createObjectURL(file));
    } catch (cause) {
      setError(cause.message);
    }
  }

  function input(shotId) {
    return {
      projectId, sceneId: "CREATE", shotId, provider,
      prompt: prompt.trim(), duration, resolution, aspectRatio,
      referenceImages: reference ? [reference] : [],
      ...(isMotion ? { referenceVideos: [{ url: videoUrl.trim() }] } : {}),
      generateAudio: isMotion ? false : audio,
      continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
    };
  }

  useEffect(() => {
    let canceled = false;
    setQuote(null);
    if (!catalog || !prompt.trim() || !reference || (isMotion && !/^https:\/\/[^\s]+$/i.test(videoUrl.trim()))) return;
    const timer = setTimeout(() => {
      renderRequest("/api/renders", { ...input("DIRECT_PREVIEW"), estimateOnly: true })
        .then((result) => { if (!canceled) { setQuote(result); setError(""); } })
        .catch((cause) => { if (!canceled) setError(cause.message); });
    }, 350);
    return () => { canceled = true; clearTimeout(timer); };
  }, [catalog, projectId, provider, reference, prompt, duration, resolution, aspectRatio, audio, videoUrl]);

  async function generate() {
    if (!quote || busy || !catalog?.policy?.higgsfieldExecutionReady) return;
    setBusy(true);
    setError("");
    try {
      const key = `fpai-direct-render:${projectId}`;
      if (!pending.current) {
        try { pending.current = JSON.parse(localStorage.getItem(key)); } catch { /* Ignore invalid browser storage. */ }
      }
      const shotId = pending.current?.shotId || `DIRECT_${renderRequestKey()}`;
      const body = input(shotId);
      const identity = await renderIdentity(body);
      if (pending.current && pending.current.identity !== identity)
        throw new Error("An earlier request may have been submitted. Check your recent videos before changing the picture or prompt.");
      pending.current ||= { shotId, identity, requestKey: renderRequestKey() };
      localStorage.setItem(key, JSON.stringify(pending.current));
      const result = await renderRequest("/api/renders", {
        ...body, requestKey: pending.current.requestKey, acceptedCost: quote.estimatedCost,
        ...(uncertain && acknowledged ? { acknowledgeUncertainRenderId: uncertain.id } : {}),
      });
      onRender(result.render);
      pending.current = null;
      localStorage.removeItem(key);
      setAcknowledged(false);
    } catch (cause) {
      if (cause.status && cause.status < 500) {
        pending.current = null;
        localStorage.removeItem(`fpai-direct-render:${projectId}`);
      }
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel quickCreate">
      <span className="eyebrow">DIRECT VIDEO CREATION</span>
      <h2>Drop in your picture. Make a video.</h2>
      <p className="sub">Use your own finished picture as the opening image. No shot list, Character Bible, or start-frame approval needed.</p>
      <div className="quickCreateGrid">
        <div>
          <label className={`quickCreateDrop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choosePhoto(event.dataTransfer.files?.[0]); }}>
            {preview ? <img src={preview} alt="Your uploaded picture" /> : <strong>Drop your picture here</strong>}
            <span>{photo ? `${photo.name} · Change picture` : "or click to choose a PNG or JPEG"}</span>
            <input type="file" accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0])} />
          </label>
          <label>What should happen in the video?<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the action, camera movement, and mood…" rows={5} /></label>
        </div>
        <div className="quickCreateControls">
          <label>Model<select value={provider} onChange={(event) => {
            const next = options.find((item) => item.id === event.target.value);
            setProvider(event.target.value);
            setDuration(next?.durations?.includes(5) ? 5 : next?.durations?.[0] || 5);
            setResolution(next?.resolutions?.[0] || "720p");
          }}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {isMotion && <label>Public reference video URL<input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://…/clip.mp4" /></label>}
          <div className="formGrid two">
            <label>Length<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{(selected?.durations || [5]).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label>
            <label>Resolution<select value={resolution} onChange={(event) => setResolution(event.target.value)}>{(selected?.resolutions || ["720p"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Frame<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{(selected?.aspectRatios || ["16:9", "9:16"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            {!isMotion && <label className="checkLabel"><input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} /> Generate audio</label>}
          </div>
          {isMotion && <small>The reference clip must be publicly reachable. Set the length to that clip’s rounded-up duration.</small>}
          {catalog && !catalog.policy?.higgsfieldConfigured && <p className="validation">Higgsfield needs the <b>HF_CREDENTIALS</b> secret on the <b>fpai-film-studio-video-adapter</b> Worker. Its value must be <b>KEY_ID:KEY_SECRET</b>. Check Cloudflare → Workers &amp; Pages → video adapter → Settings → Variables and Secrets.</p>}
          {catalog?.policy?.higgsfieldConfigured && !catalog.policy?.executionStorageReady && <p className="validation">Higgsfield is configured, but render storage or the adapter control token is unavailable.</p>}
          {uncertain && <label className="checkLabel"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> A previous request has an uncertain provider outcome. I understand a new render may add another charge.</label>}
          {error && <p className="validation" role="alert">{error}</p>}
          {pending.current && <button className="ghost" onClick={() => { pending.current = null; localStorage.removeItem(`fpai-direct-render:${projectId}`); setError(""); }}>Clear unresolved request after checking recent videos</button>}
          <p>Estimated cost: <b>{quote ? `$${quote.estimatedCost.toFixed(2)}` : "Enter a prompt and picture to see a quote"}</b></p>
          <button className="primary full" disabled={!quote || busy || (uncertain && !acknowledged) || !catalog?.policy?.higgsfieldExecutionReady} onClick={generate}>{busy ? "Submitting…" : quote ? `Create video · $${quote.estimatedCost.toFixed(2)}` : "Create video"}</button>
        </div>
      </div>
      <h3>Your videos</h3>
      {jobs.length === 0 && <p className="sub">Your direct renders will show up here.</p>}
      <div className="quickCreateResults">{jobs.map((job) => <div className="takeCard" key={job.id}>
        <b>{job.providerLabel || job.provider} · {job.status}</b>
        <small>{new Date(job.createdAt).toLocaleString()} · {job.actualCost == null ? "Cost pending" : `$${Number(job.actualCost).toFixed(2)}`}</small>
        {job.outputAsset?.url && <><video src={job.outputAsset.url} controls preload="metadata" /><a className="ghost" href={job.outputAsset.url} download={`fpai-video-${job.id}.mp4`}>Download video</a></>}
        {job.error && <p className="validation">{job.error.message}</p>}
      </div>)}</div>
    </section>
  );
}
