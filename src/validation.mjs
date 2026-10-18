// Input validation for accounts, projects, state, images and backups.
import { HttpError, KiB, MiB } from './http-utils.mjs';

export const LIMITS = Object.freeze({
  nameMax: 80,
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 1024,
  titleMax: 120,
  descriptionMax: 2000,
  stateBytesMax: 256 * KiB,
  scriptMax: 40000,
  scenesMax: 60,
  sceneTitleMax: 200,
  sceneTextMax: 4000,
  sceneDurationMax: 3600,
  textLayersMax: 20,
  layerTextMax: 1000,
  layerFontFamilyMax: 100,
  notesMax: 20000,
  idMax: 64,
  assetNameMax: 200,
  assetBytesMax: 10 * MiB,
  assetsPerProjectMax: 200,
  backupBytesMax: 50 * MiB,
  importRequestMax: 64 * MiB,
});

export const PROJECT_TYPES = Object.freeze(['travel', 'story', 'image', 'other']);
export const CANVAS_SIZES = Object.freeze([
  [1280, 720],
  [1080, 1920],
  [1080, 1080],
]);
export const IMAGE_MIMES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

export function defaultState() {
  return {
    story: { script: '', scenes: [] },
    editor: {
      width: 1280,
      height: 720,
      background: '#e8e3d8',
      baseAssetId: null,
      fit: 'cover',
      textLayers: [],
    },
    notes: '',
  };
}

function bad(message) {
  return new HttpError(400, message, 'VALIDATION_ERROR');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function charLength(s) {
  // Count Unicode code points so Korean/emoji lengths are intuitive.
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

// Control characters other than tab/newline/carriage return.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function checkString(value, label, { max, min = 0, allowNewlines = true, required = true } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw bad(`${label}은(는) 문자열이어야 합니다.`);
  if (CONTROL_RE.test(value)) throw bad(`${label}에 허용되지 않는 제어 문자가 있습니다.`);
  if (!allowNewlines && /[\r\n\t]/.test(value)) throw bad(`${label}에는 줄바꿈을 넣을 수 없습니다.`);
  const len = charLength(value);
  if (len < min) throw bad(min <= 1 ? `${label}을(를) 입력해 주세요.` : `${label}은(는) ${min}자 이상이어야 합니다.`);
  if (max !== undefined && len > max) throw bad(`${label}은(는) 최대 ${max}자까지 입력할 수 있습니다.`);
  return value;
}

function rejectUnknownKeys(obj, allowed, label) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw bad(`${label}에 알 수 없는 항목 '${key.slice(0, 40)}'이(가) 있습니다.`);
  }
}

function checkNumber(value, label, { min, max, integer = false }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw bad(`${label}은(는) 숫자여야 합니다.`);
  if (integer && !Number.isInteger(value)) throw bad(`${label}은(는) 정수여야 합니다.`);
  if (value < min || value > max) throw bad(`${label}은(는) ${min}~${max} 범위여야 합니다.`);
  return value;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FONT_RE = /^[\p{L}\p{N} ,'"_-]+$/u;

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function checkId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw bad(`${label} id는 1~64자의 영문, 숫자, '-', '_'만 사용할 수 있습니다.`);
  }
  return value;
}

// ---------- account ----------

export function validateSetup(body) {
  const name = checkString(body.name, '이름', { max: LIMITS.nameMax, min: 1, allowNewlines: false }).trim();
  if (!name) throw bad('이름을 입력해 주세요.');
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  return { name, email, password };
}

export function validateEmail(value) {
  if (typeof value !== 'string') throw bad('이메일을 입력해 주세요.');
  const email = value.trim().toLowerCase();
  if (!email || email.length > LIMITS.emailMax || !EMAIL_RE.test(email)) throw bad('이메일 형식이 올바르지 않습니다.');
  return email;
}

export function validatePassword(value) {
  if (typeof value !== 'string') throw bad('비밀번호를 입력해 주세요.');
  const len = charLength(value);
  if (len < LIMITS.passwordMin) throw bad(`비밀번호는 ${LIMITS.passwordMin}자 이상이어야 합니다.`);
  if (len > LIMITS.passwordMax) throw bad(`비밀번호는 최대 ${LIMITS.passwordMax}자까지 사용할 수 있습니다.`);
  return value;
}

