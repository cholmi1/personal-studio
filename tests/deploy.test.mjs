import test from 'node:test';
import assert from 'node:assert/strict';
import {checkEnvironment} from '../scripts/preflight.mjs';
const remote={HOST:'0.0.0.0',STUDIO_ALLOW_REMOTE:'1',DATA_DIR:'/data',RAILWAY_PUBLIC_DOMAIN:'studio.example',STUDIO_SETUP_TOKEN:'x'.repeat(24),STUDIO_SECRET:'y'.repeat(32)};
test('preflight accepts Node24 local, rejects unsupported version/port',()=>{
  assert.deepEqual(checkEnvironment({},'24.20.0').errors,[]);
  assert.ok(checkEnvironment({},'22.0.0').errors.length);
  assert.ok(checkEnvironment({PORT:'70000'},'24.20.0').errors.length);
});
test('preflight accepts Railway/Render domain and protected single-server settings',()=>{
  assert.deepEqual(checkEnvironment(remote,'24.20.0').errors,[]);
  const render={...remote,RAILWAY_PUBLIC_DOMAIN:undefined,RENDER_EXTERNAL_URL:'https://studio.example'};
  assert.deepEqual(checkEnvironment(render,'24.20.0').errors,[]);
});
test('preflight rejects HTTP/path/credentials and missing remote protection',()=>{
  for(const origin of ['http://studio.example','https://studio.example/path','https://user:secret@studio.example','invalid'])assert.ok(checkEnvironment({...remote,STUDIO_PUBLIC_ORIGIN:origin},'24.20.0').errors.length);
  for(const patch of [{STUDIO_ALLOW_REMOTE:''},{DATA_DIR:''},{STUDIO_SECRET:'short'},{STUDIO_SETUP_TOKEN:'short'},{RAILWAY_PUBLIC_DOMAIN:''}])assert.ok(checkEnvironment({...remote,...patch},'24.20.0').errors.length);
});
