/* ==========================================================================
   头像挂件的 SVG

   ⚠️ 逐字移植自用户自己的项目：components/AvatarPendantFrame.vue
      作者本人授权照抄。路径坐标、stroke-width、stroke-linejoin 一个数字没改。

   唯一的改动：
     - `<template v-if>` / `v-for` 换成字符串拼接（本项目不许用 Vue）
     - 颜色仍是 `currentColor`，由调用方从预设的 color 字段注入
     - 原来写在 `.style` 里的 `color: preset.color` 变成一个 style 属性

   为什么保留 <text> 里的字符（✿ ✧ ♡）：原项目就是这么画的 ——
   四个角上放字符当装饰点，比手画花瓣更轻，也不会因为缩放变糊。
   ========================================================================== */

import type { PendantPreset } from './model';

/** 原项目里画 `stroke-dasharray` 的那个框 */
const LACE_ID = 'frame-lace';

/** 四个角上的装饰点坐标（原 v-for 的数组） */
const CORNER_POINTS: Array<[number, number]> = [
  [18, 20],
  [81, 25],
  [14, 78],
  [76, 88],
];

/**
 * 生成一个挂件框的 SVG 内容。
 *
 * `id` 为 'frame-cat' 时走猫耳朵那套（含耳朵、眼睛、胡须、两个腮红椭圆），
 * 其余走「四角字符 + 可能的球体」那套。
 */
export function pendantFrameSVG(id: string, color: string): string {
  const dash = id === LACE_ID ? ' stroke-dasharray="2 4"' : '';
  const ring = `<circle cx="50" cy="50" r="37" stroke="currentColor" stroke-width="2"${dash} />`;

  if (id === 'frame-cat') {
    return (
      `<svg viewBox="0 0 100 100" fill="none" style="color:${color}" aria-hidden="true" focusable="false">` +
      ring +
      // 耳朵：一整块白底 + 粉描边，盖在圆环上方
      '<path d="M48 17 48 4 59 10Q67 6 76 11L87 7 85 26Q70 36 53 27Z" fill="#fff8f5" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" />' +
      // 眼睛 + 嘴
      '<path d="M60 19v2m14-2v2m-8 2q2 3 4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" />' +
      // 两个腮红
      '<ellipse cx="53" cy="29" rx="5" ry="4" fill="#fff8f5" stroke="currentColor" stroke-width="2" />' +
      '<ellipse cx="79" cy="30" rx="5" ry="4" fill="#fff8f5" stroke="currentColor" stroke-width="2" />' +
      // 胡须
      '<path d="m9 39-6-2m6 9H2m88-3 7-2m-6 10 7 1" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />' +
      '</svg>'
    );
  }

  const glyph = id === 'frame-blossom' ? '✿' : id === 'frame-orbit' ? '✧' : '♡';
  const corners = CORNER_POINTS.map(
    ([x, y], index) =>
      `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="${index % 2 ? 20 : 15}">${glyph}</text>`,
  ).join('');

  // 星球环：右上角一颗小星球
  const planet =
    id === 'frame-orbit'
      ? '<circle cx="79" cy="24" r="7" fill="#f8e7bc" stroke="currentColor" stroke-width="2" />'
      : '';

  return (
    `<svg viewBox="0 0 100 100" fill="none" style="color:${color}" aria-hidden="true" focusable="false">` +
    ring +
    corners +
    planet +
    '</svg>'
  );
}

/**
 * 挂件的样子：预设走 SVG，自定义图片走 <img>。
 *
 * @param assetUrl 自定义资源（用户导入的 PNG）的地址；空串表示这是内置预设
 */
export function pendantSVG(preset: PendantPreset | undefined, assetUrl = ''): string {
  if (assetUrl) {
    return `<img class="pendant-img" src="${assetUrl}" alt="" loading="lazy" decoding="async">`;
  }
  if (!preset) return '';
  if (preset.type === 'frame' && preset.id.startsWith('frame-')) {
    return pendantFrameSVG(preset.id, preset.color);
  }
  // 贴纸：原项目就是一个字符 + 一圈描边圆
  return `<span class="pendant-glyph" style="color:${preset.color}">${preset.glyph}</span>`;
}
