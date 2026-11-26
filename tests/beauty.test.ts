import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEAUTY_TABS,
  BUBBLE_PRESETS,
  PENDANT_PRESETS,
  allPendants,
  cloneBeauty,
  defaultBeautyData,
  defaultScheme,
  pendantOf,
  validateBeauty,
  type BeautyData,
} from '../src/apps/chat/beauty/model.ts';
import { bubbleShadow, beautyVariables, bubbleInlineStyle } from '../src/apps/chat/beauty/css.ts';
import { pendantFrameSVG, pendantSVG } from '../src/apps/chat/beauty/pendant.ts';

/* ==========================================================================
   聊天美化（移植自用户自己的项目）
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

/* ---------- 预设目录完整性 ---------- */

test('六个板块都在（原项目 CHAT_BEAUTY_TABS）', () => {
  assert.deepStrictEqual(
    BEAUTY_TABS.map((item) => item.label),
    ['界面', '头像挂件', '气泡', '聊天背景', '字体', '方案'],
  );
});

test('八个挂件预设都在，分类与配色原样', () => {
  assert.strictEqual(PENDANT_PRESETS.length, 8);
  const cat = PENDANT_PRESETS.find((item) => item.id === 'frame-cat');
  assert.deepStrictEqual(cat, {
    id: 'frame-cat',
    type: 'frame',
    category: '萌宠',
    name: '猫耳朵',
    glyph: '⌃',
    color: '#e99aa8',
  });
  // 四个框 + 四个贴纸
  assert.strictEqual(PENDANT_PRESETS.filter((item) => item.type === 'frame').length, 4);
  assert.strictEqual(PENDANT_PRESETS.filter((item) => item.type === 'sticker').length, 4);
});

test('四个气泡预设都在，数值原样', () => {
  assert.deepStrictEqual(
    BUBBLE_PRESETS.map((item) => item.name),
    ['柔和填充', '浅粉心情', '薄荷泡泡', '轻透玻璃'],
  );
  assert.strictEqual(BUBBLE_PRESETS[1]!.radius, 22);
  assert.strictEqual(BUBBLE_PRESETS[3]!.shadow, 14);
});

/* ---------- 阴影曲线 ---------- */

test('阴影强度 0 是完全的 none，不是 0px 假阴影', () => {
  assert.strictEqual(bubbleShadow(0), 'none');
});

test('阴影强度变大时，偏移/模糊/不透明度一起变', () => {
  const weak = bubbleShadow(5);
  const strong = bubbleShadow(30);
  const num = (text: string): number[] => (text.match(/[\d.]+px/g) ?? []).map(parseFloat);
  const [weakY, weakBlur] = num(weak);
  const [strongY, strongBlur] = num(strong);
  assert.ok(strongY! > weakY!);
  assert.ok(strongBlur! > weakBlur!);
  // 不透明度也要变深
  const op = (text: string): number => Number(/\/ ([\d.]+)\)/.exec(text)?.[1] ?? 0);
  assert.ok(op(strong) > op(weak));
});

test('阴影强度超范围被夹回 0~30', () => {
  assert.strictEqual(bubbleShadow(-5), 'none');
  assert.strictEqual(bubbleShadow(999), bubbleShadow(30));
  assert.strictEqual(bubbleShadow(Number.NaN), 'none');
});

/* ---------- 气泡样式 ---------- */

test('气泡内联样式包含四项：背景、边框、圆角、阴影', () => {
  const style = bubbleInlineStyle(defaultBeautyData(BG).schemes[0]!.participants.wuli);
  assert.match(style, /background:/);
  assert.match(style, /border:0px solid/);
  assert.match(style, /border-radius:16px/);
  assert.match(style, /box-shadow:none/);
});

test('透明度用 color-mix 而不是 opacity（不能把文字一起变淡）', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.wuli.bubble.opacity = 0.5;
  const style = bubbleInlineStyle(scheme.participants.wuli);
  assert.match(style, /color-mix/);
  assert.match(style, /50%/);
  assert.ok(!/opacity:/.test(style));
});

test('有渐变时叠 linear-gradient，没有渐变时不用', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.user.bubble.gradientColor = '#FF0000';
  const style = bubbleInlineStyle(scheme.participants.user);
  assert.match(style, /linear-gradient\(135deg/);
});

/* ---------- 校验 ---------- */

test('坏数据不抛错，退回默认', () => {
  assert.deepStrictEqual(validateBeauty(null, BG).schemes.length, 1);
  assert.deepStrictEqual(validateBeauty({ schemes: 'nope' }, BG).schemes.length, 1);
  assert.deepStrictEqual(validateBeauty({}, BG).activeSchemeId, 'default');
});

test('越界的圆角/阴影/透明度都被夹回合法区间', () => {
  const dirty = {
    schemes: [
      {
        id: 'x',
        name: '脏数据',
        participants: {
          wuli: { bubble: { radius: 999, shadow: -50, opacity: 5, fill: 'not-a-color' } },
        },
      },
    ],
  } as unknown as BeautyData;
  const clean = validateBeauty(dirty, BG);
  const wuli = clean.schemes[0]!.participants.wuli.bubble;
  assert.strictEqual(wuli.radius, 36);
  assert.strictEqual(wuli.shadow, 0);
  assert.strictEqual(wuli.opacity, 1);
  // 非法颜色回退到默认
  assert.strictEqual(wuli.fill, '#FFFFFF');
});

