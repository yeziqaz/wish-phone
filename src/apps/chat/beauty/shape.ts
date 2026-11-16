/* ==========================================================================
   异形气泡的预设形状

   来历：用户 2026-11-12 给的《聊天异形气泡制作教程》。
   技术原理与取舍见 docs/research/异形气泡技术调研.md。

   ---------- 为什么用内联 SVG 而不用 PNG ----------

   1. 项目铁律不许远程资源 CDN，教程那种 i.postimg.cc 图床不能用。
   2. 内联 SVG 是纯文本，塞进 data URI 即可，不占 IndexedDB 配额，
      也不用走「导入素材」那套流程。
   3. 天然透明背景 —— PNG 忘了去背会在四角留白方块，SVG 不会犯这个错。
   4. 填充色/描边色能跟着用户的气泡配色走，不会出现
      「云朵是米色、气泡是粉色」这种错配。

   ---------- 画法约定（改图形前必读） ----------

   画布 320×160。中间留平坦区给文字，装饰只放在切线之外的四角。

   ⚠️ 关键约束：**九宫格会把切线以内的部分横向/纵向拉伸**。
      所以：
        · 图形必须是**单条闭合路径** —— 用多个图形叠（圆 + 矩形）
          会在拉伸时错位、露出接缝。
        · 边上的装饰（波浪、锯齿）在切线以内会被拉开。
          要么接受（日常对话不长），要么把那段做平缓。
        · 只有四角的东西不会被拉伸，适合放「一眼认出是它」的特征
          （便笺的胶带、对话框的尖角）。

   第一版曾用「矩形 + 若干圆」画云朵、用「叠圆孔」画邮票，
   渲染出来全是错位的圆和露在外面的孔 —— 就是这个约束没想清。
   ========================================================================== */

import type { BubbleShape } from './model';

export interface ShapePreset {
  id: string;
  name: string;
  /** 生成 SVG 源码。fill 是填充色，stroke 是描边色 */
  draw: (fill: string, stroke: string) => string;
  /** 默认切线（上 右 下 左），按 320×160 画布量好 */
  slice: [number, number, number, number];
  /** 默认边框占位（上 右 下 左），通常略小于 slice，让装饰显得小一点 */
  width: [number, number, number, number];
}

const W = 320;
const H = 160;

/**
 * 坐标保留一位小数。
 *
 * SVG 里的 45.333333333333336 会白白撑大 data URI 几十个字符，
 * 而一个像素的 1/10 在手机上根本看不出来。
 */
function n(value: number): string {
  return Number(value.toFixed(1)).toString();
}