export function validateLogin(body) {
  if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email || !body.password) {
    throw bad('이메일과 비밀번호를 입력해 주세요.');
  }
  if (body.email.length > LIMITS.emailMax || body.password.length > LIMITS.passwordMax * 4) {
    throw bad('이메일 또는 비밀번호 길이가 허용 범위를 넘었습니다.');
  }
  return { email: body.email.trim().toLowerCase(), password: body.password };
}

// ---------- project fields ----------

export function validateTitle(value) {
  const title = checkString(value, '제목', { max: LIMITS.titleMax, min: 1, allowNewlines: false }).trim();
  if (!title) throw bad('제목을 입력해 주세요.');
  return title;
}

export function validateDescription(value) {
  return checkString(value, '설명', { max: LIMITS.descriptionMax });
}

export function validateType(value) {
  if (typeof value !== 'string' || !PROJECT_TYPES.includes(value)) {
    throw bad(`프로젝트 유형은 ${PROJECT_TYPES.join(', ')} 중 하나여야 합니다.`);
  }
  return value;
}

export function validateVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw bad('version은 1 이상의 정수여야 합니다.');
  return value;
}

/**
 * Validate and normalize project state. Missing keys receive defaults;
 * unknown keys and wrong types are rejected (never silently dropped).
 * @param {object} opts.assetIdCheck optional (id) => boolean|string for baseAssetId
 */
