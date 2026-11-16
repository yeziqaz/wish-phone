import { deleteWorldbook, getWorldbook, newId, putWorldbook } from '../../core/db';
import { esc, find, must } from '../../core/dom';
import type { Worldbook, WorldbookEntry } from '../../core/types';
import { line } from '../../ui/icons';
import './lore.css';

/* ==========================================================================
   世界书 · 条目编辑

   版面（从上到下）：
     书名 / 一句话说明 → 条目（每条：名字 + 启用 + 正文 + 常驻或关键词）
     → 加条目 → 自动保存提示 → 危险区（删这本书）

   两个刻意的选择：
     1. **自动保存**，没有「保存」按钮。这些是零碎的小段设定，
        用户会写一段就去聊天试一下，多一个保存按钮就多一次丢数据的机会。
     2. 条目**就地展开**，不跳新页面。一条世界书通常只有几条，
        为了改一句话来回跳页太笨重。
   ========================================================================== */

const SAVE_DELAY = 400;

/** 关键词按中英文逗号、顿号、空格切开 */
function parseKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、;；\s]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0),
    ),
  ];
}

function keywordsText(entry: WorldbookEntry): string {
  return entry.keywords.join(', ');
}

function entryHTML(entry: WorldbookEntry): string {
  const keywordMode = !entry.constant;
  return `
    <article class="lore-entry" data-entry="${esc(entry.id)}">
      <div class="lore-entry__top">
        <input class="input lore-entry__name" type="text" autocomplete="off" spellcheck="false"
               data-f="name" value="${esc(entry.name)}" placeholder="条目名（可空）">
        <label class="switch" aria-label="启用这条">
          <input type="checkbox" data-f="enabled" ${entry.enabled ? 'checked' : ''}>
          <span class="switch__track"></span>
        </label>
      </div>

      <textarea class="input textarea" rows="5" spellcheck="false" data-f="content"
                placeholder="提到这件事的时候，模型该知道什么。&#10;&#10;比如：校队是陈默待了三年的地方，他在 3 号位，膝盖受过伤。">${esc(entry.content)}</textarea>

      <div class="lore-mode" role="radiogroup" aria-label="什么时候带上这条">
        <button class="lore-mode__item" type="button" role="radio" data-f="mode"
                data-value="constant" aria-checked="${entry.constant}">常驻</button>
        <button class="lore-mode__item" type="button" role="radio" data-f="mode"
                data-value="keyword" aria-checked="${keywordMode}">关键词触发</button>
      </div>

      <label class="lore-entry__keys" ${keywordMode ? '' : 'hidden'}>
        <input class="input" type="text" autocomplete="off" spellcheck="false"
               data-f="keywords" value="${esc(keywordsText(entry))}" placeholder="校队, 篮球, 3 号">
        <span class="field__hint">逗号隔开，命中任意一个就带上。不填就永远不会被触发。</span>
      </label>

      <button class="lore-entry__del" type="button" data-f="delete">${line('trash', 16)} 删除这条</button>
    </article>`;
}

