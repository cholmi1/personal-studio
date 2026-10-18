// node --test tests/model-catalog.test.mjs : 모델 목록, 금액 어림, 무료 기준 안내 검증. 네트워크 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_MODELS, FREE_NOTE, PRICE_AS_OF, findModel, isKnownModel, qualitiesFor, sizeClass, estimateImageCost, modelOptionText } from '../public/model-catalog.js';

test('목록은 6개 모델이고 확인 기준일과 안내문에 같은 날짜가 들어 있다', () => {
  assert.deepEqual(IMAGE_MODELS.map((m) => m.id), ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
  assert.equal(PRICE_AS_OF, '2026-10-18');
  assert.equal(FREE_NOTE.asOf, '2026-10-18');
  assert.equal(FREE_NOTE.title, '무료 기준 안내');
  assert.ok(FREE_NOTE.items.length >= 5);
  assert.ok(FREE_NOTE.items.some((t) => t.startsWith('무료:')) && FREE_NOTE.items.some((t) => t.startsWith('유료:')) && FREE_NOTE.items.some((t) => t.startsWith('조건부 무료:')));
  assert.ok(FREE_NOTE.items.some((t) => /금액 상한이 아닙니다/.test(t)));
  assert.ok(!FREE_NOTE.items.some((t) => /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(t)), '이모지 없음');
});

test('조회 도우미와 품질 목록', () => {
  assert.equal(findModel('gpt-image-1-mini').label, 'GPT Image 1 Mini');
  assert.equal(findModel('nope'), null);
  assert.equal(isKnownModel('gpt-image-2'), true);
  assert.equal(isKnownModel('chatgpt-image-latest'), false);
  assert.deepEqual(qualitiesFor('gpt-image-1'), ['low', 'medium', 'high', 'auto']);
  assert.deepEqual(qualitiesFor('gpt-image-2'), ['low', 'medium', 'high', 'auto']);
  assert.deepEqual(qualitiesFor('gpt-image-2.5-sunburst'), ['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
  assert.deepEqual(qualitiesFor('gpt-image-2.5-flare'), ['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
  assert.deepEqual(qualitiesFor('totally-custom'), ['low', 'medium', 'high', 'auto']);
  // 호출자가 반환 배열을 바꿔도 카탈로그가 오염되지 않는다.
  qualitiesFor('gpt-image-1').push('x');
  assert.equal(findModel('gpt-image-1').qualities.length, 4);
  assert.equal(sizeClass('1024x1024'), 'sq');
  assert.equal(sizeClass('1536x1024'), 'wide');
  assert.equal(sizeClass('1024x1536'), 'wide');
});

const TABLE = {
  'gpt-image-1': { low: [0.011, 0.016], medium: [0.042, 0.063], high: [0.167, 0.25] },
  'gpt-image-1-mini': { low: [0.005, 0.006], medium: [0.011, 0.015], high: [0.036, 0.052] },
  'gpt-image-1.5': { low: [0.009, 0.013], medium: [0.034, 0.05], high: [0.133, 0.2] },
};

test('장당 금액: 모델 3종 x 품질 3종 x 크기 3종 전부 공식 표와 일치', () => {
  for (const [model, qs] of Object.entries(TABLE)) {
    for (const [quality, [sq, wide]] of Object.entries(qs)) {
      assert.equal(estimateImageCost({ model, quality, size: '1024x1024' }).amount, sq, `${model} ${quality} sq`);
      assert.equal(estimateImageCost({ model, quality, size: '1536x1024' }).amount, wide, `${model} ${quality} wide`);
      assert.equal(estimateImageCost({ model, quality, size: '1024x1536' }).amount, wide, `${model} ${quality} tall`);
    }
  }
});

test('금액 문구 형식', () => {
  assert.equal(estimateImageCost({ model: 'gpt-image-1', quality: 'low', size: '1024x1024' }).text, '약 $0.011 (장당, 입력 이미지 비용 별도)');
  assert.equal(estimateImageCost({ model: 'gpt-image-1', quality: 'high', size: '1536x1024' }).text, '약 $0.25 (장당, 입력 이미지 비용 별도)');
  assert.equal(estimateImageCost({ model: 'gpt-image-1.5', quality: 'high', size: '1024x1536' }).text, '약 $0.20 (장당, 입력 이미지 비용 별도)');
  assert.equal(estimateImageCost({ model: 'gpt-image-1.5', quality: 'medium', size: '1024x1536' }).text, '약 $0.05 (장당, 입력 이미지 비용 별도)');
  assert.equal(estimateImageCost({ model: 'gpt-image-1-mini', quality: 'low' }).text, '약 $0.005 (장당, 입력 이미지 비용 별도)');
  const withRef = estimateImageCost({ model: 'gpt-image-1', quality: 'low', size: '1024x1024', refCount: 2 });
  assert.equal(withRef.amount, 0.011);
  assert.ok(withRef.text.includes('참조 이미지 입력 비용 별도'));
});

test('토큰 기준 모델(2, 2.5)은 금액 null 과 공식 계산기 안내', () => {
  for (const model of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
    for (const quality of qualitiesFor(model).filter((q) => q !== 'auto')) {
      const r = estimateImageCost({ model, quality, size: '1024x1024' });
      assert.equal(r.amount, null, `${model} ${quality}`);
      assert.equal(r.text, '토큰 기준 · 장당 금액은 공식 계산기 확인');
    }
  }
  assert.ok(estimateImageCost({ model: 'gpt-image-2', quality: 'low', refCount: 1 }).text.includes('참조 이미지 입력 비용 별도'));
  assert.ok(findModel('gpt-image-2').tokenNote.includes('$30'));
  assert.ok(findModel('gpt-image-2.5-flare').tokenNote.includes('GPT Image 2와 토큰 요금 동일'));
});

test('auto 품질·알 수 없는 모델·지원하지 않는 품질', () => {
  assert.deepEqual(estimateImageCost({ model: 'gpt-image-1', quality: 'auto' }), { amount: null, text: '품질 auto: 금액 미확정' });
  assert.equal(estimateImageCost({ model: 'gpt-image-2', quality: 'auto' }).text, '품질 auto: 금액 미확정');
  assert.ok(estimateImageCost({ model: 'gpt-image-1', quality: 'auto', refCount: 1 }).text.includes('참조 이미지 입력 비용 별도'));
  assert.equal(estimateImageCost({ model: 'chatgpt-image-latest', quality: 'low' }).amount, null);
  assert.ok(/알 수 없는 모델/.test(estimateImageCost({ model: 'chatgpt-image-latest', quality: 'low' }).text));
  assert.equal(estimateImageCost({ model: 'gpt-image-1', quality: 'xhigh' }).amount, null);
  assert.ok(/지원하지 않는 품질/.test(estimateImageCost({ model: 'gpt-image-1', quality: 'xhigh' }).text));
  assert.equal(estimateImageCost({}).amount, null);
});

test('선택 목록 문구: 이름 · 태그 · low 1024² 금액 또는 토큰 기준', () => {
  assert.equal(modelOptionText(findModel('gpt-image-1')), 'GPT Image 1 · 이전 세대 · low 1024² $0.011');
  assert.equal(modelOptionText(findModel('gpt-image-1-mini')), 'GPT Image 1 Mini · 가장 저렴 · low 1024² $0.005');
  assert.equal(modelOptionText(findModel('gpt-image-2')), 'GPT Image 2 · 표준 최신 · 토큰 기준');
  assert.equal(modelOptionText(findModel('gpt-image-2.5-flare')), 'GPT Image 2.5 Flare · 빠른 일상용 · 토큰 기준');
});
