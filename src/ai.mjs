// AI secrets stay server-side. No SDK dependencies, no automatic retries.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { HttpError } from './http-utils.mjs';
const fail = (message, code = 'AI_VALIDATION', status = 400) => { throw new HttpError(status, message, code); };
const defaults = { geminiModel: 'gemini-2.5-flash', imageModel: 'gpt-image-1', quality: 'low', dailyImageLimit: 10, dailyTextLimit: 30 };
const date = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
function atomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export function createAi({ dataDir, env = {}, fetchImpl = globalThis.fetch }) {
  const configFile = path.join(dataDir, 'ai-config.enc');
  const usageFile = path.join(dataDir, 'ai-usage.json');
  const secretFile = path.join(dataDir, 'ai-secret');
  let secret = env.STUDIO_SECRET;
  if (secret && secret.length < 32) throw new Error('STUDIO_SECRET은 32자 이상이어야 합니다.');
  if (!secret) {
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
    secret = fs.readFileSync(secretFile, 'utf8');
  }
  const key = createHash('sha256').update(secret).digest();
  function encrypt(value) {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
    return JSON.stringify({ iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), body: body.toString('base64') });
  }
  let stored = {};
  if (fs.existsSync(configFile)) {
    try {
      const v = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      const c = createDecipheriv('aes-256-gcm', key, Buffer.from(v.iv, 'base64'));
      c.setAuthTag(Buffer.from(v.tag, 'base64'));
      stored = JSON.parse(Buffer.concat([c.update(Buffer.from(v.body, 'base64')), c.final()]).toString('utf8'));
    } catch { throw new Error('AI 키 설정을 복호화할 수 없습니다. 기존 STUDIO_SECRET과 데이터 볼륨을 확인해 주세요.'); }
  }
  let usage = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : { date: date(), images: 0, text: 0 };
  let busy = false;
  function cfg() { return { ...defaults, ...stored }; }
  function providerKey(p) { return (p === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY) || stored[p + 'Key'] || ''; }
  function currentUsage() {
    if (usage.date !== date()) usage = { date: date(), images: 0, text: 0 };
    return { ...usage };
  }
  function status() {
    const { geminiKey, openaiKey, ...safe } = cfg();
    return { ...safe, geminiConfigured: Boolean(providerKey('gemini')), openaiConfigured: Boolean(providerKey('openai')),
      geminiSource: env.GEMINI_API_KEY ? 'environment' : stored.geminiKey ? 'encrypted' : null,
      openaiSource: env.OPENAI_API_KEY ? 'environment' : stored.openaiKey ? 'encrypted' : null,
      usage: currentUsage(), usageNote: '한국시간 기준 시도 횟수. 실패도 포함. 실제 금액 한도는 제공자에서 별도 설정하세요.' };
  }
  function update(b) {
    if (busy) fail('AI 작업 중에는 설정을 바꿀 수 없습니다.', 'AI_BUSY', 409);
    const allowed = ['geminiKey','openaiKey','removeGemini','removeOpenai',...Object.keys(defaults)];
    if (Object.keys(b).some(k => !allowed.includes(k))) fail('알 수 없는 AI 설정입니다.');
    const next = { ...stored };
    for (const p of ['gemini','openai']) {
      const v = b[p+'Key'];
      if (v !== undefined && (typeof v !== 'string' || v.length > 512 || /[\s\x00-\x1f]/.test(v))) fail('API 키 형식을 확인해 주세요.');
      if (v) next[p+'Key'] = v;
      if (b['remove'+(p === 'gemini' ? 'Gemini' : 'Openai')] === true) delete next[p+'Key'];
    }
    for (const k of ['geminiModel','imageModel']) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(b[k])) fail('모델 이름 형식이 올바르지 않습니다.');
        if (k === 'imageModel' && !/^(gpt-image-|chatgpt-image-)/.test(b[k])) fail('GPT 이미지 모델을 선택해 주세요.');
        next[k] = b[k];
      }
    }
    if (b.quality !== undefined) { if (!['low','medium','high','auto'].includes(b.quality)) fail('이미지 품질을 확인해 주세요.'); next.quality = b.quality; }
    for (const k of ['dailyImageLimit','dailyTextLimit']) {
      if (b[k] !== undefined) { if (!Number.isInteger(b[k]) || b[k] < 0 || b[k] > 1000) fail('일일 한도는 0~1000 정수로 입력해 주세요.'); next[k] = b[k]; }
    }
    atomic(configFile, encrypt(next)); stored = next; return status();
  }
  async function remote(url, init, max = 32 * 1024 * 1024) {
    let r, timer;
    const controller = new AbortController();
    try {
      timer = setTimeout(() => controller.abort(), 180000);
      r = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
      if (!r.ok) {
        // Never echo provider messages: they may contain credentials or user text.
        await r.body?.cancel();
        const messages = { 400:'모델·입력 형식을 확인해 주세요.',401:'API 키 인증에 실패했습니다.',403:'모델 사용 권한을 확인해 주세요.',404:'해당 모델을 찾을 수 없습니다.',429:'요청 한도 또는 API 결제 상태를 확인해 주세요.' };
        fail(`AI 제공자 HTTP ${r.status}: ${messages[r.status] || '제공자 오류입니다. 잠시 후 직접 재시도해 주세요.'}`, 'AI_PROVIDER_ERROR', 502);
      }
      if (Number(r.headers.get('content-length')) > max) { await r.body?.cancel(); fail('AI 응답이 너무 큽니다.', 'AI_RESPONSE_LIMIT', 502); }
      const reader = r.body.getReader(); const chunks = []; let total = 0;
      while (true) { const { done,value } = await reader.read(); if (done) break; total += value.length; if (total > max) { await reader.cancel(); fail('AI 응답이 너무 큽니다.', 'AI_RESPONSE_LIMIT', 502); } chunks.push(Buffer.from(value)); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('AI 응답 형식을 읽을 수 없습니다.', 'AI_BAD_RESPONSE', 502); }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      fail('AI 연결이 끊겼거나 응답 시간이 초과되었습니다. 중복 과금 방지를 위해 자동 재시도하지 않았습니다.', 'AI_NETWORK', 502);
    } finally { clearTimeout(timer); }
  }
  function headers(p) {
    const k = providerKey(p);
    if (!k) fail('AI 키가 없습니다. AI 연결 설정을 먼저 해 주세요.', 'AI_NOT_CONFIGURED', 501);
    return p === 'gemini' ? { 'x-goog-api-key': k } : { Authorization: `Bearer ${k}` };
  }
  async function test(provider) {
    if (!['gemini','openai'].includes(provider)) fail('제공자를 선택해 주세요.');
    const h = headers(provider);
    const j = await remote(provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' : 'https://api.openai.com/v1/models', { headers: h }, 4*1024*1024);
    const models = provider === 'gemini' ? (j.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace(/^models\//,'')) : (j.data || []).map(m => m.id).filter(n => /^(gpt-image-|chatgpt-image-)/.test(n));
    return { models, message: '키 조회 성공. 실제 생성 권한·결제 가능 여부는 생성 호출 때 확인됩니다.' };
  }
  function validatePrompt(prompt) { if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 60000) fail('요청문은 1~60000자로 입력해 주세요.'); }
  async function run(kind, fn) {
    if (busy) fail('다른 AI 요청이 처리 중입니다.', 'AI_BUSY', 409);
    currentUsage(); const limit = kind === 'images' ? cfg().dailyImageLimit : cfg().dailyTextLimit;
    if (usage[kind] >= limit) fail('오늘의 AI 요청 한도에 도달했습니다. AI 설정에서 확인해 주세요.', 'AI_DAILY_LIMIT', 429);
    busy = true;
    try {
      usage[kind]++; atomic(usageFile, JSON.stringify(usage));
      return { ...(await fn()), usage: currentUsage() };
    } finally { busy = false; }
  }
  async function gemini({ prompt, json = false, refs = [] }) {
    validatePrompt(prompt); const h = headers('gemini');
    return run('text', async () => {
      const parts = [{ text: prompt }, ...refs.map(r => ({ inline_data: { mime_type: r.mime, data: r.bytes.toString('base64') } }))];
      const j = await remote(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg().geminiModel)}:generateContent`, {
        method: 'POST', headers: { ...h,'Content-Type':'application/json' }, body: JSON.stringify({ contents:[{role:'user',parts}], generationConfig:{ temperature:0.6, maxOutputTokens:16384, ...(json ? {responseMimeType:'application/json'} : {}) } })
      });
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
      if (!text) fail('AI 응답이 비어 있거나 안전 정책으로 차단되었습니다.', 'AI_EMPTY', 502);
      if (!json) return { text };
      try { return { text, json: JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) }; }
      catch { fail('AI가 올바른 JSON을 반환하지 않았습니다. 입력을 줄여 다시 시도해 주세요.', 'AI_BAD_JSON', 502); }
    });
  }
  async function image({ prompt, refs = [], size = '1024x1024', quality }) {
    validatePrompt(prompt); const h = headers('openai');
    if (!['1024x1024','1536x1024','1024x1536'].includes(size)) fail('지원하지 않는 이미지 크기입니다.');
    quality ??= cfg().quality;
    if (!['low','medium','high','auto'].includes(quality)) fail('품질 설정이 올바르지 않습니다.');
    return run('images', async () => {
      let body, url;
      if (refs.length) {
        url = 'https://api.openai.com/v1/images/edits'; body = new FormData();
        for (const [k,v] of Object.entries({ model:cfg().imageModel,prompt,size,quality,n:'1',output_format:'png' })) body.append(k,v);
        refs.forEach((r,i) => body.append('image[]', new Blob([r.bytes],{type:r.mime}), `reference-${i}.${r.mime.split('/')[1]}`));
      } else {
        url = 'https://api.openai.com/v1/images/generations'; h['Content-Type'] = 'application/json';
        body = JSON.stringify({model:cfg().imageModel,prompt,size,quality,n:1,output_format:'png'});
      }
      const j = await remote(url, {method:'POST',headers:h,body});
      const b64 = j.data?.[0]?.b64_json;
      if (typeof b64 !== 'string' || !b64.length || b64.length > 28*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) fail('지원하는 이미지 응답이 없습니다.', 'AI_BAD_IMAGE', 502);
      return { bytes: Buffer.from(b64,'base64'), mime:'image/png' };
    });
  }
  return { status, update, test, gemini, image };
}
