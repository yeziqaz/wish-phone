import assert from 'node:assert/strict';
import test from 'node:test';

import { assignmentsFromBindings, siteFromProvider } from '../src/core/api-migrate.ts';
import type { Provider } from '../src/core/types.ts';

/* ==========================================================================
   老数据搬家（设计文档 §15 步骤 1 的一部分）
   只测纯函数：真往 IndexedDB 里写那一步得在浏览器里看。
   ========================================================================== */

function legacyProvider(): Provider {
  return {
    id: 'p1',
    name: '我的中转站',
    protocol: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiPath: '/chat/completions',
    multiKey: true,
    keyMode: 'rotate',
    keys: [
      { id: 'k1', value: 'sk-aaa', label: '主号', enabled: true, weight: 1, callCount: 0, failCount: 0 },
      { id: 'k2', value: 'sk-bbb', label: '小号', enabled: true, weight: 1, callCount: 0, failCount: 0 },
    ],
    models: [
      { id: 'gpt-4o', displayName: 'GPT-4o', contextLength: 128000, maxOutput: null, enabled: true, source: 'api' },
      { id: 'dall-e-3', displayName: '', contextLength: null, maxOutput: null, enabled: false, source: 'api' },
    ],
    generation: { temperature: 0.8, maxTokens: null, topP: null },
    advanced: {
      stream: true,
      rateLimit: { enabled: true, perMinute: 120 },
      breaker: { enabled: true, failCount: 4, cooldownSec: 60 },
    },
    vendor: 'OpenAI',
    group: '默认分组',
    enabled: true,
    createdAt: 1000,
    updatedAt: 2000,
  } as Provider;
}

test('搬家：站点字段与 Key 一一对应，id 不变（分配还指着它）', () => {
  const site = siteFromProvider(legacyProvider());

  assert.equal(site.id, 'p1');
  assert.equal(site.name, '我的中转站');
  assert.equal(site.url, 'https://api.example.com/v1');
  assert.equal(site.keyMode, 'roundrobin');
  assert.deepEqual(
    site.keys.map((key) => key.value),
    ['sk-aaa', 'sk-bbb'],
  );
  assert.equal(site.keys[0]?.abnormal, false);
  assert.equal(site.siteType, 'relay');
});

test('搬家：模型的能力先忠实保留老的标签，系列自动归类', () => {
  const site = siteFromProvider(legacyProvider());

  // 老结构一个模型只有一个 kind，这里原样搬过来（多标签是步骤 3 拉取模型时重新推断的）
  assert.deepEqual(site.models[0]?.kinds, ['text']);
  assert.equal(site.models[0]?.series, 'gpt');
  assert.equal(site.models[0]?.contextLength, 128000);
  assert.equal(site.models[0]?.manualEdited.kinds, false);
  assert.equal(site.models[1]?.enabled, false);
});

test('搬家：放不下的字段折进备注，不丢', () => {
  const site = siteFromProvider(legacyProvider());

  assert.ok(site.note.includes('OpenAI'));
  assert.ok(site.note.includes('默认分组'));
  // 默认路径不用记，免得噪音
  assert.ok(!site.note.includes('/chat/completions'));
});

test('搬家：限流和熔断换算成新的限制项', () => {
  const site = siteFromProvider(legacyProvider());

  assert.equal(site.limits.rpm, 120);
  assert.equal(site.limits.retry, 4);
  assert.equal(site.limits.overflow, 'queue');
});

test('搬家：multiKey 关掉时用固定 Key，不认识的老 Key 直接跳过', () => {
  const provider = legacyProvider();
  provider.multiKey = false;
  const site = siteFromProvider(provider);

  assert.equal(site.keyMode, 'fixed');
  assert.equal(site.fixedKeyId, 'k1');
});

test('搬家：全局和角色两层分配都搬过来，重复的丢掉', () => {
  const bindings = {
    byKind: { text: { providerId: 'p1', modelId: 'gpt-4o' } },
    characters: {
      c1: { text: { providerId: 'p1', modelId: 'gpt-4o' } },
      c2: { voice: { providerId: 'p1', modelId: 'tts-1' } },
    },
  };

  const assignments = assignmentsFromBindings(bindings as never, new Set(['p1']));

  assert.deepEqual(
    assignments.map((item) => item.id).sort(),
    ['global::text', 'role:c1:text', 'role:c2:tts'],
  );
  // 老的 voice 现在叫 tts
  assert.equal(assignments.find((item) => item.scopeId === 'c2')?.kind, 'tts');
});

test('搬家：指向已经不存在的服务商就跳过，不留悬空记录', () => {
  const bindings = { byKind: { text: { providerId: 'missing', modelId: 'x' } }, characters: {} };
  assert.deepEqual(assignmentsFromBindings(bindings as never, new Set(['p1'])), []);
});
