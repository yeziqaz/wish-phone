import assert from 'node:assert/strict';
import test from 'node:test';

import { inferKinds, inferSeries, inferSiteType, normalizeBaseUrl } from '../src/core/api-catalog.ts';
import { parseSites } from '../src/core/api-paste.ts';

/* ==========================================================================
   粘贴识别（设计文档 §15 步骤 1 的验收样例）
   必须吃得下：单站点、多站点、多 Key、格式混乱的文本。
   ========================================================================== */

test('单站点：名称 / 地址 / 一个 Key', () => {
  const drafts = parseSites(
    ['DeepSeek 官方', 'https://api.deepseek.com', 'sk-abcdef1234567890abcdef'].join('\n'),
  );

  assert.equal(drafts.length, 1);
  const site = drafts[0];
  assert.ok(site);
  assert.equal(site.name, 'DeepSeek 官方');
  assert.equal(site.url, 'https://api.deepseek.com/v1'); // 缺 /v1 自动补
  assert.deepEqual(site.keys, ['sk-abcdef1234567890abcdef']);
  assert.equal(site.siteType, 'official');
  assert.equal(site.protocol, 'openai');
  assert.ok(site.notes.some((note) => note.includes('/v1')));
});

test('单站点多 Key：连续几行 Key 全收，且去重', () => {
  const drafts = parseSites(
    [
      '某中转站',
      'https://api.example.com/v1',
      'sk-aaaaaaaaaaaaaaaa',
      'sk-bbbbbbbbbbbbbbbb',
      'sk-aaaaaaaaaaaaaaaa', // 重复的只留一个
    ].join('\n'),
  );

  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0]?.keys, ['sk-aaaaaaaaaaaaaaaa', 'sk-bbbbbbbbbbbbbbbb']);
});

test('多站点：空行分隔，各自带自己的 Key', () => {
  const drafts = parseSites(
    [
      '站点一',
      'https://a.example.com/v1',
      'sk-1111111111111111',
      '',
      '站点二',
      'https://b.example.com/v1',
      'sk-2222222222222222',
      'sk-3333333333333333',
    ].join('\n'),
  );

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]?.name, '站点一');
  assert.deepEqual(drafts[0]?.keys, ['sk-1111111111111111']);
  assert.equal(drafts[1]?.name, '站点二');
  assert.deepEqual(drafts[1]?.keys, ['sk-2222222222222222', 'sk-3333333333333333']);
});

test('多站点：没有空行也能靠「下一个名称」切开', () => {
  const drafts = parseSites(
    [
      '站点一',
      'https://a.example.com/v1',
      'sk-1111111111111111',
      '站点二',
      'https://b.example.com/v1',
      'sk-2222222222222222',
    ].join('\n'),
  );

  assert.equal(drafts.length, 2);
  assert.equal(drafts[1]?.name, '站点二');
});

test('格式混乱：Key 写在地址前面，名称挤在行尾', () => {
  const drafts = parseSites('sk-9999999999999999 https://c.example.com/v1 随手记');

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.url, 'https://c.example.com/v1');
  assert.deepEqual(drafts[0]?.keys, ['sk-9999999999999999']);
});

test('格式混乱：全挤成一行、带中文标点和引号', () => {
  const drafts = parseSites('“备用站”，https://d.example.com，sk-8888888888888888。');

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.url, 'https://d.example.com/v1');
  assert.deepEqual(drafts[0]?.keys, ['sk-8888888888888888']);
});

test('一个 Key 都没有时仍然给出草稿，并标出缺 Key', () => {
  const drafts = parseSites(['只有地址的站', 'https://e.example.com/v1'].join('\n'));

  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0]?.keys, []);
  assert.equal(drafts[0]?.uncertain.keys, true);
  assert.ok(drafts[0]?.notes.some((note) => note.includes('Key')));
});

test('没有任何地址就返回空数组', () => {
  assert.deepEqual(parseSites('这里只是一段随便写的文字，没有网址'), []);
  assert.deepEqual(parseSites('   '), []);
});

test('名称重复时自动加后缀', () => {
  const drafts = parseSites(
    [
      '同名站',
      'https://f1.example.com/v1',
      'sk-aaaaaaaaaaaaaaaa',
      '同名站',
      'https://f2.example.com/v1',
      'sk-bbbbbbbbbbbbbbbb',
    ].join('\n'),
  );

  assert.deepEqual(
    drafts.map((draft) => draft.name),
    ['同名站', '同名站 (2)'],
  );
});

