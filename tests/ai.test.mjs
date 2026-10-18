// Isolated tests: provider fetch is always mocked. Never use real API keys or real data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAi } from '../src/ai.mjs';
import { createStudioServer } from '../src/server.mjs';

const BASE = process.env.STUDIO_TEST_TMP || os.tmpdir();
const QUIET = { info() {}, error() {} };
const OWNER = { name:'AI 테스트',email:'ai-owner@example.test',password:'a-very-long-test-only-password-1234' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=','base64');
const DUMMY_G = 'test-only-gemini-not-a-real-key';
const DUMMY_O = 'test-only-openai-not-a-real-key';
const SETUP = 'test-only-setup-token-at-least-24-chars';
const SECRET = 'test-only-encryption-secret-at-least-32-chars';
const reply = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
function dir(t) {
  fs.mkdirSync(BASE,{recursive:true});
  const d=fs.mkdtempSync(path.join(BASE,'studio-ai-test-'));
  t.after(() => fs.rmSync(d,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
  return d;
}
function mockProvider(log=[]) {
  return async (url,init={}) => {
    log.push({url,init});
    if(url.endsWith('/images/generations') || url.endsWith('/images/edits')) return reply({data:[{b64_json:PNG.toString('base64')}]});
    if(url.includes(':generateContent')) return reply({candidates:[{content:{parts:[{text:'{"title":"모의 결과","sections":[]}'}]}}]});
    if(url.includes('generativelanguage')) return reply({models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']},{name:'models/embedding-only',supportedGenerationMethods:['embedContent']}]});
    if(url === 'https://api.openai.com/v1/models') return reply({data:[{id:'gpt-image-1'},{id:'text-only'}]});
    throw new Error('Unexpected provider URL: '+url);
  };
}
async function server(t,opts={}) {
  fs.mkdirSync(BASE,{recursive:true});
  const dataDir=fs.mkdtempSync(path.join(BASE,'studio-ai-server-'));
  const web=fs.mkdtempSync(path.join(BASE,'studio-ai-web-'));
  fs.writeFileSync(path.join(web,'index.html'),'<!doctype html><title>test</title>');
  const s=createStudioServer({dataDir,publicDir:web,port:0,logger:QUIET,...opts});
  t.after(async()=>{
    await s.close();
    fs.rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    fs.rmSync(web,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  await s.listen();
  const base='http://127.0.0.1:'+s.port;
  let cookie='';
  async function req(method,p,body,extra={}) {
    const headers={Origin:opts.publicOrigin || base,...(cookie?{Cookie:cookie}:{}),...extra};
    if(body!==undefined) headers['Content-Type']='application/json';
    const r=await fetch(base+p,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await r.text(); let data; try{data=JSON.parse(text);}catch{data=text;}
    return {status:r.status,data,text,headers:r.headers};
  }
  async function setup(body={}) {
    const r=await req('POST','/api/setup',{...OWNER,...body});
    if(r.status===201) cookie=r.headers.get('set-cookie').split(';')[0];
    return r;
  }
  async function project(title='AI 모의 작업') {
    const r=await req('POST','/api/projects',{title,type:'product'});
    assert.equal(r.status,201,JSON.stringify(r.data));return r.data.project;
  }
  return {s,dataDir,req,setup,project,clearCookie(){cookie='';}};
}

test('AI keys are encrypted, absent from status, persist, blank preserves and removal erases',async t=>{
  const d=dir(t), log=[];
  const ai=createAi({dataDir:d,fetchImpl:mockProvider(log)});
  assert.equal(ai.status().geminiConfigured,false);
  const result=ai.update({geminiKey:DUMMY_G,openaiKey:DUMMY_O,dailyImageLimit:3});
  assert.equal(result.geminiConfigured,true); assert.equal(result.openaiConfigured,true);
  for(const value of [DUMMY_G,DUMMY_O]) {
    assert.ok(!JSON.stringify(result).includes(value));
    assert.ok(!fs.readFileSync(path.join(d,'ai-config.enc'),'utf8').includes(value));
  }
  ai.update({geminiKey:'',openaiKey:''});
  const again=createAi({dataDir:d,fetchImpl:mockProvider(log)});
  await again.test('gemini');
  assert.equal(log.at(-1).init.headers['x-goog-api-key'],DUMMY_G);
  assert.equal(again.status().dailyImageLimit,3);
  again.update({removeGemini:true,removeOpenai:true});
  assert.equal(again.status().geminiConfigured,false);assert.equal(again.status().openaiConfigured,false);
  const final=createAi({dataDir:d,fetchImpl:mockProvider(log)});
  assert.equal(final.status().geminiConfigured,false);
  await assert.rejects(final.test('gemini'),e=>e.code==='AI_NOT_CONFIGURED');
});

test('environment keys take priority and cannot be removed by deleting stored keys',async t=>{
  const d=dir(t), log=[], envKey='test-only-environment-key';
  const ai=createAi({dataDir:d,env:{GEMINI_API_KEY:envKey,STUDIO_SECRET:SECRET},fetchImpl:mockProvider(log)});
  ai.update({geminiKey:DUMMY_G}); await ai.test('gemini');
  assert.equal(log.at(-1).init.headers['x-goog-api-key'],envKey);
  assert.equal(ai.status().geminiSource,'environment');
  ai.update({removeGemini:true});assert.equal(ai.status().geminiConfigured,true);
  assert.ok(!JSON.stringify(ai.status()).includes(envKey));
  assert.throws(()=>createAi({dataDir:d,env:{STUDIO_SECRET:SECRET+'wrong'}}),/복호화/);
  assert.throws(()=>createAi({dataDir:dir(t),env:{STUDIO_SECRET:'too-short'}}),/32/);
});

test('provider model checks are filtered and do not consume generation quota',async t=>{
  const ai=createAi({dataDir:dir(t),fetchImpl:mockProvider()});ai.update({geminiKey:DUMMY_G,openaiKey:DUMMY_O});
  assert.deepEqual((await ai.test('gemini')).models,['gemini-2.5-flash']);
  assert.deepEqual((await ai.test('openai')).models,['gpt-image-1']);
  assert.equal(ai.status().usage.text,0);assert.equal(ai.status().usage.images,0);
});

test('daily quotas persist across restart, failed provider requests count, no auto retry',async t=>{
  const d=dir(t);let calls=0;
  const ai=createAi({dataDir:d,fetchImpl:async()=>{calls++;return reply({error:{message:DUMMY_G+' private content'}},429);}});
  ai.update({geminiKey:DUMMY_G,dailyTextLimit:1});
  await assert.rejects(ai.gemini({prompt:'test'}),e=>e.code==='AI_PROVIDER_ERROR' && !e.message.includes(DUMMY_G));
  assert.equal(calls,1);assert.equal(ai.status().usage.text,1);
  await assert.rejects(ai.gemini({prompt:'test again'}),e=>e.status===429&&e.code==='AI_DAILY_LIMIT');assert.equal(calls,1);
  const again=createAi({dataDir:d,fetchImpl:mockProvider()});
  assert.equal(again.status().usage.text,1);
  await assert.rejects(again.gemini({prompt:'test'}),e=>e.code==='AI_DAILY_LIMIT');
  again.update({dailyImageLimit:0,openaiKey:DUMMY_O});
  await assert.rejects(again.image({prompt:'test'}),e=>e.code==='AI_DAILY_LIMIT');
});

test('Gemini request JSON and image references use fixed provider URL and response parsing',async t=>{
  const log=[],ai=createAi({dataDir:dir(t),fetchImpl:mockProvider(log)});
  ai.update({geminiKey:DUMMY_G});
  const r=await ai.gemini({prompt:'test JSON',json:true,refs:[{mime:'image/png',bytes:PNG}]});
  assert.equal(r.json.title,'모의 결과');assert.equal(r.usage.text,1);
  const call=log[0],b=JSON.parse(call.init.body);
  assert.ok(call.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'));
  assert.equal(call.init.redirect,'error');
  assert.equal(b.generationConfig.responseMimeType,'application/json');
  assert.equal(b.contents[0].parts[1].inline_data.data,PNG.toString('base64'));
  assert.throws(()=>ai.update({geminiModel:'https://evil.example/model'}),e=>e.code==='AI_VALIDATION');
});

test('OpenAI image generation and reference edit request formats are correct',async t=>{
  const log=[],ai=createAi({dataDir:dir(t),fetchImpl:mockProvider(log)});ai.update({openaiKey:DUMMY_O});
  const r=await ai.image({prompt:'draw',size:'1024x1536'});assert.deepEqual(r.bytes,PNG);
  assert.equal(log[0].url,'https://api.openai.com/v1/images/generations');
  assert.equal(JSON.parse(log[0].init.body).size,'1024x1536');
  await ai.image({prompt:'edit',refs:[{mime:'image/png',bytes:PNG}],quality:'medium'});
  assert.equal(log[1].url,'https://api.openai.com/v1/images/edits');
  assert.equal(log[1].init.body.get('n'),'1');
  assert.equal(log[1].init.body.get('image[]').type,'image/png');
  assert.equal(log[1].init.headers['Content-Type'],undefined,'fetch must set multipart boundary');
  assert.equal(ai.status().usage.images,2);
  await assert.rejects(ai.image({prompt:'draw',size:'8192x8192'}),e=>e.code==='AI_VALIDATION');
  assert.equal(log.length,2);
});

test('simultaneous generation is refused and config cannot change while provider is busy',async t=>{
  let release,started;
  const signal=new Promise(r=>started=r);
  const ai=createAi({dataDir:dir(t),fetchImpl:async()=>{started();return new Promise(r=>release=()=>r(reply({candidates:[{content:{parts:[{text:'done'}]}}]})));}});
  ai.update({geminiKey:DUMMY_G});
  const pending=ai.gemini({prompt:'first'});await signal;
  await assert.rejects(ai.gemini({prompt:'second'}),e=>e.code==='AI_BUSY');
  assert.throws(()=>ai.update({geminiModel:'gemini-other'}),e=>e.code==='AI_BUSY');
  release();assert.equal((await pending).text,'done');assert.equal(ai.status().usage.text,1);
});

test('AI routes require authentication and same origin before any provider calls',async t=>{
  const calls=[],x=await server(t,{aiFetch:mockProvider(calls)});
  for(const p of ['/api/ai/config','/api/ai/test','/api/ai/gemini','/api/ai/image']) {
    const r=await x.req(p.endsWith('config')?'GET':'POST',p,p.endsWith('config')?undefined:{});assert.equal(r.status,401,p);
  }
  assert.equal((await x.setup()).status,201);
  for(const p of ['/api/ai/config','/api/ai/test','/api/ai/gemini','/api/ai/image']) {
    const r=await x.req(p.endsWith('config')?'PUT':'POST',p,{}, {Origin:'https://foreign.example'});assert.equal(r.status,403,p);assert.equal(r.data.code,'FORBIDDEN_ORIGIN');
  }
  assert.equal(calls.length,0);
  assert.equal((await x.req('PUT','/api/ai/config',{geminiKey:DUMMY_G,openaiKey:DUMMY_O})).status,200);
  const cfg=await x.req('GET','/api/ai/config');assert.equal(cfg.data.geminiConfigured,true);
  assert.ok(!cfg.text.includes(DUMMY_G));assert.ok(!cfg.text.includes(DUMMY_O));
});

test('AI assets are saved privately; other project references rejected; backup excludes keys',async t=>{
  const calls=[],x=await server(t,{aiFetch:mockProvider(calls)});assert.equal((await x.setup()).status,201);
  await x.req('PUT','/api/ai/config',{geminiKey:DUMMY_G,openaiKey:DUMMY_O});
  const p=await x.project(),other=await x.project('other');
  const upload=await x.req('POST','/api/projects/'+other.id+'/assets',{name:'ref.png',mime:'image/png',data:PNG.toString('base64')});assert.equal(upload.status,201);
  const bad=await x.req('POST','/api/ai/image',{projectId:p.id,prompt:'draw',assetIds:[upload.data.asset.id]});assert.equal(bad.status,404);assert.equal(calls.length,0);
  const duplicate=await x.req('POST','/api/ai/gemini',{projectId:other.id,prompt:'write',assetIds:[upload.data.asset.id,upload.data.asset.id]});assert.equal(duplicate.status,400);assert.equal(calls.length,0);
  const good=await x.req('POST','/api/ai/image',{projectId:p.id,prompt:'draw',size:'1024x1024'});assert.equal(good.status,201,good.text);assert.equal(good.data.asset.projectId,p.id);assert.equal(good.data.asset.mime,'image/png');
  const assets=await x.req('GET','/api/projects/'+p.id+'/assets');assert.equal(assets.data.assets.length,1);assert.equal(assets.data.assets[0].id,good.data.asset.id);
  const bytes=fs.readFileSync(path.join(x.dataDir,'assets',good.data.asset.id+'.png'));assert.deepEqual(bytes,PNG);
  const text=await x.req('POST','/api/ai/gemini',{projectId:p.id,prompt:'write JSON',json:true,assetIds:[good.data.asset.id]});assert.equal(text.status,200);assert.equal(text.data.json.title,'모의 결과');
  const backup=await x.req('GET','/api/projects/'+p.id+'/export');assert.equal(backup.status,200);for(const k of [DUMMY_G,DUMMY_O,'ai-secret','ai-config.enc']) assert.ok(!backup.text.includes(k));
  x.clearCookie();assert.equal((await x.req('GET',good.data.asset.url)).status,401);
});

test('public-origin first setup requires token even from loopback proxy and uses Secure cookie',async t=>{
  const x=await server(t,{publicOrigin:'https://studio.example.test',setupToken:SETUP,aiFetch:mockProvider()});
  const status=await x.req('GET','/api/status');assert.equal(status.data.setupTokenRequired,true);
  const missing=await x.setup();assert.equal(missing.status,403);assert.equal(missing.data.code,'SETUP_TOKEN_REQUIRED');
  const spoof=await x.req('POST','/api/setup',OWNER,{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'});assert.equal(spoof.status,403);
  const ok=await x.setup({setupToken:SETUP});assert.equal(ok.status,201,ok.text);assert.match(ok.headers.get('set-cookie'),/Secure/);assert.match(ok.headers.get('set-cookie'),/__Host-studio_session=/);
  assert.equal((await x.req('GET','/api/status')).data.setupTokenRequired,false);
  assert.equal((await x.setup({setupToken:SETUP})).status,409);
});

test('remote bind refuses absent opt-in, absent HTTPS, insecure cookies or missing initial setup token',async t=>{
  const cases=[
    {host:'0.0.0.0'},
    {host:'0.0.0.0',allowRemote:true,setupToken:SETUP},
    {host:'0.0.0.0',allowRemote:true,publicOrigin:'http://studio.example.test',setupToken:SETUP},
    {host:'0.0.0.0',allowRemote:true,publicOrigin:'https://studio.example.test',secureCookies:false,setupToken:SETUP},
    {host:'0.0.0.0',allowRemote:true,publicOrigin:'https://studio.example.test'},
  ];
  for(const opts of cases) {
    const dataDir=dir(t),web=dir(t);fs.writeFileSync(path.join(web,'index.html'),'test');
    const s=createStudioServer({dataDir,publicDir:web,port:0,logger:QUIET,...opts});
    try{await assert.rejects(s.listen());}finally{await s.close();}
  }
  assert.throws(()=>createStudioServer({dataDir:dir(t),publicDir:dir(t),setupToken:'short'}),/24/);
  const valid=await server(t,{host:'0.0.0.0',allowRemote:true,publicOrigin:'https://studio.example.test',setupToken:SETUP});
  assert.equal((await valid.req('GET','/api/health')).status,200);
});


test('invalid settings and prompts are rejected before any provider call or quota use',async t=>{
  const calls=[],ai=createAi({dataDir:dir(t),fetchImpl:mockProvider(calls)});
  for(const bad of [
    {unexpected:true},{geminiKey:'not a key'},{openaiKey:'bad\nkey'},
    {imageModel:'dall-e-3'},{quality:'imaginary'},
    {dailyImageLimit:-1},{dailyTextLimit:1.5},{dailyTextLimit:1001},
  ]) assert.throws(()=>ai.update(bad),e=>e.code==='AI_VALIDATION');
  ai.update({geminiKey:DUMMY_G,openaiKey:DUMMY_O});
  for(const prompt of ['', '   ',null,'x'.repeat(60001)]) await assert.rejects(ai.gemini({prompt}),e=>e.code==='AI_VALIDATION');
  await assert.rejects(ai.image({prompt:'draw',quality:'invalid'}),e=>e.code==='AI_VALIDATION');
  assert.equal(ai.status().usage.text,0);assert.equal(ai.status().usage.images,0);assert.equal(calls.length,0);
});

test('bad and oversized AI responses are sanitized and count as attempts',async t=>{
  const responses=[
    new Response('not JSON',{status:200}),
    reply({candidates:[]}),
    reply({candidates:[{content:{parts:[{text:'not a JSON object'}]}}]}),
    new Response('{}',{status:200,headers:{'Content-Length':String(40*1024*1024)}}),
    reply({data:[{url:'https://untrusted.example/image.png'}]}),
  ];
  const ai=createAi({dataDir:dir(t),fetchImpl:async()=>responses.shift()});
  ai.update({geminiKey:DUMMY_G,openaiKey:DUMMY_O});
  await assert.rejects(ai.gemini({prompt:'test'}),e=>e.code==='AI_BAD_RESPONSE');
  await assert.rejects(ai.gemini({prompt:'test'}),e=>e.code==='AI_EMPTY');
  await assert.rejects(ai.gemini({prompt:'test',json:true}),e=>e.code==='AI_BAD_JSON');
  await assert.rejects(ai.gemini({prompt:'test'}),e=>e.code==='AI_RESPONSE_LIMIT');
  await assert.rejects(ai.image({prompt:'test'}),e=>e.code==='AI_BAD_IMAGE');
  assert.equal(ai.status().usage.text,4);assert.equal(ai.status().usage.images,1);assert.equal(responses.length,0);
});

test('AI image endpoint rejects non-image provider bytes without saving any asset',async t=>{
  let calls=0;
  const x=await server(t,{aiFetch:async()=>{calls++;return reply({data:[{b64_json:Buffer.from('not an actual PNG').toString('base64')}]});}});
  assert.equal((await x.setup()).status,201);await x.req('PUT','/api/ai/config',{openaiKey:DUMMY_O});
  const p=await x.project();
  const bad=await x.req('POST','/api/ai/image',{projectId:p.id,prompt:'draw'});
  assert.equal(bad.status,415);assert.equal(bad.data.code,'INVALID_IMAGE');assert.equal(calls,1);
  assert.deepEqual(fs.readdirSync(path.join(x.dataDir,'assets')),[]);
  const assets=await x.req('GET','/api/projects/'+p.id+'/assets');assert.equal(assets.data.assets.length,0);
  assert.equal((await x.req('GET','/api/ai/config')).data.usage.images,1);
});