export async function mountLoreEdit(root: HTMLElement, id: string): Promise<(() => void) | void> {
  const found = await getWorldbook(id);
  if (!found) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/lore" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">找不到</h1>
        </header>
        <p class="field__note">这本世界书已经不在了，可能刚被删掉。</p>
      </div>`;
    return;
  }

  const book: Worldbook = found;

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings/lore" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title" id="lore-title">${esc(book.name)}</h1>
      </header>

      <label class="field">
        <span class="field__label">名字</span>
        <input class="input" id="lore-name" type="text" autocomplete="off" spellcheck="false"
               value="${esc(book.name)}" placeholder="世界书 1">
      </label>

      <label class="field">
        <span class="field__label">一句话说明</span>
        <input class="input" id="lore-note" type="text" autocomplete="off" spellcheck="false"
               value="${esc(book.note)}" placeholder="这本书管什么，比如「篮球校队的人际关系」">
        <span class="field__hint">只给自己看，不进提示词。</span>
      </label>

      <div class="lore-section">
        <span class="lore-section__title">条目</span>
        <span class="lore-section__count tabular" id="lore-count">${book.entries.length}</span>
      </div>

      <div id="lore-entries">
        ${
          book.entries.length === 0
            ? '<p class="lore-empty" id="lore-empty">还没有条目。一条设定写一条，别写成一整篇。</p>'
            : book.entries.map(entryHTML).join('')
        }
      </div>

      <button class="btn lore-add" type="button" id="lore-add">＋ 加一个条目</button>
      <p class="field__note" id="lore-saved">改完自动保存，不用手动存。</p>

      <div class="danger-zone">
        <h2 class="danger-zone__title">删除这本书</h2>
        <p class="danger-zone__hint">
          条目一起删掉，挂过它的角色会自动摘掉这本书。<strong>删了不能恢复。</strong>
        </p>
        <button class="btn btn--danger jelly" type="button" id="lore-delete">删除</button>
      </div>
    </div>`;

  const entriesBox = must<HTMLElement>(root, '#lore-entries');
  const savedNote = must<HTMLElement>(root, '#lore-saved');
  const countLabel = must<HTMLElement>(root, '#lore-count');

  /* ---------- 自动保存 ---------- */
  let timer = 0;

  const flush = async (): Promise<void> => {
    book.updatedAt = Date.now();
    try {
      await putWorldbook(book);
      savedNote.textContent = '已保存。';
      savedNote.className = 'field__note is-ok';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      savedNote.textContent = `保存失败：${message}`;
      savedNote.className = 'field__note is-bad';
    }
  };

  const schedule = (): void => {
    window.clearTimeout(timer);
    savedNote.textContent = '正在保存…';
    savedNote.className = 'field__note';
    timer = window.setTimeout(() => void flush(), SAVE_DELAY);
  };

  const entryOf = (card: HTMLElement): WorldbookEntry | undefined => {
    const key = card.dataset.entry;
    return book.entries.find((entry) => entry.id === key);
  };

  const syncCount = (): void => {
    countLabel.textContent = String(book.entries.length);
    if (book.entries.length > 0) find<HTMLElement>(root, '#lore-empty')?.remove();
  };

  /* ---------- 书名 / 说明 ---------- */
  const nameInput = must<HTMLInputElement>(root, '#lore-name');
  nameInput.addEventListener('input', () => {
    book.name = nameInput.value.trim() || '未命名世界书';
    must<HTMLElement>(root, '#lore-title').textContent = book.name;
    schedule();
  });

  const noteInput = must<HTMLInputElement>(root, '#lore-note');
  noteInput.addEventListener('input', () => {
    book.note = noteInput.value;
    schedule();
  });

  /* ---------- 条目里的一切，都在这个容器上代理 ---------- */
  entriesBox.addEventListener('input', (event) => {
    const field = event.target as HTMLElement;
    const card = field.closest<HTMLElement>('[data-entry]');
    const entry = card ? entryOf(card) : undefined;
    if (!card || !entry) return;

    const which = field.dataset.f;
    if (which === 'name') {
      entry.name = (field as HTMLInputElement).value;
    } else if (which === 'content') {
      entry.content = (field as HTMLTextAreaElement).value;
    } else if (which === 'keywords') {
      entry.keywords = parseKeywords((field as HTMLInputElement).value);
    } else {
      return;
    }
    schedule();
  });

  entriesBox.addEventListener('change', (event) => {
    const field = event.target as HTMLElement;
    const card = field.closest<HTMLElement>('[data-entry]');
    const entry = card ? entryOf(card) : undefined;
    if (!card || !entry || field.dataset.f !== 'enabled') return;
    entry.enabled = (field as HTMLInputElement).checked;
    schedule();
  });

  entriesBox.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-entry]');
    const entry = card ? entryOf(card) : undefined;
    if (!card || !entry) return;

    const modeButton = target.closest<HTMLElement>('[data-value]');
    if (modeButton) {
      entry.constant = modeButton.dataset.value === 'constant';
      card.querySelectorAll<HTMLElement>('[data-value]').forEach((item) => {
        item.setAttribute('aria-checked', String(item.dataset.value === modeButton.dataset.value));
      });
      const keys = card.querySelector<HTMLElement>('.lore-entry__keys');
      if (keys) keys.hidden = entry.constant;
      schedule();
      return;
    }

    const del = target.closest('[data-f="delete"]');
    if (del) {
      // 删条目也走「点一次变确认」，避免一条写好的长设定被误删
      if (del.textContent?.includes('确认')) {
        book.entries = book.entries.filter((item) => item.id !== entry.id);
        card.remove();
        syncCount();
        if (book.entries.length === 0) {
          entriesBox.innerHTML = '<p class="lore-empty" id="lore-empty">还没有条目。一条设定写一条，别写成一整篇。</p>';
        }
        schedule();
        return;
      }
      del.textContent = '确认删除';
      window.setTimeout(() => {
        if (del.isConnected) del.innerHTML = `${line('trash', 16)} 删除这条`;
      }, 3000);
    }
  });

  /* ---------- 加条目 ---------- */
  must(root, '#lore-add').addEventListener('click', () => {
    const entry: WorldbookEntry = {
      id: newId(),
      name: '',
      content: '',
      constant: false,
      keywords: [],
      enabled: true,
    };
    book.entries.push(entry);
    find<HTMLElement>(root, '#lore-empty')?.remove();
    entriesBox.insertAdjacentHTML('beforeend', entryHTML(entry));
    syncCount();
    schedule();
    entriesBox
      .querySelector<HTMLElement>(`[data-entry="${entry.id}"] [data-f="content"]`)
      ?.focus();
  });

  /* ---------- 删这本书（点一次变确认） ---------- */
  const deleteButton = must<HTMLButtonElement>(root, '#lore-delete');
  let armed = false;
  let armTimer = 0;
  deleteButton.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      deleteButton.textContent = '确认删除';
      armTimer = window.setTimeout(() => {
        armed = false;
        deleteButton.textContent = '删除';
      }, 3000);
      return;
    }
    window.clearTimeout(armTimer);
    window.clearTimeout(timer);
    void (async () => {
      await deleteWorldbook(book.id);
      location.hash = '/settings/lore';
    })();
  });

  // 离开页面时把还没落库的改动补上（定时器在页面被换掉后不会再跑）
  return () => {
    window.clearTimeout(timer);
    if (savedNote.textContent === '正在保存…') void flush();
  };
}
