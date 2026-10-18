// 대본 분할 순수 함수 모음 (DOM 없음, AI 아님). 브라우저와 Node 테스트에서 함께 쓴다.

export const MAX_SCENES = 60;

/** 대본 문자열을 조각 배열로 나눈다. mode: 'paragraph' | 'line' | 'sentence' */
export function splitScript(script, mode) {
  const text = String(script || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  let parts;
  if (mode === 'line') {
    parts = text.split('\n');
  } else if (mode === 'sentence') {
    parts = [];
    for (const para of text.split(/\n+/)) {
      const found = para.match(/[^.!?。！？…]+(?:[.!?。！？…]+["'”’)\]]*)?/g) || [];
      parts.push(...found);
    }
  } else {
    parts = text.split(/\n\s*\n+/);
  }
  return parts.map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

/** 조각이 최대 장면 수를 넘으면 순서를 지키며 고르게 묶는다. */
export function groupParts(parts, max = MAX_SCENES) {
  if (parts.length <= max) return parts;
  const size = Math.ceil(parts.length / max);
  const out = [];
  for (let i = 0; i < parts.length; i += size) out.push(parts.slice(i, i + size).join(' '));
  return out;
}

/**
 * 문장 단위로 나눈 뒤, 이어지는 문장을 묶어 정확히 min(n, 문장 수)개의 장면으로 만든다.
 * 각 장면의 글자 수가 비슷해지도록 앞에서부터 균형을 맞춘다. 순서는 바뀌지 않는다.
 */
export function splitIntoCount(script, n) {
  const parts = splitScript(script, 'sentence');
  if (!parts.length) return [];
  const want = Math.max(1, Math.min(MAX_SCENES, Math.floor(Number(n) || 1)));
  const k = Math.min(want, parts.length);
  if (k === parts.length) return parts.slice();
  const lens = parts.map((p) => [...p].length);
  let remaining = lens.reduce((a, b) => a + b, 0);
  const out = [];
  let i = 0;
  for (let g = 0; g < k; g++) {
    const groupsLeft = k - g;
    if (groupsLeft === 1) {
      out.push(parts.slice(i).join(' '));
      break;
    }
    const target = remaining / groupsLeft;
    const group = [parts[i]];
    let len = lens[i];
    i += 1;
    // 남은 그룹마다 최소 한 문장은 남겨 둔다.
    while (parts.length - i > groupsLeft - 1 && len + lens[i] / 2 <= target) {
      group.push(parts[i]);
      len += lens[i];
      i += 1;
    }
    out.push(group.join(' '));
    remaining -= len;
  }
  return out;
}
