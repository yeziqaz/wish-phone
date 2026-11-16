import test from 'node:test';
import assert from 'node:assert';
import { splitIntoBubbles, MAX_BUBBLES, MAX_CHARS } from '../src/apps/chat/room/split';

test('splitIntoBubbles 按换行拆成多个气泡', () => {
  const result = splitIntoBubbles('你终于来啦。\n今天想做什么？\n我在这儿等你。');
  assert.deepStrictEqual(result, ['你终于来啦。', '今天想做什么？', '我在这儿等你。']);
});

test('splitIntoBubbles 把空行也当断点，且不留下空串', () => {
  const result = splitIntoBubbles('第一句。\n\n第二句。\n\n\n第三句。');
  assert.deepStrictEqual(result, ['第一句。', '第二句。', '第三句。']);
});

test('splitIntoBubbles 单行过长时在句末标点处切开', () => {
  const long = `${'啊'.repeat(40)}。${'吧'.repeat(40)}。`;
  const result = splitIntoBubbles(long);
  assert.ok(result.length > 1, '应该被切开');
  for (const piece of result) {
    assert.ok(piece.length <= MAX_CHARS, `每段都不该超过 ${MAX_CHARS} 字，实际 ${piece.length}`);
  }
});

test('splitIntoBubbles 没有句末标点的长句不硬切（宁可留一个长气泡）', () => {
  const stubborn = '啊'.repeat(90);
  const result = splitIntoBubbles(stubborn);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0], stubborn);
});

test('splitIntoBubbles 气泡数超过上限时合并相邻短行，而不是丢内容', () => {
  const many = Array.from({ length: MAX_BUBBLES + 5 }, (_, i) => `第${i}句。`).join('\n');
  const result = splitIntoBubbles(many);
  assert.ok(result.length <= MAX_BUBBLES, `不该超过 ${MAX_BUBBLES} 个，实际 ${result.length}`);
  // 合并后字数应守恒：合并时用换行连接，所以比对时把所有换行去掉
  const strip = (text: string): string => text.replace(/\n/g, '');
  assert.strictEqual(
    strip(result.join('')).length,
    strip(many).length,
    '内容不该在合并时丢失',
  );
});

test('splitIntoBubbles 空内容返回空数组', () => {
  assert.deepStrictEqual(splitIntoBubbles(''), []);
  assert.deepStrictEqual(splitIntoBubbles('   \n  \n '), []);
});

test('splitIntoBubbles 单句短内容原样返回一条', () => {
  assert.deepStrictEqual(splitIntoBubbles('在的。'), ['在的。']);
});
/* ---------- 不该被拆的内容（wuli 这类干活角色会用到） ---------- */

test('splitIntoBubbles 代码块整块保留，一个字都不动', () => {
  const code = '这是代码：\n```js\nconst a = 1;\nconst b = 2;\n```\n写好了。';
  const result = splitIntoBubbles(code);
  const block = result.find((piece) => piece.includes('```'));
  assert.ok(block, '应该有一个含代码块的气泡');
  assert.ok(block.includes('const a = 1;'), '代码内容不能被拆散');
  assert.ok(block.includes('const b = 2;'), '第二行代码也要在里面');
});

test('splitIntoBubbles 代码块里的换行不会被当成气泡断点', () => {
  const code = '```python\ndef f():\n    return 1\n```';
  const result = splitIntoBubbles(code);
  assert.strictEqual(result.length, 1, '整块代码应该只占一个气泡');
});

test('splitIntoBubbles Markdown 表格整行保留', () => {
  const table = '| 名字 | 年龄 |\n| --- | --- |\n| 小明 | 18 |';
  const result = splitIntoBubbles(table);
  // 每一行都是表格，都不该被句末标点切开
  assert.ok(result.length >= 1);
  assert.ok(result.some((piece) => piece.includes('小明')));
});

test('splitIntoBubbles 合并短行时不会把代码块并进去', () => {
  const many = Array.from({ length: MAX_BUBBLES + 3 }, (_, i) => `第${i}句。`).join('\n')
    + '\n```js\nconst x = 1;\n```';
  const result = splitIntoBubbles(many);
  const codeIdx = result.findIndex((piece) => piece.includes('```'));
  assert.ok(codeIdx >= 0, '代码块应该还在');
  assert.strictEqual(result[codeIdx], '```js\nconst x = 1;\n```', '代码块不能被合并变形');
});

/* ---------- 按角色给不同尺子 ---------- */

test('splitIntoBubbles 可以用自定义上限（wuli 的 120 字尺子）', () => {
  const line = '啊'.repeat(100);
  // 默认 60 字的尺子：没有句末标点不硬切，所以还是一条
  assert.strictEqual(splitIntoBubbles(line).length, 1);
  // 120 字的尺子：100 字也没到上限，同样一条
  assert.strictEqual(splitIntoBubbles(line, { maxChars: 120 }).length, 1);

  // 140 字的句子：120 的尺子会切，且每段都不超过 120
  const longer = `${'啊'.repeat(70)}。${'吧'.repeat(70)}。`;
  const wide = splitIntoBubbles(longer, { maxChars: 120 });
  for (const piece of wide) {
    assert.ok(piece.length <= 120, `每段都不该超过 120 字，实际 ${piece.length}`);
  }
});

test('splitIntoBubbles 自定义 maxBubbles 生效', () => {
  const many = Array.from({ length: 10 }, (_, i) => `第${i}句。`).join('\n');
  const result = splitIntoBubbles(many, { maxBubbles: 3 });
  assert.ok(result.length <= 3, `不该超过 3 个，实际 ${result.length}`);
});
