# Phase 6: 정적판 (서버·로그인 없는 브라우저 저장판)

2026-10-18. 서버판 v0.5의 화면을 유지하고 저장·AI 호출 계층만 브라우저로 옮겼다. 목표는 서버 비용 없이 Cloudflare Pages 같은 무료 정적 호스팅에 배포하는 것.

## 결정
- 사용자가 "정적 + 브라우저 저장" 방식을 선택(2026-10-18). 기기 간 자동 동기화는 포기하고 백업 파일로 옮긴다.
- 작업·이미지: IndexedDB(`personal-studio`). AI 키·설정·사용량: 별도 IndexedDB(`personal-studio-settings`) 또는 sessionStorage. 프로젝트 백업에는 키가 절대 들어가지 않는다.
- AI: 브라우저가 Google Gemini·OpenAI API를 직접 호출. CORS 사전 요청은 두 곳 모두 허용됨을 확인(2026-10-18). `public/_headers`의 CSP `connect-src`가 이 두 주소만 허용.
- `studioApi` 인터페이스(`public/api.js`)를 그대로 유지해 화면 코드 변경을 최소화했다. `assetUrl()`은 동기식 blob URL 캐시.

## 파일
- 새로 만듦: `local-db.js`, `ai-client.js`, `_headers`, `tools/serve.mjs`, `tests/`
- 다시 씀: `api.js`, `ai-settings.js`
- 고침: `app.js`(로그인·서버 문구 제거, 설정 화면), `studio-home.js`, `feature-studio.js`(다운로드 링크), `promptlab.js`, `story.js`, `canvas-editor.js`, `detail-page.js`(문구)

## 검증 (2026-10-18)
- `node --test tests/ai-client.test.mjs` 16/16. 저장 계층 브라우저 검수 19/19.
- 통합 브라우저 검수(보안 헤더가 적용된 로컬 정적 서버): 로그인 없이 시작, 작업 저장·새로고침 복원, 이미지 업로드·표시, 스케치 저장, 백업 내려받기·가져오기 왕복(키 미포함), 가짜 키로 Gemini HTTP 400·OpenAI HTTP 401 실제 수신, 유료 확인창, 캔버스 PNG 내보내기 가능. 페이지 오류·CSP 오류 0건.
- 실제 유료 AI 생성·변환은 하지 않았다.

## 남은 일
- Cloudflare Pages 배포 후 실제 주소에서 같은 검수(`_headers` 적용 여부 포함).
- 실제 키로 소액 생성 1회 시험(비용 발생, 사용자 승인 필요).
- 모바일 폭 검수, 대용량 이미지·저장 공간 부족 시 동작 검수.
