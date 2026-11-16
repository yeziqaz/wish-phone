/* ==========================================================================
   板块：聊天APP（全局外观）

   只在「我 → 聊天美化」这个作用域下出现。
   单个聊天室里没有「聊天APP背景」这种东西，所以 room 作用域看不到它。

   改的是 chatAppBeauty 这份独立配置，不是角色作用域那份。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import { appAppearanceOf, type AppAppearance } from '../store';

const APP_LABELS: Array<{ key: keyof AppAppearance; label: string }> = [
  { key: 'background', label: '聊天APP背景' },
  { key: 'panel', label: '列表与卡片' },
  { key: 'navigation', label: '顶部与导航栏' },
  { key: 'accent', label: '选中颜色' },
  { key: 'ink', label: '界面文字' },
  { key: 'muted', label: '次要文字' },
];

export function appTabHTML(): string {
  const app = appAppearanceOf();
  const rows = APP_LABELS.map((row) =>
    `<label class="beauty-field">
      <span class="beauty-field__label">${esc(row.label)}</span>
      <input class="beauty-color" type="color" value="${esc(app[row.key])}"
             data-app-color="${esc(row.key)}" aria-label="${esc(row.label)}">
    </label>`,
  ).join('');

  return `<h2 class="beauty-h2">聊天 APP 全局外观</h2>
    <p class="beauty-note">作用于消息列表、通讯录、朋友圈和「我」页面。
      聊天室里的气泡和背景不在这里改 —— 那些属于每个角色自己的配置。</p>
    ${rows}
    <button class="btn beauty-btn" type="button" data-app-reset>恢复默认外观</button>`;
}
