// OpenAI 이미지 모델 목록, 장당 금액 어림, 무료 기준 안내. DOM 없는 순수 모듈(node 테스트에서도 불러온다).
// 금액은 모두 USD. 'sq' = 1024x1024, 'wide' = 1536x1024 또는 1024x1536.
// 출처: developers.openai.com/api/docs/models/<모델 ID> (2026-10-18 확인). 요금표는 바뀔 수 있다.

export const PRICE_AS_OF = '2026-10-18';

const STANDARD_QUALITIES = Object.freeze(['low', 'medium', 'high', 'auto']);
const EXTENDED_QUALITIES = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);

const TOKEN_NOTE_2 = '토큰 기준 요금(이미지 출력 100만 토큰당 $30, 이미지 입력 $8). 장당 금액은 품질·크기에 따라 달라 OpenAI 공식 계산기에서 확인';
const TOKEN_NOTE_25 = '토큰 기준 요금(GPT Image 2와 토큰 요금 동일: 이미지 출력 100만 토큰당 $30, 이미지 입력 $8). 장당 금액은 품질·크기에 따라 달라 OpenAI 공식 계산기에서 확인';

export const IMAGE_MODELS = Object.freeze([
  { id: 'gpt-image-1', label: 'GPT Image 1', tag: '이전 세대', qualities: STANDARD_QUALITIES,
    perImage: { low: { sq: 0.011, wide: 0.016 }, medium: { sq: 0.042, wide: 0.063 }, high: { sq: 0.167, wide: 0.25 } } },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', tag: '가장 저렴', qualities: STANDARD_QUALITIES,
    perImage: { low: { sq: 0.005, wide: 0.006 }, medium: { sq: 0.011, wide: 0.015 }, high: { sq: 0.036, wide: 0.052 } } },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', tag: '이전 세대 · 지시 이행 향상', qualities: STANDARD_QUALITIES,
    perImage: { low: { sq: 0.009, wide: 0.013 }, medium: { sq: 0.034, wide: 0.05 }, high: { sq: 0.133, wide: 0.2 } } },
  { id: 'gpt-image-2', label: 'GPT Image 2', tag: '표준 최신', qualities: STANDARD_QUALITIES, perImage: null, tokenNote: TOKEN_NOTE_2 },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', tag: '편집 정밀도 최우선', qualities: EXTENDED_QUALITIES, perImage: null, tokenNote: TOKEN_NOTE_25 },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', tag: '빠른 일상용', qualities: EXTENDED_QUALITIES, perImage: null, tokenNote: TOKEN_NOTE_25 },
]);

export const FREE_NOTE = Object.freeze({
  asOf: PRICE_AS_OF,
  title: '무료 기준 안내',
  items: Object.freeze([
    '무료: 이 앱 자체와 호스팅, 저장·편집·스케치·장면 분할·백업·상세페이지 편집·내보내기·프롬프트 복사(AI 호출 없음).',
    '유료: OpenAI 이미지 모델은 전부 유료이며 무료 구간이 없습니다(공식 모델 문서의 요금제 표에 Free 항목이 없고 gpt-image-1 문서는 Free를 "Not supported"로 표기). 크레딧이 충전된 계정이 필요하고, 금액은 모델·품질·크기에 따라 다릅니다.',
    '조건부 무료: Google Gemini 텍스트 API는 AI Studio에서 무료 구간이 있으나 사용 가능한 모델과 한도는 계정·시점에 따라 다릅니다(제3자 정리 기준 2026-10-10, 새 프로젝트는 2.5 모델을 못 쓸 수 있음). 앱의 AI 연결 설정에서 연결 확인으로 확인하세요.',
    'Gemini 이미지 모델은 유료입니다(제3자 기준). 이 앱은 아직 Gemini 이미지 생성을 지원하지 않습니다.',
    '주의: 앱의 하루 한도는 이 브라우저의 횟수일 뿐 금액 상한이 아닙니다. 실제 금액 상한은 OpenAI 프로젝트의 월 한도로 설정하세요.',
    '요금표는 바뀔 수 있으니 확인 기준일(2026-10-18)을 함께 보세요.',
  ]),
});

export function findModel(id) {
  return IMAGE_MODELS.find((m) => m.id === id) || null;
}
export function isKnownModel(id) {
  return findModel(id) !== null;
}
/** 알 수 없는 모델(직접 입력한 ID)은 표준 품질 4가지만 허용한다. */
export function qualitiesFor(id) {
  const m = findModel(id);
  return m ? [...m.qualities] : [...STANDARD_QUALITIES];
}
export function sizeClass(size) {
  return size === '1024x1024' ? 'sq' : 'wide';
}

function money(n) {
  let s = n.toFixed(3);
  if (s.endsWith('0')) s = s.slice(0, -1);
  return '$' + s;
}

/** 장당 금액 어림. amount 가 null 이면 금액을 확정하지 못한다는 뜻이다. */
export function estimateImageCost({ model, quality, size = '1024x1024', refCount = 0 } = {}) {
  const hint = refCount > 0 ? ' · 참조 이미지 입력 비용 별도' : '';
  const m = findModel(model);
  if (!m) return { amount: null, text: '알 수 없는 모델 · 금액은 OpenAI 요금표에서 확인' + hint };
  if (quality === 'auto') return { amount: null, text: '품질 auto: 금액 미확정' + hint };
  if (!m.qualities.includes(quality)) return { amount: null, text: '이 모델이 지원하지 않는 품질입니다' };
  if (!m.perImage) return { amount: null, text: '토큰 기준 · 장당 금액은 공식 계산기 확인' + hint };
  const row = m.perImage[quality];
  if (!row) return { amount: null, text: '금액 정보 없음 · OpenAI 요금표에서 확인' + hint };
  const amount = row[sizeClass(size)];
  return { amount, text: `약 ${money(amount)} (장당, 입력 이미지 비용 별도)` + (refCount > 0 ? ' · 참조 이미지 입력 비용 별도' : '') };
}

/** 선택 목록용 한 줄 설명: 이름 · 태그 · low 1024² 금액 또는 토큰 기준. */
export function modelOptionText(m) {
  const price = m.perImage ? `low 1024² ${money(m.perImage.low.sq)}` : '토큰 기준';
  return `${m.label} · ${m.tag} · ${price}`;
}
