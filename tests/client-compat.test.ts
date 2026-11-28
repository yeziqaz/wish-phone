import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, listModels, normalizeBaseUrl, testConnection } from '../src/ai/client';
import { ApiError, describeFailure } from '../src/ai/errors';
const config = { baseUrl: 'https://example.invalid/v1', apiKey: ' test-key ', model: 'model-a', temperature: 0.5 };
function reply(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

test('完整接口地址归一化，保留版本与自定义前缀', () => {
  for (const suffix of ['/chat/completions', '/models', '/images/generations', '/audio/speech']) {
    assert.equal(normalizeBaseUrl(' https://example.invalid/custom/v1' + suffix + '/ '),
      'https://example.invalid/custom/v1');
  }
  assert.equal(normalizeBaseUrl('https://example.invalid/custom'), 'https://example.invalid/custom');
  assert.equal(normalizeBaseUrl('https://example.invalid'), 'https://example.invalid');
});

test('模型 GET 不带多余 Content-Type，Key 仅进 Authorization 且不带 Cookie', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://example.invalid/v1/models');
    assert.equal(init.method, 'GET');
    const headers = new Headers(init.headers);
    assert.equal(headers.has('Content-Type'), false);
    assert.equal(headers.get('Authorization'), 'Bearer test-key');
    assert.equal(init.credentials, 'omit');
    return reply({ data: [{ id: 'model-a' }] });
  });
  assert.deepEqual(await listModels(config), [{ id: 'model-a' }]);
});

test('兼容顶层字符串数组，并过滤空值、去重排序', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply([' b ', 'a', 'b', '', null, 123]));
  assert.deepEqual(await listModels(config), [{ id: 'a' }, { id: 'b' }]);
});

test('兼容 models 数组及 name/model 字段', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ models: [
    { name: 'b', context_window: 8192 }, { model: 'a' }, { id: 7 }, {},
  ] }));
  assert.deepEqual(await listModels(config), [{ id: 'a' }, { id: 'b', contextLength: 8192 }]);
});

test('模型列表结构错误报中文，而不是 localeCompare 异常', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ models: 'not-an-array' }));
  await assert.rejects(listModels(config), (error: unknown) =>
    error instanceof ApiError && error.info.detail.includes('模型列表'));
});

test('标准字符串聊天返回不变，POST 保留 JSON Content-Type', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://example.invalid/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    assert.equal(JSON.parse(String(init.body)).stream, false);
    return reply({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] });
  });
  assert.equal((await chat([{ role: 'user', content: 'Hi' }], config)).text, '你好');
});

test('兼容文本块数组，不把推理块或图片当正文', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ choices: [{ message: { content: [
    { type: 'text', text: '你好' }, { type: 'image_url', text: '不显示' },
    { type: 'reasoning', text: '不显示' }, { type: 'output_text', text: '呀' }, null,
  ] } }] }));
  assert.equal((await chat([{ role: 'user', content: 'Hi' }], config)).text, '你好呀');
});

test('空文本块返回中文错误', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ choices: [{ message: { content: [] } }] }));
  await assert.rejects(chat([], config), (error: unknown) =>
    error instanceof ApiError && error.info.detail.includes('没有内容'));
});

test('完整聊天地址不会被重复拼接', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://example.invalid/v1/chat/completions');
    return reply({ choices: [{ message: { content: 'ok' } }] });
  });
  await chat([], { ...config, baseUrl: config.baseUrl + '/chat/completions' });
});

test('网络失败不发 no-cors 探测，不断言接口正常', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new TypeError('Failed to fetch'); });
  await assert.rejects(listModels(config), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.info.kind, 'network');
    assert.match(error.info.detail, /无法据此确认/);
    assert.match(error.info.detail, /跨域/);
    return true;
  });
  assert.equal(requests, 1);
});

test('查询模型接口失败不自动发送聊天或生成请求', async (t) => {
  for (const status of [404, 500]) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests++;
      assert.equal(url, 'https://example.invalid/v1/models');
      assert.equal(init.method, 'GET');
      return new Response('err', { status });
    });
    await assert.rejects(testConnection(config), (error: unknown) =>
      error instanceof ApiError && error.info.kind === (status === 404 ? 'notFound' : 'server'));
    assert.equal(requests, 1);
    t.mock.restoreAll();
  }
});
test('查询模型接口成功只返回实际列表，不补造配置中的模型', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => reply({ data: [] }));
  assert.deepEqual(await testConnection(config), { ok: true, models: [] });
});
test('错误分类在没有浏览器 navigator 的环境可用', async (t) => {
  t.mock.getter(globalThis, 'navigator', () => undefined);
  assert.equal((await describeFailure(new TypeError('Failed to fetch'))).info.kind, 'network');
});

test('设备明确离线时保留离线提示', async (t) => {
  t.mock.getter(globalThis, 'navigator', () => ({ onLine: false }) as Navigator);
  assert.equal((await describeFailure(new TypeError('Failed to fetch'))).info.kind, 'offline');
});
