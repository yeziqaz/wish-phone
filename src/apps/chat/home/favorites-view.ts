import {
  listCharacters,
  listConversations,
  listFavoritedMessages,
  putMessage,
} from '../../../core/db';
import { esc } from '../../../core/dom';
import { displayUserName } from '../../../core/prefs';
import { navigate } from '../../../core/router';
import type { Character, Conversation, Message } from '../../../core/types';
import { line } from '../../../ui/icons';
import './chat-home.css';

/* ==========================================================================
   「收藏」列表页（/chat/favorites）

   入口在「我 → 收藏」。
   展示所有 extra.favorited === true 的消息，按收藏时间（或发送时间）倒序。
   ========================================================================== */

function formatFavTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${m}/${day} ${hh}:${mm}`;
}

export async function mountFavoritesView(root: HTMLElement): Promise<void> {
  const [messages, conversations, characters] = await Promise.all([
    listFavoritedMessages(),
    listConversations(),
    listCharacters(),
  ]);

  const convMap = new Map<string, Conversation>();
  for (const c of conversations) convMap.set(c.id, c);

  const charMap = new Map<string, Character>();
  for (const ch of characters) charMap.set(ch.id, ch);

  const items = messages.slice();

  const renderList = (): string => {
    if (items.length === 0) {
      return `
        <div class="chatapp-empty">
          <p class="chatapp-empty__title">还没有收藏的消息</p>
          <p class="chatapp-empty__hint">在聊天里轻点或长按消息，点「收藏」就能存到这里。</p>
        </div>`;
    }

    const userName = displayUserName();
    return `<ul class="fav-list">${items
      .map((msg) => {
        const conv = convMap.get(msg.conversationId);
        const char = conv ? charMap.get(conv.characterId) : undefined;
        const charName = char?.name || conv?.title || '未知会话';
        const sender = msg.role === 'user' ? `${userName} · ${charName}` : charName;
        const favIso =
          typeof msg.extra?.favoritedAt === 'string' ? msg.extra.favoritedAt : msg.createdAt;
        const timeText = formatFavTime(favIso);
        const canJump = Boolean(conv?.characterId);

        return `
          <li class="fav-card" data-fav-id="${esc(msg.id)}">
            <div class="fav-card__head">
              <span class="fav-card__sender">${esc(sender)}</span>
              <span class="fav-card__time">${esc(timeText)}</span>
            </div>
            <p class="fav-card__content">${esc(msg.content)}</p>
            <div class="fav-card__actions">
              ${
                canJump
                  ? `<button class="fav-card__btn" type="button" data-fav-jump="${esc(conv!.characterId)}">进入对话</button>`
                  : ''
              }
              <button class="fav-card__btn is-muted" type="button" data-fav-remove="${esc(msg.id)}">取消收藏</button>
            </div>
          </li>`;
      })
      .join('')}</ul>`;
  };

  root.innerHTML = `
    <div class="page fav-page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/chat" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">收藏</h1>
      </header>
      <div id="fav-list-wrap">${renderList()}</div>
    </div>`;

  const wrap = root.querySelector<HTMLElement>('#fav-list-wrap');
  if (!wrap) return;

  wrap.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const jumpBtn = target.closest<HTMLElement>('[data-fav-jump]');
    if (jumpBtn) {
      const charId = jumpBtn.dataset.favJump;
      if (charId) navigate(`/chat/${encodeURIComponent(charId)}`);
      return;
    }

    const removeBtn = target.closest<HTMLElement>('[data-fav-remove]');
    if (!removeBtn) return;
    const msgId = removeBtn.dataset.favRemove;
    if (!msgId) return;

    const idx = items.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const msg = items[idx];
    if (!msg) return;

    void (async () => {
      const nextExtra: Record<string, unknown> = { ...(msg.extra ?? {}), favorited: false };
      delete nextExtra.favoritedAt;
      const updated: Message = { ...msg, extra: nextExtra };
      await putMessage(updated);
      items.splice(idx, 1);
      if (items.length === 0) {
        wrap.innerHTML = renderList();
      } else {
        wrap.querySelector(`.fav-card[data-fav-id="${CSS.escape(msgId)}"]`)?.remove();
      }
    })();
  });
}