test('贴纸超过 8 张被截断，坐标越界被夹回', () => {
  const many = Array.from({ length: 20 }, () => ({ assetId: 'sticker-star', x: 999, y: -999 }));
  const dirty = { schemes: [{ id: 'x', participants: { wuli: { avatar: { stickers: many } } } }] } as unknown as BeautyData;
  const clean = validateBeauty(dirty, BG);
  const stickers = clean.schemes[0]!.participants.wuli.avatar.stickers;
  assert.strictEqual(stickers.length, 8);
  assert.strictEqual(stickers[0]!.x, 80);
  assert.strictEqual(stickers[0]!.y, -80);
});

test('贴纸的角标非法时退回右上', () => {
  const dirty = {
    schemes: [{ id: 'x', participants: { wuli: { bubble: { stickers: [{ assetId: 'a', corner: '瞎写' }] } } } }],
  } as unknown as BeautyData;
  const clean = validateBeauty(dirty, BG);
  assert.strictEqual(clean.schemes[0]!.participants.wuli.bubble.stickers[0]!.corner, 'top-right');
});

test('默认方案永远是只读基线，篡改无效', () => {
  const tampered = {
    schemes: [{ id: 'default', readonly: true, participants: { wuli: { bubble: { radius: 30 } } } }],
    activeSchemeId: 'default',
  } as unknown as BeautyData;
  const clean = validateBeauty(tampered, BG);
  assert.strictEqual(clean.schemes[0]!.participants.wuli.bubble.radius, 16);
});

test('activeSchemeId 指向不存在的方案时退回第一个', () => {
  const clean = validateBeauty({ schemes: [{ id: 'a', name: 'A' }], activeSchemeId: 'ghost' } as unknown as BeautyData, BG);
  assert.strictEqual(clean.activeSchemeId, 'a');
});

test('方案数量上限 30 个', () => {
  const schemes = Array.from({ length: 50 }, (_, index) => ({ id: `s${index}`, name: `方案${index}` }));
  const clean = validateBeauty({ schemes } as unknown as BeautyData, BG);
  assert.strictEqual(clean.schemes.length, 30);
});

/* ---------- 变量 ---------- */

test('变量表覆盖双方气泡的三个关键项，且尺寸类变量带单位、无单位计算项保持裸数', () => {
  const vars = beautyVariables(defaultScheme(BG));
  assert.ok(vars['--beauty-wuli-fill']);
  assert.ok(vars['--beauty-user-fill']);
  assert.strictEqual(vars['--beauty-wuli-radius'], '16px');
  assert.strictEqual(vars['--beauty-user-radius'], '16px');
  assert.strictEqual(vars['--beauty-wuli-border-width'], '0px');
  assert.strictEqual(vars['--beauty-user-border-width'], '0px');
  assert.strictEqual(vars['--beauty-font-size'], '16px');
  assert.strictEqual(vars['--beauty-wuli-gradient-angle'], '135deg');
  assert.strictEqual(vars['--beauty-wuli-opacity'], '1');
  assert.ok(vars['--beauty-app-background']);
});

test('空字符串的字段不进变量表（让 CSS fallback 生效）', () => {
  const scheme = defaultScheme(BG);
  scheme.participants.wuli.bubble.gradientColor = '';
  const vars = beautyVariables(scheme);
  assert.ok(!('--beauty-wuli-gradient-color' in vars));
});

/* ---------- 挂件 SVG ---------- */

test('猫耳朵框画出耳朵、眼睛、两个腮红、胡须', () => {
  const svg = pendantFrameSVG('frame-cat', '#e99aa8');
  assert.match(svg, /viewBox="0 0 100 100"/);
  assert.match(svg, /M48 17 48 4/); // 耳朵路径
  assert.match(svg, /M60 19v2m14-2v2/); // 眼睛与嘴
  assert.strictEqual((svg.match(/<ellipse/g) ?? []).length, 2); // 两个腮红
  assert.match(svg, /m9 39-6-2/); // 胡须
  assert.match(svg, /color:#e99aa8/);
});

test('蕾丝框用虚线描边，其他框用实线', () => {
  assert.match(pendantFrameSVG('frame-lace', '#000'), /stroke-dasharray="2 4"/);
  assert.ok(!/stroke-dasharray/.test(pendantFrameSVG('frame-blossom', '#000')));
});

test('不同框用不同字符装饰', () => {
  assert.match(pendantFrameSVG('frame-blossom', '#000'), /✿/);
  assert.match(pendantFrameSVG('frame-orbit', '#000'), /✧/);
  // orbit 多一颗小星球
  assert.match(pendantFrameSVG('frame-orbit', '#000'), /<circle cx="79" cy="24"/);
});

test('贴纸预设渲染成字符，不是 SVG 框', () => {
  const preset = PENDANT_PRESETS.find((item) => item.id === 'sticker-star')!;
  const html = pendantSVG(preset);
  assert.match(html, /pendant-glyph/);
  assert.match(html, /★/);
  assert.ok(!/<svg/.test(html));
});

test('自定义图片资源优先于预设', () => {
  const preset = PENDANT_PRESETS[0]!;
  const html = pendantSVG(preset, 'data:image/png;base64,AAA');
  assert.match(html, /<img class="pendant-img"/);
});

/* ---------- 克隆 ---------- */

test('cloneBeauty 是深拷贝，改副本不影响原件', () => {
  const original = defaultBeautyData(BG);
  const copy = cloneBeauty(original);
  copy.schemes[0]!.name = '改过';
  assert.strictEqual(original.schemes[0]!.name, '默认方案');
});

test('allPendants 把自定义资源并进预设列表', () => {
  const data = defaultBeautyData(BG);
  data.customAssets.push({ id: 'beauty-x', name: '我的框', type: 'frame', category: '我的挂件' });
  const all = allPendants(data);
  assert.strictEqual(all.length, PENDANT_PRESETS.length + 1);
  assert.strictEqual(pendantOf('beauty-x', data)?.name, '我的框');
});
