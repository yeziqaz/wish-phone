/* ==========================================================================
   板块：聊天背景

   三层：图片 / 模糊 / 遮罩。
   遮罩的用意是让背景图不抢文字 —— 图太花的时候拉高遮罩，
   文字立刻能读，而不用换一张图。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import type { BeautyScheme } from '../model';
import { assetUrl } from '../store';
import { colorRow, rangeRow } from './rows';

export function backgroundTabHTML(scheme: BeautyScheme): string {
  const bg = scheme.background;
  const url = assetUrl(bg.assetId);

  const preview = url
    ? `<div class="beauty-bg-prev"><img src="${esc(url)}" alt="" style="filter:blur(${bg.blur}px)"></div>`
    : '';

  const clear = bg.assetId
    ? '<button class="btn beauty-btn" type="button" data-clear-bg>移除背景图</button>'
    : '';

  return `<h2 class="beauty-h2">聊天背景</h2>
    <button class="btn beauty-btn beauty-btn--import" type="button" data-import-bg>导入背景图</button>
    ${clear}
    ${preview}
    ${colorRow('background.color', '背景颜色', bg.color)}
    ${rangeRow('background.blur', '模糊', bg.blur, 0, 20)}
    ${rangeRow('background.overlay', '遮罩', Math.round(bg.overlay * 100), 0, 100, 1, '%')}`;
}
