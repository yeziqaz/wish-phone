/* ==========================================================================
   板块：头像挂件

   两件事共用一个板块，因为它们在视觉上是同一层（都围着头像）：
     边框（frame）—— 环绕头像外围，头像内部留空
     贴纸（sticker）—— 可调位置/缩放/旋转的多张图片

   为什么用「边框 / 贴纸」两个分段而不是两套界面：
   用户心里的模型就是「头像上贴点什么」，先选贴哪儿、再选贴什么。
   ========================================================================== */

import { esc } from '../../../../core/dom';
import { allPendants, type BeautyRole, type BeautyScheme, type Sticker } from '../model';
import { beautyData } from '../store';
import { pendantCard, segRow } from './rows';
import { avatarStickerControls } from './sticker-controls';

export interface AvatarTabState {
  subject: BeautyRole;
  avatarTab: 'frame' | 'sticker';
  category: string;
  selectedSticker: string;
}

export function avatarTabHTML(scheme: BeautyScheme, state: AvatarTabState): string {
  const data = beautyData();
  const participant = scheme.participants[state.subject];
  const pendants = allPendants(data);
  const categories = ['全部', ...new Set(pendants.map((item) => item.category))];
  const filtered = pendants.filter(
    (item) => item.type === state.avatarTab && (state.category === '全部' || item.category === state.category),
  );

  const applied = participant.avatar.stickers;
  const active: Sticker | undefined =
    applied.find((item) => item.assetId === state.selectedSticker) ?? applied.at(-1);

  const categoryChips = categories
    .map(
      (item) =>
        `<button class="beauty-cat${item === state.category ? ' is-on' : ''}" type="button" ` +
        `data-cat="${esc(item)}" aria-pressed="${item === state.category}">${esc(item)}</button>`,
    )
    .join('');

  const grid = filtered
    .map((item) =>
      pendantCard(
        item,
        participant.avatar.frameId === item.id ||
          applied.some((sticker) => sticker.assetId === item.id),
      ),
    )
    .join('');

  const clearFrame =
    state.avatarTab === 'frame' && participant.avatar.frameId
      ? '<button class="btn beauty-btn" type="button" data-clear-frame>移除边框</button>'
      : '';

  const appliedChips = applied.length
    ? `<h2 class="beauty-h2">已添加贴纸</h2>
       <div class="beauty-chips">${applied
         .map((item) => {
           const preset = pendants.find((value) => value.id === item.assetId);
           const on = active?.assetId === item.assetId;
           return `<button class="beauty-chip${on ? ' is-on' : ''}" type="button"
                     data-pick-avatar-sticker="${esc(item.assetId)}"
                     aria-pressed="${on}">${esc(preset?.name ?? '贴纸')}</button>`;
         })
         .join('')}</div>`
    : '';

  return `
    ${segRow('subject', [{ id: 'user', label: '我的头像' }, { id: 'wuli', label: '角色头像' }], state.subject)}
    ${segRow('avatarTab', [{ id: 'frame', label: '边框' }, { id: 'sticker', label: '贴纸' }], state.avatarTab)}
    <div class="beauty-cats">${categoryChips}</div>
    <div class="beauty-grid">${grid}</div>
    ${clearFrame}
    <p class="beauty-note">挂件环绕头像外围，头像内部保持留空。贴纸可调位置、大小和旋转。</p>
    ${appliedChips}
    ${active ? avatarStickerControls(active) : ''}
    <button class="btn beauty-btn beauty-btn--import" type="button" data-import-avatar>
      ${state.avatarTab === 'frame' ? '导入 PNG 头像框' : '导入自定义头像贴纸（PNG）'}
    </button>`;
}
