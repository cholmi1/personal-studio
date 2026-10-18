// 상세페이지 제작 - DOM 을 쓰지 않는 순수 도우미 (Node 에서도 불러올 수 있음).
// 구성 템플릿·기본 레이어·요청문은 사용자 본인의 "상세페이지 메이커" 앱을 바탕으로 옮겼다.
// 이 파일은 어떤 네트워크 요청도 하지 않는다.

export const LIMITS = Object.freeze({
  products: 8,
  extraInfo: 4000,
  reviewSummary: 8000,
  tone: 1000,
  productName: 120,
  summary: 500,
  palette: 3,
  sections: 16,
  label: 40,
  headline: 200,
  subcopy: 1000,
  bullets: 8,
  bullet: 200,
  visual: 2000,
  layers: 12,
  layerText: 2000,
});

export const TEMPLATES = Object.freeze([
  { id: 'basic', name: '상세페이지 기본형', desc: '히어로 → 문제 → 해결 → 특장점 → 디테일 → 사용법 → 구성' },
  { id: 'objection', name: '구매저항 해소형', desc: '구매 전 망설임을 하나씩 짚고 해소' },
  { id: 'proof', name: '비교/근거 강화형', desc: '비교 기준과 신뢰 근거를 전면에' },
  { id: 'scenario', name: '사용 시나리오형', desc: '생활 속 사용 장면 중심' },
  { id: 'story', name: '스토리브랜드 판매 서사', desc: '고객=주인공, 제품=가이드인 서사' },
  { id: 'mobile', name: '모바일 집중형', desc: '짧은 카피, 큰 비주얼, 빠른 스크롤' },
]);

export const RATIOS = Object.freeze([
  { id: 'portrait', name: '모바일 세로 (2:3)', size: '1024x1536', h: 1620 },
  { id: 'square', name: '정방형 (1:1)', size: '1024x1024', h: 1080 },
  { id: 'landscape', name: '일반 가로 (3:2)', size: '1536x1024', h: 720 },
]);

export const STYLES = Object.freeze(['미니멀', '모던', '프리미엄', '인스타감성', '내추럴', '테크', '레트로', '팝아트']);
export const LANGS = Object.freeze(['한국어', '영어', '일본어']);
export const COUNT_OPTIONS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 12]);

export const MODES = Object.freeze([
  { id: 'edit', name: '텍스트편집 모드', desc: '글자 없는 이미지 + 편집 가능한 텍스트 레이어. 글자는 이 앱이 직접 그립니다.' },
  { id: 'baked', name: '통이미지 모드', desc: 'AI가 카피를 이미지 안에 직접 디자인합니다. AI 이미지 생성 연결이 필요합니다.' },
]);

export const MODEL_OPTS = Object.freeze([
  { id: 'none', name: '모델 없이 제품 중심' },
  { id: 'some', name: '일부 섹션 모델컷 포함' },
  { id: 'hero', name: '히어로에만 모델 사용' },
]);

export const SECTION_TYPES = Object.freeze([
  'hero', 'problem', 'solution', 'feature', 'detail', 'usage', 'comparison',
  'review', 'trust', 'spec', 'composition', 'caution', 'offer', 'custom',
]);

export const TYPE_LABELS = Object.freeze({
  hero: '대표 소개', problem: '고객의 고민', solution: '해결책', feature: '핵심 특장점', detail: '디테일',
  usage: '사용법', comparison: '비교', review: '고객 후기', trust: '신뢰 근거', spec: '제품 정보',
  composition: '구성', caution: '구매 전 확인', offer: '구매 안내', custom: '섹션',
});

export const FONTS = Object.freeze({
  sans: { label: '고딕', stack: '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif' },
  serif: { label: '명조', stack: '"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", "Batang", serif' },
  display: { label: '강조(굵은 고딕)', stack: '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", "Arial Black", sans-serif', weight: 900 },
  round: { label: '둥근체', stack: '"Gowun Dodum", "NanumSquareRound", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif' },
});
export const FONT_IDS = Object.freeze(Object.keys(FONTS));
export const WEIGHTS = Object.freeze([400, 500, 600, 700, 800, 900]);
export const LAYER_ROLES = Object.freeze(['label', 'headline', 'subcopy', 'bullets', 'text']);
export const DEFAULT_PALETTE = Object.freeze(['#efece6', '#ffffff', '#16181d']);

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

export function defaultDetailPage() {
  return {
    productAssetIds: [],
    modelAssetId: null,
    extraInfo: '',
    reviewSummary: '',
    settings: { template: 'basic', count: 7, lang: '한국어', ratio: 'portrait', style: '미니멀', mode: 'edit', model: 'none', tone: '' },
    plan: null,
  };
}

