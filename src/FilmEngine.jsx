import React, { useEffect, useState } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  RefreshCw,
  Download,
  LockKeyhole,
  Plus,
  Film,
} from "lucide-react";
import {
  activeScript,
  orderedShots,
  cutDuration,
  CAPABILITIES,
} from "./film/engine.ts";
import { extractPdf } from "./film/documents.js";
import "./film/engine.css";
import { renderRequestKey } from "./renderClient.js";

const sections = [
  "Overview",
  "Sources",
  "Script",
  "Breakdown",
  "Cast and World",
  "Shot plan",
  "Music and Audio",
  "Generate",
  "Edit",
  "Deliver",
];
async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
  });
  const body = await response
    .json()
    .catch(() => ({ error: "The studio returned an unreadable response." }));
  if (!response.ok)
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : body.error?.message || `Request failed (${response.status}).`,
    );
  return body;
}
function Field({ label, children }) {
  return (
    <label className="fe-field">
      <span>
        {label
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/^./, (c) => c.toUpperCase())}
      </span>
      {children}
    </label>
  );
}
function Status({ value }) {
  return (
    <span className={`fe-status fe-${value}`}>
      {String(value).replaceAll("_", " ")}
    </span>
  );
}
function SourceSpan({ source }) {
  return source ? (
    <small>
      Source {source.sourceId.slice(0, 8)} · page {source.page} · lines{" "}
      {source.lineStart}–{source.lineEnd}
    </small>
  ) : (
    <small>Link this shot to an approved script scene.</small>
  );
}
function JsonDetails({ value, label = "Inspect details" }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
function SceneSelect({ scenes, value, onChange }) {
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a scene</option>
      {scenes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.order}. {s.slugline}
        </option>
      ))}
    </select>
  );
}
const values = (form) => Object.fromEntries(new FormData(form));
function RecordEditor({ record, onSave, children }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(values(e.currentTarget));
      }}
    >
      {children}
      <button className="primary" type="submit">
        Save {record ? "new version" : "draft"}
      </button>
    </form>
  );
}
function DownloadButton({ href, children }) {
  return (
    <a className="fe-download" href={href} download>
      <Download size={16} />
      {children}
    </a>
  );
}