export function validateState(input, { allowAnyBaseAssetId = false } = {}) {
  if (!isPlainObject(input)) throw bad('state는 객체여야 합니다.');
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > LIMITS.stateBytesMax) {
    throw new HttpError(413, `프로젝트 상태 데이터가 256KiB를 초과했습니다.`, 'STATE_TOO_LARGE');
  }
  rejectUnknownKeys(input, ['story', 'editor', 'notes'], 'state');
  const out = defaultState();

  if (input.story !== undefined) {
    const story = input.story;
    if (!isPlainObject(story)) throw bad('state.story는 객체여야 합니다.');
    rejectUnknownKeys(story, ['script', 'scenes'], 'state.story');
    if (story.script !== undefined) out.story.script = checkString(story.script, '대본', { max: LIMITS.scriptMax });
    if (story.scenes !== undefined) {
      if (!Array.isArray(story.scenes)) throw bad('장면 목록은 배열이어야 합니다.');
      if (story.scenes.length > LIMITS.scenesMax) throw bad(`장면은 최대 ${LIMITS.scenesMax}개까지 만들 수 있습니다.`);
      const seen = new Set();
      out.story.scenes = story.scenes.map((scene, i) => {
        const label = `장면 ${i + 1}`;
        if (!isPlainObject(scene)) throw bad(`${label}은(는) 객체여야 합니다.`);
        rejectUnknownKeys(scene, ['id', 'title', 'narration', 'prompt', 'duration'], label);
        const id = checkId(scene.id, label);
        if (seen.has(id)) throw bad(`${label}의 id가 중복되었습니다.`);
        seen.add(id);
        return {
          id,
          title: scene.title === undefined ? '' : checkString(scene.title, `${label} 제목`, { max: LIMITS.sceneTitleMax }),
          narration:
            scene.narration === undefined ? '' : checkString(scene.narration, `${label} 내레이션`, { max: LIMITS.sceneTextMax }),
          prompt: scene.prompt === undefined ? '' : checkString(scene.prompt, `${label} 프롬프트`, { max: LIMITS.sceneTextMax }),
          duration:
            scene.duration === undefined
              ? 0
              : checkNumber(scene.duration, `${label} 길이(초)`, { min: 0, max: LIMITS.sceneDurationMax }),
        };
      });
    }
  }

  if (input.editor !== undefined) {
    const ed = input.editor;
    if (!isPlainObject(ed)) throw bad('state.editor는 객체여야 합니다.');
    rejectUnknownKeys(ed, ['width', 'height', 'background', 'baseAssetId', 'fit', 'textLayers'], 'state.editor');
    const width = ed.width === undefined ? out.editor.width : ed.width;
    const height = ed.height === undefined ? out.editor.height : ed.height;
    if (!CANVAS_SIZES.some(([w, h]) => w === width && h === height)) {
      throw bad('캔버스 크기는 1280x720, 1080x1920, 1080x1080 중 하나여야 합니다.');
    }
    out.editor.width = width;
    out.editor.height = height;
    if (ed.background !== undefined) {
      if (typeof ed.background !== 'string' || !COLOR_RE.test(ed.background)) {
        throw bad('배경색은 #RRGGBB 형식이어야 합니다.');
      }
      out.editor.background = ed.background;
    }
    if (ed.baseAssetId !== undefined && ed.baseAssetId !== null) {
      if (allowAnyBaseAssetId) {
        if (typeof ed.baseAssetId !== 'string' || ed.baseAssetId.length < 1 || ed.baseAssetId.length > LIMITS.idMax) {
          throw bad('기본 이미지 id가 올바르지 않습니다.');
        }
      } else if (!isUuid(ed.baseAssetId)) {
        throw bad('기본 이미지 id가 올바르지 않습니다.');
      }
      out.editor.baseAssetId = ed.baseAssetId;
    }
    if (ed.fit !== undefined) {
      if (ed.fit !== 'cover' && ed.fit !== 'contain') throw bad("이미지 맞춤은 'cover' 또는 'contain'이어야 합니다.");
      out.editor.fit = ed.fit;
    }
    if (ed.textLayers !== undefined) {
      if (!Array.isArray(ed.textLayers)) throw bad('텍스트 레이어 목록은 배열이어야 합니다.');
      if (ed.textLayers.length > LIMITS.textLayersMax) {
        throw bad(`텍스트 레이어는 최대 ${LIMITS.textLayersMax}개까지 만들 수 있습니다.`);
      }
      const seen = new Set();
      out.editor.textLayers = ed.textLayers.map((layer, i) => {
        const label = `텍스트 레이어 ${i + 1}`;
        if (!isPlainObject(layer)) throw bad(`${label}은(는) 객체여야 합니다.`);
        rejectUnknownKeys(layer, ['id', 'text', 'x', 'y', 'fontSize', 'color', 'fontFamily', 'align', 'shadow'], label);
        const id = checkId(layer.id, label);
        if (seen.has(id)) throw bad(`${label}의 id가 중복되었습니다.`);
        seen.add(id);
        const color = layer.color === undefined ? '#1f1d1a' : layer.color;
        if (typeof color !== 'string' || !COLOR_RE.test(color)) throw bad(`${label} 색상은 #RRGGBB 형식이어야 합니다.`);
        const fontFamily = layer.fontFamily === undefined ? 'sans-serif' : layer.fontFamily;
        checkString(fontFamily, `${label} 글꼴`, { max: LIMITS.layerFontFamilyMax, min: 1, allowNewlines: false });
        if (!FONT_RE.test(fontFamily)) throw bad(`${label} 글꼴 이름에 허용되지 않는 문자가 있습니다.`);
        const align = layer.align === undefined ? 'left' : layer.align;
        if (!['left', 'center', 'right'].includes(align)) throw bad(`${label} 정렬은 left, center, right 중 하나여야 합니다.`);
        const shadow = layer.shadow === undefined ? false : layer.shadow;
        if (typeof shadow !== 'boolean') throw bad(`${label} 그림자 값은 true/false여야 합니다.`);
        return {
          id,
          text: layer.text === undefined ? '' : checkString(layer.text, `${label} 문구`, { max: LIMITS.layerTextMax }),
          x: layer.x === undefined ? 0 : checkNumber(layer.x, `${label} x`, { min: -10000, max: 10000 }),
          y: layer.y === undefined ? 0 : checkNumber(layer.y, `${label} y`, { min: -10000, max: 10000 }),
          fontSize: layer.fontSize === undefined ? 48 : checkNumber(layer.fontSize, `${label} 글자 크기`, { min: 4, max: 600 }),
          color,
          fontFamily,
          align,
          shadow,
        };
      });
    }
  }

  if (input.notes !== undefined) out.notes = checkString(input.notes, '메모', { max: LIMITS.notesMax });
  return out;
}

// ---------- images ----------

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeBase64Image(data, label = '이미지 데이터') {
  if (typeof data !== 'string' || data.length === 0) throw bad(`${label}가 비어 있습니다.`);
  let raw = data;
  const m = /^data:([a-z/+.-]+);base64,/i.exec(raw);
  if (m) raw = raw.slice(m[0].length);
  raw = raw.replace(/\s+/g, '');
  if (raw.length % 4 !== 0 || !BASE64_RE.test(raw)) throw bad(`${label}는 올바른 base64가 아닙니다.`);
  const maxEncoded = Math.ceil(LIMITS.assetBytesMax / 3) * 4;
  if (raw.length > maxEncoded) throw new HttpError(413, '이미지 파일은 최대 10MiB까지 올릴 수 있습니다.', 'ASSET_TOO_LARGE');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 0) throw bad(`${label}가 비어 있습니다.`);
  if (buf.length > LIMITS.assetBytesMax) throw new HttpError(413, '이미지 파일은 최대 10MiB까지 올릴 수 있습니다.', 'ASSET_TOO_LARGE');
  return buf;
}