export function newId(prefix = 'dp') {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return prefix + '_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- 문자열·숫자 정리 ----------
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** 코드 포인트 기준으로 자르고 허용되지 않는 제어 문자를 지운다. */
export function cut(value, max, { oneLine = false } = {}) {
  let s = value == null ? '' : String(value);
  s = s.replace(CONTROL_RE, '');
  if (oneLine) s = s.replace(/[\r\n\t]+/g, ' ');
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('') : s;
}

export function toHex6(v, fallback = null) {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) return ('#' + t.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  return HEX6_RE.test(t) ? t.toLowerCase() : fallback;
}

export function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isAssetId(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

export function ratioOf(id) {
  return RATIOS.find((r) => r.id === id) || RATIOS[0];
}

// ---------- 섹션 · 레이어 ----------
export function makeLayer(role, text, o = {}) {
  return normalizeLayer({
    id: newId('ly'), role, text, visible: true, x: 0.5, y: 0.1, size: 40, weight: 700, font: 'sans', color: '#16181d',
    align: 'center', lineHeight: 1.35, maxW: 0.86, shadow: false, bg: false, bgColor: '#ffffff', bgOpacity: 0.85, ...o,
  });
}

export function normalizeLayer(l) {
  const src = l && typeof l === 'object' ? l : {};
  const weight = Number(src.weight);
  return {
    id: typeof src.id === 'string' && ID_RE.test(src.id) ? src.id : newId('ly'),
    role: LAYER_ROLES.includes(src.role) ? src.role : 'text',
    text: cut(src.text, LIMITS.layerText),
    visible: src.visible !== false,
    x: clampNum(src.x, 0, 1, 0.5),
    y: clampNum(src.y, -0.1, 1.2, 0.1),
    size: Math.round(clampNum(src.size, 10, 240, 40)),
    weight: WEIGHTS.includes(weight) ? weight : 700,
    font: FONT_IDS.includes(src.font) ? src.font : 'sans',
    color: toHex6(src.color, '#16181d'),
    align: ['left', 'center', 'right'].includes(src.align) ? src.align : 'center',
    lineHeight: clampNum(src.lineHeight, 0.8, 3, 1.35),
    maxW: clampNum(src.maxW, 0.1, 1, 0.86),
    shadow: !!src.shadow,
    bg: !!src.bg,
    bgColor: toHex6(src.bgColor, '#ffffff'),
    bgOpacity: clampNum(src.bgOpacity, 0, 1, 0.85),
  };
}

export function defaultLayers(s, palette) {
  const accent = toHex6(palette && palette[2], '#16181d');
  const L = [];
  if (s.label) L.push(makeLayer('label', s.label, { y: 0.06, size: 28, weight: 700, color: accent }));
  L.push(makeLayer('headline', s.headline, { y: 0.1, size: s.type === 'hero' ? 78 : 64, weight: 800, lineHeight: 1.22 }));
  if (s.subcopy) L.push(makeLayer('subcopy', s.subcopy, { y: 0.1 + (s.type === 'hero' ? 0.13 : 0.11), size: 32, weight: 500, color: '#3d424b', lineHeight: 1.5 }));
  if (s.bullets && s.bullets.length) {
    L.push(makeLayer('bullets', s.bullets.map((b) => '✓ ' + b).join('\n'), { y: 0.78, size: 30, weight: 600, lineHeight: 1.6, bg: true, bgColor: '#ffffff', bgOpacity: 0.85 }));
  }
  return L;
}

/** 원본 섹션 정보(설계 결과·초안)를 저장 가능한 섹션으로 만든다. */
export function makeSection(sec, palette) {
  const src = sec && typeof sec === 'object' ? sec : {};
  const type = SECTION_TYPES.includes(src.type) ? src.type : 'custom';
  let bullets = src.bullets;
  if (typeof bullets === 'string') bullets = bullets.split('\n');
  bullets = (Array.isArray(bullets) ? bullets : [])
    .map((b) => cut(b, LIMITS.bullet, { oneLine: true }).trim())
    .filter(Boolean)
    .slice(0, LIMITS.bullets);
  const s = {
    id: typeof src.id === 'string' && ID_RE.test(src.id) ? src.id : newId('sec'),
    type,
    label: cut(src.label || TYPE_LABELS[type], LIMITS.label, { oneLine: true }).trim() || TYPE_LABELS[type],
    headline: cut(src.headline, LIMITS.headline),
    subcopy: cut(src.subcopy, LIMITS.subcopy),
    bullets,
    visual: cut(src.visual, LIMITS.visual),
    useModel: !!src.useModel,
    assetId: isAssetId(src.assetId) ? src.assetId : null,
    bg: toHex6(src.bg, toHex6(palette && palette[0], '#efece6')),
    layers: [],
  };
  s.layers = Array.isArray(src.layers) && src.layers.length
    ? src.layers.slice(0, LIMITS.layers).map(normalizeLayer)
    : defaultLayers(s, palette);
  // 섹션 안에서 레이어 id 중복 제거
  const seen = new Set();
  for (const l of s.layers) {
    if (seen.has(l.id)) l.id = newId('ly');
    seen.add(l.id);
  }
  return s;
}

// ---------- 템플릿 초안 (AI 아님) ----------
const GUIDE = {
  hero: { headline: (n) => `${n}, 핵심 가치를 한 줄로`, subcopy: '누구에게 어떤 변화를 주는 제품인지 1~2문장으로 적으세요.', visual: 'Hero shot of the product centered on a clean surface, soft studio lighting, generous empty space in the upper area.' },
  problem: { headline: () => '이런 고민, 있으셨나요?', subcopy: '고객이 실제로 겪는 불편을 구체적으로 적으세요.', bullets: ['고민 1을 적으세요', '고민 2를 적으세요', '고민 3을 적으세요'], visual: 'A relatable everyday scene that shows the inconvenience the customer faces, muted natural tones, no product.' },
  solution: { headline: (n) => `${n}이(가) 답이 됩니다`, subcopy: '고민을 어떻게 해결하는지 한두 문장으로 적으세요.', visual: 'The product presented as the answer, placed in bright clean light with a calm background.' },
  feature: { headline: () => 'Point. 가장 큰 장점을 적으세요', subcopy: '장점을 뒷받침하는 사실(자료에서 확인된 내용)만 적으세요.', bullets: ['근거 1', '근거 2'], visual: 'Product close-up emphasizing its key feature, minimal props, crisp lighting.' },
  detail: { headline: () => '가까이 보면 다릅니다', subcopy: '소재·마감·질감 같은 디테일을 적으세요.', visual: 'Macro close-up of the product texture and finish, shallow depth of field.' },
  usage: { headline: () => '이렇게 사용하세요', subcopy: '사용 순서나 사용 장면을 간단히 적으세요.', bullets: ['1단계', '2단계', '3단계'], visual: 'Hands using the product step by step in a natural home setting, soft daylight.' },
  comparison: { headline: () => '무엇이 다른가요?', subcopy: '비교 기준을 정하고 확인된 차이만 적으세요.', bullets: ['비교 기준 1', '비교 기준 2'], visual: 'Clean side-by-side comparison layout with the product on one side, neutral background.' },
  review: { headline: () => '먼저 써 본 분들의 이야기', subcopy: '실제 후기에서 고른 표현을 짧게 다듬어 적으세요.', bullets: ['후기 1', '후기 2'], visual: 'Warm lifestyle scene suggesting customer satisfaction, product visible in daily use.' },
  trust: { headline: () => '믿을 수 있는 이유', subcopy: '인증·시험·제조 정보 등 확인된 사실만 적으세요.', bullets: ['근거 1', '근거 2'], visual: 'Clean, trustworthy setting such as a bright lab or workshop with the product, orderly composition.' },
  spec: { headline: () => '제품 정보', subcopy: '정확한 사양을 확인해 적으세요.', bullets: ['용량·크기', '소재·성분', '제조·원산지'], visual: 'Product on a plain background with plenty of space for specification text.' },
  composition: { headline: () => '구성 안내', subcopy: '박스 안에 무엇이 들어 있는지 적으세요.', bullets: ['구성품 1', '구성품 2'], visual: 'Neat flat lay of the package contents on a light surface, top-down view.' },
  caution: { headline: () => '구매 전 꼭 확인하세요', subcopy: '사용 시 주의사항이나 맞지 않는 경우를 솔직하게 적으세요.', bullets: ['확인 사항 1', '확인 사항 2'], visual: 'Calm, simple product shot with soft light and a reassuring mood.' },
  offer: { headline: () => '지금 시작해 보세요', subcopy: '구매 혜택·배송·문의 방법 등 행동을 돕는 정보를 적으세요.', visual: 'Product with subtle gift-like presentation, inviting warm light, clean background.' },
  custom: { headline: () => '헤드라인을 적으세요', subcopy: '설명을 적으세요.', visual: 'Simple product scene with clean background.' },
};

// [type, 우선순위(작을수록 먼저 포함), 덮어쓸 문구]
const TEMPLATE_FLOWS = {
  basic: [
    ['hero', 1], ['problem', 2], ['solution', 3], ['feature', 4], ['feature', 8, { label: '두 번째 장점', headline: 'Point. 두 번째 장점을 적으세요' }],
    ['detail', 5], ['usage', 6], ['comparison', 10], ['review', 9], ['composition', 7], ['trust', 11], ['spec', 12],
  ],
  objection: [
    ['hero', 1], ['problem', 2, { label: '망설이는 이유', headline: '이런 점이 걱정되시죠?', bullets: ['걱정 1', '걱정 2', '걱정 3'] }],
    ['trust', 3, { label: '걱정 1 해소', headline: '걱정 1에 대한 답을 적으세요' }],
    ['comparison', 4, { label: '걱정 2 해소', headline: '걱정 2에 대한 답을 적으세요' }],
    ['review', 5, { label: '걱정 3 해소', headline: '먼저 써 본 분들도 같은 걱정을 했습니다' }],
    ['solution', 6], ['spec', 7], ['caution', 8], ['usage', 9], ['trust', 10, { label: '보증·교환 안내', headline: '안심하고 고르실 수 있도록' }],
    ['composition', 11], ['offer', 12],
  ],
  proof: [
    ['hero', 1], ['comparison', 2], ['trust', 3], ['spec', 4], ['review', 5], ['feature', 6], ['detail', 7],
    ['comparison', 8, { label: '선택 기준', headline: '고를 때 이것만 비교하세요' }], ['trust', 9, { label: '추가 근거', headline: '확인된 근거를 하나 더' }],
    ['usage', 10], ['composition', 11], ['offer', 12],
  ],
  scenario: [
    ['hero', 1], ['usage', 2, { label: '아침 장면', headline: '하루의 시작에' }], ['usage', 3, { label: '일상 장면', headline: '바쁜 일상 속에서' }],
    ['usage', 4, { label: '외출 장면', headline: '밖에서도 그대로' }], ['feature', 5], ['detail', 6], ['review', 7],
    ['usage', 8, { label: '특별한 날', headline: '특별한 날에도' }], ['composition', 9], ['spec', 10], ['trust', 11], ['offer', 12],
  ],
  story: [
    ['hero', 1, { label: '주인공의 목표', headline: '고객이 원하는 모습을 한 줄로', subcopy: '고객(주인공)이 이루고 싶은 목표를 적으세요.' }],
    ['problem', 2, { label: '문제', headline: '목표를 가로막는 문제', subcopy: '겉으로 보이는 문제와 그로 인한 감정을 함께 적으세요.' }],
    ['solution', 3, { label: '가이드 등장', headline: (n) => `${n}이(가) 함께합니다`, subcopy: '고객의 마음을 이해한다는 공감과 해결 능력을 보여 주세요.' }],
    ['trust', 9, { label: '가이드의 자격', headline: '믿고 따라올 수 있는 이유' }],
    ['usage', 4, { label: '계획', headline: '간단한 3단계 계획', bullets: ['1단계', '2단계', '3단계'] }],
    ['feature', 8], ['detail', 10],
    ['caution', 7, { label: '실패를 피하기', headline: '이대로 두면 생기는 일', subcopy: '행동하지 않을 때의 손해를 과장 없이 적으세요.' }],
    ['review', 6, { label: '성공 모습', headline: '달라진 하루', subcopy: '제품을 쓴 뒤 고객이 얻는 결과를 그려 주세요.' }],
    ['offer', 5, { label: '행동 촉구', headline: '지금 시작하세요' }],
    ['spec', 11], ['composition', 12],
  ],
  mobile: [
    ['hero', 1], ['feature', 2, { headline: '장점 하나, 짧게' }], ['feature', 3, { label: '두 번째 장점', headline: '두 번째 장점, 짧게' }],
    ['feature', 5, { label: '세 번째 장점', headline: '세 번째 장점, 짧게' }], ['usage', 4], ['review', 6], ['detail', 7], ['composition', 8],
    ['offer', 9], ['spec', 10], ['trust', 11], ['comparison', 12],
  ],
};

/** 추가 정보 첫 줄에서 상품명을 찾는다. */
export function productNameFrom(extraInfo) {
  const text = String(extraInfo || '');
  const m = /상품명\s*[:：]?\s*([^,\n·|]+)/.exec(text);
  if (m) return cut(m[1].trim(), 40, { oneLine: true });
  const first = text.split('\n').map((x) => x.trim()).find(Boolean) || '';
  const chunk = first.split(/[,·|]/)[0].trim();
  return chunk.length <= 40 ? chunk : '';
}

/** 템플릿 순서대로 섹션 초안을 만든다. 문구는 직접 채울 안내 문장이다. */
export function buildTemplateDraft(settings, extraInfo) {
  const st = settings || {};
  const flow = TEMPLATE_FLOWS[st.template] || TEMPLATE_FLOWS.basic;
  const count = Math.round(clampNum(st.count, 3, 12, 7));
  const name = productNameFrom(extraInfo);
  const display = name || '[상품명]';
  const mobile = st.template === 'mobile';
  let picked = flow.map((item, idx) => ({ item, idx })).sort((a, b) => a.item[1] - b.item[1]).slice(0, count);
  while (picked.length < count) picked.push({ item: ['feature', 99], idx: 1000 + picked.length });
  picked = picked.sort((a, b) => a.idx - b.idx);
  const palette = [...DEFAULT_PALETTE];
  const sections = picked.map(({ item }) => {
    const [type, , over = {}] = item;
    const g = GUIDE[type] || GUIDE.custom;
    const pick = (key) => {
      const v = over[key] !== undefined ? over[key] : g[key];
      return typeof v === 'function' ? v(display) : v;
    };
    let subcopy = pick('subcopy') || '';
    let bullets = pick('bullets') || [];
    if (mobile) { subcopy = subcopy.split(/(?<=[.!?])\s/)[0]; bullets = bullets.slice(0, 2); }
    return makeSection({
      type,
      label: over.label || TYPE_LABELS[type],
      headline: pick('headline') || '',
      subcopy,
      bullets,
      visual: g.visual,
      useModel: st.model === 'some' ? ['usage', 'review'].includes(type) : st.model === 'hero' ? type === 'hero' : false,
    }, palette);
  });
  return {
    productName: cut(name, LIMITS.productName, { oneLine: true }),
    summary: '템플릿 초안 (AI 아님) · 안내 문구를 실제 카피로 바꿔 주세요.',
    palette,
    sections,
  };
}

// ---------- 외부 AI 설계 요청문 / 결과 붙여넣기 ----------
const MODEL_LINES = {
  none: '모델(사람) 없이 제품 중심으로만 연출',
  some: '사용 장면이 중요한 섹션 1~3개에만 사람 모델 사용',
  hero: 'hero 섹션에만 사람 모델 사용',
};

/** 원본 앱의 설계 요청문을 그대로 만들고, 사진 첨부 안내를 덧붙인다. */
export function buildPlanningPrompt(dp, imageNames = []) {
  const s = (dp && dp.settings) || defaultDetailPage().settings;
  const tpl = TEMPLATES.find((t) => t.id === s.template) || TEMPLATES[0];
  const names = imageNames.filter(Boolean);
  return [
    '당신은 한국 이커머스 상세페이지 전문 기획자이자 카피라이터입니다.',
    '첨부된 자료(첫 번째 이미지가 대표 제품 이미지)를 분석해서, 1080px 폭 상세페이지의 섹션 구성과 판매 카피를 설계하세요.',
    '구성 방식: ' + tpl.name + ' (' + tpl.desc + ')',
    '섹션 수: 정확히 ' + s.count + '개. 첫 섹션은 hero.',
    '카피 언어: ' + s.lang + '. 이미지 스타일: ' + s.style + '.',
    '모델 사용: ' + (MODEL_LINES[s.model] || MODEL_LINES.none) + '.',
    s.tone ? '요청 톤/제약: ' + s.tone : '',
    dp && dp.extraInfo ? '판매자 추가 정보:\n' + dp.extraInfo : '',
    dp && dp.reviewSummary ? '고객 후기 분석 결과(카피와 섹션에 반영):\n' + dp.reviewSummary : '',
    names.length
      ? '첨부 자료 목록: ' + names.map((n, i) => `[자료 ${i + 1}${i === 0 ? ' · 대표' : ''}] ${n}`).join(', ') + '. (이 사진들을 이 대화에 함께 첨부했습니다.)'
      : '제품 사진은 이 대화에 직접 첨부합니다. 첫 번째 사진이 대표 이미지입니다.',
    '규칙: 자료에서 확인할 수 없는 수치·인증·효능은 지어내지 마세요. 헤드라인은 짧고 강하게(25자 이내), 서브카피는 1~2문장.',
    'visual 필드는 이미지 생성 모델에 줄 영어 장면 묘사입니다: 구도, 배경, 조명, 소품, 제품 배치를 구체적으로. 글자는 포함하지 마세요.',
    '다음 JSON 스키마로만 답하세요:',
    '{"productName":"상품명","category":"카테고리","target":"핵심 타깃","summary":"제품 한 줄 요약","palette":["#hex 메인","#hex 보조","#hex 강조"],',
    '"sections":[{"type":"hero|problem|solution|feature|detail|usage|comparison|review|trust|spec|composition|caution|offer","label":"섹션 역할(한국어 짧게)","headline":"","subcopy":"","bullets":["0~4개 짧은 포인트"],"visual":"English scene description","useModel":false}]}',
  ].filter(Boolean).join('\n');
}

/** 문자열 안의 실제 줄바꿈·탭을 이스케이프하고 끝 쉼표를 지운다 (AI 답변에 흔한 실수). */
function repairJson(s) {
  let out = '', inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') inStr = false;
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** 붙여 넣은 AI 답변에서 JSON 을 꺼내 상세페이지 설계로 정리한다. 실패하면 한국어 오류를 던진다. */
export function parsePlanJson(text) {
  let raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('붙여 넣은 내용이 비어 있습니다.');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) raw = fence[1].trim();
  let data;
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch { /* 아래에서 보정 후 재시도 */ }
    try { return JSON.parse(repairJson(s)); } catch { return undefined; }
  };
  data = tryParse(raw);
  if (data === undefined) {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    const a2 = raw.indexOf('['), b2 = raw.lastIndexOf(']');
    if (a >= 0 && b > a) data = tryParse(raw.slice(a, b + 1));
    if (data === undefined && a2 >= 0 && b2 > a2) data = tryParse(raw.slice(a2, b2 + 1));
  }
  if (data === undefined) throw new Error('붙여 넣은 내용에서 JSON을 찾지 못했습니다. AI 답변의 { 부터 } 까지 전체를 붙여 넣어 주세요.');
  if (Array.isArray(data)) data = { sections: data };
  if (!data || typeof data !== 'object') throw new Error('JSON 형식이 올바르지 않습니다.');
  const list = Array.isArray(data.sections) ? data.sections : [];
  if (!list.length) throw new Error('JSON에 sections(섹션 목록)가 없습니다.');
  const palette = (Array.isArray(data.palette) ? data.palette : [])
    .map((c) => toHex6(typeof c === 'string' ? (c.match(/#[0-9a-fA-F]{3,6}\b/) || [''])[0] : '', null))
    .filter(Boolean)
    .slice(0, LIMITS.palette);
  const sections = list.filter((x) => x && typeof x === 'object').slice(0, LIMITS.sections).map((x) => makeSection({
    type: typeof x.type === 'string' ? x.type.trim().toLowerCase() : 'custom',
    label: x.label, headline: x.headline, subcopy: x.subcopy, bullets: x.bullets, visual: x.visual, useModel: x.useModel === true,
  }, palette));
  if (!sections.length) throw new Error('읽을 수 있는 섹션이 없습니다.');
  const summaryParts = [data.summary, data.category && `카테고리: ${data.category}`, data.target && `타깃: ${data.target}`].filter((v) => typeof v === 'string' && v.trim());
  return {
    productName: cut(data.productName, LIMITS.productName, { oneLine: true }).trim(),
    summary: cut(summaryParts.join(' · '), LIMITS.summary),
    palette,
    sections,
    truncated: list.length > LIMITS.sections,
  };
}

// ---------- 이미지 프롬프트 ----------
export function buildImagePrompt(s, dp, { hasModelImage = false } = {}) {
  const st = (dp && dp.settings) || defaultDetailPage().settings;
  const p = (dp && dp.plan) || {};
  const modelLine = s.useModel
    ? (hasModelImage
      ? 'Include a person modeled on the person in the reference model photo (same face, hair and vibe), naturally using or holding the product.'
      : 'Include a natural-looking Korean model using or holding the product.')
    : 'No people. Product-focused composition.';
  const textLine = st.mode === 'baked'
    ? 'Design this as a finished Korean e-commerce detail page panel with clean, correctly spelled typography integrated into the layout. Text to render exactly:\n' +
      (s.label ? '- small label: "' + s.label + '"\n' : '') + '- headline: "' + s.headline + '"\n' + (s.subcopy ? '- sub copy: "' + s.subcopy + '"\n' : '') +
      (s.bullets.length ? '- points: ' + s.bullets.map((b) => '"' + b + '"').join(', ') + '\n' : '') + 'Do not add any other text.'
    : 'Leave generous clean negative space in the upper area for headline text overlay. Do not render any text, letters, captions, logos or watermarks except what is physically printed on the product.';
  const ratio = ratioOf(st.ratio);
  return [
    'Commercial product detail page section image for an online store (section role: ' + s.label + ', type: ' + s.type + ').',
    'Product: ' + (p.productName || '') + ' — ' + (p.summary || '') + '.',
    'Visual style: ' + st.style + '. Color palette: ' + ((p.palette || []).join(', ') || 'harmonious with the product') + '.',
    'Scene: ' + (s.visual || ''),
    'The product must match the first reference image exactly: same shape, proportions, colors, materials, label design and printed text.',
    modelLine, textLine,
    'High-end commercial photography quality, sharp focus, realistic lighting.',
    'Image size: ' + ratio.size + '.',
  ].join('\n');
}

export function copyTextOf(plan) {
  return (plan.sections || []).map((s, i) => '[' + (i + 1) + '] ' + s.label + '\n' + s.headline + '\n' + s.subcopy + '\n' + s.bullets.map((b) => '- ' + b).join('\n')).join('\n\n');
}

export function sectionFileName(i, s) {
  return String(i + 1).padStart(2, '0') + '_' + (s.type || 'section') + '.png';
}

// ---------- 줄바꿈 ----------
/** measure(text)->width 를 받아 maxW 안에서 줄을 나눈다. */
export function wrapLines(measure, text, maxW) {
  const out = [];
  String(text || '').split('\n').forEach((para) => {
    if (!para) { out.push(''); return; }
    const words = para.split(/(\s+)/);
    let line = '';
    // 한 줄보다 긴 단어는 글자 단위로 나눈다.
    const breakLong = (start) => {
      let buf = '';
      for (const ch of start) {
        if (measure(buf + ch) > maxW && buf) { out.push(buf); buf = ch; } else buf += ch;
      }
      return buf;
    };
    for (const w of words) {
      const test = line + w;
      if (measure(test) <= maxW) line = test;
      else if (!line.trim()) line = breakLong(test.trimStart());
      else {
        out.push(line.trimEnd());
        const next = w.trimStart();
        line = measure(next) > maxW ? breakLong(next) : next;
      }
    }
    out.push(line.trimEnd());
  });
  return out;
}

// ---------- 후기 파일 (CSV/TSV/TXT) ----------
export function detectDelimiter(firstLine) {
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch] += 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

/** 따옴표·줄바꿈이 들어간 칸을 처리하는 CSV/TSV 파서. */
export function parseDelimited(text, delimiter) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const delim = delimiter === undefined ? detectDelimiter(src.split(/\r?\n/)[0] || '') : delimiter;
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQ = true;
    } else if (delim && ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const REVIEW_COL_RE = /후기|리뷰|내용|본문|review|content|comment|text/i;

/** 후기 파일 내용에서 후기 문장 목록을 꺼낸다. */
export function extractReviews(text, fileName = '') {
  const rows = parseDelimited(text);
  if (!rows.length) return { column: '', reviews: [], total: 0 };
  const width = Math.max(...rows.map((r) => r.length));
  let column = '', values;
  if (width <= 1 || /\.txt$/i.test(fileName)) {
    const all = rows.map((r) => r.join(' ').trim());
    const head = !!all[0] && /^(고객\s*)?(후기|리뷰|내용|본문|review|reviews|content|comment|comments|text)(\s*내용)?$/i.test(all[0]);
    column = head ? all[0] : '(한 줄에 후기 하나)';
    values = head ? all.slice(1) : all;
  } else {
    const header = rows[0].map((c) => String(c).trim());
    let col = header.findIndex((c) => REVIEW_COL_RE.test(c));
    if (col < 0) {
      let best = -1;
      for (let c = 0; c < width; c++) {
        const total = rows.slice(1, 51).reduce((s, r) => s + String(r[c] ?? '').length, 0);
        if (total > best) { best = total; col = c; }
      }
    }
    column = header[col] || `${col + 1}번째 열`;
    values = rows.slice(1).map((r) => r[col]);
  }
  const reviews = values.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()).filter((v) => v.length > 4);
  return { column, reviews, total: reviews.length };
}

const PARTICLES = ['에서는', '으로는', '이라서', '이지만', '했는데', '했어요', '합니다', '입니다', '네요', '어요', '아요', '해요', '지만', '에서', '으로', '에게', '한테', '까지', '부터', '처럼', '보다', '은', '는', '이', '가', '을', '를', '에', '로', '와', '과', '도', '만', '의', '요', '고', '게', '서', '다'];
const STOPWORDS = new Set(['정말', '너무', '진짜', '그냥', '조금', '약간', '제품', '상품', '사용', '구매', '그리고', '하지만', '그런데', '있어요', '없어요', '같아요', '이번', '다음', '생각', '그래서', '역시', '완전', '많이', '하나', '이거', '이건', '저는', '제가', '우리', '처음', '그래', '그래도', '항상', '계속', '아주', '매우', '좀', '거의', '다시', '받았', '왔어', '있는', '있고', '하는', '해서', '때문', '정도', '이제', 'the', 'and', 'for', 'this', 'that', 'with', 'was', 'very']);

function stem(token) {
  if (!/[가-힣]/.test(token)) return token.toLowerCase();
  for (const p of PARTICLES) {
    if (token.endsWith(p) && token.length - p.length >= 2) return token.slice(0, token.length - p.length);
  }
  return token;
}

const POSITIVE_RE = /좋|만족|추천|최고|편하|편해|편리|촉촉|빠르|빨라|예쁘|예뻐|가성비|훌륭|깔끔|재구매/;
const NEGATIVE_RE = /아쉽|아쉬|별로|불편|냄새|늦|비싸|실망|불만|안 ?좋|아프|따가|끈적|약해|작아|커요|파손|환불/;

/** 단어 빈도·키워드 규칙만으로 후기를 정리한다 (AI 아님). */
/**
 * 문장의 만족/아쉬움 점수. "끈적임 없이", "냄새 안 나요"처럼 부정 표현 뒤에 없/안이 바로 오면 만족으로 본다.
 * 규칙 기반이며 AI 분석이 아니다.
 */
export function toneOf(sentence) {
  const s = String(sentence || '');
  let pos = 0, neg = 0;
  const negG = new RegExp(NEGATIVE_RE.source, 'g');
  let m;
  while ((m = negG.exec(s))) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 5);
    if (/^[가-힣]{0,2}\s?(없|안 ?나|안 ?나요|덜)/.test(after)) pos += 1; else neg += 1;
  }
  const posG = new RegExp(POSITIVE_RE.source, 'g');
  while (posG.exec(s)) pos += 1;
  return { pos, neg };
}

export function summarizeReviews(reviews) {
  const list = (reviews || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) return '';
  const avg = Math.round(list.reduce((s, r) => s + r.length, 0) / list.length);
  const freq = new Map();
  for (const r of list) {
    for (const t of r.match(/[가-힣]{2,}|[A-Za-z]{3,}/g) || []) {
      const w = stem(t);
      if (w.length < 2 || STOPWORDS.has(w) || STOPWORDS.has(t)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  const top = [...freq.entries()].filter(([, n]) => n >= 2 || list.length < 5).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
  const sentences = [];
  for (const r of list) for (const s of r.split(/(?<=[.!?。！？])\s+|\n+/)) { const t = s.trim(); if (t.length >= 6) sentences.push(t); }
  const short = (t) => ([...t].length > 120 ? [...t].slice(0, 120).join('') + '…' : t);
  const seen = new Set();
  const pickBy = (fn) => {
    const out = [];
    for (const s of sentences) {
      if (out.length >= 5) break;
      if (seen.has(s) || !fn(s)) continue;
      seen.add(s); out.push(short(s));
    }
    return out;
  };
  const neg = pickBy((s) => toneOf(s).neg > 0);
  const pos = pickBy((s) => { const t = toneOf(s); return t.pos > 0 && t.neg === 0; });
  const lines = [
    '[후기 로컬 정리 · AI 아님]',
    `· 분석한 후기: ${list.length}개 (평균 ${avg}자)`,
    `· 자주 나온 표현: ${top.length ? top.map(([w, n]) => `${w}(${n})`).join(', ') : '반복된 표현이 없습니다'}`,
    '',
    '[만족 포인트로 보이는 문장]',
    ...(pos.length ? pos.map((s) => '- ' + s) : ['- 찾지 못했습니다']),
    '',
    '[아쉬움·구매 전 불안으로 보이는 문장]',
    ...(neg.length ? neg.map((s) => '- ' + s) : ['- 찾지 못했습니다']),
    '',
    '※ 단어 빈도와 키워드 규칙으로 고른 결과입니다. 문맥은 직접 확인하고 다듬어 주세요.',
  ];
  return cut(lines.join('\n'), LIMITS.reviewSummary);
}

// ---------- ZIP (무압축 STORE) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * files: [{ name: string, data: Uint8Array|string }] → ZIP 바이트(Uint8Array).
 * 압축하지 않고(STORE) 이름은 UTF-8 플래그(0x0800)로 저장한다.
 */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, date: dd } = dosDateTime(date);
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, dd, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    locals.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, dd, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    centrals.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const total = parts.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
