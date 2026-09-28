import { test } from "node:test";
import assert from "node:assert/strict";
import { createHiggsfieldProvider } from "../worker/providers/higgsfield.js";
import { providerFor } from "../worker/providers/index.js";
import { config, providerLiveEnabled } from "../worker/renders.js";
import { renderReferenceKeys } from "../src/shotStartFrame.js";
const env = { HF_CREDENTIALS: "test-id:test-secret", HIGGSFIELD_KLING3_PRO_SILENT_RATE_PER_SECOND_USD: "0.0616", HIGGSFIELD_KLING3_PRO_AUDIO_RATE_PER_SECOND_USD: "0.0924", HIGGSFIELD_SEEDANCE25_720P_SILENT_RATE_PER_SECOND_USD: "0.4622", HIGGSFIELD_GENJUTSU_720P_RATE_PER_SECOND_USD: "0.681" };
const input = { duration: 5, resolution: "1080p", aspectRatio: "16:9", prompt: "Cinema shot", generateAudio: false, referenceImages: [{ mimeType: "image/png", data: "iVBORw0KGgo=" }] };
const requestId = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";
const statusUrl = `https://api.higgsfield.ai/requests/${requestId}/status`;
function mock(submission, calls = []) { return async (url, init) => {
  calls.push({url, ...init});
  if (url.endsWith("generate-upload-url")) return Response.json({ upload_url: "https://storage.example.com/upload", public_url: "https://cdn.example.com/input.png", upload_headers: { "x-amz-tagging": "retention=temporary" } });
  if (url.includes("storage.example.com")) return new Response(null, {status: 200});
  return submission(url, init);
}; }
test("Higgsfield registers model-specific routes and separates audio pricing", () => {
  const p = providerFor("higgsfield-kling-3-pro", env);
  assert.equal(p.estimate(input).estimatedCost, 0.308);
  assert.equal(p.estimate({...input, generateAudio:true}).estimatedCost, 0.462);
  assert.equal(createHiggsfieldProvider({}).estimate(input).priceBasis,"published-pre-discount-estimate");
  assert.throws(() => p.estimate({...input, referenceImages:[]}), /one composed/);
  assert.equal(providerLiveEnabled(p.capabilities.id, env), true);
  assert.equal(providerLiveEnabled(p.capabilities.id, {...env, HF_CREDENTIALS:""}), false);
  assert.equal(providerLiveEnabled(p.capabilities.id, {...env, HF_CREDENTIALS:" test-id:test-secret\n"}), true);
  assert.deepEqual(renderReferenceKeys({provider:p.capabilities.id, startFrameKey:"shot", selected:["portrait"]}), ["shot"]);
});
test("readiness accepts a complete opaque API key and rejects whitespace", () => {
  assert.equal(config({}).higgsfieldCredentialPresent, false);
  assert.equal(config({ HF_CREDENTIALS: "one-key-only" }).higgsfieldCredentialPresent, true);
  assert.equal(config({ HF_CREDENTIALS: "one-key-only" }).higgsfieldConfigured, true);
  assert.equal(config({ HF_CREDENTIALS: "Key one-key-only" }).higgsfieldConfigured, false);
  assert.equal(config({ HF_CREDENTIALS: "test-id:test-secret" }).higgsfieldConfigured, true);
});
test("Higgsfield uploads bytes without credential forwarding and submits documented body", async () => {
  const calls=[];
  const p=createHiggsfieldProvider(env,mock(async()=>Response.json({request_id:requestId,status_url:statusUrl}),calls));
  assert.equal((await p.start(input)).operationId,statusUrl);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(calls[1].headers["x-amz-tagging"],"retention=temporary");
  assert.equal(calls[2].headers.Authorization,"Key test-id:test-secret");
  assert.deepEqual(JSON.parse(calls[2].body),{image_url:"https://cdn.example.com/input.png",prompt:"Cinema shot",duration:5,sound:"off",cfg_scale:0.5,multi_shots:false});
  const pastedCalls=[];
  await createHiggsfieldProvider({...env,HF_CREDENTIALS:" one-key-only\n"},mock(async()=>Response.json({request_id:requestId,status_url:statusUrl}),pastedCalls)).start(input);
  assert.equal(pastedCalls[2].headers.Authorization,"Key one-key-only");
});
test("ambiguous submissions retain spending reservations; rejection does not leak response", async () => {
  for(const run of [async()=>{throw Error("lost")},async()=>new Response("bad",{status:502}),async()=>Response.json({})]) {
    await assert.rejects(createHiggsfieldProvider(env,mock(run)).start(input),e=>e.uncertain===true);
  }
  await assert.rejects(createHiggsfieldProvider(env,mock(async()=>new Response("secret",{status:401}))).start(input), e=>!e.uncertain&&!e.message.includes("secret"));
});
test("image upload transport failure does not mark an unsubmitted video as billable", async () => {
  let submissions = 0;
  const provider = createHiggsfieldProvider(env, async (url) => {
    if (url.endsWith("generate-upload-url")) throw new Error("transport unavailable");
    submissions++;
    return Response.json({ request_id: requestId, status_url: statusUrl });
  });
  await assert.rejects(provider.start(input), (error) => {
    assert.equal(error.code, "HIGGSFIELD_IMAGE_PREPARATION");
    assert.equal(error.uncertain, false);
    assert.match(error.message, /No video request was submitted/);
    return true;
  });
  assert.equal(submissions, 0);
});
test("polling and private asset retrieval work without an extra live switch",async()=>{
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
  assert.equal(providerLiveEnabled(p.capabilities.id,{...env,HIGGSFIELD_LIVE_ENABLED:"false"}),true);
});
test("terminal failures keep conservative cost until billing is reconciled",async()=>{
  for(const status of ["failed","nsfw","canceled"]){
    const p=createHiggsfieldProvider(env,async()=>Response.json({status}));
    const result=await p.status({operation_id:statusUrl,estimated_cost:0.308});
    assert.equal(result.status,"failed"); assert.equal(result.actualCost,0.308);
  }
});
test("render API quotes without network and hides credentials",async(t)=>{
  const {default:worker}=await import("../worker/index.js");
  t.mock.method(globalThis,"fetch",()=>{throw Error("No paid calls in tests");});
  const config={...env,FPAI_CONTROL_TOKEN:"control",RENDER_PROJECT_ID:"enemies-closer-ep01"};
  const body={...input,projectId:"enemies-closer-ep01",sceneId:"001",shotId:"001",provider:"higgsfield-kling-3-pro"};
  const request=(extra)=>new Request("https://studio.example/api/renders",{method:"POST",headers:{authorization:"Bearer control","content-type":"application/json"},body:JSON.stringify({...body,...extra})});
  const response=await worker.fetch(request({estimateOnly:true}),config);
  assert.equal(response.status,200);
  const quote=await response.json();
  assert.equal(quote.estimatedCost,0.308);
  assert.equal(JSON.stringify(quote).includes("test-secret"),false);
  assert.equal(quote.policy.higgsfieldLiveEnabled,true);
});
test("text, image, and motion models use their documented input shapes",async()=>{
  const calls=[];
  const transport=mock(async()=>Response.json({request_id:requestId,status_url:statusUrl}),calls);
  const text=createHiggsfieldProvider(env,transport,"higgsfield-kling-3-pro-text");
  await text.start({...input,referenceImages:[]});
  assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(calls[0].body),{aspect_ratio:"16:9",prompt:"Cinema shot",duration:5,sound:"off",cfg_scale:0.5,multi_shots:false});
  calls.length=0;
  const seedance=createHiggsfieldProvider(env,transport,"higgsfield-seedance-2.5-image");
  assert.equal(seedance.estimate({...input,resolution:"720p"}).estimatedCost,2.311);
  await seedance.start({...input,resolution:"720p"});
  assert.deepEqual(JSON.parse(calls[2].body),{prompt:"Cinema shot",duration:5,resolution:"720p",image_url:"https://cdn.example.com/input.png",output_format:"mp4",generate_audio:false});
  calls.length=0;
  const motion=createHiggsfieldProvider(env,transport,"higgsfield-genjutsu-motion");
  await motion.start({...input,resolution:"720p",referenceVideos:[{url:"https://cdn.example.com/source.mp4"}]});
  assert.deepEqual(JSON.parse(calls[2].body),{prompt:"Cinema shot",video_url:"https://cdn.example.com/source.mp4",image_urls:["https://cdn.example.com/input.png"],resolution:"720p"});
  assert.throws(()=>motion.estimate({...input,resolution:"720p",referenceVideos:[{url:"http://localhost/source.mp4"}]}),/Unsafe/);
});
