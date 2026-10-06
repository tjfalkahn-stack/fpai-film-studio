import { groovesPlanFor } from "./groovesProduction.js";
import React, { useEffect, useRef, useState } from "react";
import { renderIdentity, renderRequest, renderRequestKey } from "./renderClient.js";
import { START_FRAME_PROVIDER_LIMIT } from "./shotStartFrame.js";
import { encodeSourceAudio } from "./audioInput.js";
import { durationAfterModelSwitch, matchProviderDuration, readVideoDuration, uploadReferenceVideo } from "./referenceVideoClient.js";

const DEFAULT_MODEL = "veo-fast";

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
  const grooves = groovesPlanFor(projectId);
  const [catalog, setCatalog] = useState(null);
  const [provider, setProvider] = useState(grooves ? grooves.provider : DEFAULT_MODEL);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [reference, setReference] = useState(null);
  const [endPhoto, setEndPhoto] = useState(null);
  const [endPreview, setEndPreview] = useState("");
  const [endReference, setEndReference] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(grooves ? 10 : 5);
  const [resolution, setResolution] = useState(grooves?.resolution || "720p");
  const [aspectRatio, setAspectRatio] = useState(grooves ? "9:16" : "16:9");
  const [audio, setAudio] = useState(Boolean(grooves));
  const [sourceAudio, setSourceAudio] = useState(null);
  const [sourceAudioName, setSourceAudioName] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [referenceVideo, setReferenceVideo] = useState(null);
  const [videoName, setVideoName] = useState("");
  const [videoPreview, setVideoPreview] = useState("");
  const [extraPhoto, setExtraPhoto] = useState(null);
  const [extraPreview, setExtraPreview] = useState("");
  const [extraReference, setExtraReference] = useState(null);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeResult, setProbeResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = useRef(null);
  const options = (catalog?.providers || []).filter((item) => grooves ? item.id === grooves.provider : item.id.startsWith("higgsfield-") || item.audioInput || item.id.startsWith("veo-"));
  const selected = options.find((item) => item.id === provider);
  const isVeo = provider.startsWith("veo-");
  const isLtx = Boolean(selected?.audioInput);
  const isMotion = selected?.inputKind === "motion";
  const isText = selected?.inputKind === "text";
  const supportsEndFrame = Boolean(selected?.supportsEndFrame);
  const jobs = renders.filter((item) => item.projectId === projectId && item.sceneId === "CREATE" && (item.provider.startsWith("higgsfield-") || item.provider.startsWith("ltx-") || item.provider.startsWith("veo-")));
  const uncertain = jobs.find((item) => item.status === "uncertain");
  const incompatibleInput = sourceAudio && !isLtx ? "Your uploaded audio needs LTX 2.5 Fast or Pro. Choose LTX to use this track, or remove it." :
    endReference && !supportsEndFrame ? "Your end frame needs a model that accepts start and end frames. Choose Google Veo or a Higgsfield image model, or remove the end frame." :
    reference && isText ? "This text model does not use your start frame. Choose an image model or remove the start frame." :
    sourceAudio && provider === "ltx-2.5-pro" && sourceAudio.duration > 10 ? "LTX Pro accepts up to 10 seconds of audio. Choose Fast or trim the track." :
    endReference && !reference ? "Add a start frame to use the end frame." : "";
  const ready = isVeo ? catalog?.policy?.veoExecutionReady : isLtx ? catalog?.policy?.ltxExecutionReady : catalog?.policy?.higgsfieldExecutionReady;

  useEffect(() => {
    let active = true;
    const refreshCatalog = () =>
      renderRequest("/api/renderers")
        .then((next) => { if (active) { setCatalog(next); setError(""); } })
        .catch((cause) => { if (active) setError(cause.message); });
    refreshCatalog();
    window.addEventListener("focus", refreshCatalog);
    return () => { active = false; window.removeEventListener("focus", refreshCatalog); };
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (endPreview) URL.revokeObjectURL(endPreview); }, [endPreview]);
  useEffect(() => () => { if (extraPreview) URL.revokeObjectURL(extraPreview); }, [extraPreview]);
  useEffect(() => () => { if (videoPreview) URL.revokeObjectURL(videoPreview); }, [videoPreview]);

  async function choosePhoto(file, slot = "start") {
    if (!file) return;
    setError("");
    setQuote(null);
    if (slot === "end") { setEndPhoto(null); setEndPreview(""); setEndReference(null); }
    else if (slot === "extra") { setExtraPhoto(null); setExtraPreview(""); setExtraReference(null); }
    else { setPhoto(null); setPreview(""); setReference(null); }
    try {
      const encoded = await encodePhoto(file);
      if (slot === "end") { setEndPhoto(file); setEndReference(encoded); setEndPreview(URL.createObjectURL(file)); }
      else if (slot === "extra") { setExtraPhoto(file); setExtraReference(encoded); setExtraPreview(URL.createObjectURL(file)); }
      else { setPhoto(file); setReference(encoded); setPreview(URL.createObjectURL(file)); if (isVeo) setDuration(8); }
    } catch (cause) {
      setError(cause.message);
    }
  }

  async function chooseAudio(file) {
    if (!file) return;
    setSourceAudio(null); setSourceAudioName(""); setQuote(null); setError("");
    try {
      const encoded = await encodeSourceAudio(file);
      setSourceAudio(encoded); setSourceAudioName(file.name);
      if (isLtx) setDuration(encoded.duration);
    } catch (cause) { setError(cause.message); }
  }

  async function chooseVideo(file) {
    if (!file) return;
    setError("");
    setQuote(null);
    setReferenceVideo(null);
    setVideoName("");
    setVideoPreview("");
    try {
      const seconds = await readVideoDuration(file);
      const matched = matchProviderDuration(seconds, selected?.durations || [5]);
      const uploaded = await uploadReferenceVideo(file, { duration: seconds });
      setReferenceVideo({
        assetId: uploaded.id,
        mimeType: uploaded.mimeType || "video/mp4",
        duration: Math.ceil(uploaded.duration),
        url: uploaded.url,
      });
      setVideoName(file.name);
      setVideoPreview(URL.createObjectURL(file));
      setVideoUrl("");
      setDuration(Math.ceil(uploaded.duration));
    } catch (cause) {
      setError(cause.message);
    }
  }

  function input(shotId) {
    const motionImages = [reference, extraReference].filter(Boolean);
    return {
      projectId, sceneId: "CREATE", shotId, provider,
      prompt: prompt.trim(), duration: isMotion && referenceVideo ? referenceVideo.duration : duration, resolution, aspectRatio,
      referenceImages: isMotion ? motionImages : (reference ? [reference] : []),
      ...(isVeo && reference ? { referenceMode: "start-frame" } : {}),
      ...(supportsEndFrame && endReference ? { endFrameImage: endReference } : {}),
      ...(isMotion && referenceVideo?.assetId ? { referenceVideos: [{ assetId: referenceVideo.assetId, mimeType: "video/mp4" }] } : {}),
      ...(isMotion && !referenceVideo?.assetId && videoUrl.trim() ? { referenceVideos: [{ url: videoUrl.trim() }] } : {}),
      ...(isLtx && sourceAudio ? { sourceAudio } : {}),
      generateAudio: isVeo ? true : isLtx && sourceAudio ? false : isMotion ? false : audio,
      continuity: { ready: true, animaticLocked: true, timingApproved: true, hasCharacters: false },
    };
  }

  useEffect(() => {
    let canceled = false;
    setQuote(null);
    if (!catalog || incompatibleInput || !prompt.trim() || (!isText && !isVeo && !reference) || (isLtx && !sourceAudio) || (isMotion && !referenceVideo?.assetId && !/^https:\/\/[^\s]+$/i.test(videoUrl.trim()))) return;
    const timer = setTimeout(() => {
      renderRequest("/api/renders", { ...input("DIRECT_PREVIEW"), estimateOnly: true })
        .then((result) => { if (!canceled) { setQuote(result); setError(""); } })
        .catch((cause) => { if (!canceled) setError(cause.message); });
    }, 350);
    return () => { canceled = true; clearTimeout(timer); };
  }, [catalog, projectId, provider, reference, extraReference, endReference, prompt, duration, resolution, aspectRatio, audio, sourceAudio, videoUrl, referenceVideo, incompatibleInput]);

  async function generate() {
    if (!quote || busy || incompatibleInput || !ready || (grooves && jobs.length)) return;
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
      <h2>Choose your model and drop in what you want</h2>
      <p className="sub">Add pictures, an MP4 motion clip, or your own dialogue or rap track. Motion transfer can use two mascot stills plus one uploaded MP4. The model selector shows what can use each input. Google Veo makes sound from your prompt; LTX follows your uploaded audio.</p>
      {grooves && <p className="sub">One approved 10-second portrait clip with native audio. Total limit ${grooves.cap.toFixed(2)}. No additional take is available after submission.</p>}
      <div className="quickCreateGrid">
        <div>
          <h3>Your inputs</h3>
          <div className="quickCreateFrames">
            <label className={`quickCreateDrop ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choosePhoto(event.dataTransfer.files?.[0]); }}>
              {preview ? <img src={preview} alt={isMotion ? "First mascot reference preview" : "Start frame preview"} /> : <strong>{isMotion ? "Mascot image 1" : "Start frame"}</strong>}
              <span>{photo ? `${photo.name} · Change image` : "Drop or choose a PNG or JPEG"}</span>
              <input type="file" aria-label={isMotion ? "Mascot image 1" : "Start frame"} accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0])} />
            </label>
            {isMotion ? <label className="quickCreateDrop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choosePhoto(event.dataTransfer.files?.[0], "extra"); }}>
              {extraPreview ? <img src={extraPreview} alt="Second mascot reference preview" /> : <strong>Mascot image 2</strong>}
              <span>{extraPhoto ? `${extraPhoto.name} · Change image` : "Drop or choose a PNG or JPEG"}</span>
              <input type="file" aria-label="Mascot image 2" accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0], "extra")} />
            </label> : <div>
              <label className="quickCreateDrop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choosePhoto(event.dataTransfer.files?.[0], "end"); }}>
                {endPreview ? <img src={endPreview} alt="End frame preview" /> : <strong>End frame · optional</strong>}
                <span>{endPhoto ? `${endPhoto.name} · Change image` : "Drop or choose a PNG or JPEG"}</span>
                <input type="file" disabled={grooves} aria-label="End frame" accept="image/png,image/jpeg" onChange={(event) => choosePhoto(event.target.files?.[0], "end")} />
              </label>
              {endReference && <button className="ghost" type="button" onClick={() => { setEndPhoto(null); setEndReference(null); setEndPreview(""); setQuote(null); }}>Remove end frame</button>}
            </div>}
          </div>
          {isMotion && extraReference && <button className="ghost" type="button" onClick={() => { setExtraPhoto(null); setExtraReference(null); setExtraPreview(""); setQuote(null); }}>Remove second mascot image</button>}
          {isMotion && <div className="quickCreateAudio" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file?.type === "video/mp4") chooseVideo(file); }}>
            <label>Reference MP4 · motion clip (up to 32 MB)
              <input type="file" aria-label="Reference MP4" accept="video/mp4" onChange={(event) => chooseVideo(event.target.files?.[0])} />
            </label>
            <small>Drop an MP4 here or choose a file. Studio uploads it privately; you do not need a public URL.</small>
            {videoPreview && <video controls src={videoPreview} preload="metadata" />}
            {referenceVideo && <small>{videoName} · {referenceVideo.duration}s uploaded</small>}
            {referenceVideo && <button type="button" className="ghost" onClick={() => { setReferenceVideo(null); setVideoName(""); setVideoPreview(""); setQuote(null); }}>Remove MP4</button>}
          </div>}
          <div className="quickCreateAudio" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseAudio(event.dataTransfer.files?.[0]); }}><label>Own audio · dialogue, vocals, or rap (WAV, MP3, M4A, OGG; up to 3 MB, 20 seconds)
            <input type="file" accept=".wav,.mp3,.m4a,.ogg,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg" onChange={(event) => chooseAudio(event.target.files?.[0])} /></label>
            <small>Drop a track here or choose a file.</small>
            {sourceAudio && <><audio controls src={`data:${sourceAudio.mimeType};base64,${sourceAudio.data}`} /><small>{sourceAudioName} · {sourceAudio.duration}s · Select LTX to use this track.</small><button type="button" className="ghost" onClick={() => { setSourceAudio(null); setSourceAudioName(""); setQuote(null); }}>Remove audio</button></>}
          </div>
          <label>What should happen in the video?<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the action, camera movement, and mood…" rows={5} /></label>
        </div>
        <div className="quickCreateControls">
          <label>Video model<select disabled={grooves} value={provider} onChange={(event) => {
            const next = options.find((item) => item.id === event.target.value);
            setProvider(event.target.value);
            setQuote(null);
            setDuration(durationAfterModelSwitch(next, { referenceVideo, sourceAudio, reference }));
            setResolution(next?.resolutions?.[0] || "720p");
          }}>{["Google Veo", "LTX · use your audio", "Higgsfield"].map((group) => <optgroup key={group} label={group}>{options.filter((item) => group === "Google Veo" ? item.id.startsWith("veo-") : group.startsWith("LTX") ? item.audioInput : item.id.startsWith("higgsfield-")).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
          <p className="quickCreateModelHint">{isVeo ? "Google Veo generates speech, music, and effects from the prompt. Start and end frames are optional; it cannot use an uploaded soundtrack." : isLtx ? `LTX syncs the video to your uploaded audio (${provider === "ltx-2.5-pro" ? "10" : "20"} seconds max). Add a start frame if you want.` : isMotion ? "This route uses one or two mascot stills plus an uploaded MP4 motion clip." : isText ? "This route creates from text only." : "This route animates your start frame and can generate sound."}</p>
          {isMotion && !referenceVideo && <label>Public reference video URL · optional if you uploaded an MP4<input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://…/clip.mp4" /></label>}
          <div className="formGrid two">
            <label>Length{isMotion && referenceVideo ? <input value={`${referenceVideo.duration} seconds (from MP4)`} readOnly /> : isLtx && sourceAudio ? <input value={`${sourceAudio.duration} seconds (from audio)`} readOnly /> : <select disabled={grooves} value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{(isVeo && (reference || resolution === "1080p") ? [8] : selected?.durations || [5]).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select>}</label>
            <label>Resolution<select disabled={grooves} value={resolution} onChange={(event) => { setResolution(event.target.value); if (isVeo && event.target.value === "1080p") setDuration(8); }}>{(selected?.resolutions || ["720p"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Frame<select disabled={grooves} value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{(selected?.aspectRatios || ["16:9", "9:16"]).map((value) => <option key={value}>{value}</option>)}</select></label>
            {!isMotion && !isLtx && !isVeo && <label className="checkLabel"><input type="checkbox" disabled={grooves} checked={audio} onChange={(event) => setAudio(event.target.checked)} /> Generate audio</label>}
          </div>
          {isMotion && <small>Set the length to the clip’s rounded-up duration. The quote is an estimate; Create Video still submits a paid job.</small>}
          {catalog && provider.startsWith("higgsfield-") && !catalog.policy?.higgsfieldConfigured && <p className="validation">{catalog.policy?.higgsfieldCredentialPresent
            ? <>The video adapter has <b>HF_CREDENTIALS</b>, but its value contains spaces or is otherwise unusable. Edit the existing secret to the complete key copied from Higgsfield and deploy the change.</>
            : <>The video adapter cannot see <b>HF_CREDENTIALS</b>. Check that the existing secret is on <b>fpai-film-studio-video-adapter</b>, then deploy the change in Cloudflare.</>}</p>}
          {provider.startsWith("higgsfield-") && catalog?.policy?.higgsfieldConfigured && !catalog.policy?.executionStorageReady && <p className="validation">Higgsfield is configured, but render storage or the adapter control token is unavailable.</p>}
          {provider.startsWith("higgsfield-") && <button className="ghost" disabled={probeBusy} onClick={async () => {
            setProbeBusy(true);
            setProbeResult(null);
            try { setProbeResult((await renderRequest("/api/higgsfield/probe", {})).probe); }
            catch (cause) { setProbeResult({ transport: "error", errorDetail: cause.message }); }
            finally { setProbeBusy(false); }
          }}>{probeBusy ? "Checking connection…" : "Test Higgsfield connection · no video charge"}</button>}
          {provider.startsWith("higgsfield-") && probeResult && <p className="sub" role="status">Higgsfield connection: {probeResult.transport === "response" ? `HTTP ${probeResult.httpStatus}${probeResult.redirect ? " redirect" : ""}` : probeResult.transport === "error" ? `${probeResult.errorType || "Error"}: ${probeResult.errorDetail}` : "not configured"}. No video was submitted.</p>}
          {uncertain && <label className="checkLabel"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> A previous request has an uncertain provider outcome. I understand a new render may add another charge.</label>}
          {error && <p className="validation" role="alert">{error}</p>}
          {incompatibleInput && <p className="validation" role="alert">{incompatibleInput}</p>}
          {catalog && !ready && <p className="validation">{selected?.availability?.detail || "This model is not ready to render."}</p>}
          {pending.current && <button className="ghost" onClick={() => { pending.current = null; localStorage.removeItem(`fpai-direct-render:${projectId}`); setError(""); }}>Clear unresolved request after checking recent videos</button>}
          <p>Estimated cost: <b>{quote ? `$${quote.estimatedCost.toFixed(2)}` : incompatibleInput || isLtx && !sourceAudio ? "Choose compatible inputs to see a quote" : isMotion && !referenceVideo?.assetId && !videoUrl.trim() ? "Upload an MP4 or paste a public URL to see a quote" : isVeo || isText ? "Enter a prompt to see a quote" : "Enter a prompt and picture to see a quote"}</b></p>
          <button className="primary full" disabled={(grooves && jobs.length > 0) || !quote || busy || incompatibleInput || (uncertain && !acknowledged) || !ready} onClick={generate}>{busy ? "Submitting…" : quote ? `Create video · $${quote.estimatedCost.toFixed(2)}` : "Create video"}</button>
        </div>
      </div>
      <h3>Your videos</h3>
      {jobs.length === 0 && <p className="sub">Your direct renders will show up here.</p>}
      <div className="quickCreateResults">{jobs.map((job) => <div className="takeCard" key={job.id}>
        <b>{job.providerLabel || job.provider} · {job.status}</b>
        <small>{new Date(job.createdAt).toLocaleString()} · {job.actualCost == null ? "Cost pending" : `$${Number(job.actualCost).toFixed(2)}`}</small>
        {job.outputAsset?.url && <><video src={job.outputAsset.url} controls preload="metadata" /><a className="ghost" href={job.outputAsset.url} download={`fpai-video-${job.id}.mp4`}>Download video</a></>}
        {job.error && <p className="validation">{job.error.message}</p>}
        {job.status === "uncertain" && <><p className="validation">Studio lost track of this request. Check the provider’s request history before starting another render.</p>{job.provider.startsWith("higgsfield-") && <RecoverPaidJob job={job} onRender={onRender} />}</>}
      </div>)}</div>
    </section>
  );
}
