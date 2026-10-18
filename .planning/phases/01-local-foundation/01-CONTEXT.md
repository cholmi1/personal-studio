# Phase 1/2 Context

## Phase Boundary
개인 전용 계정·서버 저장 기반 및 실제 수동 창작 편집 기능의 로컬 개발 버전.

## Decisions
D-01: 사용자 개인 용도만, 회사·CVT200 문구 없음.
D-02: 집/회사/휴대폰 사용 목표, 먼저 로컬에서 동작 검증하고 배포는 승인 후.
D-03: AI는 미연결 표시, 호출/구독/외부 업로드 없음.
D-04: 소유자 계정은 사용자 직접 최초 설정, 임의 계정·비밀번호를 심지 않음. 테스트는 격리 데이터만 사용.
D-05: Node24 내장 모듈만 사용, 서버 API 계약을 기준으로 개발 작업을 분리.

## Canonical References
.planning/PROJECT.md, REQUIREMENTS.md, ROADMAP.md, API_CONTRACT.md.

## Deferred
AI 모델/키, 호스팅/HTTPS, 실제 원격 다기기 검수.