function wrap(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="0 0 ${W} ${H}">${body}</svg>`
  );
}

function path(d: string, fill: string, stroke: string): string {
  return (
    `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="3" ` +
    `stroke-linejoin="round"/>`
  );
}

/**
 * 云朵：四边全是拱形，一条闭合路径。
 *
 * 上边三段弧、下边三段弧、左右各一段 —— 全是 A 命令连起来。
 * 中途换成正向的矩形会露出接缝，所以整条路径只有起点和终点重合。
 */
function cloud(fill: string, stroke: string): string {
  const x0 = 24;
  const x1 = W - 24;
  const y0 = 30;
  const y1 = H - 30;
  const span = (x1 - x0) / 3;

  let d = `M ${n(x0)} ${n(y0)}`;
  for (let i = 0; i < 3; i += 1) {
    const a = x0 + span * i;
    d += ` A ${n(span / 2)} 22 0 0 1 ${n(a + span)} ${n(y0)}`;
  }
  d += ` A 22 22 0 0 1 ${n(x1)} ${n(y1)}`;
  for (let i = 0; i < 3; i += 1) {
    const b = x1 - span * i;
    d += ` A ${n(span / 2)} 22 0 0 1 ${n(b - span)} ${n(y1)}`;
  }
  d += ` A 22 22 0 0 1 ${n(x0)} ${n(y0)} Z`;

  return path(d, fill, stroke);
}

/**
 * 便笺：方角纸片 + 左上角斜贴的胶带。
 * 胶带有意超出纸边 —— 那正是「角」上的特征，不会被拉伸。
 */
function notepad(fill: string, stroke: string): string {
  const body = path(`M 26 30 L ${W - 26} 30 L ${W - 26} ${H - 26} L 26 ${H - 26} Z`, fill, stroke);
  const tape =
    `<g transform="rotate(-20 60 34)">` +
    `<rect x="36" y="18" width="52" height="22" rx="1" fill="${stroke}" opacity="0.16" ` +
    `stroke="${stroke}" stroke-width="2" stroke-opacity="0.35"/>` +
    `</g>`;
  return tape + body;
}

/**
 * 对话框：圆角矩形 + 右下角一个尖角。
 * 尖角落在切片内，所以永远保持形状，不会随气泡变宽被拉开。
 */
function speech(fill: string, stroke: string): string {
  const d =
    `M 26 26 Q 26 18 34 18 L ${W - 34} 18 Q ${W - 26} 18 ${W - 26} 26 ` +
    `L ${W - 26} ${H - 46} Q ${W - 26} ${H - 38} ${W - 34} ${H - 38} ` +
    `L ${W - 70} ${H - 38} L ${W - 84} ${H - 10} L ${W - 104} ${H - 38} ` +
    `L 34 ${H - 38} Q 26 ${H - 38} 26 ${H - 46} Z`;
  return path(d, fill, stroke);
}

/**
 * 邮票：四边一圈小锯齿，单条闭合路径。
 *
 * 第一版是「矩形 + 一排白圆孔」，渲染后孔全露在描边外面 ——
 * 因为圆孔画在矩形之上，矩形自己的描边把它们圈住了。
 * 现在改成路径本身就走锯齿，没有任何叠加。
 */
function stamp(fill: string, stroke: string): string {
  const teeth = 5;
  const segH = (W - 52) / teeth;
  const segV = (H - 40) / teeth;

  let d = 'M 26 20';
  for (let i = 0; i < teeth; i += 1) {
    d += ` A ${n(segH / 2)} 7 0 0 1 ${n(26 + segH * (i + 1))} 20`;
  }
  for (let i = 0; i < teeth; i += 1) {
    d += ` A 7 ${n(segV / 2)} 0 0 1 ${W - 26} ${n(20 + segV * (i + 1))}`;
  }
  for (let i = 0; i < teeth; i += 1) {
    d += ` A ${n(segH / 2)} 7 0 0 1 ${n(W - 26 - segH * (i + 1))} ${H - 20}`;
  }
  for (let i = 0; i < teeth; i += 1) {
    d += ` A 7 ${n(segV / 2)} 0 0 1 26 ${n(H - 20 - segV * (i + 1))}`;
  }
  d += ' Z';

  return path(d, fill, stroke);
}

/**
 * 预设清单。
 *
 * 丝带做过一版又砍了：燕尾切口要求左端是「向内凹」的尖角，
 * 九宫格切完以后右边那段没有对称的形状，怎么调都像被裁掉一角。
 * 宁缺勿滥 —— 放一个自己看着别扭的预设，比少一个更糟。
 */
export const BUBBLE_SHAPES: ShapePreset[] = [
  { id: 'shape-cloud', name: '云朵', draw: cloud, slice: [30, 40, 30, 40], width: [24, 30, 24, 30] },
  { id: 'shape-notepad', name: '便笺', draw: notepad, slice: [40, 30, 26, 40], width: [30, 22, 20, 30] },
  { id: 'shape-speech', name: '对话框', draw: speech, slice: [26, 30, 44, 30], width: [18, 22, 34, 22] },
  { id: 'shape-stamp', name: '邮票', draw: stamp, slice: [30, 40, 30, 40], width: [22, 30, 22, 30] },
];

export function shapePresetOf(id: string): ShapePreset | undefined {
  return BUBBLE_SHAPES.find((item) => item.id === id);
}

/**
 * 把预设画成 data URI。
 *
 * 用 encodeURIComponent 而不是 base64：体积小三分之一，而且源码可读 ——
 * 出问题时能直接在 DevTools 里看出是哪个形状。
 */
export function shapeDataUri(preset: ShapePreset, fill: string, stroke: string): string {
  return `data:image/svg+xml,${encodeURIComponent(wrap(preset.draw(fill, stroke)))}`;
}

/** 给定 shapeId，造一份带默认切片的 BubbleShape */
export function shapeOf(id: string): BubbleShape | undefined {
  const preset = shapePresetOf(id);
  if (!preset) return undefined;
  return {
    shapeId: preset.id,
    slice: [...preset.slice] as BubbleShape['slice'],
    width: [...preset.width] as BubbleShape['width'],
    fillMode: 'stretch',
  };
}
