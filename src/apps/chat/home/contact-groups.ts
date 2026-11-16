import { getSetting, putCharacter, setSetting } from '../../../core/db';
import { esc } from '../../../core/dom';
import type { Character } from '../../../core/types';
import { avatarHTML } from '../../../ui/avatar';
import { line } from '../../../ui/icons';

/* ==========================================================================
   通讯录分组

   默认组名「我的好友」始终存在，不能删；未分配过 group 的角色自动归入其中。
   自定义组名列表存在 settings 表的 `contactGroups` key，不单独建表、不改 schema。
   ========================================================================== */

export const DEFAULT_CONTACT_GROUP = '我的好友';
const CONTACT_GROUPS_KEY = 'contactGroups';

let cachedGroups: string[] = [DEFAULT_CONTACT_GROUP];
const collapsedGroups = new Set<string>();

function normalizeGroupName(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  return name || DEFAULT_CONTACT_GROUP;
}

function mergeGroupList(raw: unknown, characters: Character[]): string[] {
  const result: string[] = [DEFAULT_CONTACT_GROUP];
  const seen = new Set<string>(result);
  const push = (name: string) => {
    const clean = name.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    result.push(clean);
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') push(item);
    }
  }
  for (const character of characters) {
    if (character.group) push(character.group);
  }
  return result;
}

export async function loadContactGroups(characters: Character[]): Promise<string[]> {
  try {
    const saved = await getSetting<unknown>(CONTACT_GROUPS_KEY);
    cachedGroups = mergeGroupList(saved, characters);
  } catch {
    cachedGroups = mergeGroupList(null, characters);
  }
  return [...cachedGroups];
}

export function contactGroupsOf(characters: Character[]): string[] {
  cachedGroups = mergeGroupList(cachedGroups, characters);
  return [...cachedGroups];
}

async function saveContactGroups(groups: string[]): Promise<void> {
  const clean: string[] = [DEFAULT_CONTACT_GROUP];
  const seen = new Set<string>(clean);
  for (const name of groups) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    clean.push(trimmed);
  }
  cachedGroups = clean;
  await setSetting(CONTACT_GROUPS_KEY, clean);
}

export function isGroupCollapsed(group: string): boolean {
  return collapsedGroups.has(group);
}

export function toggleGroupCollapsed(group: string): void {
  if (collapsedGroups.has(group)) collapsedGroups.delete(group);
  else collapsedGroups.add(group);
}

export interface ContactGroupBucket {
  name: string;
  members: Character[];
}

export function groupCharacters(characters: Character[], keyword: string): ContactGroupBucket[] {
  const q = keyword.trim().toLowerCase();
  const filtered = q
    ? characters.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.relationToUser ?? '').toLowerCase().includes(q) ||
          normalizeGroupName(c.group).toLowerCase().includes(q),
      )
    : characters;

  const groups = contactGroupsOf(characters);
  const map = new Map<string, Character[]>();
  for (const name of groups) map.set(name, []);

  for (const character of filtered) {
    const g = normalizeGroupName(character.group);
    const list = map.get(g);
    if (list) list.push(character);
    else map.set(g, [character]);
  }

  const buckets: ContactGroupBucket[] = [];
  for (const [name, members] of map) {
    // 搜索模式下隐藏空分组，非搜索模式展示所有分组（方便看到自己建的新组）
    if (q && members.length === 0) continue;
    buckets.push({ name, members });
  }
  return buckets;
}

export function renderGroupedContactsHTML(characters: Character[], keyword: string): string {
  const buckets = groupCharacters(characters, keyword);
  if (buckets.length === 0) {
    return `<div class="chatapp-empty"><p class="chatapp-empty__hint">没有找到匹配的联系人</p></div>`;
  }

  const searching = keyword.trim().length > 0;

  return buckets
    .map((bucket) => {
      const collapsed = !searching && isGroupCollapsed(bucket.name);
      const rowsHTML = collapsed
        ? ''
        : bucket.members.length === 0
          ? `<div class="cg-empty">暂无联系人</div>`
          : `<ul class="chatapp__list">${bucket.members
              .map(
                (character) => `
              <li>
                <button class="chat-row chat-row--contact" type="button" data-go="/character/${esc(character.id)}">
                  <span class="chat-row__avatar">
                    ${avatarHTML(character.name || '未命名', 44, character.avatarKey, character.avatarFrame)}
                  </span>
                  <span class="chat-row__main">
                    <span class="chat-row__line">
                      <span class="chat-row__name">${esc(character.name || '未命名')}</span>
                    </span>
                    <span class="chat-row__preview">${esc(character.relationToUser?.trim() || character.personality.slice(0, 30) || '还没有写设定')}</span>
                  </span>
                </button>
              </li>`,
              )
              .join('')}</ul>`;

      return `
        <section class="cg-section">
          <button class="cg-head" type="button" data-toggle-group="${esc(bucket.name)}" aria-expanded="${!collapsed}">
            <span class="cg-head__arrow${collapsed ? '' : ' is-open'}">${line('chevron', 16)}</span>
            <span class="cg-head__name">${esc(bucket.name)}</span>
            <span class="cg-head__count tabular">${bucket.members.length}</span>
          </button>
          ${rowsHTML}
        </section>`;
    })
    .join('');
}

