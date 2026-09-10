export type Review = 'draft' | 'approved' | 'rejected' | 'locked' | 'needs_review';
export interface Span { sourceId: string; lineStart: number; lineEnd: number; page: number }
export interface Dialogue { character: string; text: string; parenthetical: string; source: Span }
export interface Scene { id: string; order: number; slugline: string; location: string; setting: string; time: string; action: string; characters: string[]; dialogue: Dialogue[]; transitions: string[]; act: string; sequence: string; beats: string[]; duration: number; source: Span }
export interface Script { id: string; version: number; title: string; logline: string; text: string; sourceId: string; scenes: Scene[]; status: Review; warnings: string[]; diff: Record<string, unknown> }
export interface Item { id: string; kind: string; name: string; sceneId: string; source: Span; status: Review; notes: string; facts: Record<string, string> }
export interface Shot { id: string; sceneId: string; order: number; subject: string; characters: string[]; duration: number; framing: string; angle: string; lens: string; movement: string; lighting: string; performance: string; dialogue: string; wardrobe: string; props: string; sound: string; musicCueId: string; prompt: string; negative: string; source: Span | null; status: Review; version: number; scriptVersion: number; needsReview: boolean; continuity: Record<string, string> }
export interface Cue { id: string; title: string; sceneId: string; kind: string; mood: string; genre: string; bpm: number; key: string; instrumentation: string; vocalDirection: string; sections: Record<string, string>; sourceIds: string[]; ownership: string; splits: string; clearance: string; version: number; status: Review; start: number; end: number }
export interface Audio { id: string; character: string; sceneId: string; kind: string; text: string; direction: string; pronunciation: string; voiceProfile: string; consent: string; sourceId: string; source: Span | null; takes: string[]; status: Review; version: number }
export interface Job { id: string; shotId: string; sceneId: string; capability: string; provider: 'mock'; model: string; status: string; estimatedCost: number; approvedCostCeiling: number; actualCost: number; retryCount: number; createdAt: string; updatedAt: string; prompt: string; promptVersion: number; worldVersion: number; characterLocks: Record<string, number | null>; selection: unknown; inputAssets: string[]; outputAsset: string | null; error: string | null; revision: string; shotVersion: number; duration: number }
export interface Clip { id: string; lane: string; jobId: string; sourceId: string; sceneId: string; start: number; in: number; out: number; level: number; caption: string; transition: string }
export interface Cut { id: string; version: number; name: string; clips: Clip[]; notes: string; status: Review }
export interface State { schema: string; projectId: string; title: string; revision: number; importedProduction: unknown; scripts: Script[]; activeScriptId: string | null; items: Item[]; shots: Shot[]; cues: Cue[]; audio: Audio[]; jobs: Job[]; cuts: Cut[]; worldVersion: number; budget: number }
export interface Command { type: string; [key: string]: unknown }
export const CAPABILITIES = ['still-image', 'image-edit', 'character-consistency', 'video', 'video-extension', 'upscale', 'lip-sync', 'voice', 'music', 'sound-effect', 'transcription', 'caption-alignment', 'assembly'] as const;
export function requireThat(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const uid = () => crypto.randomUUID();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
const unique = <T>(values: T[]) => [...new Set(values)];
const text = (value: unknown, max = 12000) => String(value ?? '').slice(0, max);
const number = (value: unknown, min = 0, max = 86400) => { const n = Number(value); requireThat(Number.isFinite(n) && n >= min && n <= max, `Number must be between ${min} and ${max}.`); return n; };
export const activeScript = (state: State) => state.scripts.find(s => s.id === state.activeScriptId);
export function emptyState(projectId: string): State { return { schema: 'fpai.film-engine.v1', projectId, title: 'Film production', revision: 0, importedProduction: null, scripts: [], activeScriptId: null, items: [], shots: [], cues: [], audio: [], jobs: [], cuts: [], worldVersion: 0, budget: 0 }; }

/** Deterministic extraction; all inferred structure requires human review. */
export function parseScript(raw: string, sourceId: string, version = 1, previous?: Script): Script {
  requireThat(raw.trim() && raw.length <= 350000, 'Script must contain 1–350,000 characters.');
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const scenes: Scene[] = [];
  let page = 1, act = '', sequence = '', current: Scene | undefined, speaker = '', parenthetical = '';
  const occurrence: Record<string, number> = {};
  const span = (line: number): Span => ({ sourceId, lineStart: line + 1, lineEnd: line + 1, page });
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const line = original.replace(/\f/g, '').trim();
    if (original.includes('\f')) page++;
    if (!line) { speaker = ''; parenthetical = ''; continue; }
    if (/^ACT\s+\w+/i.test(line)) { act = line; continue; }
    if (/^SEQUENCE\s+\w+/i.test(line)) { sequence = line; continue; }
    const heading = line.match(/^(?:\d+[A-Z]?\s+)?(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E)\s+(.+?)(?:\s+[-–—]\s+(.+?))?(?:\s+\d+[A-Z]?)?$/i);
    if (heading) {
      const key = slug(`${heading[1]}-${heading[2]}-${heading[3] || ''}`);
      occurrence[key] = (occurrence[key] || 0) + 1;
      const old = previous?.scenes.filter(s => slug(`${s.setting}-${s.location}-${s.time}`) === key)[occurrence[key] - 1];
      current = { id: old?.id || uid(), order: scenes.length + 1, slugline: line, setting: heading[1].replace(/\./g, '').toUpperCase(), location: heading[2], time: heading[3] || '', action: '', characters: [], dialogue: [], transitions: [], act, sequence, beats: [], duration: 0, source: span(i) };
      scenes.push(current); speaker = ''; continue;
    }
    if (!current) continue;
    current.source.lineEnd = i + 1;
    if (/^(?:CUT TO:|DISSOLVE TO:|FADE (?:IN|OUT)[.:]?|SMASH CUT TO:)/i.test(line)) { current.transitions.push(line); speaker = ''; continue; }
    if (/^\(.+\)$/.test(line) && speaker) { parenthetical = line.slice(1, -1); continue; }
    const next = lines[i + 1]?.trim();
    if (/^[A-Z][A-Z .'-]{1,40}(?:\s*\([^)]*\))?$/.test(line) && next && !/^\d+$/.test(line)) {
      speaker = line.replace(/\s*\((?:V\.O\.|O\.S\.|CONT'D|CONT’D)\)/g, '').trim();
      current.characters.push(speaker); continue;
    }
    if (speaker) {
      const prior = current.dialogue.at(-1);
      if (prior && prior.character === speaker && prior.source.lineEnd === i) { prior.text += ` ${line}`; prior.source.lineEnd = i + 1; }
      else current.dialogue.push({ character: speaker, text: line, parenthetical, source: span(i) });
    } else if (!/^\d+[.]?$/.test(line)) current.action += `${current.action ? '\n' : ''}${line}`;
  }
  requireThat(scenes.length, 'No scene headings found. Add INT. or EXT. headings, or correct extracted text before parsing.');
  const named = unique(scenes.flatMap(s => s.characters));
  // Explicit uppercase introductions and known dialogue speakers; no invented people.
  for (const scene of scenes) {
    const introductions = [...scene.action.matchAll(/\b([A-Z][A-Z'-]{2,}(?:\s+[A-Z][A-Z'-]{2,})?),?\s*\((?:\d{1,3}|\d{2}s|child|adult)[^)]*\)/g)].map(m => m[1]);
    scene.characters = unique([...scene.characters, ...introductions, ...named.filter(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(scene.action))]);
    scene.duration = Math.max(2, Math.round((scene.action.split(/\s+/).length + scene.dialogue.reduce((n, d) => n + d.text.split(/\s+/).length, 0)) / 2.5));
    scene.beats = scene.action.split('\n').filter(Boolean);
  }
  const result: Script = { id: uid(), version, sourceId, title: lines.find(l => l.trim() && !/^\s*(INT|EXT|ACT|SEQUENCE)[.\s]/.test(l))?.trim() || 'Untitled screenplay', logline: '', text: raw, scenes, status: 'draft', warnings: ['Rule-based extraction. Verify cast, scene boundaries, page locations and estimated durations before approval.', 'Acts, relationships and continuity are extracted only where supplied or explicitly recorded.'], diff: {} };
  result.diff = diffScript(previous, result);
  return result;
}
export function diffScript(old: Script | undefined, next: Script) {
  const previous = old?.scenes || [];
  return { added: next.scenes.filter(s => !previous.some(p => p.id === s.id)).map(s => s.id), removed: previous.filter(s => !next.scenes.some(n => n.id === s.id)).map(s => s.id), changed: next.scenes.filter(s => { const p = previous.find(p => p.id === s.id); return p && JSON.stringify([p.action,p.dialogue.map(d=>[d.character,d.text]),p.characters,p.location,p.time]) !== JSON.stringify([s.action,s.dialogue.map(d=>[d.character,d.text]),s.characters,s.location,s.time]); }).map(s => s.id), note: 'Renamed or ambiguous repeated scenes appear as added/removed and require manual mapping. Existing shot IDs are preserved.' };
}
const breakdownRules: [string, RegExp][] = [
  ['prop', /\b(?:gun|pistol|rifle|phone|bag|keys|knife|mask)\b/gi], ['vehicle', /\b(?:car|truck|jet|convoy|SUV|helicopter)\b/gi],
  ['wardrobe', /\b(?:gloves|boots|jacket|dress|hoodie|shirt|uniform)\b/gi], ['hair_makeup', /\b(?:braids|beard|wig|makeup)\b/gi],
  ['injury', /\b(?:wounded|bleeding|bruise|scar|injured)\b/gi], ['practical_effect', /\b(?:rain|smoke|fire)\b/gi],
  ['visual_effect', /\b(?:explosion|bullet|muzzle flash)\b/gi], ['sound', /\b(?:crying|gunfire|siren|thunder|footsteps)\b/gi],
  ['music', /\b(?:song|music|score|radio|singing)\b/gi], ['safety_action', /\b(?:shoots|shootout|firearm|fight|stunt|gun|fire)\b/gi],
];
export function breakdown(script: Script): Item[] {
  return script.scenes.flatMap(scene => {
    const item = (kind: string, name: string, source = scene.source): Item => ({ id: uid(), kind, name, sceneId: scene.id, source, status: 'draft', notes: '', facts: {} });
    const list = [item('location', scene.location), item('set', scene.location), ...scene.characters.map(c => item('character', c))];
    if (scene.time) list.push(item('day_night', scene.time));
    const lines = script.text.replace(/\r\n?/g, '\n').split('\n');
    for (let i = scene.source.lineStart - 1; i < scene.source.lineEnd; i++) for (const [kind, regex] of breakdownRules) {
      for (const match of (lines[i] || '').matchAll(regex)) if (!list.some(x => x.kind === kind && x.name.toLowerCase() === match[0].toLowerCase())) list.push(item(kind, match[0], { ...scene.source, lineStart: i + 1, lineEnd: i + 1 }));
    }
    return list;
  });
}
export function storyGraph(state: State) {
  const script = activeScript(state);
  const nodes = [...(script?.scenes || []).map(s => ({ id: s.id, kind: 'scene', name: s.slugline, source: s.source })), ...state.items.filter(i=>i.status!=='rejected').map(i => ({ id: i.id, kind: i.kind, name: i.name, source: i.source }))];
  const edges = state.items.filter(i=>i.status!=='rejected').map(i => ({ from: i.sceneId, to: i.id, relation: i.kind === 'relationship' ? i.notes : 'requires', source: i.source }));
  return { version: script?.version || 0, nodes, edges };
}
export function orderedShots(state: State) {
  const scenes = activeScript(state)?.scenes || [];
  return [...state.shots].sort((a,b) => (scenes.findIndex(s=>s.id===a.sceneId) + 1 || 9999) - (scenes.findIndex(s=>s.id===b.sceneId) + 1 || 9999) || a.order - b.order || a.id.localeCompare(b.id, undefined, {numeric:true})).map((s,i)=>({...s, displayNumber: String(i+1).padStart(3,'0')}));
}
export function continuityReport(state: State) {
  const warnings: { code: string; shotIds: string[]; sceneIds: string[]; message: string }[] = [];
  const previous = new Map<string, Shot>();
  for (const shot of orderedShots(state)) {
    if (shot.needsReview) warnings.push({ code: 'SCRIPT_CHANGED', shotIds: [shot.id], sceneIds: [shot.sceneId], message: 'Script revision may affect this shot. Review its source mapping and approved take.' });
    for (const character of shot.characters) {
      const prior = previous.get(character);
      if (prior) for (const key of ['identity','height','wardrobe','hair','injury','propPossession','vehicle','geography','lightingDirection','time','eyeline','screenDirection','emotion']) {
        const before = prior.continuity[key], after = shot.continuity[key];
        if (before && after && before !== after && !shot.continuity[`${key}ChangeReason`]) warnings.push({ code: 'FACT_CHANGE', shotIds: [prior.id,shot.id], sceneIds: unique([prior.sceneId,shot.sceneId]), message: `${character}: ${key} changes from “${before}” to “${after}” without a recorded story reason.` });
      }
      previous.set(character,shot);
    }
  }
  const groups = new Map<string, Shot[]>();
  for (const shot of state.shots) { const k = JSON.stringify([shot.sceneId,shot.subject,shot.framing,shot.angle]); groups.set(k,[...(groups.get(k)||[]),shot]); }
  for (const group of groups.values()) if(group.length>1) warnings.push({code:'DUPLICATE_COVERAGE',shotIds:group.map(s=>s.id),sceneIds:[group[0].sceneId],message:'Matching coverage. Confirm these are intentional alternatives.'});
  return { mode: 'recorded-facts-only', disclaimer: 'This checks recorded metadata, not visual identity, geometry, or physical safety.', warnings };
}
function newShot(scene: Scene, version: number, subject = scene.action.split('\n')[0] || scene.slugline): Shot {
  return { id: uid(), sceneId: scene.id, order: scene.order, subject, characters: scene.characters.map(slug), duration: Math.min(8, scene.duration), framing: 'wide', angle: 'eye level', lens: '35mm suggestion', movement: 'locked off', lighting: scene.time, performance: '', dialogue: scene.dialogue.map(d=>`${d.character}: ${d.text}`).join('\n'), wardrobe: '', props: '', sound: '', musicCueId: '', prompt: `${scene.slugline}. ${subject}`, negative: 'Preserve approved identity, proportions, wardrobe and screen direction.', source: scene.source, status: 'draft', version: 1, scriptVersion: version, needsReview: false, continuity: {} };
}
function find<T extends {id:string}>(list: T[], id: unknown): T { const value=list.find(x=>x.id===id); requireThat(value,'Record not found.'); return value; }
function review(value: unknown): Review { requireThat(['draft','approved','rejected','locked','needs_review'].includes(String(value)),'Invalid review status.'); return value as Review; }
function strings(value: unknown): string[] { requireThat(Array.isArray(value) && value.length<=100,'Expected at most 100 values.'); return value.map(v=>text(v,100)); }
export function reduce(state: State, command: Command): State {
  const next: State = structuredClone(state);
  const c = command;
  switch(c.type) {
    case 'import-production': {
      requireThat(!next.importedProduction,'Production snapshot already linked. Existing records are never reimported over edits.');
      const production = c.production as {project?:{title?:string};shots?:{id:string;scene:string;subject:string;characters:string[];duration:number;status:string}[]};
      requireThat(production && Array.isArray(production.shots) && production.shots.length<=2000,'Invalid production snapshot.');
      next.importedProduction=structuredClone(production); next.title=text(production.project?.title || next.title,200);
      next.shots=production.shots.map((s,i)=>({...newShot({id:s.scene,order:i+1,action:s.subject,slugline:'Linked existing production',characters:s.characters||[],duration:s.duration||8,dialogue:[],time:'',source:null} as unknown as Scene,0),id:s.id,characters:s.characters||[],status:/lock/i.test(s.status)?'locked':'approved',source:null,needsReview:true}));
      break;
    }
    case 'parse-script': {
      const script=parseScript(text(c.text,350001),text(c.sourceId,100),next.scripts.length+1,activeScript(next));
      next.scripts.push(script); break;
    }
    case 'edit-script': {
      const script=find(next.scripts,c.id); requireThat(script.status==='draft','Approved scripts are immutable. Parse a new revision.');
      script.title=text(c.title||script.title,200); script.logline=text(c.logline,1000);
      if(c.sceneId) {const scene=find(script.scenes,c.sceneId); if(c.location!==undefined)scene.location=text(c.location,200); if(c.act!==undefined)scene.act=text(c.act,100);if(c.sequence!==undefined)scene.sequence=text(c.sequence,100); if(c.characters!==undefined)scene.characters=strings(c.characters); }
      break;
    }
    case 'approve-script': {
      const script=find(next.scripts,c.id); requireThat(script.status==='draft','Only a draft script can be approved.');
      script.diff=diffScript(activeScript(next),script); script.status='approved'; next.activeScriptId=script.id;
      const affected=new Set([...(script.diff.changed as string[]),...(script.diff.removed as string[])]);
      for(const shot of next.shots) if(!shot.source || affected.has(shot.sceneId))shot.needsReview=true;
      next.items.push(...breakdown(script)); next.worldVersion++;
      for(const scene of script.scenes) for(const d of scene.dialogue) next.audio.push({id:uid(),character:slug(d.character),sceneId:scene.id,kind:'dialogue',text:d.text,direction:d.parenthetical,pronunciation:'',voiceProfile:'',consent:'unknown',sourceId:'',source:d.source,takes:[],status:'draft',version:1});
      break;
    }
    case 'review-item': {
      const item=find(next.items,c.id); requireThat(item.status!=='locked','Create a new bible record to revise a locked item.');
      if(c.status!==undefined)item.status=review(c.status);
      if(c.name!==undefined)item.name=text(c.name,300); if(c.notes!==undefined)item.notes=text(c.notes);
      if(c.facts!==undefined) { requireThat(c.facts && typeof c.facts==='object' && !Array.isArray(c.facts),'Facts must be an object.'); item.facts=Object.fromEntries(Object.entries(c.facts).map(([k,v])=>[text(k,100),text(v,4000)])); }
      next.worldVersion++; break;
    }
    case 'add-item': {
      const scene=find(activeScript(next)?.scenes || [],c.sceneId);
      next.items.push({id:uid(),kind:text(c.kind,100),name:text(c.name,300),notes:text(c.notes),sceneId:scene.id,source:scene.source,status:'draft',facts:{}});next.worldVersion++;break;
    }
    case 'merge-items': {
      const ids=strings(c.ids);requireThat(ids.length>=2,'Select at least two records.');const items=ids.map(id=>find(next.items,id));requireThat(items.every(i=>i.status!=='locked'),'Locked bible records cannot be merged.');
      next.items.push({...items[0],id:uid(),name:text(c.name || items[0].name,300),status:'draft',notes:`Merged records: ${ids.join(', ')}\n${items.map(i=>i.notes).join('\n')}`});items.forEach(i=>i.status='rejected');next.worldVersion++;break;
    }
    case 'split-item': {const item=find(next.items,c.id);requireThat(item.status!=='locked','Locked records cannot be split.');const names=strings(c.names);requireThat(names.length>=2,'Provide at least two names.');next.items.push(...names.map(name=>({...item,id:uid(),name,status:'draft' as Review})));item.status='rejected';next.worldVersion++;break;}
    case 'plan-shots': {
      const script=activeScript(next);requireThat(script,'Approve a script first.');
      for(const scene of script.scenes)if(!next.shots.some(s=>s.sceneId===scene.id))next.shots.push(newShot(scene,script.version));break;
    }
    case 'add-shot': {const script=activeScript(next);requireThat(script,'Approve a script first.');const scene=find(script.scenes,c.sceneId);next.shots.push({...newShot(scene,script.version,text(c.subject)),order:next.shots.length+1});break;}
    case 'revise-shot': {const shot=find(next.shots,c.id);next.shots.push({...shot,id:uid(),status:'draft',version:1,order:shot.order+0.1,subject:`${shot.subject} (alternative)`});break;}
    case 'edit-shot': {
      const shot=find(next.shots,c.id);requireThat(shot.status!=='locked' && shot.status!=='approved','Create an alternative to change approved or locked shot content.');
      for(const key of ['subject','framing','angle','lens','movement','lighting','performance','dialogue','wardrobe','props','sound','musicCueId','prompt','negative'] as const)if(c[key]!==undefined)shot[key]=text(c[key]);
      if(c.duration!==undefined)shot.duration=number(c.duration,0.1,600);if(c.characters!==undefined)shot.characters=strings(c.characters);
      if(c.continuity!==undefined){requireThat(c.continuity && typeof c.continuity==='object','Continuity must be an object.');shot.continuity=Object.fromEntries(Object.entries(c.continuity).map(([k,v])=>[text(k,100),text(v,1000)]));}shot.version++;break;
    }
    case 'map-shot': {const shot=find(next.shots,c.id);const script=activeScript(next);requireThat(script,'Approve a script first.');const scene=find(script.scenes,c.sceneId);shot.sceneId=scene.id;shot.source=scene.source;shot.scriptVersion=script.version;shot.needsReview=false;break;}
    case 'review-shot': {const shot=find(next.shots,c.id);requireThat(shot.status!=='locked','Locked shots stay preserved. Create an alternative.');shot.status=review(c.status);break;}
    case 'order-shots': {const ids=strings(c.ids);requireThat(ids.length===next.shots.length && new Set(ids).size===ids.length && ids.every(id=>next.shots.some(s=>s.id===id)),'Include every shot exactly once.');ids.forEach((id,i)=>{find(next.shots,id).order=i+1;});break;}
    case 'save-cue': {
      const old=c.id?find(next.cues,c.id):undefined; const scene=find(activeScript(next)?.scenes || [],c.sceneId || old?.sceneId);
      const cue: Cue={id:uid(),title:text(c.title||old?.title||'Untitled cue',200),sceneId:scene.id,kind:text(c.kind||old?.kind||'underscore',60),mood:text(c.mood||old?.mood,500),genre:text(c.genre||old?.genre,200),bpm:number(c.bpm??old?.bpm??80,1,400),key:text(c.key||old?.key,40),instrumentation:text(c.instrumentation||old?.instrumentation,2000),vocalDirection:text(c.vocalDirection||old?.vocalDirection,2000),sections:{},sourceIds:strings(c.sourceIds||old?.sourceIds||[]),ownership:text(c.ownership||old?.ownership,1000),splits:text(c.splits||old?.splits,1000),clearance:text(c.clearance||old?.clearance||'unknown',100),version:(old?.version||0)+1,status:'draft',start:number(c.start??old?.start??0),end:number(c.end??old?.end??8)};
      for(const name of ['intro','verse','pre-hook','hook','bridge','outro'])cue.sections[name]=text((c.sections as Record<string,unknown>)?.[name]??old?.sections[name],12000);
      requireThat(cue.end>cue.start,'Cue end must follow start.');next.cues.push(cue);break;
    }
    case 'mock-lyrics': {const cue=find(next.cues,c.id);const copy=structuredClone(cue);copy.id=uid();copy.version++;copy.status='draft';copy.sections.hook=`We carry the light through the weight of the night\nOne step together till the morning is bright`;copy.vocalDirection=`${copy.vocalDirection}\nMock writing example, not a live AI response. Edit for this scene.`;next.cues.push(copy);break;}
    case 'review-cue': {const cue=find(next.cues,c.id);requireThat(cue.status!=='locked','Locked cues cannot change. Save a new version.');cue.status=review(c.status);break;}
    case 'save-audio': {
      const old=c.id?find(next.audio,c.id):undefined;const scene=find(activeScript(next)?.scenes||[],c.sceneId||old?.sceneId);
      const row: Audio={id:uid(),character:text(c.character||old?.character,100),sceneId:scene.id,kind:text(c.kind||old?.kind||'dialogue',60),text:text(c.text??old?.text),direction:text(c.direction??old?.direction),pronunciation:text(c.pronunciation??old?.pronunciation),voiceProfile:text(c.voiceProfile??old?.voiceProfile),consent:text(c.consent||old?.consent||'unknown',100),sourceId:text(c.sourceId||old?.sourceId,100),source:old?.source||scene.source,takes:strings(c.takes||old?.takes||[]),status:'draft',version:(old?.version||0)+1};next.audio.push(row);break;
    }
    case 'review-job': {
      const job=find(next.jobs,c.id);const target=text(c.status);const allowed:Record<string,string[]>={completed:['needs_review'],needs_review:['approved','rejected','revision_requested'],approved:['locked'],rejected:['revision_requested'],revision_requested:['rejected'],locked:[]};
      requireThat(allowed[job.status]?.includes(target),'Invalid take review transition. Approved media is preserved.');job.status=target;job.revision=text(c.notes);job.updatedAt=new Date().toISOString();break;
    }
    case 'new-cut': {next.cuts.push({id:uid(),version:1,name:text(c.name||'Assembly',200),clips:[],notes:'',status:'draft'});break;}
    case 'revise-cut': {const old=find(next.cuts,c.id);next.cuts.push({...structuredClone(old),id:uid(),version:old.version+1,status:'draft'});break;}
    case 'place-clip': {
      const cut=find(next.cuts,c.cutId);requireThat(cut.status==='draft','Create a new cut version before editing an approved cut.');
      const lane=text(c.lane||'video',60);requireThat(['video','dialogue','music','effects','ambience','captions','titles','credits'].includes(lane),'Invalid timeline lane.');
      let sceneId=text(c.sceneId,100);let duration=86400;
      if(lane==='video'){const job=find(next.jobs,c.jobId);requireThat(['approved','locked'].includes(job.status) && job.outputAsset,'Select an approved take with an output asset.');duration=job.duration;sceneId=job.sceneId;}
      else if(!['captions','titles','credits'].includes(lane))requireThat(c.sourceId,'Choose an uploaded audio asset.');
      const clip:Clip={id:uid(),lane,jobId:text(c.jobId,100),sourceId:text(c.sourceId,100),sceneId,start:number(c.start??0),in:number(c.in??0),out:number(c.out??duration,0.01,duration),level:number(c.level??0,-60,12),caption:text(c.caption,4000),transition:text(c.transition||'cut',100)};
      requireThat(clip.out>clip.in,'Trim out must follow trim in.');cut.clips.push(clip);validateCut(cut);break;
    }
    case 'edit-clip': {const cut=find(next.cuts,c.cutId);requireThat(cut.status==='draft','Create a new cut version first.');const clip=find(cut.clips,c.id);for(const key of ['start','in','out','level'] as const)if(c[key]!==undefined)clip[key]=number(c[key],key==='level'?-60:0,key==='level'?12:86400);if(c.caption!==undefined)clip.caption=text(c.caption,4000);if(clip.jobId)requireThat(clip.out<=find(next.jobs,clip.jobId).duration,'Trim exceeds source duration.');validateCut(cut);break;}
    case 'remove-clip': {const cut=find(next.cuts,c.cutId);requireThat(cut.status==='draft','Create a new cut version first.');cut.clips=cut.clips.filter(x=>x.id!==c.id);break;}
    case 'review-cut': {const cut=find(next.cuts,c.id);requireThat(cut.status==='draft','Approved cuts are immutable.');validateCut(cut);requireThat(cut.clips.length,'An empty cut cannot be approved.');cut.status='approved';cut.notes=text(c.notes);break;}
    default: throw new Error('Unknown film engine command.');
  }
  return next;
}
export function validateCut(cut: Cut) {
  for(const clip of cut.clips)requireThat(clip.out>clip.in,'Trim out must follow trim in.');
  const video=cut.clips.filter(c=>c.lane==='video').sort((a,b)=>a.start-b.start);
  for(let i=1;i<video.length;i++)requireThat(video[i].start>=video[i-1].start+video[i-1].out-video[i-1].in,'Video clips overlap. Move or trim the clip.');
}
export function cutDuration(cut: Cut) {return Math.max(0,...cut.clips.map(c=>c.start+c.out-c.in));}
export function delivery(state: State, cutId: string, sources: unknown[], locks: unknown[]) {
  const cut=find(state.cuts,cutId);requireThat(cut.status==='approved','Approve the cut before creating a delivery package.');validateCut(cut);
  const time=(seconds:number)=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;};
  return {schema:'fpai.delivery.v1',projectId:state.projectId,revision:state.revision,title:state.title,status:'manifest_ready',masterEncoded:false,mock:state.jobs.some(j=>cut.clips.some(c=>c.jobId===j.id)&&j.provider==='mock'),shotList:orderedShots(state),productionBible:state.items,characterBible:locks,storyGraph:storyGraph(state),continuity:continuityReport(state),cueSheet:state.cues,lyrics:state.cues.map(c=>({title:c.title,version:c.version,sections:c.sections})),dialogue:state.audio,assetProvenance:sources,rightsReport:{music:state.cues.map(c=>({id:c.id,ownership:c.ownership,splits:c.splits,clearance:c.clearance})),voices:state.audio.map(a=>({id:a.id,consent:a.consent})),note:'Review unresolved permissions before public distribution.'},costReport:{estimated:state.jobs.reduce((n,j)=>n+j.estimatedCost,0),actual:state.jobs.reduce((n,j)=>n+j.actualCost,0),currency:'USD'},generationHistory:state.jobs,editDecisionList:cut,renderManifest:{schema:'fpai.runner-assembly.v1',projectId:state.projectId,cutId:cut.id,cutVersion:cut.version,duration:cutDuration(cut),lanes:cut.clips,assetResolution:'Authenticated source and take routes; no secrets embedded.',target:{container:'mp4',videoCodec:'h264',audioCodec:'aac'},status:'awaiting_runner'},audioStemManifest:cut.clips.filter(c=>['dialogue','music','effects','ambience'].includes(c.lane)),captions:'WEBVTT\n\n'+cut.clips.filter(c=>c.lane==='captions').sort((a,b)=>a.start-b.start).map((c,i)=>`${i+1}\n${time(c.start)} --> ${time(c.start+c.out-c.in)}\n${c.caption.replace(/-->/g,'→')}\n`).join('\n')};
}
