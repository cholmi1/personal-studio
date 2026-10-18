import { h } from './dom.js';
import { studioApi } from './api.js';

// 입력 중인 키는 메모리에만 존재하며 서버 전송 후 비운다. 브라우저 저장소를 사용하지 않는다.
export function createAiController({ getProjectId, getAssets, addAsset, notify, confirm, openDialog, onChange }) {
  let config = null;
  let settingsOpen = false;
  let generationBusy = false;
  const safeMessage = (err) => String(err?.message || '요청에 실패했습니다.').replace(/(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,})/g, '[비밀 값 숨김]');
  function update(value) { config = value; onChange?.(config); return config; }
  async function refresh() { return update(await studioApi.aiConfig()); }
  function reset() { update(null); }
  function ready(provider) { return !!config?.[provider === 'gemini' ? 'geminiConfigured' : 'openaiConfigured']; }
  async function ensure(provider) {
    if (!config) await refresh();
    if (ready(provider)) return;
    await open();
    if (!ready(provider)) throw new Error((provider === 'gemini' ? 'Gemini' : 'OpenAI') + ' API 키를 먼저 저장해 주세요.');
  }
  async function approve(provider, assetIds, image) {
    const model = provider === 'gemini' ? config.geminiModel : config.imageModel;
    return confirm({ title: image ? '유료 이미지 생성 요청 확인' : 'AI 텍스트 요청 확인', okLabel: image ? '동의하고 이미지 생성' : '동의하고 요청', message:
      (provider === 'gemini' ? 'Google Gemini' : 'OpenAI') + '에 입력 문구와 선택 사진 ' + assetIds.length + '장을 전송합니다. 모델: ' + model + '. API 사용료가 발생할 수 있으며 구독 요금과 별도입니다. 정확한 금액은 제공자 요금표와 사용량에서 확인해 주세요. 일일 횟수 제한은 금액 상한이 아닙니다. 계속할까요?' });
  }
  async function run(provider, args, image) {
    if (generationBusy) throw new Error('이 화면에서 AI 요청이 진행 중입니다. 완료 후 다시 시도해 주세요.');
    const projectId = getProjectId();
    if (!projectId) throw new Error('먼저 작업을 열어 주세요.');
    await ensure(provider);
    const assetIds = [...new Set(args.assetIds || [])];
    const assets = getAssets();
    if (assetIds.some(id => !assets.some(a => a.id === id))) throw new Error('선택 사진이 현재 자료함에 없습니다. 다시 선택해 주세요.');
    if (!await approve(provider, assetIds, image)) return null;
    if (getProjectId() !== projectId) throw new Error('열린 작업이 바뀌었습니다. 새 작업에서 다시 요청해 주세요.');
    generationBusy = true;
    try {
      const result = await (image ? studioApi.aiImage : studioApi.aiGemini)({ ...args, assetIds, projectId });
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
      const keyField = (label, provider) => {
        const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', maxLength: 1024, placeholder: ready(provider) ? '저장됨 · 교체할 때만 새 키 입력' : 'API 키 입력' });
        const remove = h('input', { type: 'checkbox' });
        const wrap = h('section', { class: 'ai-provider' }, h('h3', null, label),
          h('p', { class: 'ai-key-status' }, ready(provider) ? '키 저장됨 (연결·결제·모델 권한은 별도 확인)' : '등록된 키 없음'),
          h('label', { class: 'field' }, h('span', null, label + ' API 키'), input),
          h('label', { class: 'check' }, remove, '저장한 키 삭제 (환경변수 키는 서버에서 제거)'),
          h('p', { class: 'hint' }, '입력값은 가려집니다. 빈칸으로 저장하면 기존 키를 유지합니다.'));
        return {input,remove,wrap};
      };
      geminiKey = keyField('Gemini', 'gemini'); openaiKey = keyField('OpenAI', 'openai');
      const optionField = (label, value, type='text') => {
        const input = h('input', {class:'input', type, value: String(value ?? ''), maxLength: 120, min: type === 'number' ? '0' : undefined, max: type === 'number' ? '1000' : undefined, step: type === 'number' ? '1' : undefined });
        return {input,wrap:h('label',{class:'field'},h('span',null,label),input)};
      };
      const geminiModel=optionField('Gemini 모델',config.geminiModel);
      const imageModel=optionField('이미지 모델',config.imageModel);
      const quality=h('select',{class:'input'},...['low','medium','high','auto'].map(v=>h('option',{value:v,selected:v===config.quality},v)));
      const dailyImages=optionField('하루 이미지 요청 한도',config.dailyImageLimit,'number');
      const dailyText=optionField('하루 텍스트 요청 한도',config.dailyTextLimit,'number');
      const result=h('p',{class:'ai-test-result',role:'status'});
      const usage=h('p',{class:'hint'},'오늘 사용: 이미지 '+(config.usage?.images||0)+'회 / 텍스트 '+(config.usage?.text||0)+'회. 날짜·횟수 기준은 서버에서 관리됩니다.');
      const consent=h('input',{type:'checkbox'});
      const content=h('div',{class:'ai-settings stack'},
        h('p',{class:'ai-warning'},'ChatGPT·Google AI 구독과 API 결제는 별도입니다. 키 확인은 생성 요청을 하지 않습니다. 실제 생성은 문구·사진 외부 전송 및 비용을 매번 확인한 뒤 진행합니다.'),
        h('p',{class:'hint'},'키는 서버에 암호화 보관하며 화면으로 다시 보내거나 브라우저에 저장하지 않습니다. 공유 PC에서는 사용 후 로그아웃하세요.'),
        h('div',{class:'ai-provider-grid'},geminiKey.wrap,openaiKey.wrap),
        h('div',{class:'ai-option-grid'},geminiModel.wrap,imageModel.wrap,h('label',{class:'field'},h('span',null,'이미지 품질'),quality),dailyImages.wrap,dailyText.wrap),
        usage,h('label',{class:'check'},consent,'저장된 키를 해당 AI 제공자에게 보내 연결 확인하는 데 동의합니다.'),
        h('p',{class:'hint'},'새 키는 먼저 저장하세요. 연결 확인은 저장된 키로 모델 목록을 조회하며 실제 생성 성공·잔여 금액을 보장하지 않습니다.'),result);
      await openDialog({title:'AI 연결 설정',content,className:'dialog-wide',initialFocus:'input',actions:[
        {value:'save',label:'설정 저장',variant:'primary'}, {value:'gemini',label:'Gemini 연결 확인'}, {value:'openai',label:'OpenAI 연결 확인'}, {value:'close',label:'닫기',variant:'quiet'}],hideCancel:true,
        onAction:async(value,_form,showError)=>{
          if(value==='close') return;
          try {
            if(value==='save') {
              const images=Number(dailyImages.input.value), text=Number(dailyText.input.value);
              if(!Number.isInteger(images)||images<0||!Number.isInteger(text)||text<0) throw new Error('하루 한도는 0 이상의 정수로 입력해 주세요.');
              await studioApi.aiSaveConfig({geminiKey:geminiKey.input.value.trim(),openaiKey:openaiKey.input.value.trim(),removeGemini:geminiKey.remove.checked,removeOpenai:openaiKey.remove.checked,geminiModel:geminiModel.input.value.trim(),imageModel:imageModel.input.value.trim(),quality:quality.value,dailyImageLimit:images,dailyTextLimit:text});
              geminiKey.input.value=''; openaiKey.input.value=''; geminiKey.remove.checked=false;openaiKey.remove.checked=false;
              await refresh();
              for(const [provider,field] of [['gemini',geminiKey],['openai',openaiKey]]) {
                field.wrap.querySelector('.ai-key-status').textContent=ready(provider)?'키 저장됨 (연결·결제·모델 권한은 별도 확인)':'등록된 키 없음';
                field.input.placeholder=ready(provider)?'저장됨 · 교체할 때만 새 키 입력':'API 키 입력';
              }
              result.textContent='저장했습니다. 연결 확인 후 실제 기능을 테스트해 주세요.';
              notify('AI 설정을 저장했습니다.','success');
            } else {
              if(geminiKey.input.value||openaiKey.input.value||geminiKey.remove.checked||openaiKey.remove.checked) throw new Error('변경한 키를 먼저 저장해 주세요.');
              if(!consent.checked) throw new Error('키 외부 전송 동의를 선택해 주세요.');
              result.textContent='연결 확인 중…';
              const response=await studioApi.aiTest(value);
              const models=Array.isArray(response.models)?response.models:[];
              result.textContent=(value==='gemini'?'Gemini':'OpenAI')+' 연결 확인 완료. 사용 가능 모델: '+(models.length?models.join(', '):'목록 없음');
            }
          } catch(err) { result.textContent='';showError(safeMessage(err)); }
          return false;
        }});
    } catch(err) { notify(safeMessage(err),'error'); }
    finally { if(geminiKey) geminiKey.input.value=''; if(openaiKey) openaiKey.input.value=''; settingsOpen=false; }
  }
  return { get config(){return config;}, ready, refresh, reset, open, gemini:(args)=>run('gemini',args,false), image:(args)=>run('openai',args,true) };
}
