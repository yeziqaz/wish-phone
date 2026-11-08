import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeModels, pickKey } from '../src/ai/adapters/openai.ts';
import type { Site, SiteModel } from '../src/core/api-types.ts';

/* ==========================================================================
   拉取模型时的合并规则（设计文档 §6.3）
   只测纯函数，不联网。
   ========================================================================== */

function model(id: string, extra: Partial<SiteModel> = {}): SiteModel {
  return {
    id,
    name: id,
    kinds: ['text'],
    series: 'other',
    enabled: true,
    isPrimary: false,
    manualEdited: { kinds: false, series: false },
    limits: null,
    contextLength: null,
    ...extra,
  };
}

test('新拉下来的模型自动归类能力和系列', () => {
  const merged = mergeModels([], [{ id: 'claude-sonnet-4' }, { id: 'dall-e-3' }, { id: 'whisper-tts' }]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ['claude-sonnet-4', 'dall-e-3', 'whisper-tts'],
  );
  assert.equal(merged[0]?.series, 'claude');
  assert.deepEqual(merged[0]?.kinds, ['text', 'vision']);
  assert.deepEqual(merged[1]?.kinds, ['image']);
  assert.deepEqual(merged[2]?.kinds, ['tts']);
});

test('用户手动改过的能力，重新拉取不许覆盖', () => {
  const previous = [
    model('some-model', {
      kinds: ['image', 'video'],
      manualEdited: { kinds: true, series: false },
    }),
  ];

  const merged = mergeModels(previous, [{ id: 'some-model' }]);

  assert.deepEqual(merged[0]?.kinds, ['image', 'video']);
  assert.equal(merged[0]?.manualEdited.kinds, true);
});

test('用户手动改过的系列同理，但没改过的能力照样重新推断', () => {
  const previous = [
    model('gpt-4o', { series: 'qwen', manualEdited: { kinds: false, series: true } }),
  ];

  const merged = mergeModels(previous, [{ id: 'gpt-4o' }]);

  assert.equal(merged[0]?.series, 'qwen'); // 保住了手动改的
  assert.deepEqual(merged[0]?.kinds, ['text', 'vision']); // 能力照样重新推断
});

test('已经关掉的模型，重新拉取后还是关着的', () => {
  const previous = [model('a', { enabled: false }), model('b', { enabled: true })];
  const merged = mergeModels(previous, [{ id: 'a' }, { id: 'b' }]);

  assert.equal(merged[0]?.enabled, false);
  assert.equal(merged[1]?.enabled, true);
});

test('这次接口没返回的模型直接丢掉，跟着服务端走', () => {
  const previous = [model('still-here'), model('removed-by-server')];
  const merged = mergeModels(previous, [{ id: 'still-here' }]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ['still-here'],
  );
});

test('上下文长度优先用接口返回的，接口没给就沿用旧的', () => {
  const previous = [model('a', { contextLength: 8000 }), model('b', { contextLength: 4000 })];
  const merged = mergeModels(previous, [{ id: 'a', contextLength: 128000 }, { id: 'b' }]);

  assert.equal(merged[0]?.contextLength, 128000);
  assert.equal(merged[1]?.contextLength, 4000);
});

test('挑 Key：跳过停用的和异常的，固定模式认固定那一个', () => {
  const site = {
    keyMode: 'roundrobin',
    fixedKeyId: '',
    keys: [
      { id: 'k1', value: 'sk-off', label: '', enabled: false, abnormal: false },
      { id: 'k2', value: 'sk-bad', label: '', enabled: true, abnormal: true },
      { id: 'k3', value: 'sk-good', label: '', enabled: true, abnormal: false },
    ],
  } as Site;

  assert.equal(pickKey(site), 'sk-good');

  const fixed = { ...site, keyMode: 'fixed', fixedKeyId: 'k1' } as Site;
  // 固定的那个被停用了，就退回第一个能用的
  assert.equal(pickKey(fixed), 'sk-good');

  const noKey = { keyMode: 'roundrobin', fixedKeyId: '', keys: [] } as unknown as Site;
  assert.equal(pickKey(noKey), '');
});