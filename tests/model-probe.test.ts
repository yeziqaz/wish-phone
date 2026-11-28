import assert from 'node:assert/strict';
import test from 'node:test';

import { probeModel, probeModels } from '../src/ai/adapters/openai.ts';
import type { Site, SiteModel } from '../src/core/api-types.ts';

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

function requestSite(extra: Partial<Site> = {}): Site {
  return {
    id: 'site-1',
    name: 'Test Site',
    siteType: 'relay',
    protocol: 'openai',
    url: 'https://example.invalid/v1',
    keys: [{ id: 'k1', value: 'test-key', label: '', enabled: true, abnormal: false }],
    keyMode: 'roundrobin',
    fixedKeyId: '',
    limits: { concurrency: 3, rpm: 60, onLimit: 'queue', timeoutSec: 120, retry: 1 },
    models: [model('m-1'), model('m-2')],
    links: [],
    note: '',
    balance: null,
    lastTest: null,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

test('probeModel：无可用 Key 时不发请求并返回提示', async (t) => {
  let fetchCalled = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalled += 1;
    return new Response('{}');
  });

  const result = await probeModel(requestSite({ keys: [] }), 'm-1');
  assert.equal(fetchCalled, 0);
  assert.equal(result.modelId, 'm-1');
  assert.equal(result.ok, false);
  assert.equal(result.latencyMs, 0);
  assert.match(result.message, /没有可用的 Key/);
});

test('probeModels：全部成功时串行探测并逐条回调进度，不修改原模型列表', async (t) => {
  const seenModels: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    seenModels.push(body.model ?? '');
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: '好' }, finish_reason: 'stop' }],
      }),
    );
  });

  const site = requestSite();
  const snapshot = structuredClone(site.models);
  const progress: Array<{ id: string; done: number; total: number }> = [];

  const results = await probeModels(site, ['m-1', 'm-2'], {
    onProgress: (result, done, total) => {
      progress.push({ id: result.modelId, done, total });
    },
  });

  assert.deepEqual(seenModels, ['m-1', 'm-2']);
  assert.equal(results.length, 2);
  assert.equal(results.every((item) => item.ok), true);
  assert.match(results[0]!.message, /^可用 · \d+ms$/);
  assert.deepEqual(progress, [
    { id: 'm-1', done: 1, total: 2 },
    { id: 'm-2', done: 2, total: 2 },
  ]);
  assert.deepEqual(site.models, snapshot);
});

test('probeModels：部分失败混出且保留每条真实错误', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    if (body.model === 'bad-model') {
      return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 });
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: '好' }, finish_reason: 'stop' }],
      }),
    );
  });

  const results = await probeModels(requestSite(), ['good-model', 'bad-model']);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.ok, true);
  assert.equal(results[1]?.ok, false);
  assert.ok(results[1]!.message.length > 0);
});

test('probeModels：支持 signal.abort() 提前终止剩余探测', async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: '好' }, finish_reason: 'stop' }],
      }),
    );
  });

  const results = await probeModels(requestSite(), ['m-1', 'm-2', 'm-3'], {
    signal: controller.signal,
    onProgress: (_result, done) => {
      if (done === 1) controller.abort();
    },
  });

  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.modelId, 'm-1');
});

test('probeModels：无可用 Key 时不发请求且逐条回调失败进度', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response('{}');
  });

  const progress: number[] = [];
  const results = await probeModels(requestSite({ keys: [] }), ['m-1', 'm-2'], {
    onProgress: (_r, done) => progress.push(done),
  });

  assert.equal(calls, 0);
  assert.equal(results.length, 2);
  assert.equal(results.every((r) => !r.ok && /没有可用的 Key/.test(r.message)), true);
  assert.deepEqual(progress, [1, 2]);
});
