/* ==========================================================================
   板块：方案

   一套方案 = 完整的六板块配置快照。用户可以存多套、随时切。
   默认方案只读 —— 改了它不会生效，而是自动派生一个副本（见 store.ts 的 editActive）。
   这样「恢复默认」永远可用，用户不会把基线改坏却回不去。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import type { BeautyScheme } from '../model';
import { beautyData } from '../store';

export interface SchemeTabState {
  editing: boolean;
  renaming: boolean;
  name: string;
}

export function schemeTabHTML(scheme: BeautyScheme, state: SchemeTabState): string {
  const data = beautyData();

  const list = data.schemes
    .map(
      (item) =>
        `<button class="beauty-scheme${item.id === scheme.id ? ' is-on' : ''}" type="button"
           data-scheme="${esc(item.id)}" aria-pressed="${item.id === scheme.id}">
          <span>${esc(item.name)}</span>
          ${item.readonly ? '<small>只读</small>' : ''}
        </button>`,
    )
    .join('');

  const input =
    state.editing || state.renaming
      ? `<div class="beauty-scheme-new">
           <input class="input beauty-input" id="bp-scheme-name" maxlength="40"
                  placeholder="${state.renaming ? '新方案名称' : '方案名称'}"
                  value="${esc(state.name)}" spellcheck="false">
           <button class="btn btn--primary" type="button" data-scheme-save>保存</button>
         </div>`
      : '';

  // 只读方案不能重命名/删除 —— 那是「恢复默认」的锚点
  const manage = scheme.readonly
    ? ''
    : '<button class="btn beauty-btn" type="button" data-scheme-rename>重命名</button>' +
      '<button class="btn beauty-btn beauty-btn--danger" type="button" data-scheme-remove>删除</button>';

  return `<div class="beauty-schemes">${list}</div>
    ${input}
    <div class="beauty-actions">
      <button class="btn beauty-btn" type="button" data-scheme-add>另存为方案</button>
      ${manage}
    </div>`;
}