/**
 * 底部抽屉：管理分组（新建/删除）以及给联系人分配分组。
 * 直接改写传入的 characters 数组并持久化到 IndexedDB。
 */
export function openGroupManager(characters: Character[], onUpdated: () => void): void {
  const sheet = document.createElement('div');
  sheet.className = 'mo-sheet cg-sheet';

  const renderInner = (): string => {
    const groups = contactGroupsOf(characters);
    return `
      <div class="mo-sheet__mask" data-cg-close></div>
      <div class="mo-sheet__panel" role="dialog" aria-modal="true" aria-label="分组管理">
        <header class="mo-sheet__head">
          <h2 class="mo-sheet__title">分组管理</h2>
          <button class="mo-sheet__close" type="button" data-cg-close aria-label="关闭">✕</button>
        </header>
        <div class="mo-sheet__body cg-sheet__body">
          <div class="cg-add-row">
            <input class="input" id="cg-new-name" type="text" maxlength="20"
                   placeholder="新建分组名称（如：家人、同事）" autocomplete="off" spellcheck="false">
            <button class="btn btn--primary jelly" type="button" id="cg-add-btn">添加</button>
          </div>

          <h3 class="cg-sub">已有分组</h3>
          <ul class="cg-group-list">
            ${groups
              .map(
                (g) => `
              <li class="cg-group-item">
                <span class="cg-group-item__name">${esc(g)}</span>
                ${
                  g === DEFAULT_CONTACT_GROUP
                    ? `<span class="cg-group-item__tag">默认</span>`
                    : `<button class="btn btn--ghost btn--sm" type="button" data-del-group="${esc(g)}">删除</button>`
                }
              </li>`,
              )
              .join('')}
          </ul>

          ${
            characters.length > 0
              ? `
            <h3 class="cg-sub">分配联系人</h3>
            <ul class="cg-assign-list">
              ${characters
                .map((c) => {
                  const current = normalizeGroupName(c.group);
                  return `
                  <li class="cg-assign-item">
                    <span class="cg-assign-item__name">${esc(c.name || '未命名')}</span>
                    <select class="cg-select" data-assign-char="${esc(c.id)}" aria-label="${esc(c.name || '未命名')} 的分组">
                      ${groups
                        .map(
                          (g) => `<option value="${esc(g)}"${g === current ? ' selected' : ''}>${esc(g)}</option>`,
                        )
                        .join('')}
                    </select>
                  </li>`;
                })
                .join('')}
            </ul>`
              : ''
          }
        </div>
      </div>`;
  };

  sheet.innerHTML = renderInner();
  document.body.append(sheet);

  const close = () => {
    sheet.remove();
  };

  sheet.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-cg-close]')) {
      close();
      return;
    }

    if (target.closest('#cg-add-btn')) {
      const input = sheet.querySelector<HTMLInputElement>('#cg-new-name');
      const name = input?.value.trim() ?? '';
      if (!name) return;
      const next = [...contactGroupsOf(characters), name];
      void saveContactGroups(next).then(() => {
        sheet.innerHTML = renderInner();
        onUpdated();
      });
      return;
    }

    const delBtn = target.closest<HTMLElement>('[data-del-group]');
    if (delBtn) {
      const groupName = delBtn.dataset.delGroup;
      if (!groupName || groupName === DEFAULT_CONTACT_GROUP) return;
      void (async () => {
        for (const c of characters) {
          if (normalizeGroupName(c.group) === groupName) {
            c.group = DEFAULT_CONTACT_GROUP;
            c.updatedAt = Date.now();
            await putCharacter(c);
          }
        }
        const next = contactGroupsOf(characters).filter((g) => g !== groupName);
        await saveContactGroups(next);
        sheet.innerHTML = renderInner();
        onUpdated();
      })();
    }
  });

  sheet.addEventListener('change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-assign-char]');
    if (!select) return;
    const charId = select.dataset.assignChar;
    const character = characters.find((c) => c.id === charId);
    if (!character) return;
    character.group = select.value;
    character.updatedAt = Date.now();
    void putCharacter(character).then(() => {
      onUpdated();
    });
  });
}
