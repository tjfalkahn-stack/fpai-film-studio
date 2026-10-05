import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {makeMp4,makePng} from './imageFixtures.js';
const id='5acfa827-35d8-4168-8564-af5bc37fdc6b';
const input={projectId:'enemies-closer-ep01',sceneId:'CREATE',shotId:'DIRECT_PREVIEW',provider:'higgsfield-genjutsu-motion',prompt:'two mascots',continuity:{ready:true},duration:8,resolution:'720p',aspectRatio:'16:9',referenceImages:[{mimeType:'image/png',data:makePng(32,32).toString('base64')}],referenceVideos:[{assetId:id}]};
function request(extra){return new Request('https://studio.example/api/renders',{method:'POST',headers:{authorization:'Bearer control','content-type':'application/json'},body:JSON.stringify({...input,...extra})});}
test('eight-second stored MP4 rejects Length five in quotes and submissions; matching quote reserves the full price',async(t)=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No provider calls allowed');});
 const env={FPAI_CONTROL_TOKEN:'control',HF_CREDENTIALS:'mock',RENDER_PROJECT_ID:input.projectId,GENERATION_MEDIA:{get:async()=>({arrayBuffer:async()=>makeMp4(8)})}};
 for(const estimateOnly of [true,false]){
  const r=await worker.fetch(request({duration:5,estimateOnly,acceptedCost:3.405,requestKey:'stable-request'}),env);
  assert.equal(r.status,409);assert.match(JSON.stringify(await r.json()),/VIDEO_DURATION_MISMATCH/);
 }
 const good=await worker.fetch(request({estimateOnly:true}),env);assert.equal(good.status,200);assert.equal((await good.json()).estimatedCost,5.448);
 const stale=await worker.fetch(request({acceptedCost:3.405,requestKey:'stable-request'}),env);assert.equal(stale.status,409);assert.match(JSON.stringify(await stale.json()),/QUOTE_CHANGED/);
 const single=await worker.fetch(request({acceptedCost:5.448,requestKey:'stable-request'}),env);assert.equal(single.status,409);assert.match(JSON.stringify(await single.json()),/COST_CEILING/);
});

import {durationAfterModelSwitch} from '../src/referenceVideoClient.js';
import {singleRenderCeiling, reservationSessionFor} from '../worker/renders.js';
test('switching away and back restores eight-second uploaded motion duration',()=>{
 const refs={referenceVideo:{duration:8}};
 assert.equal(durationAfterModelSwitch({id:'higgsfield-kling-3-pro',durations:[5]},refs),5);
 assert.equal(durationAfterModelSwitch({id:'higgsfield-genjutsu-motion',durations:[5,8]},refs),8);
});
test('six-dollar single-job approval is bound to the exact Yard 720p asset',()=>{
 const approved={...input,projectId:'the-yard-homecoming'};
 assert.equal(singleRenderCeiling(approved,4),6);
 for(const delta of [{shotId:'TSU'},{shotId:'LAMAR'},{duration:5},{resolution:'480p'},{provider:'higgsfield-kling-3-pro'},{projectId:'another'},{referenceVideos:[{assetId:'another'}]}])assert.equal(singleRenderCeiling({...approved,...delta},4),4);
});

test('legacy Yard shot sessions are restricted to their intended scene and providers',()=>{
 const policy={sessionId:'existing-session'};
 const motion={...input,projectId:'the-yard-homecoming'};
 for(const shotId of ['TSU','LAMAR','DIRECT_valid']) {
  assert.equal(reservationSessionFor({...motion,shotId},policy),'existing-session');
  assert.equal(reservationSessionFor({...motion,sceneId:'YARD',shotId},policy),'existing-session');
 }
 assert.equal(reservationSessionFor({...motion,sceneId:'YARD',shotId:'TSU',provider:'ltx-2.5-pro'},policy),'yard-tsu-pro-first-test');
 assert.equal(reservationSessionFor({...motion,sceneId:'YARD',shotId:'LAMAR',provider:'veo-fast'},policy),'yard-lamar-pro-first-test');
 assert.equal(reservationSessionFor({...motion,shotId:'TSU',provider:'ltx-2.5-pro'},policy),'existing-session');
});
