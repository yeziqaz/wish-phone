import test from 'node:test';
import assert from 'node:assert';
import type { Message } from '../src/core/types';
import { historyMessage, messageActionBlock } from '../src/apps/chat/room/message-state';

function message(overrides: Partial<Message> = {}): Message {
  return { id: 'm1', conversationId: 'c1', role: 'user', content: '原来的要求',
    createdAt: '2026-11-28T00:00:00.000Z', ...overrides };
}

test('普通用户消息原样进入请求历史', () => {
  assert.deepStrictEqual(historyMessage(message()), { role: 'user', content: '原来的要求' });
});

test('撤销消息保留原文并注明不再代表当前要求，不修改源数据', () => {
  const source = message({ extra: { revoked: true, favorited: true, unknown: { keep: 1 } } });
  const before = structuredClone(source);
  const result = historyMessage(source);
  assert.strictEqual(result.role, 'user');
  assert.ok(result.content.includes('用户已撤销此消息'));
  assert.ok(result.content.includes('不要据此执行'));
  assert.ok(result.content.endsWith('\n原来的要求'));
  assert.deepStrictEqual(source, before);
});

test('角色消息即使有 revoked 扩展字段也不改写内容', () => {
  assert.deepStrictEqual(historyMessage(message({ role: 'assistant', extra: { revoked: true } })),
    { role: 'assistant', content: '原来的要求' });
});

test('revoked 必须严格为 true 才标记撤销', () => {
  for (const revoked of [false, 'true', 1, undefined]) {
    assert.strictEqual(historyMessage(message({ extra: { revoked } })).content, '原来的要求');
  }
});

test('AI 忙碌时回退与撤销均被拦截，优先于草稿提示', () => {
  for (const editing of [true, false]) {
    assert.match(messageActionBlock(true, '草稿', editing) ?? '', /AI 正在回复/);
  }
});

test('已有草稿时禁止回退编辑，空白草稿也不覆盖', () => {
  for (const draft of ['草稿', '   ', '\n']) {
    assert.match(messageActionBlock(false, draft, true) ?? '', /已有草稿/);
  }
});

test('撤销不覆盖草稿，因此有草稿仍可撤销', () => {
  assert.strictEqual(messageActionBlock(false, '保留我的草稿', false), null);
});

test('空草稿且空闲时允许回退编辑与撤销', () => {
  assert.strictEqual(messageActionBlock(false, '', true), null);
  assert.strictEqual(messageActionBlock(false, '', false), null);
});
