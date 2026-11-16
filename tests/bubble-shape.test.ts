import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUBBLE_SHAPES,
  shapeDataUri,
  shapeOf,
  shapePresetOf,
} from '../src/apps/chat/beauty/shape.ts';
import { bubbleShapeStyle, bubbleInlineStyle, readableInkOn } from '../src/apps/chat/beauty/css.ts';
import {
  NO_SHAPE,
  defaultBeautyData,
  defaultScheme,
  validateBeauty,
  type Participant,
} from '../src/apps/chat/beauty/model.ts';

/* ==========================================================================
   异形气泡（9-slice）

   来历：用户 2026-11-12 给的《聊天异形气泡制作教程》。
   这里的断言主要守住三件容易改坏的事：
     1. 切片值和宽度值单位不能混（教程里说 90% 的人错在这）
     2. 老数据没这个字段时必须原样可用
     3. 素材被删掉时要能安静退回圆角矩形，不能报错
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

/** 造一个挂了指定形状的 participant */
function withShape(shapeId: string): Participant {
  const base = defaultScheme(BG).participants.user;
  const shape = shapeOf(shapeId);
  return { ...base, bubble: { ...base.bubble, bubbleShape: shape ?? NO_SHAPE } };
}

test('预设形状：四个都在，id 唯一', () => {
  assert.equal(BUBBLE_SHAPES.length, 4);
  const ids = BUBBLE_SHAPES.map((item) => item.id);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(ids, ['shape-cloud', 'shape-notepad', 'shape-speech', 'shape-stamp']);
});

test('每个预设的切片值和宽度都是四个数字', () => {
  for (const preset of BUBBLE_SHAPES) {
    assert.equal(preset.slice.length, 4, `${preset.id} 的 slice 必须是 4 个`);
    assert.equal(preset.width.length, 4, `${preset.id} 的 width 必须是 4 个`);
    for (const n of preset.slice) {
      assert.ok(Number.isInteger(n) && n > 0, `${preset.id} 的切片值必须是正整数`);
    }
    for (const n of preset.width) {
      assert.ok(Number.isInteger(n) && n > 0, `${preset.id} 的宽度必须是正整数`);
    }
  }
});

test('shapeOf 带着预设的默认值', () => {
  const shape = shapeOf('shape-cloud');
  assert.ok(shape);
  assert.equal(shape.shapeId, 'shape-cloud');
  assert.deepEqual(shape.slice, [30, 40, 30, 40]);
  assert.deepEqual(shape.width, [24, 30, 24, 30]);
  assert.equal(shape.fillMode, 'stretch');
});

test('shapeOf 遇到不存在的 id 返回 undefined（不编造）', () => {
  assert.equal(shapeOf('shape-does-not-exist'), undefined);
  assert.equal(shapePresetOf(''), undefined);
});

test('data URI 是合法的可解码 SVG，且带上了配色', () => {
  const preset = shapePresetOf('shape-speech');
  assert.ok(preset);
  const uri = shapeDataUri(preset, '#AABBCC', '#112233');

  assert.ok(uri.startsWith('data:image/svg+xml,'), '必须是 data URI');
  assert.ok(!uri.startsWith('http'), '不许是远程地址');

  const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
  assert.ok(svg.startsWith('<svg'), '解码后必须是 SVG');
  assert.ok(svg.includes('#AABBCC'), '填充色要跟着走');
  assert.ok(svg.includes('#112233'), '描边色要跟着走');
  assert.ok(svg.includes('viewBox="0 0 320 160"'));
});

test('九宫格样式：切片不带单位，宽度带 px', () => {
  const style = bubbleShapeStyle(withShape('shape-cloud'));
  assert.ok(style, '挂了形状就应当有样式');

  // 切片值必须是「裸数字」—— 带 px 会被当成 CSS 像素，是教程里点名的坑
  assert.ok(style.includes('30 40 30 40'), '切片值不许带单位');
  // 宽度必须带 px
  assert.ok(style.includes('24px 30px 24px 30px'), '宽度必须带 px');
  assert.ok(style.includes('fill'), '不带 fill 中心区会是透明的');
  assert.ok(style.includes('stretch'));
});

test('九宫格样式：边框透明占位、圆角归零', () => {
  const style = bubbleShapeStyle(withShape('shape-notepad'));
  assert.ok(style.includes('border-style:solid'));
  assert.ok(style.includes('border-color:transparent'), '边框颜色必须透明，否则九宫格外面多一圈描边');
  assert.ok(style.includes('border-radius:0'), '圆角不清零会把四角装饰切掉');
  assert.ok(style.includes('background:transparent'));
});

test('没挂形状时不出九宫格样式', () => {
  const plain = defaultScheme(BG).participants.user;
  assert.equal(bubbleShapeStyle(plain), '');
});

test('形状 id 指向已删素材时安静退回圆角矩形', () => {
  const base = defaultScheme(BG).participants.user;
  const broken: Participant = {
    ...base,
    bubble: {
      ...base.bubble,
      bubbleShape: { shapeId: 'shape-removed', slice: [10, 10, 10, 10], width: [8, 8, 8, 8], fillMode: 'stretch' },
    },
  };
  assert.equal(bubbleShapeStyle(broken), '', '找不到预设就该返回空串，不许抛错');
});

