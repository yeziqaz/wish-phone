import { listCharacters, listWorldbooks, newId, putWorldbook } from '../../core/db';
import { esc } from '../../core/dom';
import type { Worldbook } from '../../core/types';
import { line } from '../../ui/icons';
import './lore.css';

/* ==========================================================================
   世界书 · 列表

   设置页是「目录」，这里也是目录：一眼看到有哪几本、各有多少条目、
   有没有真的挂到角色身上。真正的编辑在 /settings/lore/:id。

   ⚠️ 铁律：世界书**只对挂了它的角色生效**，没挂就不注入。
      所以列表里要显示「几个角色在用」，让用户一眼看出自己写的书是不是白写了。
   ========================================================================== */

/** 默认书名：世界书 1、世界书 2…… */
function nextName(books: Worldbook[]): string {
  const used = new Set(books.map((book) => book.name));
  for (let index = 1; index < 200; index += 1) {
    const name = `世界书 ${index}`;
    if (!used.has(name)) return name;
  }
  return '世界书';
}

function subtitle(book: Worldbook, mountedBy: number): string {
  if (book.entries.length === 0) return '还没有条目';
  const constant = book.entries.filter((entry) => entry.enabled && entry.constant).length;
  const parts = [`${book.entries.length} 个条目`];
  if (constant > 0) parts.push(`常驻 ${constant}`);
  parts.push(mountedBy > 0 ? `${mountedBy} 个角色在用` : '还没挂到角色');
  return parts.join(' · ');
}

export async function mountLoreList(root: HTMLElement): Promise<void> {
  const [books, characters] = await Promise.all([listWorldbooks(), listCharacters()]);

  const rows = books
    .map((book) => {
      const mountedBy = characters.filter((character) =>
        character.worldbookIds?.includes(book.id),
      ).length;
      return `
        <button class="nav-item" type="button" data-go="/settings/lore/${esc(book.id)}">
          <span class="nav-item__text">
            <span class="nav-item__title">${esc(book.name)}</span>
            <span class="nav-item__sub">${esc(subtitle(book, mountedBy))}</span>
          </span>
          <span class="nav-item__tail">${line('chevron', 18)}</span>
        </button>`;
    })
    .join('');

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">世界书</h1>
        <button class="topbar__action jelly" type="button" id="lore-new"
                aria-label="新建世界书">${line('plus', 22)}</button>
      </header>

      <p class="lore-hint">
        世界书只在<strong>挂到角色身上</strong>时才生效。提到关键词才补上那一段，常驻的每轮都带上。
      </p>

      ${
        books.length === 0
          ? `<div class="empty">
               <p class="empty__title">还没有世界书</p>
               <p class="empty__hint">点右上角的「+」写一本，写好之后去角色档案里挂上。</p>
             </div>`
          : `<div class="nav-group">${rows}</div>`
      }

      <p class="page-foot">世界书 / 正则 / 预设是三件不同的事：世界书决定「往里加什么」。</p>
    </div>`;

  const newButton = root.querySelector<HTMLButtonElement>('#lore-new');
  newButton?.addEventListener('click', () => {
    void (async () => {
      newButton.disabled = true;
      const now = Date.now();
      const book: Worldbook = {
        id: newId(),
        name: nextName(books),
        note: '',
        entries: [],
        createdAt: now,
        updatedAt: now,
      };
      await putWorldbook(book);
      location.hash = `/settings/lore/${book.id}`;
    })();
  });
}
