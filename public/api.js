// 같은 출처 API 호출 래퍼. 외부 네트워크 호출은 하지 않는다.

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function defaultMessage(status) {
  if (status === 400) return '요청 내용이 올바르지 않습니다.';
  if (status === 401) return '로그인이 필요합니다.';
  if (status === 403) return '요청이 거부되었습니다. 같은 주소에서 다시 시도해 주세요.';
  if (status === 404) return '요청한 항목을 찾을 수 없습니다.';
  if (status === 409) return '다른 곳에서 먼저 변경되어 충돌이 발생했습니다.';
  if (status === 413) return '데이터나 파일 크기가 허용 범위를 넘었습니다.';
  if (status === 415) return '지원하지 않는 형식입니다.';
  if (status === 429) return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (status === 501) return '아직 연결되지 않은 기능입니다.';
  if (status >= 500) return '서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  return `요청을 처리하지 못했습니다. (${status})`;
}

/**
 * @param {string} path 같은 출처 경로 (/api/...)
 * @param {{method?: string, body?: any, raw?: boolean}} opts
 */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  if (!path.startsWith('/api/')) throw new ApiError('허용되지 않은 경로입니다.', 0, 'BAD_PATH');
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 이 컴퓨터에서 로컬 서버가 실행 중인지 확인해 주세요.', 0, 'NETWORK');
  }
  if (raw && res.ok) return res;
  let data = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const msg = data && typeof data.error === 'string' && data.error ? data.error : defaultMessage(res.status);
    throw new ApiError(msg, res.status, data && typeof data.code === 'string' ? data.code : '');
  }
  return data || {};
}

export const studioApi = {
  status: () => api('/api/status'),
  setup: (name, email, password) => api('/api/setup', { method: 'POST', body: { name, email, password } }),
  login: (email, password) => api('/api/login', { method: 'POST', body: { email, password } }),
  logout: () => api('/api/logout', { method: 'POST', body: {} }),
  listProjects: () => api('/api/projects'),
  createProject: (data) => api('/api/projects', { method: 'POST', body: data }),
  getProject: (id) => api(`/api/projects/${encodeURIComponent(id)}`),
  patchProject: (id, data) => api(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  deleteProject: (id) => api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listAssets: (id) => api(`/api/projects/${encodeURIComponent(id)}/assets`),
  uploadAsset: (id, name, mime, data) => api(`/api/projects/${encodeURIComponent(id)}/assets`, { method: 'POST', body: { name, mime, data } }),
  deleteAsset: (assetId) => api(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  exportProject: (id) => api(`/api/projects/${encodeURIComponent(id)}/export`, { raw: true }),
  importBackup: (jsonText) => api('/api/import', { method: 'POST', body: jsonText }),
};

/** 서버가 준 url 대신 항상 id 로 같은 출처 경로를 만든다. */
export function assetUrl(asset) {
  return `/api/assets/${encodeURIComponent(String(asset && asset.id || ''))}`;
}
