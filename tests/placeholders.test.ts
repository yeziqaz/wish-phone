import assert from 'node:assert/strict';
import test from 'node:test';

import { fillPlaceholders } from '../src/core/placeholders.ts';

/* ==========================================================================
   角色卡占位符替换

   这两个占位符是 Character Card V3 规范（MIT）约定的。
   不替换的后果：模型看到的是字面花括号，示例对话里对方永远没有名字。
   ========================================================================== */

test('fillPlaceholders 替换 {{user}}', () => {
  assert.strictEqual(
    fillPlaceholders('{{user}}: 你在干什么？', '小明', 'wuli'),
    '小明: 你在干什么？',
  );
});

test('fillPlaceholders 替换 {{char}}', () => {
  assert.strictEqual(
    fillPlaceholders('{{char}}: 在等你啊', '小明', 'wuli'),
    'wuli: 在等你啊',
  );
});

test('fillPlaceholders 一段里出现多次全都换掉', () => {
  const text = '{{user}}: 你好\n{{char}}: 嗯\n{{user}}: 再见';
  assert.strictEqual(
    fillPlaceholders(text, '小明', 'wuli'),
    '小明: 你好\nwuli: 嗯\n小明: 再见',
  );
});

test('fillPlaceholders 单个花括号不动（只认双花括号）', () => {
  const text = '这是一个 {普通} 花括号，还有 {{user}} 在这里';
  assert.strictEqual(
    fillPlaceholders(text, '小明', 'wuli'),
    '这是一个 {普通} 花括号，还有 小明 在这里',
  );
});

test('fillPlaceholders 没有占位符时原样返回', () => {
  const text = '普通的一段话，没有任何占位符。';
  assert.strictEqual(fillPlaceholders(text, '小明', 'wuli'), text);
});

test('fillPlaceholders 自己的名字里含花括号也不会出事', () => {
  // 用户名里带 {{char}} 不该被二次替换
  assert.strictEqual(
    fillPlaceholders('{{user}} 说：{{char}} 好', '{{char}}', 'wuli'),
    '{{char}} 说：wuli 好',
  );
});
