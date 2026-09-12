import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Brain,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  Database,
  DollarSign,
  Eye,
  Film,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  Layers3,
  LayoutGrid,
  List,
  LockKeyhole,
  PackageCheck,
  PiggyBank,
  Play,
  Plus,
  RefreshCw,
  Route,
  Scissors,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UnlockKeyhole,
  Upload,
  Users,
  Video,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  CANONICAL_REFERENCE_CATEGORIES,
  GENERATION_TYPES,
  OWNER_ID,
  PROJECT_ID,
  adjustProductionBudget,
  calculateBudgetSummary,
  characterReferenceCount,
  isCharacterReferenceComplete,
  lockProductionBudget,
  mergeSavedCharacters,
  missingReferenceCategories,
  normalizeBudget,
  normalizeLedger,
  normalizeLedgerEntry,
  setProductionBudget,
} from "./domain.js";
import {
  DEFAULT_ECONOMY_SETTINGS,
  PRICING_UPDATED_AT,
  SEEDANCE_PRICING_UPDATED_AT,
  ROUTES,
  buildGenerationPlan,
  calculateProductionEconomy,
  createQueuedLedgerEntry,
  createSalvageRecord,
  evaluateBudgetGate,
  normalizeEconomySettings,
  normalizeShotEconomy,
  parseUsableRangeText,
  providerPerformance,
  updateEconomySettings,
} from "./economy.js";
import { DEFAULT_SEEDANCE_RATES } from "./seedancePricing.js";
import "./styles.css";
import { approveTakeState, updateTakeState } from "./takeReview.js";
import RenderPanel from "./RenderPanel.jsx";
import { renderRequest, mergeRender } from "./renderClient.js";
import FilmEngine from "./FilmEngine.jsx";
import ReferenceLibrary from "./ReferenceLibrary.jsx";
import ProductionCharacterSheet from "./ProductionCharacterSheet.jsx";
import { syncCanonicalRefsFromLibrary, LEGACY_SLOT_TO_LIBRARY } from "./characterReferences.js";
import { assignCharacterCanonicalSlot, fetchCharacterLibrary, uploadCharacterReference } from "./characterReferenceClient.js";

const STORAGE_KEY = "fpai-film-studio-v1.2";
const MEDIA_DB = "fpai-film-studio-media";
const MEDIA_STORE = "media";
const REFERENCE_SLOTS = CANONICAL_REFERENCE_CATEGORIES.map(({ key, label }) => [key, label.toUpperCase()]);
const EXPRESSIONS = ["Neutral", "Suspicious", "Controlled Anger", "Hurt", "Paternal", "Exhausted"];

const seedShots = [
  ["001", 2, "CHAOS", "BLACK / Mikey crying", "Sound-first opening", [], [], "Planned", { motionNeed: "local", shotCap: 0 }],
  ["002", 2, "CHAOS", "Mikey wet eye — ECU", "Micro handheld", ["mikey"], [], "Planned", { identityRisk: 3, lipVisible: false, shotCap: 0.8 }],
  ["003", 3, "CHAOS", "Airfield aerial / fire / jet", "Aggressive drone dive", [], ["a1"], "Hero", { complexity: 3, reusePotential: "high", shotCap: 1.6 }],
  ["010", 3, "CHAOS", "Jasmine holding Mikey", "Handheld reveal", ["jasmine", "mikey"], ["a1"], "Hero", { identityRisk: 3, complexity: 2, shotCap: 1.4 }],
  ["012", 3, "CHAOS", "Turner wounded", "Find through foreground", ["turner"], ["a1"], "Hero", { identityRisk: 2, shotCap: 1.2 }],
  ["020", 3, "CHAOS", "Convoy aerial", "Top-down pursuit", [], ["a1", "a2"], "Hero", { complexity: 3, reusePotential: "high", shotCap: 1.6 }],
  ["027", 4.5, "CONTROL", "Marcus hero reveal", "Stabilized push-in", ["marcus"], ["a1"], "Hero", { hero: true, identityRisk: 3, shotCap: 3 }],
  ["031", 2, "CONTROL", "MIKEY: Daddy!", "Child-height close-up", ["mikey"], ["a1"], "Planned", { lipVisible: true, identityRisk: 3, localAudio: true, shotCap: 1 }],
];

const seed = {
  project: {
    id: PROJECT_ID,
    title: "ENEMIES CLOSER",
    subtitle: "IYKYK · EP01 · Houston crime thriller",
    runtime: 1620,
    budget: 1200,
    productionBudget: { original: 1200, current: 1200, locked: false, lockedAt: null, history: [] },
    openingBudget: 165,
    drift: "STRICT",
    ownerId: OWNER_ID,
    economy: { ...DEFAULT_ECONOMY_SETTINGS },
  },
  characters: [
    {
      id: "marcus",
      name: 'Marcus "Kingpin" Holloway',
      role: "Kingpin / protagonist",
      locked: false,
      refs: {},
      expressions: {},
      voice: "Quiet Houston baritone",
      wardrobe: "Tarmac Look 01",
      notes: "Calm enough to scare a room. Camera stabilizes when he takes control.",
    },
    {
      id: "jasmine",
      name: "Jasmine",
      role: "Marcus's woman / secret architect",
      locked: false,
      refs: {},
      expressions: {},
      voice: "Soft, intelligent, guarded",
      wardrobe: "Tarmac Look 01",
      notes: "Never telegraph the betrayal.",
    },
    {
      id: "turner",
      name: "Detective Turner",
      role: "Dirty cop / hidden accomplice",
      locked: false,
      refs: {},
      expressions: {},
      voice: "Weary public mask; precise privately",
      wardrobe: "HPD Look 01",
      notes: "History with Jasmine stays invisible.",
    },
    {
      id: "mikey",
      name: "Mikey",
      role: "Marcus & Jasmine's son",
      locked: false,
      refs: {},
      expressions: {},
      voice: "Natural four-year-old",
      wardrobe: "Pajamas 01",
      notes: "Emotional POV anchor for the opening.",
    },
  ],
  scenes: [
    {
      id: "001",
      title: "Tarmac / Night / Rain",
      purpose: "Aftermath → The Three → They're Coming → Convoy → The King.",
      location: "Private airfield · East Houston",
      weather: "Heavy rain",
      status: "POC",
      animaticLocked: false,
      animaticLockedAt: null,
    },
  ],
  assets: [
    { id: "a1", type: "Location", name: "Tarmac Master 01", status: "Needed", locked: false, mediaKey: null },
    { id: "a2", type: "Vehicle", name: "Marcus Convoy", status: "Needed", locked: false, mediaKey: null },
    { id: "a3", type: "Prop", name: "Six Black Duffels", status: "Needed", locked: false, mediaKey: null },
    { id: "a4", type: "Prop", name: "Jasmine Crucifix", status: "Needed", locked: false, mediaKey: null },
    { id: "a5", type: "Audio", name: "Heavy Rain Master", status: "Needed", locked: false, mediaKey: null },
  ],
  providers: [
    { id: "google-video", name: "Google Gemini Video API", enabled: false, serverSide: true },
    { id: "local-finish", name: "FPAI Local Finish", enabled: true, serverSide: false },
  ],
  shots: seedShots.map(([id, sec, mode, subject, move, characters, assets, status, economy]) => ({
    id,
    scene: "001",
    sec,
    mode,
    subject,
    move,
    characters,
    assets,
    status,
    prompt: "",
    provider: "auto",
    cost: 0,
    approved: false,
    takes: [],
    drift: "STRICT",
    economy: { ...economy, animaticApproved: false, maxAttempts: 2, manualRouteId: "auto" },
  })),
  ledger: [],
};

function openMediaDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE)) request.result.createObjectStore(MEDIA_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putMedia(key, file) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, "readwrite");
    transaction.objectStore(MEDIA_STORE).put(file, key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getMedia(key) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(MEDIA_STORE).objectStore(MEDIA_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteMedia(key) {
  const db = await openMediaDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MEDIA_STORE, "readwrite");
    transaction.objectStore(MEDIA_STORE).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function migrateData() {
  let old = null;
  const keys = [
    STORAGE_KEY,
    "fpai-film-studio-v1.1F",
    "fpai-film-studio-v1.1E",
    "fpai-film-studio-v1.1D",
    "fpai-film-studio-v1.1C",
    "fpai-film-studio-v1.1B",
    "fpai-film-studio-v1.1A",
  ];
  for (const key of keys) {
    try {
      old = JSON.parse(localStorage.getItem(key));
      if (old) break;
    } catch {
      // Keep searching older snapshots.
    }
  }
  if (!old) return seed;

  const project = { ...seed.project, ...old.project, id: old.project?.id || PROJECT_ID };
  project.productionBudget = normalizeBudget(project);
  project.economy = normalizeEconomySettings(project);

  return {
    ...seed,
    ...old,
    project,
    characters: mergeSavedCharacters(old.characters, seed.characters),
    scenes: (old.scenes || seed.scenes).map((scene) => ({ ...scene, animaticLocked: Boolean(scene.animaticLocked) })),
    assets: old.assets || seed.assets,
    providers: old.providers || seed.providers,
    shots: (old.shots || seed.shots).map((shot) => ({
      ...shot,
      characters: shot.characters || [],
      assets: shot.assets || [],
      takes: shot.takes || [],
      provider: shot.provider || "auto",
      drift: shot.drift || "STRICT",
      economy: normalizeShotEconomy(shot, project),
    })),
    ledger: normalizeLedger(old.ledger || []),
  };
}

function useData() {
  const [data, setData] = useState(migrateData);
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(data)), [data]);
  return [data, setData];
}

