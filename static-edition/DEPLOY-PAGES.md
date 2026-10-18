# Cloudflare Pages 배포 안내 (무료)

확인 기준: 2026-10-18. 이 앱은 서버가 없는 정적 사이트라서 **빌드 명령 없이 `public` 폴더만 올리면** 됩니다.

## 방법 A. 폴더를 직접 올리기 (Direct Upload, GitHub 연결 불필요)
1. Cloudflare 대시보드 > Workers & Pages > Create > Pages > **Upload assets** 를 고릅니다.
2. 프로젝트 이름(예: `my-studio`)을 정하면 주소가 `https://프로젝트이름.pages.dev` 가 됩니다.
3. 이 폴더의 `public` 안의 **내용 전체**(안의 파일과 `_headers` 포함)를 올립니다. `public` 폴더 자체가 아니라 그 안의 파일들이 사이트 맨 위(루트)에 놓여야 합니다. ZIP으로 만들 때도 같습니다.
4. 배포가 끝나면 주소를 열어 확인합니다. 수정할 때마다 같은 방식으로 새로 올립니다.

## 방법 B. GitHub 저장소를 연결하기 (자동 배포)
1. Workers & Pages > Create > Pages > **Connect to Git** 에서 저장소를 고릅니다. Cloudflare에 GitHub 접근을 허용하는 단계가 있으니, 가능하면 해당 저장소 하나만 선택하세요.
2. Framework preset은 `None`, Build command는 비워 두고, **Build output directory** 는 `public` (저장소 안에 `static-edition/` 폴더로 올렸다면 Root directory를 `static-edition`, output을 `public`)으로 둡니다.
3. 저장소에 커밋이 올라갈 때마다 자동으로 배포됩니다.

## 배포 직후 확인
1. 주소를 열면 로그인 없이 바로 홈이 보입니다.
2. 개발자도구 콘솔에 보안 정책(CSP) 오류가 없어야 합니다. `public/_headers`가 적용되지 않으면 `X-Frame-Options`, `Content-Security-Policy` 응답 헤더가 비어 있습니다.
3. 새 작업 하나를 만들어 저장하고 새로고침해 복원되는지 봅니다.
4. 설정 화면에서 "영구 보관 요청" 상태를 확인합니다.

## 알아둘 점
- `_headers`의 보안 정책(CSP)은 `connect-src`에 `https://api.openai.com`과 `https://generativelanguage.googleapis.com`만 허용합니다. 다른 AI 서비스를 쓰려면 이 줄을 고쳐야 합니다.
- `X-Robots-Tag: noindex, nofollow`로 검색에 노출되지 않게 했습니다. 주소를 아는 사람은 누구나 화면을 열 수 있지만 작업 내용은 각자의 브라우저에만 있습니다.
- 접근 자체를 막고 싶으면 Cloudflare Access를 Pages에 붙일 수 있습니다(별도 설정, 무료 한도는 계정에서 확인).
- 사이트 주소(`*.pages.dev`)가 바뀌면 브라우저가 다른 사이트로 보므로 저장된 작업이 보이지 않습니다. 주소를 바꾸기 전에 백업을 내려받으세요. 사용자 지정 도메인을 쓸 계획이면 처음부터 그 주소를 쓰는 것이 안전합니다.
- 무료 요금과 한도는 Cloudflare 계정과 시점에 따라 달라질 수 있습니다. 배포 전 Pages 요금 안내를 확인하세요.
