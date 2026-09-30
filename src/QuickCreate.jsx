import React, { useEffect, useRef, useState } from "react";
import { renderIdentity, renderRequest, renderRequestKey } from "./renderClient.js";
import { START_FRAME_PROVIDER_LIMIT } from "./shotStartFrame.js";
import { encodeSourceAudio } from "./audioInput.js";

const DEFAULT_MODEL = "higgsfield-kling-3-standard";

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

function RecoverPaidJob({ job, onRender }) {
  const [jobId, setJobId] = useState("");
  const [chargedAmount, setChargedAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function recover() {
    setBusy(true);
    setError("");
    try {
      const result = await renderRequest(`/api/renders/${job.id}/recover`, { jobId: jobId.trim(), chargedAmount });
      onRender(result.render);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <div className="quickCreateControls">
    <p className="sub">Already paid for this video? Find its Job ID and exact amount charged in Higgsfield Requests. Recovering it checks that job without submitting another video.</p>
    <label>Higgsfield Job ID<input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label>
    <label>Amount charged (USD)<input type="number" min="0" max="100" step="0.0001" value={chargedAmount} onChange={(event) => setChargedAmount(event.target.value)} placeholder="0.3465" /></label>
    <button className="ghost" disabled={busy || !jobId.trim() || chargedAmount === ""} onClick={recover}>{busy ? "Recovering…" : "Recover paid video · no new generation"}</button>
    {error && <p className="validation" role="alert">{error}</p>}
  </div>;
}

export default function QuickCreate({ projectId, renders, onRender }) {
  const [catalog, setCatalog] = useState(null);
  const [provider, setProvider] = useState(DEFAULT_MODEL);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [reference, setReference] = useState(null);
  const [endPhoto, setEndPhoto] = useState(null);
  const [endPreview, setEndPreview] = useState("");
  const [endReference, setEndReference] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [audio, setAudio] = useState(false);
  const [sourceAudio, setSourceAudio] = useState(null);
  const [sourceAudioName, setSourceAudioName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef(null);
  const options = (catalog?.providers || []).filter((item) => item.id.startsWith("higgsfield-") || item.audioInput);
  const selected = options.find((item) => item.id === provider);
  const isLtx = Boolean(selected?.audioInput);
  const isMotion = selected?.inputKind === "motion";
  const isText = selected?.inputKind === "text";
  const supportsEndFrame = Boolean(selected?.supportsEndFrame);
  const jobs = renders.filter((item) => item.projectId === projectId && item.sceneId === "CREATE" && (item.provider.startsWith("higgsfield-") || item.provider.startsWith("ltx-")));
  const uncertain = jobs.find((item) => item.status === "uncertain");

  useEffect(() => {
    renderRequest("/api/renderers").then(setCatalog).catch((cause) => setError(cause.message));
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (endPreview) URL.revokeObjectURL(endPreview); }, [endPreview]);

  async function choosePhoto(file, end = false) {
    if (!file) return;
    setError("");
    setQuote(null);
    if (end) { setEndPhoto(null); setEndPreview(""); setEndReference(null); }
    else { setPhoto(null); setPreview(""); setReference(null); }
    try {
      const encoded = await encodePhoto(file);
      if (end) { setEndPhoto(file); setEndReference(encoded); setEndPreview(URL.createObjectURL(file)); }
      else { setPhoto(file); setReference(encoded); setPreview(URL.createObjectURL(file)); }
    } catch (cause) {
      setError(cause.message);
    }
  }

  function input(shotId) {
    return {
      projectId, sceneId: "CREATE", shotId, provider,
      prompt: prompt.trim(), duration, resolution, aspectRatio,
      referenceImages: !isText && reference ? [reference] : [],
      ...(supportsEndFrame && endReference ? { endFrameImage: endReference } : {}),
      ...(isMotion ? { referenceVideos: [{ url: videoUrl.trim() }] } : {}),
      ...(isLtx && sourceAudio ? { sourceAudio } : {}),
      generateAudio: isLtx && sourceAudio ? false : isMotion ? false : audio,
      continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
    };
  }

  useEffect(() => {
    let canceled = false;
    setQuote(null);
    if (!catalog || !prompt.trim() || (!isText && !reference) || (isLtx && !sourceAudio) || (isMotion && !/^https:\/\/[^\s]+$/i.test(videoUrl.trim()))) return;
    const timer = setTimeout(() => {
      renderRequest("/api/renders", { ...input("DIRECT_PREVIEW"), estimateOnly: true })
        .then((result) => { if (!canceled) { setQuote(result); setError(""); } })
        .catch((cause) => { if (!canceled) setError(cause.message); });
    }, 350);
    return () => { canceled = true; clearTimeout(timer); };
  }, [catalog, projectId, provider, reference, endReference, prompt, duration, resolution, aspectRatio, audio, sourceAudio, videoUrl]);

  async function generate() {
    if (!quote || busy || !(isLtx ? catalog?.policy?.ltxExecutionReady : catalog?.policy?.higgsfieldExecutionReady)) return;
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
      <h2>{isText ? "Describe it. Make a video." : "Upload your shot frames. Make a video."}</h2>
      <p className="sub">{isText ? "Generate from your prompt without an opening image." : supportsEndFrame ? "Upload the start frame and optionally the end frame. Both are sent to the selected model." : isMotion ? "Upload a reference image and provide a source video for motion transfer. This route does not use start and end frames." : "Use your finished picture as the opening image."}</p>
      <div className="quickCreateGrid">
        <div>
          {!isText && <div className={supportsEndFrame ? "quickCreateFrames" : ""}>
            <label className={`quickCreateDrop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choosePhoto(event.dataTransfer.files?.[0]); }}>
              {preview ? <img src={preview} alt={isMotion ? "Reference image preview" : "Start frame preview"} /> : <strong>{isMotion ? "Reference image" : "Start frame"}</strong>}
              <span>{photo ? `${photo.name} · Change image` : "Drop or choose a PNG or JPEG"}</span>
              <input type="file" aria-label={isMotion ? "Reference image" : "Start frame"} accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0])} />
            </label>
            {supportsEndFrame && <div>
              <label className="quickCreateDrop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choosePhoto(event.dataTransfer.files?.[0], true); }}>
                {endPreview ? <img src={endPreview} alt="End frame preview" /> : <strong>End frame · optional</strong>}
                <span>{endPhoto ? `${endPhoto.name} · Change image` : "Drop or choose a PNG or JPEG"}</span>
                <input type="file" aria-label="End frame" accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0], true)} />
              </label>
              {endReference && <button className="ghost" type="button" onClick={() => { setEndPhoto(null); setEndReference(null); setEndPreview(""); setQuote(null); }}>Remove end frame</button>}
            </div>}
          </div>}
          <label>What should happen in the video?<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the action, camera movement, and mood…" rows={5} /></label>
        </div>
        <div className="quickCreateControls">
          <label>Model<select value={provider} onChange={(event) => {
            const next = options.find((item) => item.id === event.target.value);
            setProvider(event.target.value);
            setSourceAudio(null); setSourceAudioName(""); setQuote(null);
            setDuration(next?.durations?.includes(5) ? 5 : next?.durations?.[0] || 5);
            setResolution(next?.resolutions?.[0] || "720p");
          }}>{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {isLtx && <div><label>Upload dialogue or rap audio (MP3, M4A, OGG; up to {provider === "ltx-2.5-pro" ? 10 : 20} seconds)
            <input type="file" accept=".mp3,.m4a,.ogg,audio/mpeg,audio/mp4,audio/ogg" onChange={async (event) => {
              const file = event.target.files?.[0];
              setSourceAudio(null); setSourceAudioName(""); setQuote(null); setError("");
              if (!file) return;
              try {
                const encoded = await encodeSourceAudio(file);
                if (provider === "ltx-2.5-pro" && encoded.duration > 10) throw new Error("LTX Pro accepts up to 10 seconds. Trim this clip or choose Fast.");
                setSourceAudio(encoded); setSourceAudioName(file.name); setDuration(encoded.duration);
              } catch (cause) { setError(cause.message); }
            }} /></label>
            {sourceAudio && <><audio controls src={`data:${sourceAudio.mimeType};base64,${sourceAudio.data}`} /><small>{sourceAudioName} · {sourceAudio.duration}s. The original track drives the video.</small><button type="button" className="ghost" onClick={() => { setSourceAudio(null); setSourceAudioName(""); setQuote(null); }}>Remove audio</button></>}
          </div>}
          {isMotion && <label>Public reference video URL<input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://…/clip.mp4" /></label>}
          <div className="formGrid two">
            <label>Length{isLtx && sourceAudio ? <input value={`${sourceAudio.duration} seconds (from audio)`} readOnly /> : <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{(selected?.durations || [5]).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select>}</label>
            <label>Resolution<select value={resolution} onChange={(event) => setResolution(event.target.value)}>{(selected?.resolutions || ["720p"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Frame<select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{(selected?.aspectRatios || ["16:9", "9:16"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            {!isMotion && !isLtx && <label className="checkLabel"><input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} /> Generate audio</label>}
          </div>
          {isMotion && <small>The reference clip must be publicly reachable. Set the length to that clip’s rounded-up duration.</small>}
          {catalog && !catalog.policy?.higgsfieldConfigured && <p className="validation">{catalog.policy?.higgsfieldCredentialPresent
            ? <>The video adapter has <b>HF_CREDENTIALS</b>, but its value contains spaces or is otherwise unusable. Edit the existing secret to the complete key copied from Higgsfield and deploy the change.</>
            : <>The video adapter cannot see <b>HF_CREDENTIALS</b>. Check that the existing secret is on <b>fpai-film-studio-video-adapter</b>, then deploy the change in Cloudflare.</>}</p>}
          {catalog?.policy?.higgsfieldConfigured && !catalog.policy?.executionStorageReady && <p className="validation">Higgsfield is configured, but render storage or the adapter control token is unavailable.</p>}
          <button className="ghost" disabled={probeBusy} onClick={async () => {
            setProbeBusy(true);
            setProbeResult(null);
            try { setProbeResult((await renderRequest("/api/higgsfield/probe", {})).probe); }
            catch (cause) { setProbeResult({ transport: "error", errorDetail: cause.message }); }
            finally { setProbeBusy(false); }
          }}>{probeBusy ? "Checking connection…" : "Test Higgsfield connection · no video charge"}</button>
          {probeResult && <p className="sub" role="status">Higgsfield connection: {probeResult.transport === "response" ? `HTTP ${probeResult.httpStatus}${probeResult.redirect ? " redirect" : ""}` : probeResult.transport === "error" ? `${probeResult.errorType || "Error"}: ${probeResult.errorDetail}` : "not configured"}. No video was submitted.</p>}
          {uncertain && <label className="checkLabel"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> A previous request has an uncertain provider outcome. I understand a new render may add another charge.</label>}
          {error && <p className="validation" role="alert">{error}</p>}
          {pending.current && <button className="ghost" onClick={() => { pending.current = null; localStorage.removeItem(`fpai-direct-render:${projectId}`); setError(""); }}>Clear unresolved request after checking recent videos</button>}
          <p>Estimated cost: <b>{quote ? `$${quote.estimatedCost.toFixed(2)}` : isText ? "Enter a prompt to see a quote" : "Enter a prompt and picture to see a quote"}</b></p>
          <button className="primary full" disabled={!quote || busy || (uncertain && !acknowledged) || !(isLtx ? catalog?.policy?.ltxExecutionReady : catalog?.policy?.higgsfieldExecutionReady)} onClick={generate}>{busy ? "Submitting…" : quote ? `Create video · $${quote.estimatedCost.toFixed(2)}` : "Create video"}</button>
        </div>
      </div>
      <h3>Your videos</h3>
      {jobs.length === 0 && <p className="sub">Your direct renders will show up here.</p>}
      <div className="quickCreateResults">{jobs.map((job) => <div className="takeCard" key={job.id}>
        <b>{job.providerLabel || job.provider} · {job.status}</b>
        <small>{new Date(job.createdAt).toLocaleString()} · {job.actualCost == null ? "Cost pending" : `$${Number(job.actualCost).toFixed(2)}`}</small>
        {job.outputAsset?.url && <><video src={job.outputAsset.url} controls preload="metadata" /><a className="ghost" href={job.outputAsset.url} download={`fpai-video-${job.id}.mp4`}>Download video</a></>}
        {job.error && <p className="validation">{job.error.message}</p>}
        {job.status === "uncertain" && <><p className="validation">Studio lost track of this request. Check Higgsfield Requests for its outcome before starting another render.</p><RecoverPaidJob job={job} onRender={onRender} /></>}
      </div>)}</div>
    </section>
  );
}
