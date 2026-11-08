import assert from 'node:assert/strict';
import test from 'node:test';

import { toApiError, describeResponse } from '../src/ai/errors.ts';

/* ==========================================================================
   错误翻译（AGENTS §9：报错要翻译成人话再给用户看）

   这一组测试的起点是一个真实报错：
     用户界面上出现了
     Failed to execute 'json' on 'Response': Unexpected token '<', "<!DOCTYPE "...
     根因：接口回了 200，但内容是一张网页，response.json() 直接炸了。
   ========================================================================== */

const HTML = '<!DOCTYPE html>\n<html lang="zh"><head><title>我的中转站</title></head><body>欢迎</body></html>';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('200 但返回的是一张网页 —— 拦在 json() 之前，报「路径不对」', async () => {
  const error = await describeResponse(new Response(HTML, { status: 200 }));

  assert.ok(error, '应该被判成错误，不能放行');
  assert.equal(error.info.kind, 'notFound');
  // 关键：人话里不许出现浏览器原文
  assert.ok(!error.info.detail.includes('DOCTYPE'));
  assert.ok(!/Failed to execute/i.test(error.info.detail));
  assert.match(error.info.detail, /网页/);
  // 原文只进折叠区
  assert.match(error.info.raw ?? '', /DOCTYPE/);
});

test('200 但内容不是 JSON 也不是网页 —— 报「服务端出错了」，不是英文异常', async () => {
  const error = await describeResponse(new Response('OK', { status: 200 }));

  assert.ok(error);
  assert.equal(error.info.kind, 'server');
  assert.match(error.info.detail, /不是 JSON/);
});

test('200 + 正常 JSON 照常放行', async () => {
  const error = await describeResponse(json({ data: [{ id: 'gpt-4o' }] }));
  assert.equal(error, null);
});

test('200 + 空 body 放行，交给调用方按「没有内容」处理', async () => {
  const error = await describeResponse(new Response('', { status: 200 }));
  assert.equal(error, null);
});

test('200 但 body 里写着错误 —— 仍然要报出来', async () => {
  const error = await describeResponse(
    json({ error: { message: 'invalid api key' } }, 200),
  );
  assert.ok(error);
  assert.equal(error.info.kind, 'server');
  assert.match(error.info.detail, /invalid api key/);
});

test('常见的 HTTP 状态码各自归到对应分类', async () => {
  const cases: Array<[number, string]> = [
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [429, 'rate'],
    [404, 'notFound'],
    [413, 'tooLarge'],
    [500, 'server'],
    [503, 'server'],
  ];
  for (const [status, kind] of cases) {
    const error = await describeResponse(json({ error: { message: 'x' } }, status));
    assert.equal(error?.info.kind, kind, `HTTP ${status} 应该归到 ${kind}`);
  }
});

test('兜底：浏览器原生英文异常不再当正文显示', () => {
  const raw = new SyntaxError(
    `Failed to execute 'json' on 'Response': Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
  );
  const error = toApiError(raw);

  assert.equal(error.info.kind, 'unknown');
  assert.ok(!/Failed to execute/i.test(error.info.detail), '正文里不许出现英文原文');
  assert.ok(!/DOCTYPE/.test(error.info.detail));
  assert.match(error.info.raw ?? '', /Failed to execute/);
});

test('已经是 ApiError 的原样返回，不会被兜底改写', async () => {
  const original = await describeResponse(new Response(HTML, { status: 200 }));
  assert.ok(original);
  assert.equal(toApiError(original), original);
});