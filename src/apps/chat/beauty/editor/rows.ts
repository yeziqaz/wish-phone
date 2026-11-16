/* ==========================================================================
   美化面板的通用行

   这些都是纯函数：输入数据，输出 HTML 字符串，不碰 DOM、不读全局状态。
   抽出来是因为五个板块（头像/气泡/背景/字体/界面）都要用它们 ——
   放在 panel.ts 里会变成"谁都能改，改坏了不知道影响哪儿"。

   事件绑定不在这里：面板用一个统一的 click 委托，
   靠 data-color / data-range / data-seg 这些属性认领。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import { assetUrl } from '../store';
import { pendantSVG } from '../pendant';
import type { PendantPreset } from '../model';

/** 分段控件（一排按钮，选中项反色） */
export function segRow(
  name: string,
  options: Array<{ id: string; label: string }>,
  current: string,
): string {
  return `<div class="beauty-seg" role="group">${options
    .map(
      (item) =>
        `<button class="beauty-seg__item${item.id === current ? ' is-on' : ''}" type="button" ` +
        `data-seg="${esc(name)}" data-seg-value="${esc(item.id)}" aria-pressed="${item.id === current}">` +
        `${esc(item.label)}</button>`,
    )
    .join('')}</div>`;
}

/** 颜色行 */
export function colorRow(path: string, label: string, value: string): string {
  return `<label class="beauty-field">
    <span class="beauty-field__label">${esc(label)}</span>
    <input class="beauty-color" type="color" value="${esc(value)}" data-color="${esc(path)}" aria-label="${esc(label)}">
  </label>`;
}

/** 滑杆行 */
export function rangeRow(
  path: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 1,
  suffix = '',
): string {
  return `<label class="beauty-field beauty-field--range">
    <span class="beauty-field__label">${esc(label)}<output class="beauty-field__out">${value}${suffix}</output></span>
    <input class="beauty-range" type="range" min="${min}" max="${max}" step="${step}" value="${value}"
           data-range="${esc(path)}" aria-label="${esc(label)}">
  </label>`;
}

/** 挂件 / 贴纸卡片（导入的图片优先，否则画预设 SVG） */
export function pendantCard(item: PendantPreset, selected: boolean): string {
  const url = assetUrl(item.id);
  const visual = url
    ? `<img class="beauty-card__img" src="${esc(url)}" alt="">`
    : `<span class="beauty-card__art">${pendantSVG(item)}</span>`;
  return `<button class="beauty-card${selected ? ' is-on' : ''}" type="button"
            data-pendant="${esc(item.id)}" data-pendant-type="${esc(item.type)}"
            aria-pressed="${selected}">
    ${visual}<small class="beauty-card__name">${esc(item.name)}</small>
  </button>`;
}

/** 已添加贴纸的横向胶囊 */
export function chipRow(
  items: Array<{ id: string; label: string }>,
  activeId: string,
  dataAttr: string,
): string {
  return `<div class="beauty-chips">${items
    .map(
      (item) =>
        `<button class="beauty-chip${activeId === item.id ? ' is-on' : ''}" type="button"
           ${dataAttr}="${esc(item.id)}" aria-pressed="${activeId === item.id}">${esc(item.label)}</button>`,
    )
    .join('')}</div>`;
}
