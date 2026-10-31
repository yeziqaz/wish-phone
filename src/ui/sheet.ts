import './sheet.css';
import { esc } from '../core/dom';

/* ==========================================================================
   底部抽屉（bottom sheet）

   用途：一屏里要从一大堆东西里挑几项时用它，例如「拉取模型」。
   放在 ui/ 而不是 features/ 里，因为角色、聊天以后也会用到同一套。

   用法：
     const picked = await openSheet({ title: '选择模型', items: [...] });
     picked 为 null 表示用户取消了。
   ========================================================================== */

export interface SheetItem {
  id: string;
  label: string;
  /** 名字右边的小字，例如上下文长度 */
  meta?: string;
  /** 已经在列表里了：显示成「已添加」，勾不上 */
  taken?: boolean;
}

export interface SheetConfig {
  title: string;
  items: SheetItem[];
  /** 想分组就传：给每一项一个组名；不传就一坨列出来 */
  groupOf?: (item: SheetItem) => string;
  /** 一个都没有时的提示 */
  emptyText?: string;
  /** 确认按钮的文案，默认「添加 N 个」 */
  confirmLabel?: (count: number) => string;
}

export function openSheet(config: SheetConfig): Promise<SheetItem[] | null> {
  return new Promise((resolve) => {
    const selected = new Set<string>();
    const groupOf = config.groupOf;
    const confirmLabel = config.confirmLabel ?? ((count: number) => `添加 ${count} 个`);

    const items = config.items;
    const byId = new Map(items.map((item) => [item.id, item]));

    // 按组整理，组的先后 = 首次出现的先后
    const groups = new Map<string, SheetItem[]>();
    for (const item of items) {
      const name = groupOf ? groupOf(item) : '';
      const list = groups.get(name);
      if (list) list.push(item);
      else groups.set(name, [item]);
    }

    const root = document.createElement('div');
    root.className = 'sheet';
    root.innerHTML = `
      <div class="sheet__mask" data-close></div>
      <div class="sheet__panel" role="dialog" aria-modal="true" aria-label="${esc(config.title)}">
        <div class="sheet__grip"></div>
        <header class="sheet__head">
          <h2 class="sheet__title">${esc(config.title)}</h2>
          <button class="sheet__close" type="button" data-close aria-label="关闭">✕</button>
        </header>
        <input class="input sheet__search" type="search" autocomplete="off"
               spellcheck="false" placeholder="搜索">
        <div class="sheet__list" id="sheet-list"></div>
        <footer class="sheet__foot">
          <button class="btn jelly" type="button" data-close>取消</button>
          <button class="btn btn--primary jelly" type="button" data-ok disabled>添加 0 个</button>
        </footer>
      </div>`;

    const list = root.querySelector<HTMLElement>('#sheet-list');
    const okButton = root.querySelector<HTMLButtonElement>('[data-ok]');
    const search = root.querySelector<HTMLInputElement>('.sheet__search');

    /** 重新画列表。搜索框在外面，所以这里重建不会打断输入 */
    const paint = (query: string): void => {
      if (!list) return;
      if (items.length === 0) {
        list.innerHTML = `<p class="sheet__empty">${esc(config.emptyText ?? '没有可选项')}</p>`;
        return;
      }

      const hit = (item: SheetItem): boolean =>
        !query ||
        item.id.toLowerCase().includes(query) ||
        item.label.toLowerCase().includes(query);

      const html: string[] = [];
      let shownTotal = 0;
      for (const [name, groupItems] of groups) {
        const shown = groupItems.filter(hit);
        if (shown.length === 0) continue;
        shownTotal += shown.length;
        const allPicked = shown.every((item) => item.taken || selected.has(item.id));
        html.push(`
          <section class="sheet__group">
            ${
              name
                ? `<div class="sheet__group-head">
                     <span class="sheet__group-name">${esc(name)}</span>
                     <span class="sheet__group-count">${shown.length}</span>
                     <button class="sheet__group-all" type="button" data-group-all="${esc(name)}"
                             ${allPicked ? 'disabled' : ''}>${allPicked ? '已全选' : '全选'}</button>
                   </div>`
                : ''
            }
            ${shown
              .map(
                (item) => `
              <label class="sheet__item${item.taken ? ' is-taken' : ''}">
                <input type="checkbox" data-item="${esc(item.id)}"
                       ${item.taken ? 'disabled' : ''}
                       ${selected.has(item.id) ? 'checked' : ''}>
                <span class="sheet__item-label">${esc(item.label)}</span>
                <span class="sheet__item-meta">${esc(item.taken ? '已添加' : (item.meta ?? ''))}</span>
              </label>`,
              )
              .join('')}
          </section>`);
      }

      list.innerHTML =
        shownTotal === 0
          ? '<p class="sheet__empty">没有匹配的项</p>'
          : html.join('');
    };

    const syncConfirm = (): void => {
      if (!okButton) return;
      okButton.disabled = selected.size === 0;
      okButton.textContent = confirmLabel(selected.size);
    };

    const close = (result: SheetItem[] | null): void => {
      root.classList.remove('is-open');
      const done = (): void => {
        root.remove();
        resolve(result);
      };
      root.addEventListener('transitionend', done, { once: true });
      // 万一动画被系统关掉了，兜底
      window.setTimeout(done, 400);
    };

    // 点背景、点取消、点 ✕ 都关掉
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]')) {
        close(null);
        return;
      }
      if (target.closest('[data-ok]')) {
        close([...selected].map((id) => byId.get(id)).filter(Boolean) as SheetItem[]);
        return;
      }
      const all = target.closest<HTMLElement>('[data-group-all]');
      if (all) {
        const name = all.dataset.groupAll ?? '';
        const groupItems = (groups.get(name) ?? []).filter((item) => !item.taken && hitForQuery(item));
        for (const item of groupItems) selected.add(item.id);
        paint(currentQuery());
        syncConfirm();
      }
    });

    const currentQuery = (): string => (search?.value ?? '').trim().toLowerCase();
    const hitForQuery = (item: SheetItem): boolean => {
      const q = currentQuery();
      return !q || item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q);
    };

    root.addEventListener('change', (e) => {
      const box = (e.target as HTMLInputElement).closest<HTMLInputElement>('[data-item]');
      if (!box) return;
      const id = box.dataset.item ?? '';
      if (box.checked) selected.add(id);
      else selected.delete(id);
      paint(currentQuery());
      syncConfirm();
    });

    root.addEventListener('input', (e) => {
      if ((e.target as HTMLElement).matches('.sheet__search')) paint(currentQuery());
    });

    document.body.appendChild(root);
    paint('');
    syncConfirm();
    // 下一帧再加 is-open，让滑上来的动画跑起来
    requestAnimationFrame(() => root.classList.add('is-open'));
  });
}
