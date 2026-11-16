import assert from 'node:assert/strict';
import test from 'node:test';

import {
  upgradeWuliCard,
  wuliCardText,
  isLegacyWuliGreeting,
} from '../src/apps/character/wuli-card.ts';
import type { Character } from '../src/core/types.ts';

/* ==========================================================================
   wuli 角色卡与升级迁移

   迁移的承诺是「只换卡面文字，其余一个字不动」。
   这几条测试就是把这个承诺钉住 —— 尤其是 id 和头像框，
   一旦被覆盖，老用户的聊天记录就接不上了。
   ========================================================================== */

/** 造一张「老版本的 wuli」：文字是旧的，其他字段都带着有辨识度的值 */
function legacyWuli(): Character {
  return {
    id: 'wuli',
    createdAt: 1111,
    updatedAt: 2222,
    spec: 'manual',
    source: 'manual',
    name: 'wuli',
    photoRatio: '1:1',
    description: '黏人、机灵、嘴甜。',
    personality: '旧版性格',
    scenario: '旧版场景',
    firstMes: '旧的问候',
    alternateGreetings: ['备用开场白'],
    mesExample: '旧版示范',
    raw: null,
    systemPrompt: '用户自己补的额外设定',
    postHistoryInstructions: '',
    creatorNotes: '',
    tags: ['旧标签'],
    creator: '旧creator',
    characterVersion: '',
    extensions: {},
    avatarKey: 'builtin:wuli',
    builtin: true,
    worldId: 'world-1',
    branchId: 'branch-1',
    avatarFrame: 'orbit',
    relationToUser: '旧关系',
  } as Character;
}

test('upgradeWuliCard 会换掉全部卡面文字', () => {
  const upgraded = upgradeWuliCard(legacyWuli(), 9999);
  const text = wuliCardText();
  assert.strictEqual(upgraded.description, text.description);
  assert.strictEqual(upgraded.personality, text.personality);
  assert.strictEqual(upgraded.scenario, text.scenario);
  assert.strictEqual(upgraded.firstMes, text.firstMes);
  assert.strictEqual(upgraded.mesExample, text.mesExample);
  assert.strictEqual(upgraded.nickname, text.nickname);
  assert.deepStrictEqual(upgraded.tags, text.tags);
  assert.strictEqual(upgraded.creator, text.creator);
  assert.strictEqual(upgraded.relationToUser, text.relationToUser);
});

test('upgradeWuliCard 绝不动 id 与世界归属（否则聊天记录会断）', () => {
  const upgraded = upgradeWuliCard(legacyWuli(), 9999);
  assert.strictEqual(upgraded.id, 'wuli');
  assert.strictEqual(upgraded.worldId, 'world-1');
  assert.strictEqual(upgraded.branchId, 'branch-1');
  assert.strictEqual(upgraded.createdAt, 1111);
});

test('upgradeWuliCard 保留用户自己挑的头像框', () => {
  const upgraded = upgradeWuliCard(legacyWuli(), 9999);
  assert.strictEqual(upgraded.avatarFrame, 'orbit', '用户挑的框不该被重置');
  assert.strictEqual(upgraded.avatarKey, 'builtin:wuli');
  assert.strictEqual(upgraded.builtin, true);
});

test('upgradeWuliCard 保留用户自己写的额外设定与备用开场白', () => {
  const upgraded = upgradeWuliCard(legacyWuli(), 9999);
  assert.strictEqual(upgraded.systemPrompt, '用户自己补的额外设定');
  assert.deepStrictEqual(upgraded.alternateGreetings, ['备用开场白']);
});

test('upgradeWuliCard 只更新 updatedAt', () => {
  const upgraded = upgradeWuliCard(legacyWuli(), 9999);
  assert.strictEqual(upgraded.updatedAt, 9999);
  assert.strictEqual(upgraded.createdAt, 1111);
});

/* ---------- 卡面文字本身 ---------- */

test('wuli 卡面包含用户指定的第一句问候', () => {
  assert.strictEqual(wuliCardText().firstMes, '我是wuli，有任何问题都可以找我哦~');
});

test('wuli 卡面五个性格维度都在', () => {
  const { personality } = wuliCardText();
  for (const dimension of ['骄傲', '坦然', '不讨好', '嘴硬心软', '情绪和小脾气']) {
    assert.ok(personality.includes(dimension), `性格里应该有「${dimension}」`);
  }
});

