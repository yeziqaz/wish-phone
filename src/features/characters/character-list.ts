import { listCharacters } from '../../core/db';
import type { Character } from '../../core/types';
import { esc } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { characterSummary, hasGreeting } from './shared';
import './characters.css';

/* ==========================================================================
   角色列表

   点一张卡进编辑页。以后导入角色卡（PNG / JSON）也从这个页面的「+」进。
   ========================================================================== */

function cardHTML(character: Character): string {
  const meta: string[] = [];
  if (hasGreeting(character)) meta.push('有开场白');
  if (character.spec !== 'manual') meta.push('导入的卡');

  return `
    <button class="char-card jelly" type="button" data-go="/character/${esc(character.id)}">
      ${avatarHTML(character.name || '未命名', 52)}
      <span class="char-card__text">
        <span class="char-card__name">${esc(character.name || '未命名')}</span>
        <span class="char-card__desc">${esc(characterSummary(character))}</span>
        ${meta.length > 0 ? `<span class="char-card__meta">${esc(meta.join(' · '))}</span>` : ''}
      </span>
      <span class="char-card__tail">${line('chevron', 18)}</span>
    </button>`;
}

const EMPTY = `
  <div class="empty">
    <p class="empty__title">还没有角色</p>
    <p class="empty__hint">点右上角的「+」手动创建，<br>或者等做完角色卡导入再直接把卡拖进来。</p>
  </div>`;

export async function mountCharacterList(root: HTMLElement): Promise<void> {
  const characters = await listCharacters();

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">角色</h1>
        <button class="topbar__action jelly" type="button" data-go="/character/new"
                aria-label="新建角色">${line('plus', 22)}</button>
      </header>

      <div class="char-list">
        ${characters.length === 0 ? EMPTY : characters.map(cardHTML).join('')}
      </div>
    </div>`;

  // 从编辑页返回时路由会重新挂载这个页面，所以这里不需要额外监听
}