export default function FilmEngine({ production, onCast }) {
  const base = `/api/projects/${encodeURIComponent(production.project.id)}/film`;
  const [section, setSection] = useState("Overview"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [sourceId, setSourceId] = useState(""),
    [scriptText, setScriptText] = useState(""),
    [selectedScript, setSelectedScript] = useState(""),
    [selectedShot, setSelectedShot] = useState(""),
    [selectedCut, setSelectedCut] = useState(""),
    [kind, setKind] = useState("all"),
    [history, setHistory] = useState(null);
  const [pending, setPending] = useState(null);
  async function refresh() {
    const result = await request(base);
    setData(result);
    return result;
  }
  useEffect(() => {
    let cancelled = false;
    request(base)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function command(c) {
    const key =
      pending?.fingerprint === JSON.stringify(c)
        ? pending.key
        : renderRequestKey();
    setPending({ key, fingerprint: JSON.stringify(c) });
    const result = await request(`${base}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestKey: key,
        expectedRevision: data.state.revision,
        command: c,
      }),
    });
    setPending(null);
    setData((d) => ({ ...d, state: result.state }));
    setNotice("Saved to production history.");
    return result.state;
  }
  const act = (c) => run(() => command(c));
  if (!data)
    return (
      <section className="panel fe-root">
        <h2>Film Engine</h2>
        {error ? (
          <>
            <p role="alert" className="fe-error">
              {error}
            </p>
            <button onClick={() => run(refresh)}>Retry loading</button>
          </>
        ) : (
          <p role="status">Loading your production…</p>
        )}
      </section>
    );
  const state = data.state,
    script = activeScript(state),
    scenes = script?.scenes || [],
    shots = orderedShots(state),
    sources = data.sources || [];
  const draft =
      state.scripts.find((s) => s.id === selectedScript) ||
      state.scripts.at(-1),
    shot = shots.find((s) => s.id === selectedShot),
    cut = state.cuts.find((c) => c.id === selectedCut) || state.cuts.at(-1);
  const approvedJobs = state.jobs.filter(
    (j) =>
      ["approved", "locked"].includes(j.status) && j.capability === "video",
  );
  const flags = [
    ["Sources", sources.length, "Sources"],
    ["Approved script", script ? 1 : 0, "Script"],
    ["Shot plan", shots.filter((s) => !s.needsReview).length, "Shot plan"],
    ["Approved takes", approvedJobs.length, "Generate"],
    [
      "Approved cuts",
      state.cuts.filter((c) => c.status === "approved").length,
      "Edit",
    ],
  ];
  async function upload(event) {
    const form = event.currentTarget;
    await run(async () => {
      const result = await request(`${base}/sources`, {
        method: "POST",
        body: new FormData(form),
      });
      setSourceId(result.source.id);
      await refresh();
      setNotice("Source uploaded. The original file is preserved.");
      form.reset();
    });
  }
  async function loadText(id) {
    setSourceId(id);
    await run(async () => {
      const row = sources.find((s) => s.id === id);
      if (!row) return;
      if (row.mime_type === "application/pdf") {
        const response = await fetch(`${base}/sources/${id}/asset`, {
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Could not read the PDF.");
        const pdf = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdf.GlobalWorkerOptions.workerSrc = worker.default;
        const result = await extractPdf(
          new Uint8Array(await response.arrayBuffer()),
          pdf,
        );
        setScriptText(result.text);
        setNotice(result.warnings.join(" "));
      } else {
        const result = await request(`${base}/sources/${id}/text`);
        setScriptText(result.text);
        setNotice(result.warnings.join(" "));
      }
      setSection("Script");
    });
  }
  return (
    <section className="fe-root" aria-busy={busy}>
      <div className="fe-heading">
        <div>
          <span className="eyebrow">FILM ENGINE · MOCK WORKSPACE</span>
          <h2>From script to delivery</h2>
          <p>
            Production revision {state.revision}. Review each stage before
            moving it forward.
          </p>
        </div>
        <button disabled={busy} onClick={() => run(refresh)}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <div
        className="fe-nav"
        role="navigation"
        aria-label="Film Engine sections"
      >
        {sections.map((name) => (
          <button
            disabled={busy}
            className={section === name ? "active" : ""}
            key={name}
            onClick={() => {
              setSection(name);
              setError("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p className="fe-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fe-notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">Saving or processing your request…</p>}
      <fieldset className="fe-content" disabled={busy}>
        {section === "Overview" && (
          <>
            <div className="fe-readiness">
              {flags.map(([name, count, target]) => (
                <button key={name} onClick={() => setSection(target)}>
                  <strong>{count}</strong>
                  <span>{name}</span>
                  <small>
                    {count ? "Available to review" : "Next step needed"}
                  </small>
                </button>
              ))}
            </div>
            <div className="panel">
              <h3>Continue Enemies Closer</h3>
              <p>
                Link a snapshot of the scenes and shots currently open in this
                browser. Your original production remains available in the
                existing studio.
              </p>
              {state.importedProduction ? (
                <Status value="approved" />
              ) : (
                <button
                  className="primary"
                  onClick={() => act({ type: "import-production", production })}
                >
                  <Film size={16} />
                  Link existing production
                </button>
              )}
              <button onClick={() => setSection("Sources")}>
                Add a screenplay
              </button>
            </div>
            <div className="panel">
              <h3>Production history</h3>
              <button
                onClick={() =>
                  run(async () =>
                    setHistory((await request(`${base}/history`)).events),
                  )
                }
              >
                View saved revisions
              </button>
              {Array.isArray(history) && (
                <ol className="fe-history">
                  {history.map((e) => (
                    <li key={e.revision}>
                      Revision {e.revision}:{" "}
                      {e.command_type.replaceAll("-", " ")}{" "}
                      <small>{new Date(e.created_at).toLocaleString()}</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
        {section === "Sources" && (
          <>
            <div className="panel">
              <h3>Source Library</h3>
              <p>
                Screenplays, treatments, lyrics, notes, images and audio.
                Originals are private. Maximum 24 MB per file.
              </p>
              <form
                className="fe-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  upload(e);
                }}
              >
                <Field label="Source file">
                  <input
                    name="file"
                    type="file"
                    required
                    accept=".pdf,.docx,.fdx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.wav,.mp3,.m4a,.flac,.ogg"
                  />
                </Field>
                <Field label="Purpose">
                  <select name="category">
                    {[
                      "screenplay",
                      "treatment",
                      "lyrics",
                      "notes",
                      "character-reference",
                      "location-reference",
                      "wardrobe",
                      "prop",
                      "demo",
                      "instrumental",
                      "dialogue",
                      "stems",
                      "cue-sheet",
                      "document",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Rights status">
                  <select name="rightsStatus">
                    <option value="unknown">Needs review</option>
                    <option value="owned">Original / owned</option>
                    <option value="licensed">Licensed</option>
                    <option value="permission-recorded">
                      Permission recorded
                    </option>
                    <option value="restricted">Restricted</option>
                  </select>
                </Field>
                <Field label="Source and permission notes">
                  <input
                    name="provenance"
                    placeholder="Who supplied it and where permission is recorded"
                    maxLength={2000}
                  />
                </Field>
                <button className="primary">
                  <Upload size={16} />
                  Upload source
                </button>
              </form>
            </div>
            <div className="fe-list">
              {sources.length ? (
                sources.map((s) => (
                  <article className="panel" key={s.id}>
                    <div className="fe-row">
                      <div>
                        <h3>{s.filename}</h3>
                        <small>
                          Version {s.source_version} ·{" "}
                          {(s.byte_size / 1024).toFixed(0)} KB · {s.category}
                        </small>
                      </div>
                      <Status value={s.rights_status} />
                    </div>
                    <p>{s.provenance}</p>
                    <DownloadButton href={`${base}/sources/${s.id}/asset`}>
                      Original file
                    </DownloadButton>
                    {/\.(pdf|docx|fdx|txt|md)$/i.test(s.filename) && (
                      <button onClick={() => loadText(s.id)}>
                        <FileText size={16} />
                        Read as script
                      </button>
                    )}
                    <small>
                      {state.scripts.filter((v) => v.sourceId === s.id).length}{" "}
                      linked script versions
                    </small>
                  </article>
                ))
              ) : (
                <p>
                  No sources yet. Upload the screenplay to start the breakdown.
                </p>
              )}
            </div>
          </>
        )}
        {section === "Script" && (
          <>
            <div className="panel">
              <h3>Script extraction and review</h3>
              <p>
                Correct extracted text before parsing. A new parse creates a
                draft revision; approved versions remain intact.
              </p>
              <Field label="Original source">
                <select
                  value={sourceId}
                  onChange={(e) => loadText(e.target.value)}
                >
                  <option value="">Choose a screenplay source</option>
                  {sources
                    .filter((s) => /\.(pdf|docx|fdx|txt|md)$/i.test(s.filename))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.filename} · v{s.source_version}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Extracted screenplay">
                <textarea
                  className="fe-script"
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder={
                    "TITLE\n\nINT. LOCATION - NIGHT\n\nAction.\n\nCHARACTER\nDialogue."
                  }
                />
              </Field>
              <button
                className="primary"
                disabled={!sourceId || !scriptText.trim()}
                onClick={() =>
                  run(async () => {
                    const result = await command({
                      type: "parse-script",
                      sourceId,
                      text: scriptText,
                    });
                    setSelectedScript(result.scripts.at(-1).id);
                  })
                }
              >
                Parse new draft
              </button>
            </div>
            {!!state.scripts.length && (
              <Field label="Script revision">
                <select
                  value={draft?.id || ""}
                  onChange={(e) => setSelectedScript(e.target.value)}
                >
                  {state.scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      Version {s.version} · {s.title} · {s.status}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {draft && (
              <div className="panel">
                <div className="fe-row">
                  <h3>
                    {draft.title} · v{draft.version}
                  </h3>
                  <Status value={draft.status} />
                </div>
                {draft.warnings.map((w) => (
                  <p className="fe-muted" key={w}>
                    {w}
                  </p>
                ))}
                <JsonDetails
                  value={draft.diff}
                  label="Changes from the approved script"
                />
                {draft.status === "draft" && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act({
                          type: "edit-script",
                          id: draft.id,
                          ...values(e.currentTarget),
                        });
                      }}
                    >
                      <div className="fe-grid">
                        <Field label="Title">
                          <input name="title" defaultValue={draft.title} />
                        </Field>
                        <Field label="Logline">
                          <input name="logline" defaultValue={draft.logline} />
                        </Field>
                      </div>
                      <button>Save title and logline</button>
                    </form>
                    <button
                      className="primary"
                      onClick={() =>
                        act({ type: "approve-script", id: draft.id })
                      }
                    >
                      <CheckCircle2 size={16} />
                      Approve breakdown
                    </button>
                  </>
                )}
                {draft.scenes.map((scene) => (
                  <details key={`${draft.id}-${scene.id}`} className="fe-scene">
                    <summary>
                      {scene.order}. {scene.slugline} · {scene.duration}s
                      estimate
                    </summary>
                    <SourceSpan source={scene.source} />
                    <p>{scene.action}</p>
                    {scene.dialogue.map((d, i) => (
                      <p key={i}>
                        <b>{d.character}</b>{" "}
                        {d.parenthetical && `(${d.parenthetical})`}
                        <br />
                        {d.text}
                      </p>
                    ))}
                    <p>
                      Cast: {scene.characters.join(", ") || "Review needed"}
                    </p>
                    {draft.status === "draft" && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const v = values(e.currentTarget);
                          act({
                            type: "edit-script",
                            id: draft.id,
                            sceneId: scene.id,
                            ...v,
                            characters: v.characters
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          });
                        }}
                      >
                        <div className="fe-grid">
                          <Field label="Cast, separated by commas">
                            <input
                              name="characters"
                              defaultValue={scene.characters.join(", ")}
                            />
                          </Field>
                          <Field label="Location">
                            <input
                              name="location"
                              defaultValue={scene.location}
                            />
                          </Field>
                          <Field label="Act">
                            <input name="act" defaultValue={scene.act} />
                          </Field>
                          <Field label="Sequence">
                            <input
                              name="sequence"
                              defaultValue={scene.sequence}
                            />
                          </Field>
                        </div>
                        <button>Save corrections</button>
                      </form>
                    )}
                  </details>
                ))}
              </div>
            )}
          </>
        )}
        {["Breakdown", "Cast and World"].includes(section) && (
          <>
            <div className="panel">
              <div className="fe-row">
                <h3>
                  {section === "Breakdown"
                    ? "Production breakdown"
                    : "Cast and world bibles"}{" "}
                  · version {state.worldVersion}
                </h3>
                <button onClick={onCast}>Open Character Bible photos</button>
              </div>
              <p>
                Review extracted requirements and record continuity facts. The
                checks compare recorded facts; they do not judge images.
              </p>
              <Field label="Filter requirements">
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">All requirements</option>
                  {[...new Set(state.items.map((i) => i.kind))].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <details>
                <summary>Add a production requirement</summary>
                <form
                  className="fe-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act({ type: "add-item", ...values(e.currentTarget) });
                  }}
                >
                  <Field label="Scene">
                    <select required name="sceneId">
                      {scenes.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.slugline}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Type">
                    <select name="kind">
                      {[
                        "character",
                        "relationship",
                        "location",
                        "set",
                        "prop",
                        "vehicle",
                        "wardrobe",
                        "hair_makeup",
                        "lighting",
                        "palette",
                        "weather",
                        "injury",
                        "music_theme",
                        "camera_language",
                        "continuity",
                      ].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Name">
                    <input required name="name" />
                  </Field>
                  <Field label="Notes">
                    <input name="notes" />
                  </Field>
                  <button className="primary">Add requirement</button>
                </form>
              </details>
            </div>
            <div className="fe-list">
              {state.items
                .filter((i) => kind === "all" || i.kind === kind)
                .map((item) => (
                  <article className="panel" key={`${item.id}-${item.status}`}>
                    <div className="fe-row">
                      <div>
                        <small>{item.kind.replaceAll("_", " ")}</small>
                        <h3>{item.name}</h3>
                      </div>
                      <Status value={item.status} />
                    </div>
                    <SourceSpan source={item.source} />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = values(e.currentTarget);
                        try {
                          act({
                            type: "review-item",
                            id: item.id,
                            ...v,
                            facts: JSON.parse(v.facts || "{}"),
                          });
                        } catch {
                          setError("Facts must be a valid JSON object.");
                        }
                      }}
                    >
                      <Field label="Name">
                        <input
                          name="name"
                          defaultValue={item.name}
                          disabled={item.status === "locked"}
                        />
                      </Field>
                      <Field
                        label={
                          item.kind === "character"
                            ? "Biography, age, height, proportions, skin, hair, personality and performance notes"
                            : "Production notes"
                        }
                      >
                        <textarea
                          name="notes"
                          defaultValue={item.notes}
                          disabled={item.status === "locked"}
                        />
                      </Field>
                      <details>
                        <summary>Structured continuity facts</summary>
                        <textarea
                          aria-label="Facts JSON"
                          name="facts"
                          defaultValue={JSON.stringify(item.facts, null, 2)}
                          disabled={item.status === "locked"}
                        />
                      </details>
                      {item.status !== "locked" && (
                        <div className="fe-actions">
                          <button>Save changes</button>
                          <button
                            type="button"
                            onClick={() =>
                              act({
                                type: "review-item",
                                id: item.id,
                                status: "approved",
                              })
                            }
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              act({
                                type: "review-item",
                                id: item.id,
                                status: "rejected",
                              })
                            }
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              act({
                                type: "review-item",
                                id: item.id,
                                status: "locked",
                              })
                            }
                          >
                            <LockKeyhole size={14} />
                            Lock
                          </button>
                        </div>
                      )}
                    </form>
                    {item.status !== "locked" && (
                      <details>
                        <summary>Merge or split requirement</summary>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = values(e.currentTarget);
                            act({
                              type: "split-item",
                              id: item.id,
                              names: v.names
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            });
                          }}
                        >
                          <Field label="Split into names, separated by commas">
                            <input required name="names" />
                          </Field>
                          <button>Split into drafts</button>
                        </form>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const v = values(e.currentTarget);
                            act({
                              type: "merge-items",
                              ids: [item.id, v.other],
                              name: item.name,
                            });
                          }}
                        >
                          <Field label="Merge with">
                            <select required name="other">
                              <option value="">
                                Choose another requirement
                              </option>
                              {state.items
                                .filter(
                                  (i) =>
                                    i.id !== item.id && i.status !== "locked",
                                )
                                .map((i) => (
                                  <option key={i.id} value={i.id}>
                                    {i.name} · {i.kind}
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <button>Merge into draft</button>
                        </form>
                      </details>
                    )}
                  </article>
                ))}
            </div>
            {!state.items.length && (
              <p>Approve a script to create the first production breakdown.</p>
            )}
          </>
        )}
        {section === "Shot plan" && (
          <>
            <div className="panel">
              <h3>Chronological shot plan</h3>
              <p>
                Display numbers follow story order. Stable shot IDs and the
                linked production snapshot are preserved.
              </p>
              <button
                className="primary"
                disabled={!script}
                onClick={() => act({ type: "plan-shots" })}
              >
                Suggest initial scene coverage
              </button>
              <details>
                <summary>Add a shot manually</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act({ type: "add-shot", ...values(e.currentTarget) });
                  }}
                >
                  <Field label="Scene">
                    <select required name="sceneId">
                      {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.slugline}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Shot description">
                    <input name="subject" required />
                  </Field>
                  <button>Add draft shot</button>
                </form>
              </details>
            </div>
            <div className="fe-split">
              <div className="fe-shot-list">
                {shots.map((s, i) => (
                  <button
                    className={selectedShot === s.id ? "active" : ""}
                    key={s.id}
                    onClick={() => setSelectedShot(s.id)}
                  >
                    <b>{s.displayNumber}</b>
                    <span>
                      {s.subject}
                      <small>
                        Stable ID {s.id} · {s.duration}s ·{" "}
                        {s.needsReview ? "source review needed" : s.status}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              {shot && (
                <div className="panel" key={`${shot.id}-${shot.version}`}>
                  <h3>
                    {shot.displayNumber}. {shot.subject}
                  </h3>
                  <Status value={shot.status} />
                  <SourceSpan source={shot.source} />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act({
                        type: "map-shot",
                        id: shot.id,
                        ...values(e.currentTarget),
                      });
                    }}
                  >
                    <Field label="Approved source scene">
                      <select
                        required
                        name="sceneId"
                        defaultValue={
                          scenes.some((s) => s.id === shot.sceneId)
                            ? shot.sceneId
                            : ""
                        }
                      >
                        <option value="">Review and link scene</option>
                        {scenes.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.order}. {s.slugline}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <button>Confirm source mapping</button>
                  </form>
                  {!["approved", "locked"].includes(shot.status) ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = values(e.currentTarget);
                        try {
                          act({
                            type: "edit-shot",
                            id: shot.id,
                            ...v,
                            characters: v.characters
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                            continuity: JSON.parse(v.continuity || "{}"),
                          });
                        } catch {
                          setError("Continuity facts must be valid JSON.");
                        }
                      }}
                    >
                      <div className="fe-grid">
                        {[
                          "subject",
                          "framing",
                          "angle",
                          "lens",
                          "movement",
                          "lighting",
                          "performance",
                          "wardrobe",
                          "props",
                          "sound",
                          "dialogue",
                          "prompt",
                          "negative",
                        ].map((key) => (
                          <Field
                            label={key[0].toUpperCase() + key.slice(1)}
                            key={key}
                          >
                            <textarea name={key} defaultValue={shot[key]} />
                          </Field>
                        ))}
                        <Field label="Character IDs, separated by commas">
                          <input
                            name="characters"
                            defaultValue={shot.characters.join(", ")}
                          />
                        </Field>
                        <Field label="Duration in seconds">
                          <input
                            name="duration"
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="600"
                            defaultValue={shot.duration}
                          />
                        </Field>
                      </div>
                      <details>
                        <summary>Continuity facts</summary>
                        <p>
                          Record identity, height, wardrobe, hair, injury,
                          propPossession, vehicle, geography, lightingDirection,
                          time, eyeline, screenDirection and emotion. Add a
                          matching ChangeReason when a change belongs in the
                          story.
                        </p>
                        <textarea
                          aria-label="Shot continuity JSON"
                          name="continuity"
                          defaultValue={JSON.stringify(
                            shot.continuity,
                            null,
                            2,
                          )}
                        />
                      </details>
                      <button className="primary">Save shot</button>
                    </form>
                  ) : (
                    <JsonDetails
                      value={shot}
                      label="Inspect approved shot instructions"
                    />
                  )}
                  <div className="fe-actions">
                    <button
                      onClick={() => act({ type: "revise-shot", id: shot.id })}
                    >
                      Create alternative
                    </button>
                    {shot.status !== "locked" && (
                      <>
                        <button
                          onClick={() =>
                            act({
                              type: "review-shot",
                              id: shot.id,
                              status: "approved",
                            })
                          }
                        >
                          Approve shot
                        </button>
                        <button
                          onClick={() =>
                            act({
                              type: "review-shot",
                              id: shot.id,
                              status: "locked",
                            })
                          }
                        >
                          Lock shot
                        </button>
                      </>
                    )}
                    <button
                      disabled={shots.findIndex((s) => s.id === shot.id) === 0}
                      onClick={() => {
                        const ids = shots.map((s) => s.id),
                          i = ids.indexOf(shot.id);
                        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                        act({ type: "order-shots", ids });
                      }}
                    >
                      Move earlier
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {section === "Music and Audio" && (
          <>
            <div className="panel">
              <h3>Original songs and music cues</h3>
              <p>
                Write lyrics, keep versions and place cues against a scene.
                Generated music and lyric suggestions currently use explicit
                mock behavior.
              </p>
              <RecordEditor
                onSave={(v) =>
                  act({
                    type: "save-cue",
                    ...v,
                    sections: Object.fromEntries(
                      [
                        "intro",
                        "verse",
                        "pre-hook",
                        "hook",
                        "bridge",
                        "outro",
                      ].map((k) => [k, v[k]]),
                    ),
                    sourceIds: v.sourceIds ? [v.sourceIds] : [],
                  })
                }
              >
                <div className="fe-grid">
                  <Field label="Scene">
                    <select name="sceneId" required>
                      {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.slugline}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {[
                    "title",
                    "mood",
                    "genre",
                    "key",
                    "instrumentation",
                    "vocalDirection",
                    "ownership",
                    "splits",
                  ].map((key) => (
                    <Field key={key} label={key}>
                      <input name={key} required={key === "title"} />
                    </Field>
                  ))}
                  <Field label="Cue type">
                    <select name="kind">
                      {[
                        "underscore",
                        "source",
                        "theme",
                        "song",
                        "end-credits",
                      ].map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="BPM">
                    <input
                      type="number"
                      name="bpm"
                      defaultValue="80"
                      min="1"
                      max="400"
                    />
                  </Field>
                  <Field label="Start seconds">
                    <input
                      type="number"
                      name="start"
                      defaultValue="0"
                      min="0"
                      step="0.1"
                    />
                  </Field>
                  <Field label="End seconds">
                    <input
                      type="number"
                      name="end"
                      defaultValue="8"
                      min="0"
                      step="0.1"
                    />
                  </Field>
                  <Field label="Clearance">
                    <select name="clearance">
                      <option value="unknown">Needs review</option>
                      <option value="owned">Original / owned</option>
                      <option value="cleared">Cleared</option>
                      <option value="restricted">Restricted</option>
                    </select>
                  </Field>
                  <Field label="Beat, demo or mix">
                    <select name="sourceIds">
                      <option value="">No linked audio yet</option>
                      {sources
                        .filter((s) => s.mime_type.startsWith("audio/"))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.filename}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <div className="fe-grid">
                  {[
                    "intro",
                    "verse",
                    "pre-hook",
                    "hook",
                    "bridge",
                    "outro",
                  ].map((k) => (
                    <Field key={k} label={k}>
                      <textarea name={k} />
                    </Field>
                  ))}
                </div>
              </RecordEditor>
            </div>
            <div className="fe-list">
              {state.cues.map((c) => (
                <div className="panel" key={c.id}>
                  <h3>
                    {c.title} · v{c.version}
                  </h3>
                  <Status value={c.status} />
                  <p>
                    {c.mood} · {c.bpm} BPM · {c.start}–{c.end}s
                  </p>
                  {Object.entries(c.sections)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <b>{k}</b>
                        <p className="fe-lyrics">{v}</p>
                      </div>
                    ))}
                  <button
                    onClick={() => act({ type: "mock-lyrics", id: c.id })}
                  >
                    Create mock lyric suggestion
                  </button>
                  {c.status !== "locked" && (
                    <button
                      onClick={() =>
                        act({
                          type: "review-cue",
                          id: c.id,
                          status: "approved",
                        })
                      }
                    >
                      Approve cue
                    </button>
                  )}
                  <details>
                    <summary>Edit as a new lyric version</summary>
                    <RecordEditor
                      record={c}
                      onSave={(v) =>
                        act({ type: "save-cue", id: c.id, sections: v })
                      }
                    >
                      {Object.entries(c.sections).map(([k, v]) => (
                        <Field key={k} label={k}>
                          <textarea name={k} defaultValue={v} />
                        </Field>
                      ))}
                    </RecordEditor>
                  </details>
                  <JsonDetails value={c} label="Cue and rights information" />
                </div>
              ))}
            </div>
            <div className="panel">
              <h3>Dialogue, voices and sound</h3>
              <p>
                Dialogue from each approved script is listed below. Save
                casting, pronunciation, performance and consent as new versions.
              </p>
              <details>
                <summary>Add ADR, effects, foley or ambience</summary>
                <RecordEditor onSave={(v) => act({ type: "save-audio", ...v })}>
                  <Field label="Scene">
                    <select name="sceneId" required>
                      {scenes.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.slugline}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Kind">
                    <select name="kind">
                      {[
                        "dialogue",
                        "ADR",
                        "effects",
                        "foley",
                        "room-tone",
                        "ambience",
                        "score",
                      ].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Character">
                    <input name="character" />
                  </Field>
                  <Field label="Text or sound brief">
                    <textarea name="text" required />
                  </Field>
                  <Field label="Performance direction">
                    <textarea name="direction" />
                  </Field>
                  <Field label="Recording">
                    <select name="sourceId">
                      <option value="">No source yet</option>
                      {sources
                        .filter((s) => s.mime_type.startsWith("audio/"))
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.filename}
                          </option>
                        ))}
                    </select>
                  </Field>
                </RecordEditor>
              </details>
            </div>
            {state.audio.map((a) => (
              <details className="panel" key={a.id}>
                <summary>
                  {a.character || a.kind} · v{a.version}: {a.text.slice(0, 100)}
                </summary>
                <SourceSpan source={a.source} />
                <RecordEditor
                  record={a}
                  onSave={(v) => act({ type: "save-audio", id: a.id, ...v })}
                >
                  {["text", "direction", "pronunciation", "voiceProfile"].map(
                    (k) => (
                      <Field key={k} label={k}>
                        <textarea name={k} defaultValue={a[k]} />
                      </Field>
                    ),
                  )}
                  <Field label="Voice consent">
                    <select name="consent" defaultValue={a.consent}>
                      <option value="unknown">Needs review</option>
                      <option value="owned">Own voice</option>
                      <option value="permission-recorded">
                        Permission recorded
                      </option>
                      <option value="restricted">Restricted</option>
                    </select>
                  </Field>
                </RecordEditor>
              </details>
            ))}
          </>
        )}
        {section === "Generate" && (
          <>
            <div className="panel">
              <h3>Prepare and review takes</h3>
              <p>
                Every job is mock and costs $0. Video uses the existing test
                slate. Other capabilities return labeled test packages.
              </p>
              <form
                className="fe-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({
                    type: "create-job",
                    ...values(e.currentTarget),
                    provider: "mock",
                    approvedCostCeiling: 0,
                  });
                }}
              >
                <Field label="Approved shot">
                  <select name="shotId" required>
                    <option value="">Choose a shot</option>
                    {shots
                      .filter((s) => ["approved", "locked"].includes(s.status))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayNumber}. {s.subject}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Output">
                  <select name="capability">
                    {CAPABILITIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replaceAll("-", " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="primary">Queue mock job</button>
              </form>
            </div>
            <div className="fe-list">
              {state.jobs.map((j) => (
                <div className="panel" key={j.id}>
                  <div className="fe-row">
                    <h3>
                      {shots.find((s) => s.id === j.shotId)?.subject ||
                        j.shotId}
                    </h3>
                    <Status value={j.status} />
                  </div>
                  <p>
                    Mock {j.capability} · $0.00 · attempt {j.retryCount + 1}
                  </p>
                  {j.outputAsset &&
                    (j.capability === "video" ? (
                      <video controls preload="metadata" src={j.outputAsset} />
                    ) : (
                      <DownloadButton href={j.outputAsset}>
                        Mock output package
                      </DownloadButton>
                    ))}
                  {j.error && <p className="fe-error">{j.error}</p>}
                  <div className="fe-actions">
                    {["queued", "processing"].includes(j.status) && (
                      <>
                        <button
                          className="primary"
                          onClick={() => act({ type: "advance-job", id: j.id })}
                        >
                          {j.status === "queued"
                            ? "Start mock processing"
                            : "Store mock result"}
                        </button>
                        <button
                          onClick={() => act({ type: "cancel-job", id: j.id })}
                        >
                          Cancel job
                        </button>
                      </>
                    )}
                    {j.status === "failed" && (
                      <button
                        onClick={() => act({ type: "retry-job", id: j.id })}
                      >
                        Retry mock job
                      </button>
                    )}
                    {j.status === "completed" && (
                      <button
                        onClick={() =>
                          act({
                            type: "review-job",
                            id: j.id,
                            status: "needs_review",
                          })
                        }
                      >
                        Open for review
                      </button>
                    )}
                    {j.status === "needs_review" && (
                      <>
                        <button
                          onClick={() =>
                            act({
                              type: "review-job",
                              id: j.id,
                              status: "approved",
                            })
                          }
                        >
                          Approve take
                        </button>
                        <button
                          onClick={() =>
                            act({
                              type: "review-job",
                              id: j.id,
                              status: "rejected",
                            })
                          }
                        >
                          Reject take
                        </button>
                      </>
                    )}
                    {j.status === "approved" && (
                      <button
                        onClick={() =>
                          act({
                            type: "review-job",
                            id: j.id,
                            status: "locked",
                          })
                        }
                      >
                        Lock take
                      </button>
                    )}
                  </div>
                  {["needs_review", "rejected"].includes(j.status) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act({
                          type: "review-job",
                          id: j.id,
                          status: "revision_requested",
                          ...values(e.currentTarget),
                        });
                      }}
                    >
                      <Field label="Revision instructions">
                        <textarea name="notes" required />
                      </Field>
                      <button>Request revision</button>
                    </form>
                  )}
                  <JsonDetails
                    value={j}
                    label="Prompt, selected references, locks and cost"
                  />
                </div>
              ))}
            </div>
            {!state.jobs.length && (
              <p>
                No jobs yet. Approve a shot, confirm its source mapping and
                rebuild the relevant Character Bible locks.
              </p>
            )}
          </>
        )}
        {section === "Edit" && (
          <>
            <div className="panel">
              <h3>Editorial assembly</h3>
              <form
                className="fe-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const result = await command({
                      type: "new-cut",
                      ...values(e.currentTarget),
                    });
                    setSelectedCut(result.cuts.at(-1).id);
                  });
                }}
              >
                <Field label="Cut name">
                  <input
                    name="name"
                    required
                    placeholder="Scene 001 assembly"
                  />
                </Field>
                <button>
                  <Plus size={16} />
                  New cut
                </button>
              </form>
              <Field label="Versioned cuts">
                <select
                  value={cut?.id || ""}
                  onChange={(e) => setSelectedCut(e.target.value)}
                >
                  <option value="">Choose a cut</option>
                  {state.cuts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · v{c.version} · {c.status}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {cut && (
              <div className="panel">
                <div className="fe-row">
                  <h3>
                    {cut.name} · {cutDuration(cut).toFixed(1)} seconds
                  </h3>
                  <Status value={cut.status} />
                </div>
                <div className="fe-timeline">
                  {[
                    "video",
                    "dialogue",
                    "music",
                    "effects",
                    "ambience",
                    "captions",
                    "titles",
                    "credits",
                  ].map((lane) => (
                    <div className="fe-lane" key={lane}>
                      <b>{lane}</b>
                      <div>
                        {cut.clips
                          .filter((c) => c.lane === lane)
                          .sort((a, b) => a.start - b.start)
                          .map((c) => (
                            <span key={c.id} title={c.caption || c.jobId}>
                              {c.start.toFixed(1)}–
                              {(c.start + c.out - c.in).toFixed(1)}s{" "}
                              {c.caption.slice(0, 35)}
                            </span>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
                {cut.status === "draft" && (
                  <>
                    <form
                      className="fe-grid"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act({
                          type: "place-clip",
                          cutId: cut.id,
                          ...values(e.currentTarget),
                        });
                      }}
                    >
                      <Field label="Lane">
                        <select name="lane">
                          {[
                            "video",
                            "dialogue",
                            "music",
                            "effects",
                            "ambience",
                            "captions",
                            "titles",
                            "credits",
                          ].map((l) => (
                            <option key={l}>{l}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Approved video take">
                        <select name="jobId">
                          <option value="">For video lane</option>
                          {approvedJobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {shots.find((s) => s.id === j.shotId)?.subject} ·{" "}
                              {j.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Audio source">
                        <select name="sourceId">
                          <option value="">For audio lanes</option>
                          {sources
                            .filter((s) => s.mime_type.startsWith("audio/"))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.filename}
                              </option>
                            ))}
                        </select>
                      </Field>
                      {[
                        ["start", cutDuration(cut)],
                        ["in", 0],
                        ["out", 8],
                        ["level", 0],
                      ].map(([k, v]) => (
                        <Field
                          key={k}
                          label={
                            k === "level" ? "Level (dB)" : `${k} (seconds)`
                          }
                        >
                          <input
                            name={k}
                            type="number"
                            step="0.1"
                            defaultValue={v}
                          />
                        </Field>
                      ))}
                      <Field label="Caption or title">
                        <input name="caption" />
                      </Field>
                      <button className="primary">Place on timeline</button>
                    </form>
                    {cut.clips.map((c) => (
                      <details key={c.id}>
                        <summary>
                          {c.lane}: {c.start}s · {(c.out - c.in).toFixed(1)}s
                        </summary>
                        <form
                          className="fe-grid"
                          onSubmit={(e) => {
                            e.preventDefault();
                            act({
                              type: "edit-clip",
                              cutId: cut.id,
                              id: c.id,
                              ...values(e.currentTarget),
                            });
                          }}
                        >
                          {["start", "in", "out", "level"].map((k) => (
                            <Field key={k} label={k}>
                              <input
                                name={k}
                                type="number"
                                step="0.1"
                                defaultValue={c[k]}
                              />
                            </Field>
                          ))}
                          <Field label="Text">
                            <input name="caption" defaultValue={c.caption} />
                          </Field>
                          <button>Save trim and placement</button>
                          <button
                            type="button"
                            onClick={() =>
                              act({
                                type: "remove-clip",
                                cutId: cut.id,
                                id: c.id,
                              })
                            }
                          >
                            Remove from draft
                          </button>
                        </form>
                      </details>
                    ))}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        act({
                          type: "review-cut",
                          id: cut.id,
                          ...values(e.currentTarget),
                        });
                      }}
                    >
                      <Field label="Cut review notes">
                        <textarea name="notes" />
                      </Field>
                      <button className="primary" disabled={!cut.clips.length}>
                        Approve cut
                      </button>
                    </form>
                  </>
                )}
                <button
                  onClick={() =>
                    run(async () => {
                      const result = await command({
                        type: "revise-cut",
                        id: cut.id,
                      });
                      setSelectedCut(result.cuts.at(-1).id);
                    })
                  }
                >
                  Create next cut version
                </button>
              </div>
            )}
          </>
        )}
        {section === "Deliver" && (
          <div className="panel">
            <h3>Delivery packages</h3>
            <p>
              Download the production bibles, shot list, lyrics, cue sheet,
              dialogue, captions, rights information, costs, edit decisions and
              render manifest as a single JSON package.
            </p>
            <p>
              Final MP4 or MOV encoding requires a media runner. A manifest
              download does not mean a master has been encoded.
            </p>
            {state.cuts
              .filter((c) => c.status === "approved")
              .map((c) => (
                <div className="fe-delivery" key={c.id}>
                  <div>
                    <h3>
                      {c.name} · v{c.version}
                    </h3>
                    <small>
                      {cutDuration(c).toFixed(1)} seconds · approved cut
                    </small>
                  </div>
                  <DownloadButton href={`${base}/delivery/${c.id}`}>
                    Download delivery package
                  </DownloadButton>
                </div>
              ))}
            {!state.cuts.some((c) => c.status === "approved") && (
              <p>
                Approve an editorial cut to prepare the first delivery package.
              </p>
            )}
            <button
              onClick={() =>
                run(async () => {
                  const fresh = await refresh();
                  setHistory(fresh.continuity);
                })
              }
            >
              Check continuity
            </button>
            {history?.warnings && (
              <JsonDetails value={history} label="Continuity report" />
            )}
          </div>
        )}
      </fieldset>
    </section>
  );
}
