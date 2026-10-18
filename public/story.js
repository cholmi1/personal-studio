// 대본 · 장면(스토리보드) 편집. 장면 분할은 브라우저 안의 단순 규칙이며 AI 가 아니다.
import { h, clear, uid } from './dom.js';
import { icon } from './icons.js';

export const MAX_SCRIPT = 40000;
export const MAX_SCENES = 60;

/** 순수 함수: 대본 문자열을 조각 배열로 나눈다. */
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

function estimateSeconds(text) {
  // 낭독 시간 단순 추정: 공백 제외 글자 약 7자/초, 최소 2초
  const chars = String(text).replace(/\s/g, '').length;
  return Math.max(2, Math.round(chars / 7));
}

function titleFrom(text, index) {
  const first = String(text).split(/[.!?。！？\n]/)[0].trim();
  if (!first) return `장면 ${index + 1}`;
  return first.length > 24 ? first.slice(0, 24) + '…' : first;
}

export function makeScene(text = '', index = 0) {
  return {
    id: uid('scene'),
    title: text ? titleFrom(text, index) : `장면 ${index + 1}`,
    narration: text,
    prompt: '',
    duration: text ? estimateSeconds(text) : 4,
  };
}

/**
 * @param {HTMLElement} root
 * @param {{ getState: () => any, markDirty: () => void, notify: Function, choose: Function, confirm: Function, sendToCanvas: (text: string) => void, aiBlocked: Function }} ctx
 */