test('认不出名字就拿域名顶，并记一条说明', () => {
  const drafts = parseSites(['https://api.somewhere.com/v1', 'sk-cccccccccccccccc'].join('\n'));

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.name, 'somewhere');
  assert.ok(drafts[0]?.notes.some((note) => note.includes('名称')));
});

test('特殊站点认得出生图 / 语音协议', () => {
  assert.equal(inferSiteType('https://api.novelai.net'), 'official');
  assert.equal(inferSiteType('https://api.openai.com/v1'), 'official');
  assert.equal(inferSiteType('https://openrouter.ai/api/v1'), 'aggregator');
  assert.equal(inferSiteType('https://api.somemiddleman.com/v1'), 'relay');
});

test('地址规范化：补 /v1、去 /chat/completions、去多余斜杠', () => {
  assert.equal(normalizeBaseUrl('https://a.com', 'openai').url, 'https://a.com/v1');
  assert.equal(normalizeBaseUrl('https://a.com/v1/', 'openai').url, 'https://a.com/v1');
  assert.equal(
    normalizeBaseUrl('https://a.com/v1/chat/completions', 'openai').url,
    'https://a.com/v1',
  );
  // 非 OpenAI 协议不动它的路径
  assert.equal(normalizeBaseUrl('https://api.novelai.net/', 'novelai').url, 'https://api.novelai.net');
});

test('系列推断：按表归类，认不出就是未分类', () => {
  assert.equal(inferSeries('claude-sonnet-4'), 'claude');
  assert.equal(inferSeries('gpt-4o-mini'), 'gpt');
  assert.equal(inferSeries('deepseek-chat'), 'deepseek');
  assert.equal(inferSeries('gemini-1.5-pro'), 'gemini');
  assert.equal(inferSeries('qwen-max'), 'qwen');
  assert.equal(inferSeries('GROK-3'), 'grok');
  assert.equal(inferSeries('GLM-4.5'), 'glm');
  assert.equal(inferSeries('KIMI-K2'), 'kimi');
  assert.equal(inferSeries('MiniMax-Text-01'), 'minimax');
  assert.equal(inferSeries('Doubao-Seed-1.6'), 'doubao');
  assert.equal(inferSeries('my-agents-model'), 'agents');
  assert.equal(inferSeries('AGENS-1'), 'agents');
  assert.equal(inferSeries('some-random-model'), 'other');
});

test('能力推断：可多标签，越具体的排越前', () => {
  assert.deepEqual(inferKinds('text-embedding-3-small'), ['embedding']);
  assert.deepEqual(inferKinds('gpt-4o-tts'), ['tts']);
  assert.deepEqual(inferKinds('dall-e-3'), ['image']);
  assert.deepEqual(inferKinds('gpt-4o'), ['text', 'vision']);
  assert.deepEqual(inferKinds('deepseek-chat'), ['text']);
  assert.deepEqual(inferKinds('kling-v1'), ['video']);
});

import { inferSubSeries } from '../src/core/api-catalog';

test('小类：把系列关键词剥掉，剩下的就是小类', () => {
  assert.equal(inferSubSeries('claude-opus-4-5'), 'opus');
  assert.equal(inferSubSeries('claude-opus-4-6'), 'opus');
  assert.equal(inferSubSeries('claude-sonnet-4-5'), 'sonnet');
  assert.equal(inferSubSeries('claude-haiku-3-5'), 'haiku');
  assert.equal(inferSubSeries('gpt-4o'), '4o');
  assert.equal(inferSubSeries('gpt-4o-mini'), '4o-mini');
  assert.equal(inferSubSeries('deepseek-v4.1-flash'), 'v4.1-flash');
  assert.equal(inferSubSeries('gemini-2.5-pro'), '2.5-pro');
});

test('小类：剥完是空 → 算「本系其他」', () => {
  assert.equal(inferSubSeries('claude'), '');
  assert.equal(inferSubSeries('gpt'), '');
});

test('小类：去掉日期尾巴和 latest 这类后缀', () => {
  assert.equal(inferSubSeries('gpt-4o-20240620'), '4o');
  assert.equal(inferSubSeries('claude-3-5-sonnet-latest'), 'sonnet');
});

test('小类：不认识的模型保留原名，不硬塞进某个系列', () => {
  assert.equal(inferSubSeries('my-custom-model'), 'my-custom-model');
});
