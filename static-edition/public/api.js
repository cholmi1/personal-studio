// 브라우저 저장소(IndexedDB) 기반 studioApi. 이전 서버판과 같은 메서드 이름·반환 형태를 유지한다.
// AI 호출은 ./ai-client.js 로 위임한다(브라우저에서 제공자에게 직접 요청).
import * as db from './local-db.js';
import { ApiError } from './local-db.js';

export { ApiError };

const LOCAL_USER = { name: '나', email: '' };

async function aiModule() {
  try {
    return await import('./ai-client.js');
  } catch {
    throw new ApiError('AI 연결 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.', 501, 'AI_NOT_CONFIGURED');
  }
}
async function aiCall(name, ...args) {
  const m = await aiModule();
  if (typeof m[name] !== 'function') throw new ApiError('이 버전에서 지원하지 않는 AI 기능입니다.', 501, 'AI_NOT_CONFIGURED');
  return m[name](...args);
}
async function aiConfigured() {
  try {
    const m = await import('./ai-client.js');
    return Boolean(await m.isConfigured?.());
  } catch {
    return false;
  }
}

/** 호환용: 예전 /api/ 경로 호출은 더 이상 없다. */
export async function api() {
  throw new ApiError('이 버전에서는 사용하지 않는 요청입니다.', 501, 'NOT_SUPPORTED');
}

export const studioApi = {
  aiConfig: () => aiCall('aiConfig'),
  aiSaveConfig: (body) => aiCall('aiSaveConfig', body),
  aiTest: (provider) => aiCall('aiTest', provider),
  aiGemini: (body) => aiCall('aiGemini', body),
  aiImage: (body) => aiCall('aiImage', body),
  status: async () => ({
    setupRequired: false,
    authenticated: true,
    user: { ...LOCAL_USER },
    ai: { configured: await aiConfigured() },
    setupTokenRequired: false,
    storage: 'browser',
    deployment: 'static',
  }),
  setup: async () => ({ user: { ...LOCAL_USER } }),
  login: async () => ({ user: { ...LOCAL_USER } }),
  logout: async () => ({ ok: true }),
  listProjects: () => db.listProjects(),
  createProject: (data) => db.createProject(data),
  getProject: (id) => db.getProject(id),
  patchProject: (id, data) => db.patchProject(id, data),
  deleteProject: (id) => db.deleteProject(id),
  listAssets: (id) => db.listAssets(id),
  uploadAsset: (id, name, mime, data) => db.uploadAsset(id, name, mime, data),
  deleteAsset: (assetId) => db.deleteAsset(assetId),
  exportProject: (id) => db.exportProject(id),
  importBackup: (jsonText) => db.importBackup(jsonText),
};

/** 동기 함수. listAssets/getProject/uploadAsset 이 이미지 URL을 미리 만들어 둔다. */
export function assetUrl(asset) {
  return db.assetObjectUrl(asset && asset.id);
}
