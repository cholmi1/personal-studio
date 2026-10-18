// Offline startup checks. Does not print secrets or call any provider.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkEnvironment(env = process.env, version = process.versions.node) {
  const errors = [];
  const warnings = [];
  const [major, minor] = version.split('.').map(Number);
  if (major !== 24 || minor < 15) errors.push('Node.js 24.15 이상, 25 미만이 필요합니다.');
  const port = Number(env.PORT || '4318');
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT는 1~65535 정수여야 합니다.');
  const host = env.HOST || '127.0.0.1';
  const remote = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (remote && env.STUDIO_ALLOW_REMOTE !== '1') errors.push('외부 바인딩에는 STUDIO_ALLOW_REMOTE=1이 필요합니다.');
  const origin = env.STUDIO_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (remote && !origin) errors.push('HTTPS 공개 주소(STUDIO_PUBLIC_ORIGIN 또는 플랫폼 도메인)가 필요합니다.');
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        errors.push('공개 주소는 경로·쿼리·로그인 정보 없는 HTTPS 주소여야 합니다.');
      }
    } catch { errors.push('공개 주소 형식이 올바르지 않습니다.'); }
  }
  if (env.STUDIO_SETUP_TOKEN && env.STUDIO_SETUP_TOKEN.length < 24) errors.push('최초 설정 토큰은 24자 이상이어야 합니다.');
  if (env.STUDIO_SECRET && env.STUDIO_SECRET.length < 32) errors.push('STUDIO_SECRET은 32자 이상이어야 합니다.');
  if (remote && !env.DATA_DIR) errors.push('배포에서는 영구 저장소 경로 DATA_DIR을 지정해야 합니다.');
  if (remote && !env.STUDIO_SECRET) warnings.push('암호화 비밀 파일이 DATA_DIR에 생성됩니다. 영구 볼륨과 별도 보안 백업이 필요합니다.');
  return { errors, warnings, remote, dataDir: env.DATA_DIR || '.data' };
}

function main() {
  const result = checkEnvironment();
  if (!result.errors.length) {
    try {
      fs.mkdirSync(result.dataDir, { recursive: true, mode: 0o700 });
      fs.accessSync(result.dataDir, fs.constants.R_OK | fs.constants.W_OK);
      // Existing DB owner validation is the server's responsibility.
      if (result.remote && !fs.existsSync(path.join(result.dataDir, 'studio.sqlite')) && !process.env.STUDIO_SETUP_TOKEN) {
        result.errors.push('새 원격 서버의 최초 소유자 설정에는 STUDIO_SETUP_TOKEN이 필요합니다.');
      }
    } catch { result.errors.push('데이터 폴더에 읽기·쓰기 권한이 없습니다. 볼륨 마운트와 권한을 확인해 주세요.'); }
  }
  for (const warning of result.warnings) console.warn(`[사전 점검 안내] ${warning}`);
  for (const error of result.errors) console.error(`[사전 점검 실패] ${error}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log('배포 전 설정 점검 통과. 영구 볼륨 연결 여부와 HTTPS 인증서는 플랫폼에서 별도 확인해 주세요.');
}
const direct = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (direct) main();
