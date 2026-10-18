import { h, formatDate } from './dom.js';
import { icon } from './icons.js';

const META = {
  canvas: { tag: '스케치 → 이미지', details: ['직접 스케치', '화풍 선택', '참조 이미지'] },
  signature: { tag: '텍스트 → 이미지', details: ['프롬프트', '비율·해상도', '배경 심도'] },
  'photo-anime': { tag: '사진 → 애니메이션', details: ['원본 업로드', '애니화', '원본·결과 비교'] },
  'anime-photo': { tag: '애니메이션 → 사진', details: ['원본 업로드', '실사화', '결과 다운로드'] },
  compose: { tag: '참조 이미지 → 새 구성', details: ['멀티 캔버스', '메인 + 참조', '영역 배치'] },
  storyboard: { tag: '이야기 → 장면', details: ['등장인물 참조', '대본 입력', '장면 분할'] },
};
export function renderStudioHome(root, ctx) {
  const recent = ctx.projects.slice(0, 5);
  const tools = h('div', { class: 'studio-tool-grid' }, ...ctx.tools.map((t, i) => {
    const m = META[t.id] || { tag: '창작 도구', details: [] };
    return h('button', { type: 'button', class: 'studio-tool-card', onclick: () => ctx.launch(t.id), 'aria-label': t.name + ' 열기' },
      h('div', { class: 'studio-card-top' }, h('span', { class: 'studio-card-icon' }, icon(t.icon)), h('span', { class: 'studio-card-tag' }, m.tag), h('span', { class: 'studio-card-number' }, String(i + 1).padStart(2, '0'))),
      h('h2', null, t.name), h('p', null, t.desc),
      h('div', { class: 'studio-card-bottom' }, h('span', { class: 'studio-card-details' }, m.details.join(' · ')), icon('send', 'icon-sm')));
  }));
  root.append(h('div', { class: 'studio-home' },
    h('header', { class: 'studio-welcome' },
      h('div', { class: 'studio-welcome-line' }, h('span', { class: 'studio-home-kicker' }, '나만의 이미지 작업실'), h('span', { class: 'studio-local' }, icon('lock','icon-sm'), '개인 작업 공간')),
      h('h1', null, '무엇을 만들어 볼까요?'),
      h('p', null, '만들고 싶은 결과에 맞는 도구를 선택하세요. 입력부터 결과 저장까지, 한 화면에서 작업합니다.')),
    tools,
    h('section', { class: 'studio-extra' }, h('span', { class: 'studio-extra-icon' }, icon('layers')), h('div', null, h('h2', null, '상세페이지 제작'), h('p', null, '기존 제품 자료·템플릿·섹션 편집과 PNG·ZIP 내보내기를 그대로 사용할 수 있습니다.')), h('span', { class: 'studio-extra-tag' }, '추가 기능'), h('button', { class: 'btn', type: 'button', onclick: () => ctx.launch('detail') }, '열기', icon('send','icon-sm'))),
    h('section', { class: 'studio-recent' }, h('div', { class: 'studio-section-head' }, h('h2', null, '최근 작업'), h('span', null, '이 브라우저에 저장한 작업')),
      recent.length ? h('ul', { class: 'studio-recent-list' }, ...recent.map(p => h('li', null, h('button', { type: 'button', onclick: () => ctx.openProject(p.id) }, icon(p.type === 'product' ? 'layers' : p.type === 'story' ? 'scenes' : 'image','icon-sm'), h('span', null, p.title), h('time', null, formatDate(p.updatedAt)), icon('send','icon-sm'))))) : h('div', { class: 'studio-empty' }, icon('folder'), h('div', null, h('strong', null, '아직 저장한 작업이 없습니다.'), h('p', null, '위의 도구를 열면 새 작업이 만들어집니다. 예시 작업은 자동으로 넣지 않습니다.')))),
    h('section', { class: 'studio-safe-note', role: 'note' }, icon('lock','icon-sm'), h('div', null, h('strong', null, '작업은 이 브라우저에만 저장됩니다.'), h('p', null, '서버와 로그인이 없어서 다른 기기에는 자동으로 옮겨지지 않고, 브라우저의 사이트 데이터를 지우면 사라질 수 있습니다. 중요한 작업은 작업 화면의 "정보·메모" 탭에서 백업 파일을 내려받아 보관하세요.'))),
    h('footer', { class: 'studio-home-footer' }, icon('info','icon-sm'), '직접 편집·스케치·장면 분할은 AI 없이 사용할 수 있습니다. AI 생성·변환은 실행 전에 Google·OpenAI로 직접 전송되는 내용과 비용을 확인합니다.')));
}
