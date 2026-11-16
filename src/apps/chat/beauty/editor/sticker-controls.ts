/* ==========================================================================
   贴纸的微调控件

   头像贴纸和气泡贴纸的控件长得像但不一样：
     头像贴纸：位置是「头像本体坐标」（±80），没有角标概念
     气泡贴纸：先选贴在气泡哪个角，再在这个角的基准上偏移（±80px）

   所以是两个函数而不是一个带开关的 —— 硬合并会变成一堆 if。
   ========================================================================== */

import { rangeRow } from './rows';
import type { Sticker, StickerCorner } from '../model';

export const CORNER_LABEL: Record<StickerCorner, string> = {
  'top-left': '左上',
  'top-right': '右上',
  'bottom-left': '左下',
  'bottom-right': '右下',
};

export const CORNERS: StickerCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** 头像贴纸：位置 / 缩放 / 旋转 */
export function avatarStickerControls(item: Sticker): string {
  return `<div class="beauty-controls">
    ${rangeRow('avatarSticker.x', '水平位置', item.x, -80, 80)}
    ${rangeRow('avatarSticker.y', '垂直位置', item.y, -80, 80)}
    ${rangeRow('avatarSticker.scale', '缩放', item.scale, 0.3, 3, 0.1)}
    ${rangeRow('avatarSticker.rotation', '旋转', item.rotation, -180, 180, 1, '°')}
    <button class="btn beauty-btn beauty-btn--danger" type="button" data-remove-avatar-sticker>删除此贴纸</button>
  </div>`;
}

/** 气泡贴纸：角标 + 位置 / 缩放 / 旋转 */
export function bubbleStickerControls(item: Sticker): string {
  const corners = CORNERS.map(
    (corner) =>
      `<button class="beauty-chip${item.corner === corner ? ' is-on' : ''}" type="button"
         data-bubble-corner="${corner}" aria-pressed="${item.corner === corner}">${CORNER_LABEL[corner]}</button>`,
  ).join('');

  return `<div class="beauty-controls">
    <div class="beauty-corners">
      <span class="beauty-field__label">贴纸位置</span>
      ${corners}
    </div>
    ${rangeRow('bubbleSticker.x', '水平位置', item.x, -80, 80, 1, 'px')}
    ${rangeRow('bubbleSticker.y', '垂直位置', item.y, -80, 80, 1, 'px')}
    ${rangeRow('bubbleSticker.scale', '缩放', item.scale, 0.3, 3, 0.1)}
    ${rangeRow('bubbleSticker.rotation', '旋转', item.rotation, -180, 180, 1, '°')}
    <button class="btn beauty-btn beauty-btn--danger" type="button" data-remove-bubble-sticker>删除此气泡贴纸</button>
  </div>`;
}