function formatTime(seconds) {
  const total = Math.round(Math.max(0, Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function titleCase(value = "") {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Mode({ value }) {
  return <span className={`mode ${String(value).toLowerCase()}`}>{value}</span>;
}

function Pill({ tone = "neutral", children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Metric({ label, value, detail, tone = "" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </div>
  );
}

function Media({ mediaKey, type = "image", remoteUrl, assetUrl }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let objectUrl = "";
    if (assetUrl || !mediaKey || String(mediaKey).startsWith("library:")) {
      setUrl(assetUrl || "");
      return undefined;
    }
    getMedia(mediaKey).then((file) => {
      if (file) {
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      }
    });
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [mediaKey, assetUrl]);

  if (remoteUrl) return <video src={remoteUrl} controls preload="metadata" />;
  if (assetUrl) return type === "video" ? <video src={assetUrl} controls /> : <img src={assetUrl} alt="Uploaded production asset" />;
  if (!mediaKey) return <div className="emptyMedia"><ImageIcon /></div>;
  if (!url) return <div className="emptyMedia">Loading…</div>;
  return type === "video" ? <video src={url} controls /> : <img src={url} alt="Uploaded production asset" />;
}

function App() {
  const [data, setData] = useData();
  const [tab, setTab] = useState("Overview");
  const [characterId, setCharacterId] = useState(null);
  const [shotId, setShotId] = useState(null);
  const [packageShotId, setPackageShotId] = useState(null);
  const [view, setView] = useState("Storyboard");
  const [dragTarget, setDragTarget] = useState(null);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [budgetNote, setBudgetNote] = useState("");
  const [ownerOverride, setOwnerOverride] = useState(false);
  const [toast, setToast] = useState(null);
  const [renders, setRenders] = useState([]);
  function receiveRender(render) {
    setRenders(previous => [...previous.filter(r => r.id !== render.id), render]);
    setData(current => mergeRender(current, render));
  }
  useEffect(() => {
    let canceled = false;
    let timer;
    async function sync() {
      try {
        const result = await renderRequest('/api/renders');
        for (const row of result.renders) {
          if (canceled) return;
          receiveRender(row);
          if (['queued','starting','running'].includes(row.status) || (row.status === 'completed' && !row.outputAsset)) {
            const result = await renderRequest(`/api/renders/${row.id}`);
            if (!canceled) receiveRender(result.render);
          }
        }
      } catch { /* The shot panel reports connection errors; local production stays usable. */ }
      if (!canceled) timer = setTimeout(sync, 1500);
    }
    sync();
    return () => { canceled = true; clearTimeout(timer); };
  }, []);

  const tabs = ["Overview", "Film Engine", "Economy", "Characters", "Scenes", "Shots", "Takes", "Assets", "Continuity", "Router", "Budget"];
  const character = data.characters.find((item) => item.id === characterId) || null;
  const shot = data.shots.find((item) => item.id === shotId) || null;
  const packageShot = data.shots.find((item) => item.id === packageShotId) || null;
  const characterById = (id) => data.characters.find((item) => item.id === id);
  const assetById = (id) => data.assets.find((item) => item.id === id);
  const sceneById = (id) => data.scenes.find((item) => item.id === id);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const productionBudget = useMemo(
    () => calculateBudgetSummary(data.project, data.ledger),
    [data.project, data.ledger],
  );
  const economySummary = useMemo(
    () => calculateProductionEconomy({ project: data.project, shots: data.shots, ledger: data.ledger }),
    [data.project, data.shots, data.ledger],
  );
  const performance = useMemo(() => providerPerformance(data.ledger), [data.ledger]);
  const lockedCast = data.characters.filter((item) => item.locked).length;
  const approvedFootage = data.shots.filter((item) => item.approved).reduce((sum, item) => sum + item.sec, 0);
  const selectedScene = data.scenes[0];
  const sceneShots = data.shots.filter((item) => item.scene === selectedScene?.id);
  const approvedAnimaticShots = sceneShots.filter((item) => normalizeShotEconomy(item, data.project).animaticApproved).length;
  const allMappedTimingApproved = sceneShots.length > 0 && approvedAnimaticShots === sceneShots.length;

  function notify(message, tone = "good") {
    setToast({ message, tone });
  }

  function updateCharacter(id, patch) {
    setData((current) => ({
      ...current,
      characters: current.characters.map((item) => {
        if (item.id !== id) return item;
        const resolved = typeof patch === "function" ? patch(item) : patch;
        return { ...item, ...resolved };
      }),
    }));
  }

  function applyCharacterLibraryPayload(id, payload = {}) {
    updateCharacter(id, (item) => {
      const references = payload.references
        || (payload.reference
          ? [
              ...(item.referenceLibrary || []).filter((row) => row.id !== payload.reference.id),
              payload.reference,
            ]
          : payload.deletedId
            ? (item.referenceLibrary || []).filter((row) => row.id !== payload.deletedId)
            : item.referenceLibrary);
      const next = {};
      if (payload.migratedMediaKeys) next.migratedMediaKeys = payload.migratedMediaKeys;
      if (payload.lock !== undefined) next.identityLock = payload.lock;
      if (payload.coverage) next.referenceCoverage = payload.coverage;
      if (references) next.referenceLibrary = references;
      if (
        Object.prototype.hasOwnProperty.call(payload, "canonicalSlots")
        || payload.references
        || payload.reference
        || payload.deletedId
      ) {
        next.refs = syncCanonicalRefsFromLibrary(item, references || [], payload.canonicalSlots || {});
      }
      return next;
    });
  }

  useEffect(() => {
    let canceled = false;
    const projectId = data.project.id;
    const characterIds = data.characters.map((item) => item.id);
    (async () => {
      for (const id of characterIds) {
        try {
          const payload = await fetchCharacterLibrary(projectId, id);
          if (canceled) return;
          applyCharacterLibraryPayload(id, payload);
        } catch {
          /* Local production stays usable if the adapter is offline. */
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [data.project.id]);

  function updateShot(id, patch) {
    setData((current) => ({
      ...current,
      shots: current.shots.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function updateShotEconomy(id, patch) {
    setData((current) => ({
      ...current,
      shots: current.shots.map((item) => {
        if (item.id !== id) return item;
        return {
          ...item,
          economy: { ...normalizeShotEconomy(item, current.project), ...patch },
        };
      }),
    }));
  }

  function updateScene(id, patch) {
    setData((current) => ({
      ...current,
      scenes: current.scenes.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function updateGenerationSettings(patch) {
    setData((current) => ({ ...current, project: updateEconomySettings(current.project, patch) }));
  }

  function continuityForShot(targetShot) {
    const blockers = [];
    const warnings = [];
    for (const id of targetShot.characters || []) {
      const target = characterById(id);
      if (!target?.locked) blockers.push(`${target?.name || id} is not locked.`);
      for (const missing of missingReferenceCategories(target)) {
        blockers.push(`${target?.name || id} is missing ${missing.label}.`);
      }
    }
    for (const id of targetShot.assets || []) {
      const target = assetById(id);
      if (!target?.locked) warnings.push(`${target?.name || id} is not locked.`);
    }
    return { blockers, warnings, ready: blockers.length === 0 };
  }

  function planForShot(targetShot) {
    return buildGenerationPlan({
      shot: targetShot,
      project: data.project,
      characters: (targetShot.characters || []).map(characterById).filter(Boolean),
      assets: (targetShot.assets || []).map(assetById).filter(Boolean),
      ledger: data.ledger,
    });
  }

  function packageForShot(targetShot) {
    const plan = planForShot(targetShot);
    const continuity = continuityForShot(targetShot);
    const gate = evaluateBudgetGate({
      project: data.project,
      scene: sceneById(targetShot.scene) || {},
      shot: targetShot,
      ledger: data.ledger,
      plan,
      continuityReady: continuity.ready,
      ownerOverride,
    });
    return { shot: targetShot, plan, continuity, gate };
  }

  const generationPackage = packageShot ? packageForShot(packageShot) : null;

  async function addReference(targetCharacter, slot, file) {
    if (!file) return;
    const key = `char:${targetCharacter.id}:${slot}:${Date.now()}`;
    const previous = targetCharacter.refs?.[slot]?.key;
    await putMedia(key, file);
    if (previous && !String(previous).startsWith("library:")) await deleteMedia(previous);
    const mapping = LEGACY_SLOT_TO_LIBRARY[slot] || { category: "other" };
    updateCharacter(targetCharacter.id, (item) => ({
      refs: {
        ...item.refs,
        [slot]: { key, name: file.name, category: slot, uploadedAt: new Date().toISOString() },
      },
      locked: false,
    }));
    try {
      const payload = await uploadCharacterReference(data.project.id, targetCharacter.id, file, {
        category: mapping.category,
        angle: mapping.angle || "",
        expression: mapping.expression || "",
        isPrimary: Boolean(mapping.primary),
        isIdentityAnchor: Boolean(mapping.identityAnchor || mapping.primary),
        approvalState: "approved",
        canonicalSlot: slot,
      });
      applyCharacterLibraryPayload(targetCharacter.id, payload);
    } catch (error) {
      if (error.status === 409 && error.payload?.reference?.id) {
        try {
          const assigned = await assignCharacterCanonicalSlot(
            data.project.id,
            targetCharacter.id,
            slot,
            error.payload.reference.id,
          );
          applyCharacterLibraryPayload(targetCharacter.id, assigned);
        } catch (assignError) {
          notify(assignError.message, "bad");
        }
      } else if (error.status !== 409) notify(error.message, "bad");
    }
  }

  async function removeReference(targetCharacter, slot) {
    const reference = targetCharacter.refs?.[slot];
    if (reference?.key && !String(reference.key).startsWith("library:")) await deleteMedia(reference.key);
    updateCharacter(targetCharacter.id, (item) => {
      const refs = { ...item.refs };
      delete refs[slot];
      return { refs, locked: false };
    });
    try {
      const payload = await assignCharacterCanonicalSlot(data.project.id, targetCharacter.id, slot, null);
      applyCharacterLibraryPayload(targetCharacter.id, payload);
    } catch (error) {
      notify(error.message, "bad");
    }
  }

  async function addExpression(targetCharacter, name, file) {
    if (!file) return;
    const key = `char:${targetCharacter.id}:expr:${name}:${Date.now()}`;
    await putMedia(key, file);
    const expressions = { ...targetCharacter.expressions, [name]: { key, name: file.name } };
    updateCharacter(targetCharacter.id, { expressions });
  }

  async function addTake(targetShot, file) {
    if (!file) return;
    const key = `shot:${targetShot.id}:take:${Date.now()}`;
    await putMedia(key, file);
    const plan = planForShot(targetShot);
    const take = {
      id: String(Date.now()),
      key,
      name: file.name,
      status: "Review",
      cost: 0,
      continuity: 0,
      generatedSeconds: plan.requestSeconds || targetShot.sec,
      usableSeconds: 0,
      usableRanges: [],
      usableRangeText: "",
      notes: "",
    };
    updateShot(targetShot.id, { takes: [...(targetShot.takes || []), take] });
  }

  function updateTake(targetShot, takeId, patch) {
    setData(current => updateTakeState(current, targetShot.id, takeId, patch));
  }

  function approveTake(targetShot, takeId) {
    const plan = planForShot(targetShot);
    setData(current => approveTakeState(current, targetShot.id, takeId, plan));
    notify(`Shot ${targetShot.id} approved. Usable seconds were added to the learning ledger.`);
  }

  function queuePaidPlan(targetShot) {
    const packet = packageForShot(targetShot);
    if (!packet.gate.queueAllowed) {
      notify(packet.gate.blockers[0] || "This request is blocked.", "bad");
      return;
    }
    const entry = normalizeLedgerEntry({
      ...createQueuedLedgerEntry({ plan: packet.plan, project: data.project, shot: targetShot }),
      attemptNumber: packet.gate.attemptsUsed + 1,
    });
    setData((current) => ({ ...current, ledger: [...current.ledger, entry] }));
    setPackageShotId(targetShot.id);
    notify(`Shot ${targetShot.id} entered the budget-safe queue. No API charge was made.`);
  }

  async function cancelQueuedEntry(entryId) {
    const entry=data.ledger.find(e=>e.id===entryId);
    if(entry?.metadata?.renderId) {
      try { const result=await renderRequest(`/api/renders/${entry.metadata.renderId}/cancel`,{}); receiveRender(result.render); }
      catch(error) { notify(error.message,'bad'); }
      return;
    }
    setData((current) => ({
      ...current,
      ledger: current.ledger.map((entry) => entry.id === entryId
        ? { ...entry, generationStatus: "canceled", approvalStatus: "not_applicable" }
        : entry),
    }));
    notify("Queued request canceled before provider execution.");
  }

  function copyPlan(plan) {
    const text = JSON.stringify({
      requestHash: plan.requestHash,
      route: plan.route.id,
      model: plan.route.model,
      jobs: plan.jobs,
      prompt: plan.prompt,
    }, null, 2);
    navigator.clipboard?.writeText(text);
    notify("Generation plan copied.");
  }

  function approveAllMappedTiming() {
    setData((current) => ({
      ...current,
      shots: current.shots.map((item) => item.scene === selectedScene.id
        ? { ...item, economy: { ...normalizeShotEconomy(item, current.project), animaticApproved: true } }
        : item),
    }));
    notify("Mapped shot timing approved. Review once more before locking the scene animatic.");
  }

  function toggleAnimaticLock() {
    if (!selectedScene) return;
    if (!selectedScene.animaticLocked && !allMappedTimingApproved) {
      notify("Approve every mapped shot timing before locking the animatic.", "bad");
      return;
    }
    const locked = !selectedScene.animaticLocked;
    updateScene(selectedScene.id, {
      animaticLocked: locked,
      animaticLockedAt: locked ? new Date().toISOString() : null,
    });
    notify(locked ? "Scene animatic locked. Paid requests can now pass this gate." : "Scene animatic unlocked. Paid requests are blocked again.");
  }

  function applySetBudget() {
    try {
      setData((current) => ({
        ...current,
        project: setProductionBudget(current.project, budgetDraft || productionBudget.currentBudget),
      }));
      setBudgetDraft("");
    } catch (error) {
      notify(error.message, "bad");
    }
  }

  function applyLockBudget() {
    setData((current) => ({ ...current, project: lockProductionBudget(current.project) }));
  }

  function applyAdjustBudget() {
    try {
      setData((current) => ({
        ...current,
        project: adjustProductionBudget(
          current.project,
          budgetDraft || productionBudget.currentBudget,
          budgetNote,
          current.project.ownerId || OWNER_ID,
        ),
      }));
      setBudgetDraft("");
      setBudgetNote("");
    } catch (error) {
      notify(error.message, "bad");
    }
  }

  const navIcon = (name) => {
    const icons = {
      Overview: Film,
      Economy: PiggyBank,
      Characters: Users,
      Scenes: Layers3,
      Shots: Camera,
      Takes: Play,
      Assets: HardDrive,
      Continuity: ShieldCheck,
      Router: Route,
      Budget: WalletCards,
    };
    const Icon = icons[name] || Film;
    return <Icon />;
  };

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="fpMark">FP</div>
          <div><b>FPAI</b><span>FILM STUDIO v1.2</span></div>
        </div>
        <nav>
          {tabs.map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
              {navIcon(item)}<span>{item}</span><ChevronRight />
            </button>
          ))}
        </nav>
        <div className="pipelineBadge">
          <i /> ECONOMY ENGINE ACTIVE
          <small>Animatic → Continuity → Cost Router → Ledger</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">ACTIVE PRODUCTION</span>
            <h1>{data.project.title}</h1>
            <p>{data.project.subtitle}</p>
          </div>
          <div className="actions">
            <button className="ghost" onClick={() => setTab("Shots")}><Search /> Find shot</button>
            <button className="primary" onClick={() => setTab("Shots")}><Camera /> Open Shots</button>
          </div>
        </header>

        <section className="metrics">
          <Metric label="CAST LOCKED" value={`${lockedCast}/4`} detail="Principal cast" />
          <Metric label="GENERATION FORECAST" value={formatMoney(economySummary.forecast.forecast)} detail={`${economySummary.forecast.savingsPercent}% below naive`} tone="economy" />
          <Metric label="GENERATION COMMITTED" value={formatMoney(economySummary.actual + economySummary.committed)} detail={`${formatMoney(economySummary.availableToWorking)} to working ceiling`} />
          <Metric label="PRODUCTION SPEND" value={formatMoney(productionBudget.spent)} detail={`${productionBudget.percentageUsed.toFixed(1)}% of ${formatMoney(productionBudget.currentBudget)}`} tone={productionBudget.warningState} />
        </section>

        {tab === "Film Engine" && <FilmEngine production={data} onCast={() => setTab('Characters')} />}
        {tab === "Overview" && (
          <OverviewPage
            data={data}
            economySummary={economySummary}
            lockedCast={lockedCast}
            approvedAnimaticShots={approvedAnimaticShots}
            sceneShots={sceneShots}
            selectedScene={selectedScene}
            setTab={setTab}
          />
        )}

        {tab === "Economy" && (
          <EconomyPage
            data={data}
            summary={economySummary}
            selectedScene={selectedScene}
            sceneShots={sceneShots}
            approvedAnimaticShots={approvedAnimaticShots}
            allMappedTimingApproved={allMappedTimingApproved}
            approveAllMappedTiming={approveAllMappedTiming}
            toggleAnimaticLock={toggleAnimaticLock}
            updateGenerationSettings={updateGenerationSettings}
            planForShot={planForShot}
            packageForShot={packageForShot}
            setPackageShotId={setPackageShotId}
            performance={performance}
          />
        )}

        {tab === "Characters" && (
          <section className="panel">
            <span className="eyebrow">VISUAL BIBLE</span>
            <h2>Canonical Character Locks</h2>
            <div className="characterGrid">
              {data.characters.map((item) => (
                <div className="characterCard" key={item.id}>
                  <div className="portrait">{item.refs?.identityFront?.key ? <Media mediaKey={item.refs.identityFront.key} assetUrl={item.refs.identityFront.assetUrl} /> : item.name[0]}</div>
                  <h3>{item.name}</h3>
                  <small>{item.role}</small>
                  <p>{characterReferenceCount(item)}/5 required reference assets · {(item.referenceLibrary || []).length} library photos</p>
                  <Pill tone={item.locked ? "good" : "bad"}>{item.locked ? "LOCKED" : "NOT LOCKED"}</Pill>
                  <button className="ghost full" onClick={() => setCharacterId(item.id)}>Open character bible</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "Scenes" && (
          <section className="panel">
            <span className="eyebrow">SCENES</span>
            <h2>Screenplay Command Center</h2>
            {data.scenes.map((item) => {
              const mapped = data.shots.filter((target) => target.scene === item.id);
              const approved = mapped.filter((target) => normalizeShotEconomy(target, data.project).animaticApproved).length;
              return (
                <div className="sceneRow" key={item.id}>
                  <div>
                    <b>SCENE {item.id} · {item.title}</b>
                    <p>{item.purpose}</p>
                    <small>{item.location} · {item.weather} · {approved}/{mapped.length} timing approvals</small>
                  </div>
                  <Pill tone={item.animaticLocked ? "good" : "warn"}>{item.animaticLocked ? "ANIMATIC LOCKED" : "ANIMATIC OPEN"}</Pill>
                </div>
              );
            })}
          </section>
        )}

        {tab === "Shots" && (
          <ShotsPage
            data={data}
            view={view}
            setView={setView}
            planForShot={planForShot}
            continuityForShot={continuityForShot}
            setShotId={setShotId}
          />
        )}

        {tab === "Takes" && (
          <TakesPage data={data} setShotId={setShotId} cancelQueuedEntry={cancelQueuedEntry} />
        )}

        {tab === "Assets" && (
          <section className="panel">
            <span className="eyebrow">ASSET VAULT</span>
            <h2>Production Assets</h2>
            <div className="assetList">
              {data.assets.map((item) => (
                <div key={item.id}>
                  <HardDrive />
                  <div><b>{item.name}</b><small>{item.type}</small></div>
                  <Pill tone={item.locked ? "good" : "neutral"}>{item.locked ? "LOCKED" : item.status}</Pill>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === "Continuity" && (
          <ContinuityPage
            data={data}
            continuityForShot={continuityForShot}
            setPackageShotId={setPackageShotId}
          />
        )}

        {tab === "Router" && (
          <RouterPage data={data} performance={performance} />
        )}

        {tab === "Budget" && (
          <BudgetPage
            data={data}
            productionBudget={productionBudget}
            economySummary={economySummary}
            approvedFootage={approvedFootage}
            budgetDraft={budgetDraft}
            setBudgetDraft={setBudgetDraft}
            budgetNote={budgetNote}
            setBudgetNote={setBudgetNote}
            applySetBudget={applySetBudget}
            applyLockBudget={applyLockBudget}
            applyAdjustBudget={applyAdjustBudget}
            cancelQueuedEntry={cancelQueuedEntry}
          />
        )}
      </main>

      {character && (
        <CharacterDrawer
          character={character}
          projectId={data.project.id}
          dragTarget={dragTarget}
          setDragTarget={setDragTarget}
          addReference={addReference}
          removeReference={removeReference}
          addExpression={addExpression}
          updateCharacter={updateCharacter}
          getMedia={getMedia}
          notify={notify}
          close={() => setCharacterId(null)}
        />
      )}

      {shot && (
        <ShotDrawer
          shot={shot}
          renderPanel={<RenderPanel key={shot.id} shot={shot} project={data.project} characters={(shot.characters || []).map(characterById).filter(Boolean)} scene={sceneById(shot.scene)} plan={planForShot(shot)} continuity={continuityForShot(shot)} getMedia={getMedia} onRender={receiveRender} renders={renders} />}
          project={data.project}
          updateShot={updateShot}
          updateShotEconomy={updateShotEconomy}
          plan={planForShot(shot)}
          packet={packageForShot(shot)}
          setPackageShotId={setPackageShotId}
          addTake={addTake}
          updateTake={updateTake}
          approveTake={approveTake}
          reusableTakes={data.shots.flatMap((sourceShot) => (sourceShot.takes || [])
            .filter((take) => take.status === "Approved" && Number(take.usableSeconds || 0) > 0)
            .map((take) => ({ id: `take:${sourceShot.id}:${take.id}`, label: `Shot ${sourceShot.id} · ${take.name}` })))}
          close={() => setShotId(null)}
        />
      )}

      {generationPackage && (
        <GenerationPackageDrawer
          packet={generationPackage}
          ownerOverride={ownerOverride}
          setOwnerOverride={setOwnerOverride}
          queuePaidPlan={queuePaidPlan}
          copyPlan={copyPlan}
          close={() => {
            setPackageShotId(null);
            setOwnerOverride(false);
          }}
        />
      )}

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}

function OverviewPage({ data, economySummary, lockedCast, approvedAnimaticShots, sceneShots, selectedScene, setTab }) {
  return (
    <>
      <section className="twoColumn">
        <div className="panel economyHero">
          <span className="eyebrow">GENERATION ECONOMY ENGINE</span>
          <h2>Build the movie, not the bill.</h2>
          <p className="lead">The 27-minute forecast is now governed by local-first routing, shortest-permitted paid clips, attempt caps, duplicate protection, and clip salvage.</p>
          <div className="forecastNumbers">
            <div><span>CONTROLLED FORECAST</span><b>{formatMoney(economySummary.forecast.forecast)}</b></div>
            <div><span>NAIVE WORKFLOW</span><b>{formatMoney(economySummary.forecast.naiveCost)}</b></div>
            <div><span>PROJECTED SAVINGS</span><b>{formatMoney(economySummary.forecast.savings)}</b></div>
          </div>
          <button className="primary" onClick={() => setTab("Economy")}><Gauge /> Open Economy Control</button>
        </div>
        <div className="panel">
          <span className="eyebrow">PIPELINE STATUS</span>
          <h2>Production Readiness</h2>
          <div className="intelList">
            <p><CheckCircle2 /> Cost compiler and duplicate hashing installed</p>
            <p className={lockedCast === 4 ? "good" : "warn"}><AlertTriangle /> {4 - lockedCast} principal characters still unlocked</p>
            <p className={selectedScene?.animaticLocked ? "good" : "warn"}><Clock3 /> {approvedAnimaticShots}/{sceneShots.length} mapped timings approved</p>
            <p className="good"><ShieldCheck /> Provider execution remains off; dry-run queue only</p>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panelHead">
          <div><span className="eyebrow">SCENE 001</span><h2>Tarmac / Night / Rain</h2></div>
          <Pill tone={selectedScene?.animaticLocked ? "good" : "warn"}>{selectedScene?.animaticLocked ? "ANIMATIC LOCKED" : "ANIMATIC OPEN"}</Pill>
        </div>
        <div className="heroInside">
          <div>
            <h3>Opening Proof of Concept</h3>
            <p>Aftermath → The Three → They're Coming → Convoy → The King.</p>
            <div className="numbers">
              <b>{data.shots.length}<small>KEY SHOTS</small></b>
              <b>{formatTime(data.shots.reduce((sum, item) => sum + item.sec, 0))}<small>MAPPED</small></b>
              <b>{economySummary.localShotCount}<small>LOCAL-FIRST</small></b>
              <b>{formatMoney(economySummary.mappedExpectedCost)}<small>EXPECTED API</small></b>
            </div>
          </div>
          <div className="modeStack"><Mode value="CHAOS" /><Mode value="SUSPICION" /><Mode value="CONTROL" /></div>
        </div>
      </section>
    </>
  );
}

function EconomyPage({
  data,
  summary,
  selectedScene,
  sceneShots,
  approvedAnimaticShots,
  allMappedTimingApproved,
  approveAllMappedTiming,
  toggleAnimaticLock,
  updateGenerationSettings,
  planForShot,
  packageForShot,
  setPackageShotId,
  performance,
}) {
  const settings = normalizeEconomySettings(data.project);
  return (
    <>
      <section className="economyMetrics">
        <Metric label="GENERATION TARGET" value={formatMoney(settings.generationTarget)} detail="Normal production target" tone="economy" />
        <Metric label="WORKING CEILING" value={formatMoney(settings.workingCeiling)} detail="Owner override above this" />
        <Metric label="EMERGENCY CEILING" value={formatMoney(settings.emergencyCeiling)} detail="Hard stop" tone="warning" />
        <Metric label="FORECAST" value={formatMoney(summary.forecast.forecast)} detail={`${summary.forecast.savingsPercent}% projected savings`} tone="good" />
      </section>

      <section className="twoColumn economyTop">
        <div className="panel">
          <div className="panelHead">
            <div><span className="eyebrow">BUDGET GOVERNOR</span><h2>Hard Spending Controls</h2></div>
            <Pill tone="good">DRY RUN</Pill>
          </div>
          <div className="formGrid three">
            <label>Target<input type="number" min="0" step="1" value={settings.generationTarget} onChange={(event) => updateGenerationSettings({ generationTarget: Number(event.target.value) })} /></label>
            <label>Working Ceiling<input type="number" min="0" step="1" value={settings.workingCeiling} onChange={(event) => updateGenerationSettings({ workingCeiling: Number(event.target.value) })} /></label>
            <label>Emergency Ceiling<input type="number" min="0" step="1" value={settings.emergencyCeiling} onChange={(event) => updateGenerationSettings({ emergencyCeiling: Number(event.target.value) })} /></label>
          </div>
          <div className="budgetGauge">
            <i style={{ width: `${Math.min(100, ((summary.actual + summary.committed) / Math.max(1, settings.emergencyCeiling)) * 100)}%` }} />
          </div>
          <div className="budgetFacts">
            <span>Actual <b>{formatMoney(summary.actual)}</b></span>
            <span>Queued <b>{formatMoney(summary.committed)}</b></span>
            <span>To working ceiling <b>{formatMoney(summary.availableToWorking)}</b></span>
          </div>
          <div className="safetyNotice"><Server /> Provider execution is disabled until a server-side adapter and explicit owner switch are connected.</div>
        </div>

        <div className="panel">
          <div className="panelHead">
            <div><span className="eyebrow">ANIMATIC LOCK</span><h2>Scene 001 Spend Gate</h2></div>
            <Pill tone={selectedScene.animaticLocked ? "good" : "warn"}>{selectedScene.animaticLocked ? "LOCKED" : "OPEN"}</Pill>
          </div>
          <div className="lockProgress"><b>{approvedAnimaticShots}/{sceneShots.length}</b><span>shot timings approved</span></div>
          <div className="progressTrack"><i style={{ width: `${sceneShots.length ? (approvedAnimaticShots / sceneShots.length) * 100 : 0}%` }} /></div>
          <div className="buttonRow">
            <button className="ghost" onClick={approveAllMappedTiming}><CheckCircle2 /> Approve mapped timing</button>
            <button className="primary" disabled={!selectedScene.animaticLocked && !allMappedTimingApproved} onClick={toggleAnimaticLock}>
              {selectedScene.animaticLocked ? <UnlockKeyhole /> : <LockKeyhole />}
              {selectedScene.animaticLocked ? "Unlock Animatic" : "Lock Animatic"}
            </button>
          </div>
          <p className="sub">Paid requests cannot pass while the scene animatic is open. Changing shot duration removes that shot’s timing approval and blocks paid work again.</p>
        </div>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><span className="eyebrow">27-MINUTE FORECAST</span><h2>Controlled Production Assumptions</h2></div>
          <Pill tone="economy">{formatMoney(summary.forecast.forecast)}</Pill>
        </div>
        <div className="assumptionGrid">
          <label>Paid Motion Share<input type="number" min="0" max="1" step="0.05" value={settings.paidMotionShare} onChange={(event) => updateGenerationSettings({ paidMotionShare: Number(event.target.value) })} /><small>{Math.round(settings.paidMotionShare * 100)}% of final runtime</small></label>
          <label>Edit Yield<input type="number" min="0.1" step="0.1" value={settings.editYield} onChange={(event) => updateGenerationSettings({ editYield: Number(event.target.value) })} /><small>final seconds per source second</small></label>
          <label>Planning Attempts<input type="number" min="1" step="0.1" value={settings.planningAttempts} onChange={(event) => updateGenerationSettings({ planningAttempts: Number(event.target.value) })} /><small>average attempts per accepted source</small></label>
          <label>Blended Rate<input type="number" min="0" step="0.01" value={settings.blendedRate} onChange={(event) => updateGenerationSettings({ blendedRate: Number(event.target.value) })} /><small>dollars per generated second</small></label>
          <label>Rounding Overhead<input type="number" min="1" step="0.05" value={settings.roundingOverhead} onChange={(event) => updateGenerationSettings({ roundingOverhead: Number(event.target.value) })} /><small>duration rounding and hero overrun</small></label>
        </div>
        <div className="forecastFlow">
          <div><Film /><b>{formatTime(summary.forecast.runtime)}</b><span>final runtime</span></div>
          <ChevronRight />
          <div><Video /><b>{summary.forecast.paidFinalSeconds}s</b><span>paid-motion coverage</span></div>
          <ChevronRight />
          <div><Scissors /><b>{summary.forecast.sourceSeconds}s</b><span>source footage needed</span></div>
          <ChevronRight />
          <div><RefreshCw /><b>{summary.forecast.generatedSeconds}s</b><span>billable generations</span></div>
          <ChevronRight />
          <div className="highlight"><DollarSign /><b>{formatMoney(summary.forecast.forecast)}</b><span>forecast</span></div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHead">
          <div><span className="eyebrow">SHOT COST COMPILER</span><h2>Mapped Shot Routing</h2></div>
          <span className="pricingStamp">Google snapshot {PRICING_UPDATED_AT} · Seedance fal assumption {SEEDANCE_PRICING_UPDATED_AT}</span>
        </div>
        <div className="economyTable">
          <div className="tableHeader"><span>Shot</span><span>Class</span><span>Method</span><span>Paid sec</span><span>1 attempt</span><span>Expected</span><span>Cap</span><span>Gate</span></div>
          {data.shots.map((item) => {
            const plan = planForShot(item);
            const packet = packageForShot(item);
            return (
              <button key={item.id} className="tableRow" onClick={() => setPackageShotId(item.id)}>
                <span><b>#{item.id}</b><small>{item.sec}s final</small></span>
                <span>{titleCase(plan.shotClass)}</span>
                <span><b>{plan.route.label}</b><small>{plan.route.paid ? plan.route.model : "No API request"}</small></span>
                <span>{plan.requestSeconds || "—"}</span>
                <span>{formatMoney(plan.oneAttemptCost)}</span>
                <span>{formatMoney(plan.expectedCost)}</span>
                <span>{formatMoney(plan.economy.shotCap)}</span>
                <span><Pill tone={packet.gate.queueAllowed || packet.gate.localPlan ? "good" : "bad"}>{packet.gate.localPlan ? "LOCAL" : packet.gate.queueAllowed ? "QUEUE READY" : "BLOCKED"}</Pill></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panelHead"><div><span className="eyebrow">ROUTER LEARNING</span><h2>Effective Cost Per Usable Second</h2></div><Database /></div>
        {Object.values(performance).length ? (
          <div className="performanceGrid">
            {Object.values(performance).map((item) => (
              <div key={item.routeId}>
                <b>{item.routeId}</b>
                <span>{item.requests} requests · {item.approved} approved</span>
                <strong>{item.costPerUsableSecond == null ? "No usable footage yet" : `${formatMoney(item.costPerUsableSecond)} / usable sec`}</strong>
              </div>
            ))}
          </div>
        ) : <p className="sub">The router starts learning after generated takes are reviewed. Until then it uses conservative default acceptance assumptions.</p>}
      </section>
      <SeedanceVisibility compact />
    </>
  );
}

function ShotsPage({ data, view, setView, planForShot, continuityForShot, setShotId }) {
  return (
    <section className="panel">
      <div className="panelHead">
        <div><span className="eyebrow">SHOT DIRECTOR</span><h2>Scene 001</h2></div>
        <div className="viewToggle">
          <button onClick={() => setView("Storyboard")} className={view === "Storyboard" ? "on" : ""}><LayoutGrid /></button>
          <button onClick={() => setView("List")} className={view === "List" ? "on" : ""}><List /></button>
          <button onClick={() => setView("Timeline")} className={view === "Timeline" ? "on" : ""}><Clock3 /></button>
        </div>
      </div>
      {view === "Storyboard" ? (
        <div className="storyboard">
          {data.shots.map((item) => {
            const plan = planForShot(item);
            const continuity = continuityForShot(item);
            return (
              <button className="shotCard" key={item.id} onClick={() => setShotId(item.id)}>
                <div className="frame"><span>#{item.id}</span><b>{item.subject}</b></div>
                <div className="shotMeta"><Mode value={item.mode} /><span>{item.sec}s</span><span>{formatMoney(plan.expectedCost)}</span></div>
                <div className="routeBar"><span>{plan.route.label}</span><Pill tone={continuity.ready ? "good" : "bad"}>{continuity.ready ? "CONTINUITY READY" : "BLOCKED"}</Pill></div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rows">
          {data.shots.map((item) => {
            const plan = planForShot(item);
            const continuity = continuityForShot(item);
            return (
              <button key={item.id} onClick={() => setShotId(item.id)}>
                <b>#{item.id}</b><span>{item.subject}</span><span>{plan.route.label}</span><span>{formatMoney(plan.expectedCost)}</span><strong className={continuity.ready ? "good" : "bad"}>{continuity.ready ? "READY" : "BLOCKED"}</strong>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TakesPage({ data, setShotId, cancelQueuedEntry }) {
  const queued = data.ledger.filter((entry) => ["planned", "queued", "running"].includes(entry.generationStatus));
  const withTakes = data.shots.filter((item) => item.takes.length);
  return (
    <>
      <section className="panel">
        <div className="panelHead"><div><span className="eyebrow">BUDGET-SAFE QUEUE</span><h2>Requests Awaiting Execution</h2></div><Pill tone="good">NO CHARGE YET</Pill></div>
        {queued.length ? queued.map((entry) => (
          <div className="queueRow" key={entry.id}>
            <div><b>Shot #{entry.shotId} · {entry.routeId}</b><small>{entry.requestSeconds}s requested · {formatMoney(entry.estimatedCost)} reserved · hash {entry.requestHash}</small></div>
            <Pill tone="warn">{entry.generationStatus.toUpperCase()}</Pill>
            <button className="ghost compact" onClick={() => cancelQueuedEntry(entry.id)}><X /> Cancel</button>
          </div>
        )) : <p className="sub">No paid requests are queued.</p>}
      </section>
      <section className="panel">
        <span className="eyebrow">APPROVALS</span>
        <h2>Take Review Room</h2>
        {withTakes.length ? withTakes.map((item) => (
          <button className="takeIndexRow" key={item.id} onClick={() => setShotId(item.id)}>
            <b>Shot #{item.id}</b><span>{item.subject}</span><span>{item.takes.length} takes</span><span>{item.takes.reduce((sum, take) => sum + Number(take.usableSeconds || 0), 0).toFixed(1)} usable sec</span>
          </button>
        )) : <p className="sub">No takes yet. Upload or connect a completed render from the shot editor.</p>}
      </section>
    </>
  );
}

function ContinuityPage({ data, continuityForShot, setPackageShotId }) {
  return (
    <>
      <section className="panel">
        <span className="eyebrow">CONTINUITY GATE</span>
        <h2>Principal Cast</h2>
        <div className="characterGrid">
          {data.characters.map((item) => (
            <div className="characterCard compactCard" key={item.id}>
              <div className="portrait small">{item.name[0]}</div>
              <h3>{item.name}</h3>
              <p>{characterReferenceCount(item)}/5 reference assets · {(item.referenceLibrary || []).length} library photos</p>
              <Pill tone={item.locked ? "good" : "bad"}>{item.locked ? "LOCKED" : "NOT LOCKED"}</Pill>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Pre-flight Shot Status</h2>
        <div className="rows continuityRows">
          {data.shots.map((item) => {
            const continuity = continuityForShot(item);
            return (
              <button key={item.id} onClick={() => setPackageShotId(item.id)}>
                <b>#{item.id}</b><span>{item.subject}</span><span>{item.characters.map((id) => data.characters.find((target) => target.id === id)?.name).join(", ") || "No principal cast"}</span><strong className={continuity.ready ? "good" : "bad"}>{continuity.ready ? "READY" : `${continuity.blockers.length} BLOCKERS`}</strong>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function SeedanceVisibility({ compact = false }) {
  const cards = [
    {
      id: "seedance-fast",
      label: "Seedance 2.0 Fast",
      rate: DEFAULT_SEEDANCE_RATES["fast-720p"],
      resolution: "720p",
      audio: true,
      references: "Up to 9 images + reference video",
      use: "Draft motion, coverage, transitions, inexpensive reference-driven tests",
    },
    {
      id: "seedance-standard",
      label: "Seedance 2.0 Standard",
      rate: DEFAULT_SEEDANCE_RATES["standard-720p"],
      rate1080: DEFAULT_SEEDANCE_RATES["standard-1080p"],
      resolution: "720p / 1080p",
      audio: true,
      references: "Up to 9 Character Bible + scene references",
      use: "Cinematic character shots, reference-driven scenes, audio-enabled takes",
    },
  ];
  return (
    <section className={`panel seedancePanel${compact ? " compact" : ""}`}>
      <div className="panelHead">
        <div>
          <span className="eyebrow">SEEDANCE 2.0</span>
          <h2>{compact ? "Fal video routes" : "Provider Control · Seedance 2.0"}</h2>
        </div>
        <Pill tone="good">LIVE OFF</Pill>
      </div>
      <p className="sub">ComfyUI remains identity stills. Seedance is a video candidate, not an automatic replacement for Veo. The isolated Seedance controlled test uses SEEDANCE_LIVE_ENABLED only and never opens LIVE_RENDERING_ENABLED or Veo. Hero shots can still justify Veo. Creator Generate Take stays on the existing shot workflow.</p>
      <div className="seedanceGrid">
        {cards.map((card) => (
          <div className="seedanceCard" key={card.id}>
            <b>{card.label}</b>
            <strong>${card.rate.toFixed(4)}/sec · {card.resolution}</strong>
            {card.rate1080 ? <small>1080p ${card.rate1080.toFixed(4)}/sec</small> : <small>Fast 720p default</small>}
            <div className="seedanceCaps">
              <span>Audio {card.audio ? "yes" : "no"}</span>
              <span>{card.references}</span>
            </div>
            <p>{card.use}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RouterPage({ data, performance }) {
  const settings = normalizeEconomySettings(data.project);
  return (
    <>
      <section className="panel routerHero">
        <div><span className="eyebrow">EXPECTED-COST ROUTER</span><h2>Cheapest accepted footage, not cheapest sticker price.</h2><p className="lead">Every route is scored by shot class, requested seconds, expected attempts, actual usable seconds, and owner-defined caps.</p></div>
        <div className="adapterStatus"><Server /><b>SERVER ADAPTER</b><Pill tone={settings.serverAdapterConnected ? "good" : "bad"}>{settings.serverAdapterConnected ? "CONNECTED" : "NOT CONNECTED"}</Pill></div>
      </section>
      <section className="panel">
        <div className="panelHead"><div><span className="eyebrow">ROUTES</span><h2>Local, ComfyUI, Seedance, Gemini Omni, and Veo Methods</h2></div><span className="pricingStamp">Paid rates as of {settings.pricingUpdatedAt} · Seedance {SEEDANCE_PRICING_UPDATED_AT}</span></div>
        <SeedanceVisibility />
        <div className="routeGrid">
          {ROUTES.map((route) => {
            const learned = performance[route.id];
            return (
              <div className={`routeCard ${route.paid ? "paid" : "local"}`} key={route.id}>
                <div className="routeIcon">{route.paid ? <Zap /> : <HardDrive />}</div>
                <div><b>{route.label}</b><small>{route.model}</small></div>
                <strong>{route.paid ? `$${route.ratePerSecond.toFixed(route.provider === "seedance" ? 4 : 2)}/sec` : "$0 API"}</strong>
                <p>{route.description}</p>
                <div className="routeStats"><span>{learned?.requests || 0} learned requests</span><span>{learned?.usableSeconds || 0}s usable</span></div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function BudgetPage({
  data,
  productionBudget,
  economySummary,
  approvedFootage,
  budgetDraft,
  setBudgetDraft,
  budgetNote,
  setBudgetNote,
  applySetBudget,
  applyLockBudget,
  applyAdjustBudget,
  cancelQueuedEntry,
}) {
  return (
    <section className="twoColumn budgetPage">
      <div className="panel">
        <span className="eyebrow">PRODUCTION LEDGER</span>
        <h2>Owner Production Budget</h2>
        <div className={`bigMoney ${productionBudget.warningState}`}>{formatMoney(productionBudget.spent)}<small>spent · {productionBudget.percentageUsed.toFixed(1)}% used</small></div>
        <div className="budgetRows">
          <div><span>Original Budget</span><b>{formatMoney(productionBudget.originalBudget)}</b></div>
          <div><span>Current Budget</span><b>{formatMoney(productionBudget.currentBudget)}</b></div>
          <div><span>Remaining</span><b>{formatMoney(productionBudget.remaining)}</b></div>
          <div><span>Approved footage</span><b>{formatTime(approvedFootage)}</b></div>
        </div>
        <div className="budgetForm">
          <label>Budget Amount<input type="number" min="0" step="0.01" value={budgetDraft} placeholder={productionBudget.currentBudget.toFixed(2)} onChange={(event) => setBudgetDraft(event.target.value)} /></label>
          <label>Adjustment Note<input value={budgetNote} placeholder="Optional reason" onChange={(event) => setBudgetNote(event.target.value)} /></label>
          <div className="buttonRow">
            <button className="ghost" disabled={productionBudget.locked} onClick={applySetBudget}>Set Budget</button>
            <button className="primary" disabled={productionBudget.locked} onClick={applyLockBudget}><LockKeyhole /> Lock Budget</button>
            <button className="ghost" onClick={applyAdjustBudget}>Adjust Budget</button>
          </div>
        </div>
      </div>
      <div className="panel">
        <span className="eyebrow">GENERATION GOVERNOR</span>
        <h2>Actual + Reserved API Spend</h2>
        <div className="generationTotals">
          <div><span>Actual</span><b>{formatMoney(economySummary.actual)}</b></div>
          <div><span>Queued</span><b>{formatMoney(economySummary.committed)}</b></div>
          <div><span>Forecast</span><b>{formatMoney(economySummary.forecast.forecast)}</b></div>
        </div>
        <div className="ledgerList">
          {data.ledger.length ? data.ledger.map((entry) => (
            <div className="ledgerRow" key={entry.id}>
              <div><span>{new Date(entry.timestamp).toLocaleString()} · {entry.label || entry.generationType}</span><small>{entry.routeId || `${entry.provider}/${entry.model}`} · {entry.requestSeconds || 0}s requested · {entry.usableSeconds || 0}s usable</small></div>
              <div className="ledgerMoney"><b>{entry.generationStatus === "queued" ? formatMoney(entry.estimatedCost) : formatMoney(entry.actualCost)}</b><Pill tone={entry.generationStatus === "completed" ? "good" : entry.generationStatus === "canceled" ? "neutral" : "warn"}>{entry.generationStatus.toUpperCase()}</Pill></div>
              {["planned", "queued", "running"].includes(entry.generationStatus) && <button className="iconButton" onClick={() => cancelQueuedEntry(entry.id)}><X /></button>}
            </div>
          )) : <p className="sub">No generation spend or reservations logged.</p>}
        </div>
        <h3>Budget Audit History</h3>
        {productionBudget.history.length ? productionBudget.history.map((entry, index) => (
          <div className="ledgerRow audit" key={`${entry.timestamp}-${index}`}>
            <div><span>{new Date(entry.timestamp).toLocaleString()} · {entry.actor || OWNER_ID}</span><small>{entry.note || "No note"}</small></div>
            <b>{formatMoney(entry.previousBudget)} → {formatMoney(entry.newBudget)}</b>
          </div>
        )) : <p className="sub">No production budget adjustments yet.</p>}
      </div>
    </section>
  );
}

function CharacterDrawer({ character, projectId, dragTarget, setDragTarget, addReference, removeReference, addExpression, updateCharacter, getMedia, notify, close }) {
  const lockReady = isCharacterReferenceComplete(character);
  function onLibrarySync(payload) {
    updateCharacter(character.id, (item) => {
      const references = payload.references
        || (payload.reference
          ? [...(item.referenceLibrary || []).filter((row) => row.id !== payload.reference.id), payload.reference]
          : payload.deletedId
            ? (item.referenceLibrary || []).filter((row) => row.id !== payload.deletedId)
            : item.referenceLibrary);
      const next = {};
      if (payload.migratedMediaKeys) next.migratedMediaKeys = payload.migratedMediaKeys;
      if (payload.lock !== undefined) next.identityLock = payload.lock;
      if (payload.coverage) next.referenceCoverage = payload.coverage;
      if (payload.references || payload.reference || payload.deletedId) {
        next.referenceLibrary = references;
      }
      if (
        Object.prototype.hasOwnProperty.call(payload, "canonicalSlots")
        || payload.references
        || payload.reference
        || payload.deletedId
      ) {
        next.refs = syncCanonicalRefsFromLibrary(item, references || [], payload.canonicalSlots || {});
      }
      return next;
    });
  }
  return (
    <div className="overlay">
      <div className="drawer wide libraryDrawer">
        <button className="close" onClick={close}><X /></button>
        <span className="eyebrow">CHARACTER BIBLE</span>
        <h2>{character.name}</h2>
        <ProductionCharacterSheet
          projectId={projectId}
          character={character}
          onLibrarySync={onLibrarySync}
          notify={notify}
        />
        <h3>Required Visual References</h3>
        <p className="dropHint">Drag an image onto a slot, or click the slot to browse.</p>
        <div className="referenceGrid">
          {REFERENCE_SLOTS.map(([slot, label]) => {
            const reference = character.refs?.[slot];
            const key = `ref:${slot}`;
            return (
              <div
                className={`referenceSlot dropzone ${dragTarget === key ? "dragging" : ""}`}
                key={slot}
                onDragEnter={(event) => { event.preventDefault(); setDragTarget(key); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragTarget(null); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragTarget(null);
                  const file = event.dataTransfer.files?.[0];
                  if (file?.type?.startsWith("image/")) addReference(character, slot, file);
                }}
              >
                <label>
                  <div className="referencePreview">{reference ? <Media mediaKey={reference.key} assetUrl={reference.assetUrl} /> : <><Upload /><span>DROP IMAGE</span></>}</div>
                  <b>{label}</b>
                  <small>{reference ? reference.name : "Required before lock"}</small>
                  <div className="slotAction">{reference ? "DROP TO REPLACE · CLICK TO BROWSE" : "DROP HERE · CLICK TO BROWSE"}</div>
                  <input type="file" accept="image/*" onChange={(event) => addReference(character, slot, event.target.files?.[0])} />
                </label>
                {reference && <button className="iconButton floating" title="Remove reference" onClick={() => removeReference(character, slot)}><Trash2 /></button>}
              </div>
            );
          })}
        </div>
        <ReferenceLibrary
          projectId={projectId}
          character={character}
          getMedia={getMedia}
          dragTarget={dragTarget}
          setDragTarget={setDragTarget}
          onLibrarySync={onLibrarySync}
          notify={notify}
        />
        <h3>Expression Bank</h3>
        <div className="expressionGrid">
          {EXPRESSIONS.map((name) => {
            const key = `expr:${name}`;
            return (
              <label
                className={`expression dropzone ${dragTarget === key ? "dragging" : ""}`}
                key={name}
                onDragEnter={(event) => { event.preventDefault(); setDragTarget(key); }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragTarget(null); }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragTarget(null);
                  const file = event.dataTransfer.files?.[0];
                  if (file?.type?.startsWith("image/")) addExpression(character, name, file);
                }}
              >
                <div>{character.expressions?.[name] ? <Media mediaKey={character.expressions[name].key} /> : <><Upload /><span>DROP</span></>}</div>
                <b>{name}</b>
                <input type="file" accept="image/*" onChange={(event) => addExpression(character, name, event.target.files?.[0])} />
              </label>
            );
          })}
        </div>
        <label>Role<input value={character.role} readOnly /></label>
        <label>Voice<input value={character.voice} onChange={(event) => updateCharacter(character.id, { voice: event.target.value })} /></label>
        <label>Wardrobe<input value={character.wardrobe} onChange={(event) => updateCharacter(character.id, { wardrobe: event.target.value })} /></label>
        <label>Continuity Notes<textarea value={character.notes} onChange={(event) => updateCharacter(character.id, { notes: event.target.value })} /></label>
        {!lockReady && <div className="validation"><AlertTriangle /> Missing {missingReferenceCategories(character).map((item) => item.label).join(", ")}.</div>}
        <button disabled={!lockReady} className="primary full" onClick={() => updateCharacter(character.id, { locked: !character.locked })}><LockKeyhole />{character.locked ? "UNLOCK CHARACTER" : "LOCK CHARACTER"}</button>
      </div>
    </div>
  );
}

function ShotDrawer({ shot, renderPanel, project, updateShot, updateShotEconomy, plan, packet, setPackageShotId, addTake, updateTake, approveTake, reusableTakes, close }) {
  const economy = normalizeShotEconomy(shot, project);
  return (
    <div className="overlay">
      <div className="drawer wide">
        <button className="close" onClick={close}><X /></button>
        <span className="eyebrow">SHOT EDITOR</span>
        <h2>Shot #{shot.id}</h2>
        <h3>{shot.subject}</h3>
        <div className="formGrid two">
          <label>Duration<input type="number" min="0.1" step="0.1" value={shot.sec} onChange={(event) => updateShot(shot.id, { sec: Number(event.target.value), economy: { ...economy, animaticApproved: false } })} /></label>
          <label>Mode<select value={shot.mode} onChange={(event) => updateShot(shot.id, { mode: event.target.value })}><option>CHAOS</option><option>SUSPICION</option><option>CONTROL</option></select></label>
        </div>
        <label>Camera<input value={shot.move} onChange={(event) => updateShot(shot.id, { move: event.target.value })} /></label>
        <label>Prompt<textarea value={shot.prompt} onChange={(event) => updateShot(shot.id, { prompt: event.target.value })} /></label>

        <div className="sectionTitle"><SlidersHorizontal /><span>GENERATION ECONOMY CONTROLS</span></div>
        <div className="animaticApproval">
          <div><b>Shot timing approved in animatic</b><small>Changing duration automatically removes this approval.</small></div>
          <button className={economy.animaticApproved ? "toggle on" : "toggle"} onClick={() => updateShotEconomy(shot.id, { animaticApproved: !economy.animaticApproved })}><i /></button>
        </div>
        <div className="formGrid three">
          <label>Motion Method<select value={economy.motionNeed} onChange={(event) => updateShotEconomy(shot.id, { motionNeed: event.target.value })}><option value="local">Local composite</option><option value="still">Still + local motion</option><option value="generative">Paid generative motion</option></select></label>
          <label>Route<select value={economy.manualRouteId} onChange={(event) => updateShotEconomy(shot.id, { manualRouteId: event.target.value })}><option value="auto">Auto route</option>{ROUTES.map((route) => <option value={route.id} key={route.id}>{route.label}</option>)}</select></label>
          <label>Reuse Potential<select value={economy.reusePotential} onChange={(event) => updateShotEconomy(shot.id, { reusePotential: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Clip Vault Reuse<select value={economy.reuseAssetId || ""} onChange={(event) => updateShotEconomy(shot.id, { reuseAssetId: event.target.value || null })}><option value="">No approved take selected</option>{reusableTakes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Motion Complexity<input type="number" min="0" max="3" value={economy.complexity} onChange={(event) => updateShotEconomy(shot.id, { complexity: Number(event.target.value) })} /></label>
          <label>Identity Risk<input type="number" min="0" max="3" value={economy.identityRisk} onChange={(event) => updateShotEconomy(shot.id, { identityRisk: Number(event.target.value) })} /></label>
          <label>Max Attempts<input type="number" min="1" max="10" value={economy.maxAttempts} onChange={(event) => updateShotEconomy(shot.id, { maxAttempts: Number(event.target.value) })} /></label>
          <label>Shot Cap<input type="number" min="0" step="0.1" value={economy.shotCap} onChange={(event) => updateShotEconomy(shot.id, { shotCap: Number(event.target.value) })} /></label>
          <label className="checkLabel"><input type="checkbox" checked={economy.lipVisible} onChange={(event) => updateShotEconomy(shot.id, { lipVisible: event.target.checked })} /><span>Visible dialogue</span></label>
          <label className="checkLabel"><input type="checkbox" checked={economy.localAudio} onChange={(event) => updateShotEconomy(shot.id, { localAudio: event.target.checked })} /><span>Finish dialogue locally</span></label>
          <label className="checkLabel"><input type="checkbox" checked={economy.hero} onChange={(event) => updateShotEconomy(shot.id, { hero: event.target.checked })} /><span>Hero shot</span></label>
          <label className="checkLabel"><input type="checkbox" checked={economy.nativeDetail} onChange={(event) => updateShotEconomy(shot.id, { nativeDetail: event.target.checked })} /><span>Native 1080p needed</span></label>
        </div>

        <div className="shotCostCard">
          <div><span>RECOMMENDED ROUTE</span><b>{plan.route.label}</b><small>{titleCase(plan.shotClass)}</small></div>
          <div><span>PAID DURATION</span><b>{plan.requestSeconds || 0}s</b><small>{plan.route.estimate.clipDurations.join(" + ") || "Local"}</small></div>
          <div><span>ONE ATTEMPT</span><b>{formatMoney(plan.oneAttemptCost)}</b><small>{plan.route.estimate.expectedAttempts} expected attempts</small></div>
          <div><span>MAX EXPOSURE</span><b>{formatMoney(plan.maxExposure)}</b><small>cap {formatMoney(economy.shotCap)}</small></div>
        </div>
        <button className="ghost full" onClick={() => setPackageShotId(shot.id)}><PackageCheck /> Preview Cost-Control Package</button>
        {packet.gate.blockers.length > 0 && <div className="validation"><AlertTriangle /> {packet.gate.blockers[0]}</div>}

        {renderPanel}
        <h3>Takes and Salvage</h3>
        <label className="primary uploadButton"><Upload /> Upload completed take<input type="file" accept="image/*,video/*" onChange={(event) => addTake(shot, event.target.files?.[0])} /></label>
        <div className="takeGrid">
          {shot.takes.map((take) => (
            <div className="takeCard" key={take.id}>
              <div className="takeMedia"><Media mediaKey={take.key} remoteUrl={take.url} type={take.name.match(/\.(mp4|mov|webm)$/i) ? "video" : "image"} /></div>
              <div className="formGrid two compactForm">
                <label>Actual Cost<input type="number" min="0" readOnly={Boolean(take.renderId)} step="0.01" value={take.cost} onChange={(event) => updateTake(shot, take.id, { cost: Number(event.target.value) })} /></label>
                <label>Continuity<input type="number" min="0" max="100" value={take.continuity} onChange={(event) => updateTake(shot, take.id, { continuity: Number(event.target.value) })} /></label>
                <label>Generated sec<input type="number" readOnly={Boolean(take.renderId)} step="0.1" value={take.generatedSeconds} onChange={(event) => {
                  const generatedSeconds = Number(event.target.value);
                  const usableRanges = parseUsableRangeText(take.usableRangeText || "", generatedSeconds);
                  updateTake(shot, take.id, { generatedSeconds, usableRanges, usableSeconds: usableRanges.reduce((sum, range) => sum + range.end - range.start, 0) });
                }} /></label>
                <label>Usable sec<input type="number" step="0.1" value={take.usableSeconds} onChange={(event) => updateTake(shot, take.id, { usableSeconds: Number(event.target.value) })} /></label>
                <label className="rangeInput">Usable timecodes<input value={take.usableRangeText || ""} placeholder="0-2.4, 5-6.1" onChange={(event) => {
                  const usableRangeText = event.target.value;
                  const usableRanges = parseUsableRangeText(usableRangeText, Number(take.generatedSeconds || 0));
                  updateTake(shot, take.id, { usableRangeText, usableRanges, usableSeconds: usableRanges.reduce((sum, range) => sum + range.end - range.start, 0) });
                }} /></label>
              </div>
              <div className="takeActions">
                <button aria-label="Reject take" onClick={() => updateTake(shot, take.id, { status: "Rejected" })}><ThumbsDown /></button>
                <button onClick={() => updateTake(shot, take.id, { status: "Shortlist" })}><Star /></button>
                <button aria-label="Approve take" onClick={() => approveTake(shot, take.id)}><ThumbsUp /></button>
              </div>
              <Pill tone={take.status === "Approved" ? "good" : take.status === "Rejected" ? "bad" : "neutral"}>{take.status}</Pill>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GenerationPackageDrawer({ packet, ownerOverride, setOwnerOverride, queuePaidPlan, copyPlan, close }) {
  const { shot, plan, continuity, gate } = packet;
  return (
    <div className="overlay">
      <div className="drawer packageDrawer">
        <button className="close" onClick={close}><X /></button>
        <span className="eyebrow">GENERATION PACKAGE PREVIEW</span>
        <h2>Shot #{shot.id}</h2>
        <h3>{shot.subject}</h3>

        <section className="packageSummary">
          <div><span>CLASS</span><b>{titleCase(plan.shotClass)}</b></div>
          <div><span>ROUTE</span><b>{plan.route.label}</b></div>
          <div><span>REQUEST</span><b>{plan.requestSeconds || 0}s</b></div>
          <div><span>ONE ATTEMPT</span><b>{formatMoney(plan.oneAttemptCost)}</b></div>
          <div><span>EXPECTED</span><b>{formatMoney(plan.expectedCost)}</b></div>
          <div><span>MAX EXPOSURE</span><b>{formatMoney(plan.maxExposure)}</b></div>
        </section>

        <section>
          <div className="sectionHeader"><b>ASSEMBLED PROMPT</b><button className="iconButton" onClick={() => copyPlan(plan)}><Copy /></button></div>
          <pre>{plan.prompt}</pre>
        </section>

        <section>
          <b>PROVIDER JOB PLAN</b>
          {plan.jobs.length ? plan.jobs.map((job) => (
            <div className="jobRow" key={job.jobIndex}>
              <span>Job {job.jobIndex + 1}</span><b>{job.durationSeconds}s · {job.resolution}</b><small>{job.model}</small>
            </div>
          )) : <p className="good">No paid provider job. Finish this shot locally or reuse approved footage.</p>}
        </section>

        <section>
          <b>CONTINUITY</b>
          {continuity.blockers.map((item) => <p className="bad" key={item}>BLOCKER · {item}</p>)}
          {continuity.warnings.map((item) => <p className="warn" key={item}>WARNING · {item}</p>)}
          {continuity.ready && <p className="good">READY · Character inheritance is clear.</p>}
        </section>

        <section>
          <b>BUDGET GOVERNOR</b>
          <div className="gateFacts">
            <span>Attempts <b>{gate.attemptsUsed}/{plan.economy.maxAttempts}</b></span>
            <span>Shot reserved/spent <b>{formatMoney(gate.shotSpend)}</b></span>
            <span>After request <b>{formatMoney(gate.projectedCommitted)}</b></span>
          </div>
          {gate.blockers.map((item) => <p className="bad" key={item}>BLOCKER · {item}</p>)}
          {gate.warnings.map((item) => <p className="warn" key={item}>WARNING · {item}</p>)}
          {!gate.blockers.length && !gate.localPlan && <p className="good">QUEUE READY · Budget and duplicate checks passed.</p>}
          {gate.localPlan && <p className="good">LOCAL ROUTE · No API charge should be created.</p>}
        </section>

        {(plan.route.tier === "standard" || plan.route.resolution === "4k" || gate.blockers.some((item) => item.includes("owner override"))) && (
          <label className="overrideCheck"><input type="checkbox" checked={ownerOverride} onChange={(event) => setOwnerOverride(event.target.checked)} /><span>Owner override for this preview</span></label>
        )}

        <div className="executionStatus">
          <Server />
          <div><b>EXECUTION REMAINS OFF</b><small>{gate.executionBlockers.join(" · ") || "Server controls connected"}</small></div>
        </div>
        <button className="primary full" disabled={!gate.queueAllowed} onClick={() => queuePaidPlan(shot)}><PiggyBank />{gate.localPlan ? "NO PAID REQUEST NEEDED" : "QUEUE BUDGET-SAFE REQUEST"}</button>
        <p className="sub center">Queuing reserves budget and records the request hash. It does not call Google or create a charge.</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
