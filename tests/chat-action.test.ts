import test from 'node:test';
import assert from 'node:assert';
import { parseCharacterAction } from '../src/apps/chat/room/action';

test('parseCharacterAction extracts parenthesis actions correctly', () => {
  const result = parseCharacterAction('(尾巴一甩，从屏幕边角探出半个脑袋) 呜……你终于来啦。');
  assert.strictEqual(result.actionText, '尾巴一甩，从屏幕边角探出半个脑袋');
  assert.strictEqual(result.mainText, '呜……你终于来啦。');
});

test('parseCharacterAction handles text without actions', () => {
  const result = parseCharacterAction('你好呀，今天过得怎么样？');
  assert.strictEqual(result.actionText, null);
  assert.strictEqual(result.mainText, '你好呀，今天过得怎么样？');
});
