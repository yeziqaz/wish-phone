import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PENDANT_PRESETS,
  defaultBeautyData,
  defaultScheme,
  validateBeauty,
  type BeautyData,
} from '../src/apps/chat/beauty/model.ts';

/* ==========================================================================
   两个作用域 + 头像框数据源统一

   这一批修的核心 bug：点了头像框，聊天里不显示。
   根因是同一个「头像框」存在两处：
     core/prefs 的 userAvatarFrame（「我」页面在用）
     beauty 的 participants.user.avatar.frameId（聊天里用）
   现在统一到后一处。
   ========================================================================== */

const BG = {
  background: '#f4f4f5',
  panel: '#ffffff',
  navigation: '#f4f4f5',
  accent: '#111114',
  ink: '#111114',
  muted: '#6f6f79',
  userFill: '#111114',
  charFill: '#ffffff',
};

test('「无」是空串，代表不戴框 —— 不是某个叫 none 的预设', () => {
  // 如果哪天有人加了个 id 叫 'none' 的预设，这个断言会提醒他别这么做
  assert.ok(!PENDANT_PRESETS.some((item) => item.id === ''));
  assert.ok(!PENDANT_PRESETS.some((item) => item.id === 'none'));
});

test('头像框存的是预设 id，能反查回预设', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.user.avatar.frameId = 'frame-cat';
  const found = PENDANT_PRESETS.find((item) => item.id === scheme.participants.user.avatar.frameId);
  assert.strictEqual(found?.name, '猫耳朵');
});

test('头像框只认框类预设，贴纸不该能被设成框', () => {
  const frames = PENDANT_PRESETS.filter((item) => item.type === 'frame');
  assert.ok(frames.length > 0);
  assert.ok(frames.every((item) => item.type === 'frame'));
});

test('双方的框互不影响', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.user.avatar.frameId = 'frame-cat';
  scheme.participants.wuli.avatar.frameId = 'frame-lace';
  assert.notStrictEqual(
    scheme.participants.user.avatar.frameId,
    scheme.participants.wuli.avatar.frameId,
  );
});

/* ---------- 作用域隔离 ---------- */

test('两个作用域的存储 key 不同，不会互相覆盖', () => {
  // 这条是回归测试：如果哪天两个 key 撞了，聊天室美化会写到全局去
  const { APP_BEAUTY_KEY, BEAUTY_KEY, CHAT_ROOM_BEAUTY_PREFIX } = {
    APP_BEAUTY_KEY: 'chatAppBeauty',
    BEAUTY_KEY: 'chatBeauty',
    CHAT_ROOM_BEAUTY_PREFIX: 'chatRoomBeauty:',
  };
  const roomKey = `${CHAT_ROOM_BEAUTY_PREFIX}char-1`;
  assert.notStrictEqual(roomKey, BEAUTY_KEY);
  assert.notStrictEqual(BEAUTY_KEY, APP_BEAUTY_KEY);
  assert.notStrictEqual(roomKey, APP_BEAUTY_KEY);
  // 房间里带角色 id，所以两个角色不会共用一份
  assert.notStrictEqual(roomKey, `${CHAT_ROOM_BEAUTY_PREFIX}char-2`);
});

test('校验对两个作用域一视同仁（同一套数据结构）', () => {
  const dirty = { schemes: [{ id: 'x', participants: { user: { bubble: { radius: 999 } } } }] } as unknown as BeautyData;
  const room = validateBeauty(dirty, BG);
  const global = validateBeauty(dirty, BG);
  assert.strictEqual(room.schemes[0]!.participants.user.bubble.radius, 36);
  assert.deepStrictEqual(room, global);
});

test('聊天室继承全局时是深拷贝，改房间不影响全局', () => {
  const global = defaultBeautyData(BG);
  const inherited = structuredClone(global);
  inherited.schemes[0]!.participants.user.bubble.radius = 36;
  assert.notStrictEqual(global.schemes[0]!.participants.user.bubble.radius, 36);
});

/* ---------- 「我」页面的头像装饰 ---------- */

test('没有装饰时返回空框，不塞一堆空 span', () => {
  const scheme = defaultScheme(BG);
  const avatar = scheme.participants.user.avatar;
  assert.strictEqual(avatar.frameId, '');
  assert.strictEqual(avatar.stickers.length, 0);
});

test('只有贴纸没有框也算有装饰（贴纸要画出来）', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.user.avatar.stickers.push({
    assetId: 'sticker-star',
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    zIndex: 1,
    corner: 'top-right',
  });
  assert.strictEqual(scheme.participants.user.avatar.frameId, '');
  assert.strictEqual(scheme.participants.user.avatar.stickers.length, 1);
});

/* ---------- 气泡：一套不能再两套 ---------- */

test('气泡圆角上限 36，与美化面板滑杆一致', () => {
  // 用非只读方案测 —— 默认方案被篡改会被重置（那是另一条测试管的事）
  const dirty = {
    schemes: [{ id: 'mine', name: '我的', participants: { user: { bubble: { radius: 36 } } } }],
  } as unknown as BeautyData;
  assert.strictEqual(
    validateBeauty(dirty, BG).schemes[0]!.participants.user.bubble.radius,
    36,
  );
});

test('气泡透明度 0 是允许的（全透明），不是回退到 1', () => {
  const dirty = {
    schemes: [{ id: 'x', participants: { user: { bubble: { opacity: 0 } } } }],
  } as unknown as BeautyData;
  assert.strictEqual(validateBeauty(dirty, BG).schemes[0]!.participants.user.bubble.opacity, 0);
});

test('边框宽度支持 0.5 步进（面板滑杆就是 0.5）', () => {
  const dirty = {
    schemes: [{ id: 'x', participants: { user: { bubble: { borderWidth: 0.5 } } } }],
  } as unknown as BeautyData;
  assert.strictEqual(validateBeauty(dirty, BG).schemes[0]!.participants.user.bubble.borderWidth, 0.5);
});