export function renderStory(root, ctx) {
  clear(root);
  const story = ctx.getState().story;

  // ---------- 대본 영역 ----------
  const count = h('span', { class: 'counter', 'aria-live': 'polite' });
  const scriptArea = h('textarea', {
    id: 'script-input',
    class: 'script-input',
    value: story.script || '',
    maxLength: MAX_SCRIPT,
    rows: 16,
    placeholder: '여기에 대본이나 이야기 초안을 적어 보세요.\n\n빈 줄로 단락을 나누면 장면 나누기가 쉬워집니다.',
    spellcheck: 'false',
  });
  const updateCount = () => {
    count.textContent = `${scriptArea.value.length.toLocaleString('ko-KR')} / ${MAX_SCRIPT.toLocaleString('ko-KR')}자`;
  };
  updateCount();
  scriptArea.addEventListener('input', () => {
    story.script = scriptArea.value;
    updateCount();
    ctx.markDirty();
  });

  const modeSelect = h('select', { id: 'split-mode', class: 'input' },
    h('option', { value: 'paragraph' }, '빈 줄(단락)마다'),
    h('option', { value: 'line' }, '줄바꿈마다'),
    h('option', { value: 'sentence' }, '문장마다'),
  );

  const splitBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: doSplit },
    icon('scissors'), h('span', null, '로컬 분할 (AI 아님)'));

  const scriptPanel = h('section', { class: 'panel story-script', 'aria-labelledby': 'script-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'script-heading', class: 'panel-title' }, icon('pen'), '대본'),
      count,
    ),
    h('label', { class: 'sr-only', htmlFor: 'script-input' }, '대본 입력'),
    scriptArea,
    h('div', { class: 'split-bar' },
      h('div', { class: 'field inline' },
        h('label', { htmlFor: 'split-mode' }, '나누는 기준'),
        modeSelect,
      ),
      splitBtn,
    ),
    h('p', { class: 'hint' }, icon('info', 'icon-sm'),
      '이 버튼은 브라우저에서 정해진 규칙(빈 줄·줄바꿈·문장부호)으로만 나눕니다. 내용을 새로 쓰거나 요약하지 않으며 외부로 전송하지 않습니다.'),
    h('div', { class: 'ai-row' },
      h('button', { type: 'button', class: 'btn btn-ai', 'aria-disabled': 'true', onclick: () => ctx.aiBlocked('대본 AI 작성') },
        icon('plug'), h('span', null, 'AI 대본 다듬기'), h('span', { class: 'badge badge-off' }, 'AI 미연결')),
    ),
  );

  // ---------- 장면 목록 ----------
  const sceneList = h('ol', { class: 'scene-list', 'aria-label': '장면 목록' });
  const totals = h('span', { class: 'counter' });
  const addBtn = h('button', { type: 'button', class: 'btn', onclick: addScene }, icon('plus'), h('span', null, '장면 추가'));

  const scenesPanel = h('section', { class: 'panel story-scenes', 'aria-labelledby': 'scenes-heading' },
    h('div', { class: 'panel-head' },
      h('h2', { id: 'scenes-heading', class: 'panel-title' }, icon('scenes'), '장면'),
      totals,
    ),
    sceneList,
    h('div', { class: 'scene-actions' }, addBtn),
  );

  root.append(h('div', { class: 'story-grid' }, scriptPanel, scenesPanel));

  function updateTotals() {
    const total = story.scenes.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
    const m = Math.floor(total / 60);
    const s = Math.round((total % 60) * 10) / 10;
    totals.textContent = `${story.scenes.length}개 · 예상 ${m ? `${m}분 ` : ''}${s}초`;
    addBtn.disabled = story.scenes.length >= MAX_SCENES;
  }

  async function doSplit() {
    const parts = splitScript(story.script, modeSelect.value);
    if (!parts.length) {
      ctx.notify('나눌 대본이 없습니다. 먼저 대본을 입력해 주세요.', 'error');
      scriptArea.focus();
      return;
    }
    let mode = 'replace';
    if (story.scenes.length) {
      mode = await ctx.choose({
        title: '이미 장면이 있습니다',
        message: `대본에서 ${parts.length}개의 조각을 찾았습니다. 기존 장면 ${story.scenes.length}개를 어떻게 할까요?`,
        choices: [
          { value: 'append', label: '뒤에 이어 붙이기' },
          { value: 'replace', label: '기존 장면 바꾸기', variant: 'danger' },
        ],
      });
      if (!mode) return;
    }
    const room = mode === 'append' ? MAX_SCENES - story.scenes.length : MAX_SCENES;
    if (room <= 0) {
      ctx.notify(`장면은 최대 ${MAX_SCENES}개까지 만들 수 있습니다.`, 'error');
      return;
    }
    const grouped = groupParts(parts, room);
    const base = mode === 'append' ? story.scenes.length : 0;
    const created = grouped.map((p, i) => makeScene(p, base + i));
    story.scenes = mode === 'append' ? story.scenes.concat(created) : created;
    ctx.markDirty();
    renderScenes();
    if (grouped.length < parts.length) {
      ctx.notify(`조각 ${parts.length}개를 장면 ${grouped.length}개로 묶었습니다. (최대 ${MAX_SCENES}개)`, 'info');
    } else {
      ctx.notify(`로컬 규칙으로 장면 ${created.length}개를 만들었습니다. 저장해야 서버에 보관됩니다.`, 'info');
    }
  }

  function addScene() {
    if (story.scenes.length >= MAX_SCENES) return;
    story.scenes.push(makeScene('', story.scenes.length));
    ctx.markDirty();
    renderScenes();
    const last = sceneList.lastElementChild;
    last && last.querySelector('input')?.focus();
  }

  function move(index, delta, focusSel) {
    const to = index + delta;
    if (to < 0 || to >= story.scenes.length) return;
    const [item] = story.scenes.splice(index, 1);
    story.scenes.splice(to, 0, item);
    ctx.markDirty();
    renderScenes();
    const card = sceneList.children[to];
    const target = card && (card.querySelector(focusSel) || card.querySelector('button'));
    if (target && !target.disabled) target.focus();
    else card?.querySelector('input')?.focus();
  }

  async function removeScene(index) {
    const scene = story.scenes[index];
    const hasText = scene.narration || scene.prompt;
    if (hasText) {
      const ok = await ctx.confirm({ title: '장면 삭제', message: `"${scene.title || `장면 ${index + 1}`}" 장면을 삭제할까요? 저장하기 전까지는 서버에 반영되지 않습니다.`, okLabel: '삭제', danger: true });
      if (!ok) return;
    }
    story.scenes.splice(index, 1);
    ctx.markDirty();
    renderScenes();
    const next = sceneList.children[Math.min(index, story.scenes.length - 1)];
    (next ? next.querySelector('input') : addBtn).focus();
  }

  let dragIndex = -1;

  function renderScenes() {
    clear(sceneList);
    if (!story.scenes.length) {
      sceneList.append(h('li', { class: 'empty-note' },
        icon('scenes', 'icon-lg'),
        h('p', null, '아직 장면이 없습니다.'),
        h('p', { class: 'muted' }, '대본을 적고 "로컬 분할 (AI 아님)"을 누르거나, 장면을 직접 추가하세요.'),
      ));
    }
    story.scenes.forEach((scene, i) => {
      const titleId = `scene-title-${scene.id}`;
      const titleInput = h('input', { id: titleId, class: 'input scene-title', value: scene.title || '', maxLength: 120, placeholder: `장면 ${i + 1}` });
      titleInput.addEventListener('input', () => { scene.title = titleInput.value; ctx.markDirty(); });

      const narr = h('textarea', { class: 'input', rows: 3, value: scene.narration || '', maxLength: 4000, placeholder: '내레이션 · 대사' });
      narr.addEventListener('input', () => { scene.narration = narr.value; ctx.markDirty(); });

      const prompt = h('textarea', { class: 'input', rows: 2, value: scene.prompt || '', maxLength: 2000, placeholder: '화면 구상 메모 (어떤 그림·사진을 쓸지)' });
      prompt.addEventListener('input', () => { scene.prompt = prompt.value; ctx.markDirty(); });

      const dur = h('input', { class: 'input dur-input', type: 'number', min: 0, max: 600, step: 0.5, value: String(scene.duration ?? 0), inputmode: 'decimal' });
      dur.addEventListener('input', () => {
        const v = Number(dur.value);
        scene.duration = Number.isFinite(v) ? Math.min(600, Math.max(0, v)) : 0;
        ctx.markDirty();
        updateTotals();
      });

      const narrId = `scene-narr-${scene.id}`;
      const promptId = `scene-prompt-${scene.id}`;
      const durId = `scene-dur-${scene.id}`;
      narr.id = narrId; prompt.id = promptId; dur.id = durId;

      const handle = h('span', { class: 'drag-handle', title: '끌어서 순서 바꾸기', 'aria-hidden': 'true', draggable: true }, icon('grip'));
      const card = h('li', { class: 'scene-card', dataset: { index: String(i) } },
        h('div', { class: 'scene-head' },
          handle,
          h('span', { class: 'scene-num', 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')),
          h('label', { class: 'sr-only', htmlFor: titleId }, `장면 ${i + 1} 제목`),
          titleInput,
          h('div', { class: 'scene-tools' },
            h('button', { type: 'button', class: 'icon-btn mv-up', 'aria-label': `장면 ${i + 1} 위로`, disabled: i === 0, onclick: () => move(i, -1, '.mv-up') }, icon('up')),
            h('button', { type: 'button', class: 'icon-btn mv-down', 'aria-label': `장면 ${i + 1} 아래로`, disabled: i === story.scenes.length - 1, onclick: () => move(i, 1, '.mv-down') }, icon('down')),
            h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': `장면 ${i + 1} 삭제`, onclick: () => removeScene(i) }, icon('trash')),
          ),
        ),
        h('div', { class: 'scene-body' },
          h('div', { class: 'field' }, h('label', { htmlFor: narrId }, '내레이션'), narr),
          h('div', { class: 'field' }, h('label', { htmlFor: promptId }, '화면 메모'), prompt),
          h('div', { class: 'scene-foot' },
            h('div', { class: 'field inline' }, h('label', { htmlFor: durId }, icon('clock', 'icon-sm'), '계획 길이(초)'), dur),
            h('div', { class: 'scene-foot-btns' },
              h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: () => ctx.sendToCanvas(scene.title || scene.narration || '') },
                icon('send', 'icon-sm'), h('span', null, '제목을 캔버스 문구로')),
              h('button', { type: 'button', class: 'btn btn-ai btn-sm', 'aria-disabled': 'true', onclick: () => ctx.aiBlocked('장면 이미지 생성') },
                icon('plug', 'icon-sm'), h('span', null, '이미지 생성'), h('span', { class: 'badge badge-off' }, 'AI 미연결')),
            ),
          ),
        ),
      );

      handle.addEventListener('dragstart', (e) => {
        dragIndex = i;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        try { e.dataTransfer.setDragImage(card, 24, 24); } catch { /* 일부 브라우저 미지원 */ }
      });
      handle.addEventListener('dragend', () => { card.classList.remove('dragging'); dragIndex = -1; });
      card.addEventListener('dragover', (e) => {
        if (dragIndex < 0) return;
        e.preventDefault();
        card.classList.add('drop-target');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drop-target');
        if (dragIndex < 0 || dragIndex === i) return;
        const [item] = story.scenes.splice(dragIndex, 1);
        story.scenes.splice(i, 0, item);
        dragIndex = -1;
        ctx.markDirty();
        renderScenes();
      });

      sceneList.append(card);
    });
    updateTotals();
  }

  renderScenes();
}
