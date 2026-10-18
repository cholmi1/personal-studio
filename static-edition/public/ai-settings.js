import { h, clear } from './dom.js';
import { aiConfig, aiSaveConfig, aiTest, aiGemini, aiImage } from './ai-client.js';
import { IMAGE_MODELS, FREE_NOTE, findModel, isKnownModel, qualitiesFor, estimateImageCost, modelOptionText } from './model-catalog.js';

// 키는 이 브라우저의 설정 저장소(작업 데이터와 분리)에만 보관한다. 호출 때만 Google/OpenAI로 직접 전송한다.
export function createAiController({ getProjectId, getAssets, addAsset, notify, confirm, openDialog, onChange }) {
  let config = null;
  let settingsOpen = false;
  let generationBusy = false;
  const safeMessage = (err) => String(err?.message || '요청에 실패했습니다.').replace(/(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,})/g, '[비밀 값 숨김]');
  function update(value) { config = value; onChange?.(config); return config; }
  async function refresh() { return update(await aiConfig()); }
  function reset() { update(null); }
  function ready(provider) { return !!config?.[provider === 'gemini' ? 'geminiConfigured' : 'openaiConfigured']; }
  async function ensure(provider) {
    if (!config) await refresh();
    if (ready(provider)) return;
    await open();
    if (!ready(provider)) throw new Error((provider === 'gemini' ? 'Gemini' : 'OpenAI') + ' API 키를 먼저 저장해 주세요.');
  }
  // 이미지 요청은 실제로 보낼 모델·품질·크기와 금액 어림을 함께 보여 준다(저장된 기본값이 아니라 이번 요청의 선택).
  function imageChoice(args) {
    const model = args.model || config.imageModel;
    const allowed = qualitiesFor(model);
    const quality = args.quality || (allowed.includes(config.quality) ? config.quality : 'low');
    const size = args.size || '1024x1024';
    return { model, quality, size };
  }
  async function approve(provider, assetIds, image, args = {}) {
    const who = provider === 'gemini' ? 'Google Gemini' : 'OpenAI';
    const transfer = who + '에 입력 문구와 선택 사진 ' + assetIds.length + '장을 이 브라우저에서 직접 전송합니다. ';
    const tail = 'API 사용료가 발생할 수 있으며 구독 요금과 별도입니다. 정확한 금액은 제공자 요금표와 사용량에서 확인해 주세요. 일일 횟수 제한은 금액 상한이 아닙니다. 계속할까요?';
    if (!image) {
      return confirm({ title: 'AI 텍스트 요청 확인', okLabel: '동의하고 요청', message: transfer + '모델: ' + config.geminiModel + '. ' + tail });
    }
    const c = imageChoice(args);
    const est = estimateImageCost({ model: c.model, quality: c.quality, size: c.size, refCount: assetIds.length });
    return confirm({ title: '유료 이미지 생성 요청 확인', okLabel: '동의하고 이미지 생성', message:
      transfer + '모델: ' + c.model + ' · 품질: ' + c.quality + ' · 크기: ' + c.size.replace('x', '×') + ' · 예상 금액: ' + est.text + '. 이 모델은 무료 구간이 없는 유료 요청입니다. ' + tail });
  }
  async function run(provider, args, image) {
    if (generationBusy) throw new Error('이 화면에서 AI 요청이 진행 중입니다. 완료 후 다시 시도해 주세요.');
    const projectId = getProjectId();
    if (!projectId) throw new Error('먼저 작업을 열어 주세요.');
    await ensure(provider);
    const assetIds = [...new Set(args.assetIds || [])];
    const assets = getAssets();
    if (assetIds.some(id => !assets.some(a => a.id === id))) throw new Error('선택 사진이 현재 자료함에 없습니다. 다시 선택해 주세요.');
    if (!await approve(provider, assetIds, image, args)) return null;
    if (getProjectId() !== projectId) throw new Error('열린 작업이 바뀌었습니다. 새 작업에서 다시 요청해 주세요.');
    generationBusy = true;
    try {
      const result = await (image ? aiImage : aiGemini)({ ...args, assetIds, projectId });
      if (result.usage && config) update({ ...config, usage: result.usage });
      if (getProjectId() !== projectId) {
        if (image) notify('이미지는 원래 작업의 자료함에 저장됐습니다. 해당 작업을 다시 열어 확인해 주세요.', 'success');
        throw new Error('작업이 바뀌어 현재 화면에는 AI 결과를 적용하지 않았습니다.');
      }
      if (image && result.asset) addAsset(result.asset);
      return result;
    } finally { generationBusy = false; }
  }
  async function open() {
    if (settingsOpen) return;
    settingsOpen = true;
    let geminiKey, openaiKey;
    try {
      await refresh();
      const sourceText = (provider) => {
        const src = config?.[provider + 'Source'];
        return src === 'session' ? '키가 이 탭 세션에만 있습니다 (탭을 닫으면 사라짐)' : '키가 이 브라우저에 저장되어 있습니다 (연결·결제·모델 권한은 별도 확인)';
      };
      const keyField = (label, provider) => {
        const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', maxLength: 512, placeholder: ready(provider) ? '저장됨 · 교체할 때만 새 키 입력' : 'API 키 입력' });
        const remove = h('input', { type: 'checkbox' });
        const wrap = h('section', { class: 'ai-provider' }, h('h3', null, label),
          h('p', { class: 'ai-key-status' }, ready(provider) ? sourceText(provider) : '등록된 키 없음'),
          h('label', { class: 'field' }, h('span', null, label + ' API 키'), input),
          h('label', { class: 'check' }, remove, '이 키 삭제'),
          h('p', { class: 'hint' }, '입력값은 가려집니다. 빈칸으로 저장하면 기존 키를 유지합니다.'));
        return { input, remove, wrap };
      };
      geminiKey = keyField('Gemini', 'gemini'); openaiKey = keyField('OpenAI', 'openai');
      const optionField = (label, value, type = 'text') => {
        const input = h('input', { class: 'input', type, value: String(value ?? ''), maxLength: 120, min: type === 'number' ? '0' : undefined, max: type === 'number' ? '1000' : undefined, step: type === 'number' ? '1' : undefined });
        return { input, wrap: h('label', { class: 'field' }, h('span', null, label), input) };
      };
      const geminiModel = optionField('Gemini 모델', config.geminiModel);
      // 이미지 모델: 목록에서 고르거나 '직접 입력'으로 다른 ID를 적는다. 품질 목록은 선택한 모델이 지원하는 것만 보여 준다.
      const knownNow = isKnownModel(config.imageModel);
      const modelSelect = h('select', { class: 'input', 'aria-label': '이미지 모델' },
        ...IMAGE_MODELS.map(m => h('option', { value: m.id, selected: m.id === config.imageModel }, modelOptionText(m))),
        h('option', { value: '__custom', selected: !knownNow }, '직접 입력(다른 모델 ID)'));
      const customModel = h('input', { class: 'input', type: 'text', maxLength: 100, 'aria-label': '이미지 모델 ID 직접 입력', placeholder: '예: chatgpt-image-latest', value: knownNow ? '' : config.imageModel, hidden: knownNow });
      const imageModel = { wrap: h('div', { class: 'field ai-model-field' }, h('span', null, '이미지 모델'), modelSelect, customModel) };
      const currentModel = () => (modelSelect.value === '__custom' ? customModel.value.trim() : modelSelect.value);
      const quality = h('select', { class: 'input', 'aria-label': '이미지 품질' });
      const costHint = h('p', { class: 'hint ai-cost-hint', role: 'status' });
      const refreshQuality = () => {
        const model = currentModel();
        const allowed = qualitiesFor(model);
        const keep = allowed.includes(quality.value) ? quality.value : (allowed.includes(config.quality) ? config.quality : 'low');
        clear(quality);
        for (const v of allowed) quality.append(h('option', { value: v, selected: v === keep }, v));
        const est = estimateImageCost({ model, quality: quality.value, size: '1024x1024' });
        const m = findModel(model);
        costHint.textContent = '1024×1024 기준 예상: ' + est.text + (m && m.tokenNote ? ' · ' + m.tokenNote : '') + (m ? '' : ' · 목록에 없는 모델이라 금액을 어림하지 못합니다.');
      };
      modelSelect.addEventListener('change', () => { customModel.hidden = modelSelect.value !== '__custom'; refreshQuality(); });
      customModel.addEventListener('input', refreshQuality);
      quality.addEventListener('change', refreshQuality);
      quality.value = config.quality;
      refreshQuality();
      const freeNote = h('section', { class: 'ai-free-note', 'aria-label': FREE_NOTE.title },
        h('h3', null, FREE_NOTE.title, h('span', { class: 'ai-free-asof' }, ' · 확인 기준일 ' + FREE_NOTE.asOf)),
        h('ul', null, ...FREE_NOTE.items.map(t => h('li', null, t))));
      const dailyImages = optionField('하루 이미지 요청 한도', config.dailyImageLimit, 'number');
      const dailyText = optionField('하루 텍스트 요청 한도', config.dailyTextLimit, 'number');
      const result = h('p', { class: 'ai-test-result', role: 'status' });
      const usage = h('p', { class: 'hint' }, '오늘 사용: 이미지 ' + (config.usage?.images || 0) + '회 / 텍스트 ' + (config.usage?.text || 0) + '회. 이 브라우저에서 센 한국시간 기준 횟수이며, 다른 기기나 브라우저의 사용량은 합산되지 않습니다.');
      const remember = h('input', { type: 'checkbox', checked: config.rememberKeys !== false });
      const consent = h('input', { type: 'checkbox' });
      const content = h('div', { class: 'ai-settings stack' },
        h('p', { class: 'ai-warning' }, 'ChatGPT·Google AI 구독과 API 결제는 별도입니다. 키 확인은 생성 요청을 하지 않습니다. 실제 생성은 문구·사진이 Google 또는 OpenAI로 직접 전송되며 비용이 발생할 수 있어 매번 확인한 뒤 진행합니다.'),
        h('p', { class: 'ai-warning ai-risk' }, '키는 이 브라우저에만 저장되며 암호화되지 않습니다. 이 브라우저 프로필을 쓰는 다른 사람이나 악성 확장 프로그램이 읽을 수 있습니다. 제공자 화면에서 사용 한도(예산)를 정한 제한 키를 만들어 쓰고, 공용 PC에서는 사용하지 마세요. 작업 백업과 앱 소스에는 키가 들어가지 않습니다.'),
        h('div', { class: 'ai-provider-grid' }, geminiKey.wrap, openaiKey.wrap),
        h('label', { class: 'check' }, remember, '이 브라우저에 키 기억하기 (끄면 이 탭을 닫을 때 키가 사라집니다)'),
        h('div', { class: 'ai-option-grid' }, geminiModel.wrap, imageModel.wrap, h('label', { class: 'field' }, h('span', null, '이미지 품질(기본값)'), quality), dailyImages.wrap, dailyText.wrap),
        costHint, freeNote,
        usage, h('label', { class: 'check' }, consent, '저장된 키를 해당 AI 제공자(Google 또는 OpenAI)에게 직접 보내 연결 확인하는 데 동의합니다.'),
        h('p', { class: 'hint' }, '새 키는 먼저 저장하세요. 연결 확인은 저장된 키로 모델 목록을 조회하며 실제 생성 성공·잔여 금액을 보장하지 않습니다.'), result);
      await openDialog({ title: 'AI 연결 설정', content, className: 'dialog-wide', initialFocus: 'input', actions: [
        { value: 'save', label: '설정 저장', variant: 'primary' }, { value: 'gemini', label: 'Gemini 연결 확인' }, { value: 'openai', label: 'OpenAI 연결 확인' }, { value: 'forget', label: '저장된 키 모두 삭제' }, { value: 'close', label: '닫기', variant: 'quiet' }], hideCancel: true,
        onAction: async (value, _form, showError) => {
          if (value === 'close') return;
          const syncStatus = () => {
            for (const [provider, field] of [['gemini', geminiKey], ['openai', openaiKey]]) {
              field.wrap.querySelector('.ai-key-status').textContent = ready(provider) ? sourceText(provider) : '등록된 키 없음';
              field.input.placeholder = ready(provider) ? '저장됨 · 교체할 때만 새 키 입력' : 'API 키 입력';
            }
          };
          try {
            if (value === 'save') {
              const images = Number(dailyImages.input.value), text = Number(dailyText.input.value);
              if (!Number.isInteger(images) || images < 0 || !Number.isInteger(text) || text < 0) throw new Error('하루 한도는 0 이상의 정수로 입력해 주세요.');
              update(await aiSaveConfig({ geminiKey: geminiKey.input.value.trim(), openaiKey: openaiKey.input.value.trim(), removeGemini: geminiKey.remove.checked, removeOpenai: openaiKey.remove.checked, rememberKeys: remember.checked, geminiModel: geminiModel.input.value.trim(), imageModel: currentModel(), quality: quality.value, dailyImageLimit: images, dailyTextLimit: text }));
              geminiKey.input.value = ''; openaiKey.input.value = ''; geminiKey.remove.checked = false; openaiKey.remove.checked = false;
              syncStatus();
              result.textContent = '저장했습니다. 연결 확인 후 실제 기능을 테스트해 주세요.';
              notify('AI 설정을 저장했습니다.', 'success');
            } else if (value === 'forget') {
              if (!await confirm({ title: '저장된 키 삭제', message: '이 브라우저에 저장된 Gemini·OpenAI 키를 모두 지웁니다. 모델·한도 설정과 작업 데이터는 유지됩니다. 계속할까요?', okLabel: '키 삭제', danger: true })) return false;
              update(await aiSaveConfig({ removeGemini: true, removeOpenai: true }));
              geminiKey.input.value = ''; openaiKey.input.value = '';
              syncStatus();
              result.textContent = '저장된 키를 모두 삭제했습니다.';
              notify('저장된 AI 키를 삭제했습니다.', 'success');
            } else {
              if (geminiKey.input.value || openaiKey.input.value || geminiKey.remove.checked || openaiKey.remove.checked) throw new Error('변경한 키를 먼저 저장해 주세요.');
              if (!consent.checked) throw new Error('키 외부 전송 동의를 선택해 주세요.');
              result.textContent = '연결 확인 중…';
              const response = await aiTest(value);
              const models = Array.isArray(response.models) ? response.models : [];
              result.textContent = (value === 'gemini' ? 'Gemini' : 'OpenAI') + ' 연결 확인 완료. 사용 가능 모델: ' + (models.length ? models.join(', ') : '목록 없음');
            }
          } catch (err) { result.textContent = ''; showError(safeMessage(err)); }
          return false;
        } });
    } catch (err) { notify(safeMessage(err), 'error'); }
    finally { if (geminiKey) geminiKey.input.value = ''; if (openaiKey) openaiKey.input.value = ''; settingsOpen = false; }
  }
  return { get config() { return config; }, ready, refresh, reset, open, gemini: (args) => run('gemini', args, false), image: (args) => run('openai', args, true) };
}