export function sniffImageMime(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 16 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buf.toString('ascii', 12, 16))
  ) {
    return 'image/webp';
  }
  return null;
}

export function validateMime(mime) {
  if (typeof mime !== 'string' || !Object.hasOwn(IMAGE_MIMES, mime.toLowerCase())) {
    throw new HttpError(415, 'PNG, JPEG, WebP 이미지만 올릴 수 있습니다.', 'UNSUPPORTED_IMAGE_TYPE');
  }
  return mime.toLowerCase();
}

export function sanitizeAssetName(name, mime) {
  let n = typeof name === 'string' ? name : '';
  n = n.replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\/]/g, '_').trim();
  // Keep only the base name, strip leading dots.
  n = n.replace(/^\.+/, '');
  if (charLength(n) > LIMITS.assetNameMax) n = [...n].slice(0, LIMITS.assetNameMax).join('');
  if (!n) n = `image.${IMAGE_MIMES[mime] || 'img'}`;
  return n;
}

/** Validate an uploaded/imported image; returns {name,mime,bytes}. */
export function validateImagePayload({ name, mime, data }, label = '이미지') {
  const m = validateMime(mime);
  const bytes = decodeBase64Image(data, `${label} 데이터`);
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) throw new HttpError(415, `${label} 파일 내용이 PNG, JPEG, WebP 형식이 아닙니다.`, 'INVALID_IMAGE');
  if (sniffed !== m) throw new HttpError(415, `${label}의 실제 형식(${sniffed})이 지정한 형식(${m})과 다릅니다.`, 'INVALID_IMAGE');
  return { name: sanitizeAssetName(name, m), mime: m, bytes };
}

// ---------- backup ----------

export function validateBackup(body) {
  if (body.format !== 'personal-studio-backup') throw bad('나의 창작실 백업 파일 형식이 아닙니다.');
  if (body.version !== 1) throw bad('지원하지 않는 백업 버전입니다.');
  rejectUnknownKeys(body, ['format', 'version', 'project', 'assets'], '백업');
  const p = body.project;
  if (!isPlainObject(p)) throw bad('백업에 프로젝트 정보가 없습니다.');
  rejectUnknownKeys(p, ['title', 'description', 'type', 'state'], '백업 프로젝트');
  const title = validateTitle(p.title);
  const description = p.description === undefined ? '' : validateDescription(p.description);
  const type = p.type === undefined ? 'other' : validateType(p.type);
  const state = validateState(p.state === undefined ? {} : p.state, { allowAnyBaseAssetId: true });

  const assetsIn = body.assets === undefined ? [] : body.assets;
  if (!Array.isArray(assetsIn)) throw bad('백업의 이미지 목록은 배열이어야 합니다.');
  if (assetsIn.length > LIMITS.assetsPerProjectMax) {
    throw bad(`백업 이미지는 최대 ${LIMITS.assetsPerProjectMax}개까지 가져올 수 있습니다.`);
  }
  const ids = new Set();
  let total = 0;
  const assets = assetsIn.map((a, i) => {
    const label = `백업 이미지 ${i + 1}`;
    if (!isPlainObject(a)) throw bad(`${label} 정보가 올바르지 않습니다.`);
    rejectUnknownKeys(a, ['id', 'name', 'mime', 'data'], label);
    if (typeof a.id !== 'string' || a.id.length < 1 || a.id.length > LIMITS.idMax) throw bad(`${label}의 id가 올바르지 않습니다.`);
    if (ids.has(a.id)) throw bad(`${label}의 id가 중복되었습니다.`);
    ids.add(a.id);
    const img = validateImagePayload(a, label);
    total += img.bytes.length;
    if (total > LIMITS.backupBytesMax) throw new HttpError(413, '백업 이미지 전체 크기가 50MiB를 초과합니다.', 'BACKUP_TOO_LARGE');
    return { oldId: a.id, ...img };
  });

  if (state.editor.baseAssetId !== null && !ids.has(state.editor.baseAssetId)) {
    throw bad('기본 이미지가 백업 이미지 목록에 없습니다.');
  }
  return { title, description, type, state, assets };
}
