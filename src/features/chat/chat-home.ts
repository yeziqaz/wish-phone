import { listCharacters } from '../../core/db';
import { esc } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import './chat.css';

/* ==========================================================================
   聊天首页：从角色里挑一个开始聊。
   一版只做「每个角色一条会话」，不搞多会话列表。
   ========================================================================== */

export async function mountChatHome(root: HTMLElement): Promise<void> {
  const characters = await listCharacters();

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">聊天</h1>
        <button class="topbar__action jelly" type="button" data-go="/character" aria-label="角色">${line('character', 22)}</button>
      </header>

      ${
        characters.length === 0
          ? `<div class="empty">
               <p class="empty__title">还没有角色</p>
               <p class="empty__hint">先去角色页建一个，再回来聊天。</p>
               <button class="btn btn--primary jelly" type="button" data-go="/character">去角色页</button>
             </div>`
          : `<div class="nav-group">${characters
              .map(
                (character) => `
              <button class="nav-item" type="button" data-go="/chat/${esc(character.id)}">
                ${avatarHTML(character.name || '未命名', 44, character.avatarKey)}
                <span class="nav-item__text">
                  <span class="nav-item__title">${esc(character.name || '未命名')}</span>
                  <span class="nav-item__sub">${esc(character.relationToUser?.trim() || character.description.slice(0, 28) || '开始聊天')}</span>
                </span>
                <span class="nav-item__tail">${line('chevron', 18)}</span>
              </button>`,
              )
              .join('')}</div>`
      }
    </div>`;
}