test('挂了形状时内联样式让位给九宫格（渐变不再覆盖图）', () => {
  const participant = withShape('shape-stamp');
  const style = bubbleInlineStyle(participant);
  assert.ok(style.includes('border-image'), '应当走九宫格');
  assert.ok(!style.includes('linear-gradient'), '渐变会让图看不见，必须让位');
  assert.ok(style.includes('box-shadow'), '阴影仍然保留');
});

test('没挂形状时还是原来的圆角矩形样式', () => {
  const plain = defaultScheme(BG).participants.user;
  const style = bubbleInlineStyle(plain);
  assert.ok(style.includes('border-radius'));
  assert.ok(!style.includes('border-image'));
});

test('老数据没有 bubbleShape 字段也能读，且外观不变', () => {
  const full = defaultBeautyData(BG);
  const old = JSON.parse(JSON.stringify(full.schemes[0]));
  old.id = 'legacy';
  old.name = '老方案';
  old.readonly = false;
  delete old.participants.user.bubble.bubbleShape;
  delete old.participants.wuli.bubble.bubbleShape;

  const result = validateBeauty({ version: 1, activeSchemeId: 'legacy', customAssets: [], schemes: [old] }, BG);
  const bubble = result.schemes[0]!.participants.user.bubble;

  assert.equal(bubble.bubbleShape.shapeId, '', '老数据读出来必须是「不启用形状」');
  assert.deepEqual(bubble.bubbleShape.slice, [0, 0, 0, 0]);
  assert.equal(bubble.bubbleShape.fillMode, 'stretch');
  assert.ok(bubble.fill, '老配色不能丢');
});

test('越界的切片值被夹住，非法填充模式归位', () => {
  const full = defaultBeautyData(BG);
  const dirty = JSON.parse(JSON.stringify(full.schemes[0]));
  dirty.id = 'dirty';
  dirty.readonly = false;
  dirty.participants.user.bubble.bubbleShape = {
    shapeId: 'shape-cloud',
    slice: [-5, 9999, 30, 40],
    width: [24, 30, 24, 9999],
    fillMode: '随便写的',
  };

  const result = validateBeauty({ version: 1, activeSchemeId: 'dirty', customAssets: [], schemes: [dirty] }, BG);
  const shape = result.schemes[0]!.participants.user.bubble.bubbleShape;

  assert.deepEqual(shape.slice, [0, 400, 30, 40], '负数和超大值都要夹回 0~400');
  assert.deepEqual(shape.width, [24, 30, 24, 400]);
  assert.equal(shape.fillMode, 'stretch', '非法模式回落到 stretch');
});

test('shapeId 超长会被截断', () => {
  const full = defaultBeautyData(BG);
  const long = JSON.parse(JSON.stringify(full.schemes[0]));
  long.id = 'long';
  long.readonly = false;
  long.participants.user.bubble.bubbleShape = {
    shapeId: 'x'.repeat(500),
    slice: [1, 1, 1, 1],
    width: [1, 1, 1, 1],
    fillMode: 'round',
  };

  const result = validateBeauty({ version: 1, activeSchemeId: 'long', customAssets: [], schemes: [long] }, BG);
  const shape = result.schemes[0]!.participants.user.bubble.bubbleShape;
  assert.equal(shape.shapeId.length, 100);
  assert.equal(shape.fillMode, 'round', '合法模式要保留');
});

test('两种填充模式 round / space 都能存下来', () => {
  for (const mode of ['round', 'space'] as const) {
    const full = defaultBeautyData(BG);
    const scheme = JSON.parse(JSON.stringify(full.schemes[0]));
    scheme.id = `m-${mode}`;
    scheme.readonly = false;
    scheme.participants.user.bubble.bubbleShape = {
      shapeId: 'shape-stamp',
      slice: [30, 40, 30, 40],
      width: [22, 30, 22, 30],
      fillMode: mode,
    };
    const result = validateBeauty(
      { version: 1, activeSchemeId: `m-${mode}`, customAssets: [], schemes: [scheme] },
      BG,
    );
    assert.equal(result.schemes[0]!.participants.user.bubble.bubbleShape.fillMode, mode);
  }
});

/* ---------- 文字色：跟着图的底色走，不跟着「谁说的」走 ---------- */

test('深底配浅字、浅底配深字（曾错写成一律深字，导致我的气泡看不见）', () => {
  assert.equal(readableInkOn('#111114'), 'var(--inverse-ink)');
  assert.equal(readableInkOn('#FFFFFF'), 'var(--ink)');
  assert.equal(readableInkOn('#FAFBFF'), 'var(--ink)');
  assert.equal(readableInkOn('#009AFF'), 'var(--inverse-ink)');
  assert.equal(readableInkOn('#EEEEEE'), 'var(--ink)');
});

test('颜色格式不认识时退回深色字，不抛错', () => {
  assert.equal(readableInkOn(''), 'var(--ink)');
  assert.equal(readableInkOn('#FFF'), 'var(--ink)');
  assert.equal(readableInkOn('not-a-color'), 'var(--ink)');
});

test('六位大小写都能识别', () => {
  assert.equal(readableInkOn('#111114'), readableInkOn('#111114'.toLowerCase()));
  assert.equal(readableInkOn('#ffffff'), 'var(--ink)');
});
