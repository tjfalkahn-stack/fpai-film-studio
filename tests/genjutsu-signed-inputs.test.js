import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { createHiggsfieldProvider } from '../worker/providers/higgsfield.js';
import { serveHiggsfieldInput } from '../worker/providers/higgsfieldInput.js';
const id='d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
test('motion uses distinct signed stored images without provider upload initialization',async()=>{
 const refs=[{mimeType:'image/png',data:'AQID'},{mimeType:'image/jpeg',data:'BAUG'}];
 const input={renderId:id,duration:8,resolution:'720p',prompt:'PV left, TSU right spin',referenceVideos:[{url:'https://media.example/source.mp4'}],referenceImages:refs};
 const env={HF_CREDENTIALS:'mock-only',FPAI_CONTROL_TOKEN:'mock-signing',GENERATION_MEDIA:{get:async()=>({json:async()=>input})}};
 const calls=[];
 await createHiggsfieldProvider(env,async(url,init)=>{calls.push({url,init});return Response.json({request_id:id});},'higgsfield-genjutsu-motion').start(input);
 assert.equal(calls.length,1);assert.match(calls[0].url,/motion-transfer/);
 const payload=JSON.parse(calls[0].init.body);assert.equal(payload.image_urls.length,2);assert.notEqual(...payload.image_urls);
 for(let i=0;i<2;i++){
  const r=await serveHiggsfieldInput(new Request(payload.image_urls[i]),env);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),refs[i].mimeType);assert.equal(r.headers.get('content-length'),'3');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],i?[4,5,6]:[1,2,3]);
  const head=await serveHiggsfieldInput(new Request(payload.image_urls[i],{method:'HEAD'}),env);
  assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),refs[i].mimeType);assert.equal((await head.arrayBuffer()).byteLength,0);
  const proxied=await worker.fetch(new Request(payload.image_urls[i],{method:'HEAD'}),env);
  assert.equal(proxied.status,200);assert.equal(proxied.headers.get('content-type'),refs[i].mimeType);
  const swap=new URL(payload.image_urls[i]);swap.searchParams.set('frame',`ref-${1-i}`);assert.equal((await serveHiggsfieldInput(new Request(swap),env)).status,404);
  const invalid=new URL(payload.image_urls[i]);invalid.searchParams.set('frame','ref-8');assert.equal((await serveHiggsfieldInput(new Request(invalid),env)).status,404);
  const expired=new URL(payload.image_urls[i]);expired.searchParams.set('expires','1000000000');assert.equal((await serveHiggsfieldInput(new Request(expired),env)).status,404);
 }
 const unauthorizedHead=await worker.fetch(new Request(`https://fpai-film-studio-video-adapter.tjfalkahn.workers.dev/api/renders/${id}/input`,{method:'HEAD'}),env);
 assert.equal(unauthorizedHead.status,404);
});
