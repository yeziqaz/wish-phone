import { esc } from '../../../core/dom';
import { line } from '../../../ui/icons';

/* ==========================================================================
   聊天室右上角「···」的菜单

   用户 2026-11-17 要求分层：
     以前「···」是直通角色档案的，等于把「看这个人是谁」和「调这间屋子的样子」
     两个完全不同的事挤进了一个按钮。现在点开先给一层菜单，里面两项：
       1. 角色档案 —— 人设、照片、开场白（进的是角色 APP 的那一页）
       2. 聊天室美化 —— 气泡、背景、字体（只影响这一间）

   为什么不做成横向工具条（openActionBar）：
     那一套是「贴着某个气泡冒出来」的快捷操作，条目多时挤成一排小字。
     这里是两个带副标题的入口，需要一行一个字说清「点进去能看到什么」，
     所以走底部小面板，和「聊天设置」同一套观感。
   ========================================================================== */

export type RoomMenuChoice = 'dossier' | 'beauty' | null;

export interface RoomMenuConfig {
  title: string;
}

export function openRoomMenu(config: RoomMenuConfig): Promise<RoomMenuChoice> {
  return new Promise((resolve) => {
    let closed = false;

    const root = document.createElement('div');
    root.className = 'chat-settings room-menu';
    root.innerHTML = `
      <div class="chat-settings__mask" data-cancel></div>
      <div class="chat-settings__panel" role="dialog" aria-modal="true"
           aria-label="${esc(config.title)}">
        <div class="chat-settings__grip"></div>
        <header class="chat-settings__head">
          <h2 class="chat-settings__title">${esc(config.title)}</h2>
          <button class="chat-settings__close" type="button" data-cancel aria-label="关闭">✕</button>
        </header>

        <div class="chat-settings__body">
          <section class="cs-group">
            <button class="me-row room-menu__row" type="button" data-pick="dossier">
              <span class="room-menu__icon">${line('character', 20)}</span>
              <span class="room-menu__text">
                <span class="room-menu__title">角色档案</span>
                <span class="room-menu__sub">人设、照片、开场白</span>
              </span>
              <span class="me-row__chevron">${line('chevron', 16)}</span>
            </button>
            <button class="me-row room-menu__row" type="button" data-pick="beauty">
              <span class="room-menu__icon">${line('sparkle', 20)}</span>
              <span class="room-menu__text">
                <span class="room-menu__title">聊天室美化</span>
                <span class="room-menu__sub">气泡、背景、字体</span>
              </span>
              <span class="me-row__chevron">${line('chevron', 16)}</span>
            </button>
          </section>
        </div>
      </div>`;

    const finish = (choice: RoomMenuChoice): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      window.setTimeout(() => {
        root.remove();
        resolve(choice);
      }, 200);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null);
    };

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cancel]')) {
        finish(null);
        return;
      }
      const pick = target.closest<HTMLElement>('[data-pick]');
      const choice = pick?.dataset.pick;
      if (choice === 'dossier' || choice === 'beauty') finish(choice);
    });

    document.body.appendChild(root);
    document.addEventListener('keydown', onKey);
    // 下一帧再加 is-open，让 transform 过渡真的跑起来
    requestAnimationFrame(() => root.classList.add('is-open'));
  });
}
