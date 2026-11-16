/* ==========================================================================
   板块：字体

   只有字号和颜色。自定义字体文件导入还没做（需要 FontFace API + 字体文件存储），
   这里如实写出来，不假装能点。
   ========================================================================== */

import type { BeautyScheme } from '../model';
import { colorRow, rangeRow } from './rows';

export function fontTabHTML(scheme: BeautyScheme): string {
  return `<h2 class="beauty-h2">字体</h2>
    <p class="beauty-note">自定义字体导入还没做（需要字体文件存储）。下面的字号和颜色现在就能用。</p>
    ${rangeRow('font.size', '字号', scheme.font.size, 12, 24, 1, 'px')}
    ${colorRow('font.color', '文字颜色', scheme.font.color)}`;
}