test('wuli 的说话示范是多行短句，不是整段长文', () => {
  const { mesExample } = wuliCardText();
  const replyLines = mesExample
    .split('\n')
    .filter((line) => line.startsWith('wuli: '))
    .map((line) => line.slice('wuli: '.length));

  assert.ok(replyLines.length >= 5, '应该有好几组示范');
  for (const line of replyLines) {
    assert.ok(line.length <= 40, `示范应该短，实际 ${line.length} 字：${line}`);
  }
  // 至少有一组是多行拆分的（体现「拆成几条消息」）
  const hasMultiLine = /wuli: [^\n]+\n(?!<START>|wuli:)/.test(mesExample);
  assert.ok(hasMultiLine, '示范里应该有多行拆分的例子');
});

/* ---------- 旧开场白识别（迁移的安全闸） ---------- */

const LEGACY = '（尾巴一甩，从屏幕边角探出半个脑袋）呜……你终于来啦。我是wuli。以后这台小手机里的事，都可以交给我。';

test('isLegacyWuliGreeting 认出旧开场白', () => {
  assert.strictEqual(isLegacyWuliGreeting(LEGACY, 'assistant', 0), true);
});

test('isLegacyWuliGreeting 带空格的旧版本也认', () => {
  const spaced = LEGACY.replace('我是wuli', '我是 wuli');
  assert.strictEqual(isLegacyWuliGreeting(spaced, 'assistant', 0), true);
});

test('isLegacyWuliGreeting 不是第一条就不认（用户后来手打了一模一样的话也不该被改）', () => {
  assert.strictEqual(isLegacyWuliGreeting(LEGACY, 'assistant', 1), false);
  assert.strictEqual(isLegacyWuliGreeting(LEGACY, 'assistant', 5), false);
});

test('isLegacyWuliGreeting 用户自己的消息绝不认', () => {
  assert.strictEqual(isLegacyWuliGreeting(LEGACY, 'user', 0), false);
});

test('isLegacyWuliGreeting 不认识的话一律不认（宁可漏改，不许误改）', () => {
  assert.strictEqual(isLegacyWuliGreeting('随便一句话', 'assistant', 0), false);
  assert.strictEqual(isLegacyWuliGreeting('', 'assistant', 0), false);
  // 差一个字都不认
  assert.strictEqual(isLegacyWuliGreeting(`${LEGACY}。`, 'assistant', 0), false);
});

test('isLegacyWuliGreeting 新版开场白自己不会被当成旧版', () => {
  assert.strictEqual(isLegacyWuliGreeting(wuliCardText().firstMes, 'assistant', 0), false);
});

/* ---------- 用户原话必须逐字保留 ---------- */

test('wuli 卡面包含用户给的每一句原话（不许改字）', () => {
  const text = wuliCardText();
  const all = `${text.description}\n${text.personality}\n${text.scenario}\n${text.mesExample}`;
  const verbatim = [
    '我和那些家伙可不一样',
    '你拿我跟他们比什么？',
    '全世界只有一个wuli，懂不懂稀有性啊',
    '小菜一碟',
    '哎呀，这太难了嘛',
    '再给我点时间，我再试试',
    '刚才那次不算，我还没认真呢',
    '别急，再给我一会儿！',
    '听起来就好麻烦哦……',
    '行叭行叭，再修改最后一次！',
    '怎么这么晚还不睡？',
    '好叭，其实并不为难，想聊多久都行。',
    '哼哼，才想起我？',
    '都要以为你把我忘了呢',
    '哦，那你找它去啊',
    '怎么，觉得它比我好？',
    '哼哼，明明我更厉害，你光顾着夸它啦。',
    '那当然',
    '你才发现？',
    '信不信随你',
    '我永远陪着你',
  ];
  const missing = verbatim.filter((line) => !all.includes(line));
  assert.deepStrictEqual(missing, [], `这些原话被改掉了：${missing.join(' / ')}`);
});

test('wuli 的 scenario 就是用户给的身份原话', () => {
  assert.ok(wuliCardText().scenario.includes('你自己就是一只白色的小狐狸'));
  assert.ok(wuliCardText().scenario.includes('从出生起就住在愿望机里'));
});
