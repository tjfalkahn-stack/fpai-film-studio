import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, parseScript, reduce, activeScript, storyGraph, breakdown, orderedShots, continuityReport, validateCut, delivery } from '../src/film/engine.ts';
import { extractDocument, extractPdf } from '../src/film/documents.js';
import { zipSync, strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Test-only adaptation of seeded shot subjects, not the owner's complete screenplay.
export const SCRIPT=`ENEMIES CLOSER — MOCK ACCEPTANCE FIXTURE

ACT ONE
SEQUENCE ONE
EXT. AIRFIELD - NIGHT

JASMINE (28) is crying, holding MIKEY (5). TURNER (40) is wounded beside a truck.
MARCUS (38) enters wearing black gloves and boots. He carries a pistol. Fire and smoke surround a jet.

JASMINE
(crying)
Stay with me.

MIKEY
Daddy!

MARCUS
Keep your eyes on me.

TURNER
We have to move.

CUT TO:

INT. TRUCK - NIGHT

Marcus watches the mirror. Music plays on the radio.

MARCUS
We are going home.
`;
export function approved(){let s=emptyState('enemies-closer-ep01');s=reduce(s,{type:'parse-script',text:SCRIPT,sourceId:'fixture-script'});s=reduce(s,{type:'approve-script',id:s.scripts[0].id});return s;}

test('script parser preserves source spans, dialogue, emotions, scenes and explicit acts',()=>{
  const s=parseScript(SCRIPT,'source');assert.equal(s.scenes.length,2);assert.equal(s.scenes[0].act,'ACT ONE');assert.equal(s.scenes[0].sequence,'SEQUENCE ONE');
  assert.deepEqual([...s.scenes[0].characters].sort(),['JASMINE','MARCUS','MIKEY','TURNER']);assert.equal(s.scenes[0].dialogue[0].parenthetical,'crying');
  for(const d of s.scenes[0].dialogue)assert.match(SCRIPT.split('\n').slice(d.source.lineStart-1,d.source.lineEnd).join(' '),new RegExp(d.text.replace(/[.!?]/g,'')));
  assert.equal(s.scenes[0].location,'AIRFIELD');assert.equal(s.scenes[1].setting,'INT');assert.equal(s.scenes[0].transitions[0],'CUT TO:');
});
test('script revision diff marks affected shots without changing locked content or original snapshot',()=>{
  let s=approved();s=reduce(s,{type:'plan-shots'});const shot=s.shots[0];s=reduce(s,{type:'review-shot',id:shot.id,status:'locked'});const original=structuredClone(s.shots[0]);
  s=reduce(s,{type:'parse-script',text:SCRIPT.replace('Stay with me.','Please stay with me.'),sourceId:'revision'});assert.equal(s.scripts[1].scenes[0].id,s.scripts[0].scenes[0].id);assert.deepEqual(s.scripts[1].diff.changed,[shot.sceneId]);
  s=reduce(s,{type:'approve-script',id:s.scripts[1].id});assert.equal(s.shots[0].needsReview,true);assert.equal(s.shots[0].status,'locked');assert.equal(s.shots[0].prompt,original.prompt);assert.equal(s.scripts[0].text,SCRIPT);
  assert.throws(()=>reduce(s,{type:'edit-shot',id:shot.id,prompt:'overwrite'}),/alternative/);assert.throws(()=>reduce(s,{type:'edit-script',id:s.scripts[0].id,title:'overwrite'}),/immutable/);
});
test('breakdown is traceable and graph links actual scene IDs',()=>{
  const state=approved(),items=breakdown(activeScript(state));for(const kind of ['character','location','set','prop','vehicle','wardrobe','injury','sound','music','safety_action'])assert.ok(items.some(i=>i.kind===kind),kind);
  const pistol=items.find(i=>i.name==='pistol');assert.match(SCRIPT.split('\n')[pistol.source.lineStart-1],/pistol/);const graph=storyGraph(state);assert.ok(graph.edges.every(e=>graph.nodes.some(n=>n.id===e.from)&&graph.nodes.some(n=>n.id===e.to)));
});
test('chronological display numbering preserves sparse storage IDs and seed data',()=>{
  const production={project:{title:'Enemies Closer'},shots:[{id:'027',scene:'001',subject:'Marcus reveal',characters:['marcus'],duration:4.5,status:'Locked'},{id:'002',scene:'001',subject:'Mikey wet eye',characters:['mikey'],duration:2,status:'Locked'}]};
  const state=reduce(emptyState('enemies-closer-ep01'),{type:'import-production',production});const moved=reduce(state,{type:'order-shots',ids:['002','027']});
  assert.deepEqual(orderedShots(moved).map(s=>[s.id,s.displayNumber]),[['002','001'],['027','002']]);assert.deepEqual(moved.importedProduction,production);assert.throws(()=>reduce(moved,{type:'import-production',production}),/already linked/);
});
test('continuity conflicts identify both affected scenes and shots, and accept explicit reasons',()=>{
  let state=reduce(approved(),{type:'plan-shots'});state.shots.forEach(s=>s.characters=['marcus']);state.shots[0].continuity={wardrobe:'black',injury:'wounded',height:'6ft2'};state.shots[1].continuity={wardrobe:'blue',injury:'none',height:'5ft8'};
  const warnings=continuityReport(state).warnings;assert.equal(warnings.length,3);assert.deepEqual(warnings[0].shotIds,state.shots.map(s=>s.id));state.shots[1].continuity={wardrobe:'blue',wardrobeChangeReason:'Changed in truck'};assert.equal(continuityReport(state).warnings.length,0);
});
test('music and voice versions keep prior lyrics, permissions and source links',()=>{
  let s=approved(),sceneId=activeScript(s).scenes[0].id;s=reduce(s,{type:'save-cue',sceneId,title:'Hold On',sections:{hook:'An original line'},ownership:'FPAI',clearance:'owned',sourceIds:['beat-1']});const original=structuredClone(s.cues[0]);
  s=reduce(s,{type:'mock-lyrics',id:original.id});assert.deepEqual(s.cues[0],original);assert.equal(s.cues[1].version,2);assert.match(s.cues[1].vocalDirection,/Mock/);
  const line=s.audio[0];s=reduce(s,{type:'save-audio',id:line.id,consent:'permission-recorded',voiceProfile:'Performer permission record 01',direction:'Quiet urgency'});assert.equal(s.audio[0].consent,'unknown');assert.equal(s.audio.at(-1).consent,'permission-recorded');assert.equal(s.audio.at(-1).source.sourceId,'fixture-script');
});
test('editorial rejects unapproved media, overlap, out-of-range trims and protected take changes',()=>{
  let s=approved();s.jobs=[{id:'job',status:'needs_review',outputAsset:'/asset',duration:8,sceneId:activeScript(s).scenes[0].id,provider:'mock',actualCost:0,estimatedCost:0}];s=reduce(s,{type:'new-cut'});const cutId=s.cuts[0].id;
  assert.throws(()=>reduce(s,{type:'place-clip',cutId,jobId:'job',out:4}),/approved/);s=reduce(s,{type:'review-job',id:'job',status:'approved'});s=reduce(s,{type:'place-clip',cutId,jobId:'job',out:4});
  assert.throws(()=>reduce(s,{type:'place-clip',cutId,jobId:'job',start:2,out:4}),/overlap/);assert.throws(()=>reduce(s,{type:'edit-clip',cutId,id:s.cuts[0].clips[0].id,out:9}),/source duration/);assert.throws(()=>reduce(s,{type:'review-job',id:'job',status:'rejected'}),/transition/);
  s=reduce(s,{type:'place-clip',cutId,lane:'captions',start:0,in:0,out:4,caption:'Stay with me.'});s=reduce(s,{type:'review-cut',id:cutId});const pack=delivery(s,cutId,[],[]);assert.equal(pack.masterEncoded,false);assert.equal(pack.mock,true);assert.match(pack.captions,/00:00:00.000 --> 00:00:04.000/);assert.equal(pack.renderManifest.duration,4);assert.throws(()=>reduce(s,{type:'remove-clip',cutId,id:s.cuts[0].clips[0].id}),/new cut/);
});
test('FDX and DOCX extraction preserve dialogue and reject external XML entities or oversized ZIP members',()=>{
  const fdx='<FinalDraft><Content><Paragraph Type="Scene Heading"><Text>INT. ROOM - NIGHT</Text></Paragraph><Paragraph Type="Character"><Text>JASMINE</Text></Paragraph><Paragraph Type="Dialogue"><Text>Stay with me.</Text></Paragraph></Content></FinalDraft>';
  const extracted=extractDocument(strToU8(fdx),'scene.fdx');assert.equal(parseScript(extracted.text,'fdx').scenes[0].dialogue[0].text,'Stay with me.');
  const docx=zipSync({'word/document.xml':strToU8('<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>INT. ROOM - NIGHT</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>JASMINE</w:t></w:r></w:p><w:p><w:r><w:t>Stay with me.</w:t></w:r></w:p></w:body></w:document>')});assert.match(extractDocument(docx,'scene.docx').text,/JASMINE\nStay with me/);
  assert.throws(()=>extractDocument(strToU8('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///x">]><FinalDraft/>'),'bad.fdx'),/entity/);
  assert.throws(()=>extractDocument(zipSync({'word/document.xml':new Uint8Array(5*1024*1024)}),'bomb.docx'),/bounded/);
});
function pdfFixture(){
  const lines=['ENEMIES CLOSER','INT. ROOM - NIGHT','','JASMINE','Stay with me.'];const stream='BT /F1 12 Tf 60 760 Td '+lines.map((l,i)=>`${i?'0 -24 Td ':''}(${l}) Tj`).join('\n')+' ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return strToU8(pdf);
}
test('actual PDF text layer extraction produces editable, scene-aware text',async()=>{
  const library=await import('pdfjs-dist/legacy/build/pdf.mjs');const result=await extractPdf(pdfFixture(),library);assert.match(result.text,/INT. ROOM - NIGHT/);assert.match(result.text,/Stay with me/);assert.equal(result.method,'pdf-text-layer');
});
test('original seed and shot block remain byte-for-byte unchanged from the inspected baseline',()=>{
  const source=readFileSync('src/main.jsx','utf8');const block=source.slice(source.indexOf('const seedShots ='),source.indexOf('function openMediaDB'));
  assert.equal(createHash('sha256').update(block).digest('hex'),readFileSync('tests/fixtures/film-seed.sha256','utf8').trim());
});
