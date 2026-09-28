import { test } from "node:test";
import assert from "node:assert/strict";
import { createHiggsfieldProvider } from "../worker/providers/higgsfield.js";
import { providerFor } from "../worker/providers/index.js";
import { providerLiveEnabled } from "../worker/renders.js";
import { renderReferenceKeys } from "../src/shotStartFrame.js";
const env = { HF_CREDENTIALS: "test-id:test-secret", HIGGSFIELD_LIVE_ENABLED: "true", HIGGSFIELD_KLING3_PRO_SILENT_RATE_PER_SECOND_USD: "0.0616", HIGGSFIELD_KLING3_PRO_AUDIO_RATE_PER_SECOND_USD: "0.0924" };
const input = { duration: 5, resolution: "1080p", aspectRatio: "16:9", prompt: "Cinema shot", generateAudio: false, referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }] };
const requestId = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
const statusUrl = `https://api.higgsfield.ai/requests/${requestId}/status`;
function mock(submission, calls = []) { return async (url, init) => {
  calls.push({url, ...init});
  if (url.endsWith("generate-upload-url")) return Response.json({ upload_url: "https://storage.example.com/upload", public_url: "https://cdn.example.com/input.png", upload_headers: { "x-amz-tagging": "retention=temporary" } });
  if (url.includes("storage.example.com")) return new Response(null, {status: 200});
  return submission(url, init);
}; }
test("Higgsfield registered with independent gate, prices separated by audio", () => {
  const p = providerFor("higgsfield-kling-3-pro", env);
  assert.equal(p.estimate(input).estimatedCost, 0.308);
  assert.equal(p.estimate({...input, generateAudio:true}).estimatedCost, 0.462);
  assert.throws(() => createHiggsfieldProvider({}).estimate(input), /must match/);
  assert.throws(() => p.estimate({...input, referenceImages:[]}), /one composed/);
  assert.equal(providerLiveEnabled(p.capabilities.id, env), true);
  assert.equal(providerLiveEnabled(p.capabilities.id, {...env, HF_CREDENTIALS:""}), false);
  assert.deepEqual(renderReferenceKeys({provider:p.capabilities.id, startFrameKey:"shot", selected:["portrait"]}), ["shot"]);
});
test("Higgsfield uploads bytes without credential forwarding and submits documented body", async () => {
  const calls=[];
  const p=createHiggsfieldProvider(env,mock(async()=>Response.json({request_id:requestId,status_url:statusUrl}),calls));
  assert.equal((await p.start(input)).operationId,statusUrl);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].headers["x-amz-tagging"],"retention=temporary");
  assert.equal(calls[2].headers.Authorization,"Key test-id:test-secret");
  assert.deepEqual(JSON.parse(calls[2].body),{image_url:"https://cdn.example.com/input.png",prompt:"Cinema shot",duration:5,sound:"off",cfg_scale:0.5,multi_shots:false});
});
test("ambiguous submissions retain spending reservations; rejection does not leak response", async () => {
  for(const run of [async()=>{throw Error("lost")},async()=>new Response("bad",{status:502}),async()=>Response.json({})]) {
    await assert.rejects(createHiggsfieldProvider(env,mock(run)).start(input),e=>e.uncertain===true);
  }
  await assert.rejects(createHiggsfieldProvider(env,mock(async()=>new Response("secret",{status:401}))).start(input), e=>!e.uncertain&&!e.message.includes("secret"));
});
test("polling and private asset retrieval work after submissions disabled",async()=>{
  const calls=[];
  const p=createHiggsfieldProvider({...env,HIGGSFIELD_LIVE_ENABLED:"false"},async(url,init)=>{
    calls.push({url,...init});
    return url===statusUrl?Response.json({status:"completed",video:{url:"https://cdn.example.com/video.mp4"}}):new Response("video");
  });
  const result=await p.status({operation_id:statusUrl,estimated_cost:0.308});
  assert.equal(result.status,"completed");
  await p.asset({asset_json:JSON.stringify(result.asset)});
  assert.equal(calls[1].headers,undefined);
  await assert.rejects(p.status({operation_id:"https://evil.example/requests/x/status"}),/Unsafe/);
  await assert.rejects(p.start(input),/disabled/);
});
test("terminal failures keep conservative cost until billing is reconciled",async()=>{
  for(const status of ["failed","nsfw","canceled"]){
    const p=createHiggsfieldProvider(env,async()=>Response.json({status}));
    const result=await p.status({operation_id:statusUrl,estimated_cost:0.308});
    assert.equal(result.status,"failed"); assert.equal(result.actualCost,0.308);
  }
});
test("render API quotes without network, hides credentials and rejects disabled submissions",async(t)=>{
  const {default:worker}=await import("../worker/index.js");
  t.mock.method(globalThis,"fetch",()=>{throw Error("No paid calls in tests");});
  const config={...env,HIGGSFIELD_LIVE_ENABLED:"false",FPAI_CONTROL_TOKEN:"control",RENDER_PROJECT_ID:"enemies-closer-ep01"};
  const body={...input,projectId:"enemies-closer-ep01",sceneId:"001",shotId:"001",provider:"higgsfield-kling-3-pro"};
  const request=(extra)=>new Request("https://studio.example/api/renders",{method:"POST",headers:{authorization:"Bearer control","content-type":"application/json"},body:JSON.stringify({...body,...extra})});
  const response=await worker.fetch(request({estimateOnly:true}),config);
  assert.equal(response.status,200);
  const quote=await response.json();
  assert.equal(quote.estimatedCost,0.308);
  assert.equal(JSON.stringify(quote).includes("test-secret"),false);
  assert.equal((await worker.fetch(request({acceptedCost:0.308,requestKey:"higgsfield-disabled-01"}),config)).status,403);
});
