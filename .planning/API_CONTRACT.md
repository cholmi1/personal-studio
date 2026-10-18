# Personal Studio local v0.1 API contract

Node 24 built-in HTTP + node:sqlite. Single owner only. No packages, cloud uploads, third-party code copying, or outbound AI calls. Bind 127.0.0.1 by default. Deployment and real AI are Phase 3, not done now.

## Envelope / security
JSON errors: {error: Korean message, code?: string}. Request Content-Type application/json for JSON writes. Enforce exact same-origin Origin for all state-changing browser requests (CLI tests supply Origin). Session cookies HttpOnly, SameSite=Strict, Path=/; Secure on HTTPS / configured production. No cookie token or password returned in JSON, no password/key in logs. Same-origin authenticated media only. Use scrypt password hashing and random opaque session tokens whose hashes are stored. Owner setup allowed once; owner count must be rechecked atomically. Failed login throttling. Never expose .data, .planning, src or arbitrary filesystem paths as static files. Static allowlist public assets only. Bound all string/state/request/file sizes. No public unauthenticated share URLs.

## State
Project: {id,title,description,type,version,createdAt,updatedAt,state,assetCount?}. type in travel,story,image,other. title max120, description max2000.
Default state:
{"story":{"script":"","scenes":[]},"editor":{"width":1280,"height":720,"background":"#e8e3d8","baseAssetId":null,"fit":"cover","textLayers":[]},"notes":""}
Scenes: [{id,title,narration,prompt,duration}]. duration is planned seconds, not output video.
Text layers: [{id,text,x,y,fontSize,color,fontFamily,align,shadow}]. Coordinates in canvas pixels; frontend edits and draws. image canvas ratios:1280x720,1080x1920,1080x1080. No arbitrary HTML execution. State JSON limit 256KiB, script max40000 chars, <=60 scenes, <=20 text layers.

## Routes
- GET /api/health -> {ok:true}
- GET /api/status -> {setupRequired:boolean,authenticated:boolean,user:null|{name,email},ai:{configured:false},storage:'server',deployment:'local'}
- POST /api/setup {name,email,password} -> {user:{name,email}} + session cookie. Password min12 chars, never auto-generated or hardcoded in production. Subsequent setup ->409.
- POST /api/login {email,password} -> {user:{name,email}} + cookie
- POST /api/logout {} -> {ok:true} + revoke cookie
- GET /api/projects -> {projects: Project[]}; list may omit state.
- POST /api/projects {title,description?,type?} -> {project:Project}
- GET /api/projects/:id -> {project:Project}
- PATCH /api/projects/:id {version,title?,description?,type?,state?} -> {project:Project}; stale version ->409 {error,code:'VERSION_CONFLICT'}. Keep dirty frontend edits, never silent overwrite.
- DELETE /api/projects/:id -> {ok:true}; frontend asks confirmation.
- GET /api/projects/:id/assets -> {assets: Asset[]}
- POST /api/projects/:id/assets {name,mime,data} -> {asset:Asset}; data is base64, max decoded10MiB. Only PNG/JPEG/WebP and signature checks. No SVG/HTML uploads. Server UUID file names, not original filename.
- GET /api/assets/:id -> binary image, owner auth required. Asset {id,projectId,name,mime,size,url,createdAt}; url=/api/assets/:id.
- DELETE /api/assets/:id -> {ok:true}; frontend asks confirmation and clears baseAssetId if needed.
- GET /api/projects/:id/export -> downloadable JSON backup {format:'personal-studio-backup',version:1,project:{title,description,type,state},assets:[{id,name,mime,data}]} containing original image bytes, never account or secrets. Max50MiB total backup; over limit explicit error.
- POST /api/import -> same backup JSON -> {project:Project}. Validate first, create fresh project+assets, remap state.editor.baseAssetId from old asset IDs; transactional rollback and cleanup on invalid input. Max64MiB request. No account/settings import.
- /api/ai/* ->501 {error:'AI 제공자가 연결되지 않았습니다. 유료 호출은 실행하지 않았습니다.',code:'AI_NOT_CONFIGURED'}; auth and same-origin protection apply. Frontend does not call this automatically.

## Storage/start/test
src/server.mjs exports createStudioServer({dataDir,host?,port?}) if convenient, and starts when run directly. NODE entry src/server.mjs. PORT default4318, can0 for tests. DATA_DIR defaults .data inside repo for portable use. In this Aside session runtime DATA_DIR is set to C:\Users\chkang\.aside\u\0\personal-studio-data (outside distributable artifacts). Console logs local URL only. SQLite+files persistent. Tests use isolated OS/temp roots under session tmp, never production .data. API test scripts belong tests/. Node tests can spawn server on ephemeral port. Native SQLite is available on system Node24.20.0.

## Frontend boundaries
public/index.html, public/styles.css, public/app.js (+ optional modules under public/) only. Korean creative workspace '나의 창작실', personal not business, original design not Walter clone. Warm ivory/ink/sage palette, inline SVG icons, no emojis or external font/CDN. Responsive desktop and390px. Owner first-run/login screen. Project workspace, script/storyboard, image/thumbnail, assets, settings/status. Explicit save+dirty indicator; editing data survives server persistence. Local scene splitting is labeled '로컬 분할 (AI 아님)'. AI generation buttons are visibly disconnected, not mocked. Thumbnail canvas image import, cover/contain, ratios, background, editable text layers, PNG download and saving layer state. Manual image editing works without API. Project export/import works. Warn that server isn't deployed and cross-device sync isn't available yet. First owner should be created by user; do not seed credentials. No telemetry, external requests, fake generated images or success states.
