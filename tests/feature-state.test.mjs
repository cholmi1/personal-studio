import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, validateState, remapAssetRefs, collectAssetRefs, validateBackup } from '../src/validation.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const state = (canvas) => ({ featureStudio: { canvas } });
const rejects = (value) => assert.throws(() => validateState(value), (error) => error.status === 400 || error.status === 413);

test('legacy state defaults to independent empty feature state; unknown state keys remain strict', () => {
  assert.deepEqual(validateState({}).featureStudio, {});
  assert.deepEqual(validateState({ notes: '기존 메모' }), { ...defaultState(), notes: '기존 메모' });
  const a = defaultState(); a.featureStudio.canvas = {};
  assert.deepEqual(defaultState().featureStudio, {});
  rejects({ unexpected: {} });
});

test('all six hyphenated tools and activeTool round-trip arbitrary bounded JSON without aliasing', () => {
  const featureStudio = { activeTool: 'photo-anime' };
  for (const tool of ['canvas', 'signature', 'photo-anime', 'anime-photo', 'compose', 'storyboard']) {
    featureStudio[tool] = { title: '설정', options: { enabled: true, empty: null, scale: 0.5 }, items: [1, '문자', false] };
  }
  const result = validateState({ featureStudio });
  assert.deepEqual(result.featureStudio, featureStudio);
  result.featureStudio.canvas.options.scale = 2;
  assert.equal(featureStudio.canvas.options.scale, 0.5);
  for (const activeTool of ['detail', null]) assert.equal(validateState({ featureStudio: { activeTool } }).featureStudio.activeTool, activeTool);
  rejects({ featureStudio: { activeTool: 'unknown' } });
  rejects({ featureStudio: { photoAnime: {} } });
  for (const value of [null, [], true, 1, 'text']) {
    rejects({ featureStudio: value });
    rejects(state(value));
  }
});

test('bounded strings, arrays, keys, entries and finite numbers', () => {
  validateState(state({ text: '가'.repeat(20000), entries: Array(40).fill(null), min: -1e8, max: 1e8 }));
  validateState(state(Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['k' + i, i]))));
  validateState(state({ ['k'.repeat(80)]: true }));
  for (const value of [NaN, Infinity, -Infinity, 1e8 + 1, -1e8 - 1, undefined, 1n, () => {}, Symbol('x')]) rejects(state({ value }));
  rejects(state({ text: 'x'.repeat(20001) }));
  rejects(state({ text: 'a\u0000b' }));
  rejects(state({ list: Array(41).fill(0) }));
  rejects(state({ ['k'.repeat(81)]: 0 }));
  rejects(state(Object.fromEntries(Array.from({ length: 81 }, (_, i) => ['k' + i, i]))));
});

test('feature size budget is UTF-8 JSON bytes including keys and punctuation', () => {
  const payload = { a: 'x'.repeat(20000), b: 'x'.repeat(20000), c: 'x'.repeat(20000), d: 'x'.repeat(20000), e: 'x'.repeat(20000), f: '' };
  const remaining = 100 * 1024 - Buffer.byteLength(JSON.stringify({ canvas: payload }));
  payload.f = 'x'.repeat(remaining);
  assert.equal(Buffer.byteLength(JSON.stringify({ canvas: payload })), 100 * 1024);
  validateState(state(payload));
  payload.f += 'x';
  rejects(state(payload));
  rejects(state({ a: '가'.repeat(20000), b: '가'.repeat(20000) }));
});

test('depth 8 allowed; depth 9, circular, exotic, unsafe and accessor shapes rejected', () => {
  let nested = null;
  for (let i = 0; i < 7; i++) nested = { child: nested };
  validateState(state(nested));
  rejects(state({ child: nested }));
  const cycle = {}; cycle.self = cycle; rejects(state(cycle));
  for (const value of [new Date(), new Map(), /x/, new (class Custom {})(), Object.create({ inherited: true })]) rejects(state({ value }));
  for (const key of ['__proto__', 'constructor', 'prototype']) rejects(state(JSON.parse('{"' + key + '":{}}')));
  const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('must not invoke'); } });
  rejects(state(getter));
  rejects(state({ [Symbol('x')]: 1 }));
  rejects(state(Object.defineProperty({}, 'hidden', { value: 1 })));
  rejects(state({ list: Array(1) }));
  const extras = []; extras.custom = 1; rejects(state({ list: extras }));
  const nullPrototype = Object.create(null); nullPrototype.safe = 1;
  assert.deepEqual(validateState(state(nullPrototype)).featureStudio.canvas, { safe: 1 });
});

test('nested UUID references validate, collect and remap missing references consistently', () => {
  const input = state({ baseAssetId: A, assetId: A, emptyAssetId: null, layers: [{ sourceAssetId: B, refIds: [A, B], assetIds: [A, C], imageAssetIds: [C] }] });
  const result = validateState(input);
  assert.deepEqual(collectAssetRefs(result), [A, A, B, A, B, A, C, C]);
  assert.equal(remapAssetRefs(result, (id) => id === A ? C : undefined), result);
  assert.deepEqual(result.featureStudio.canvas, { baseAssetId: C, assetId: C, emptyAssetId: null, layers: [{ sourceAssetId: null, refIds: [C], assetIds: [C], imageAssetIds: [] }] });
  assert.equal(input.featureStudio.canvas.baseAssetId, A);
  for (const value of ['missing', '', 123, {}, []]) rejects(state({ sourceAssetId: value }));
  for (const value of [null, A, [null], ['missing'], [A, 1]]) rejects(state({ refIds: value }));
  rejects(state({ assetIds: ['bad'] }));
  rejects(state({ imageAssetIds: ['bad'] }));
});

test('backup IDs use existing import policy and feature refs cannot reference absent assets', () => {
  const imported = validateState(state({ inputAssetId: 'old-asset', refIds: ['old-asset', 'missing'] }), { allowAnyBaseAssetId: true });
  remapAssetRefs(imported, (id) => id === 'old-asset' ? A : null);
  assert.deepEqual(imported.featureStudio.canvas, { inputAssetId: A, refIds: [A] });
  validateState(imported);
  assert.throws(() => validateBackup({ format: 'personal-studio-backup', version: 1, project: { title: 'backup', state: state({ inputAssetId: 'absent' }) }, assets: [] }), /이미지/);
  const older = defaultState(); delete older.featureStudio;
  assert.equal(remapAssetRefs(older, () => null), older);
});
