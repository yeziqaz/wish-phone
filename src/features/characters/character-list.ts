import { listCharactersInBranch, listWorlds, putCharacter } from '../../core/db';
import { esc, must } from '../../core/dom';
import { resolveActiveWorld, resolveBranch, switchTimeline, worldMode } from '../../core/worlds';
import type { Branch, Character, World } from '../../core/types';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { characterFromFile } from './card-import';
import { ensureDefaults } from './defaults';
import { characterSummary, hasGreeting } from './shared';
import './characters.css';

/* ==========================================================================
   角色列表 + 世界（世界观）切换

   顶部是世界标签：一个世界一份角色名单。
   世界里有不止一条时间线（平行时空）时，标签下面再多一行时间线。
   「管理」进世界详情页，改设定、开平行时空、删世界。

   切换世界/时间线不跳路由，就地重画 —— 因为地址没变。
   ========================================================================== */

interface ListState {
  worlds: World[];
  world: World;
  branch: Branch;
  characters: Character[];
}

async function loadState(): Promise<ListState | null> {
  const worlds = await listWorlds();
  const world = await resolveActiveWorld(worlds);
  if (!world) return null;
  const branch = await resolveBranch(world);
  if (!branch) return null;

  const characters = await listCharactersInBranch(world.id, branch.id);
  return { worlds, world, branch, characters };
}

function cardHTML(character: Character): string {
  const meta: string[] = [];
  if (character.relationToUser?.trim()) meta.push(character.relationToUser.trim());
  if (hasGreeting(character)) meta.push('有开场白');
  if (character.spec !== 'manual') meta.push('导入的卡');

  return `
    <button class="char-card jelly" type="button" data-go="/character/${esc(character.id)}">
      ${avatarHTML(character.name || '未命名', 52, character.avatarKey)}
      <span class="char-card__text">
        <span class="char-card__name">${esc(character.name || '未命名')}</span>
        <span class="char-card__desc">${esc(characterSummary(character))}</span>
        ${meta.length > 0 ? `<span class="char-card__meta">${esc(meta.join(' · '))}</span>` : ''}
      </span>
      <span class="char-card__tail">${line('chevron', 18)}</span>
    </button>`;
}

function worldTabsHTML(state: ListState): string {
  const tabs = state.worlds
    .map((world) => {
      const active = world.id === state.world.id;
      const label = `<span class="world-tab__name">${esc(world.name)}</span>`;

      // 当前世界：整颗胶囊是「已选中」，右侧单独给一个铅笔进世界编辑。
      // 不加「管理」按钮 —— 用户说不想为改设定跑一趟设置。
      if (active) {
        return `
          <div class="world-tab is-active" role="tab" aria-selected="true">
            <span class="world-tab__label">${label}</span>
            <button class="world-tab__edit" type="button" data-go="/world/${esc(world.id)}"
                    aria-label="编辑这个世界">${line('pencil', 16)}</button>
          </div>`;
      }

      return `
        <button class="world-tab jelly" type="button"
                data-world="${esc(world.id)}" role="tab" aria-selected="false">
          ${label}
        </button>`;
    })
    .join('');

  return `
    <div class="world-tabs" role="tablist" aria-label="世界">
      ${tabs}
      <button class="world-tab world-tab--add jelly" type="button" data-go="/world/new"
              aria-label="新建世界">${line('plus', 18)}</button>
    </div>`;
}

function listHTML(state: ListState): string {
  if (state.characters.length === 0) {
    return `
      <div class="empty">
        <p class="empty__title">这个小世界还是空的</p>
        <p class="empty__hint">点右上角的「+」创建角色，<br>或者导入一张现成的角色卡。</p>
      </div>`;
  }
  return `<div class="char-list">${state.characters.map(cardHTML).join('')}</div>`;
}

export async function mountCharacterList(root: HTMLElement): Promise<void> {
  try {
    await ensureDefaults();
  } catch {
    // 世界/内置角色没准备好也不要白屏，下面会显示提示
  }

  const paint = async (): Promise<void> => {
    const state = await loadState();
    if (!state) {
      root.innerHTML = `
        <div class="page">
          <header class="topbar">
            <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
            <h1 class="topbar__title">角色</h1>
          </header>
          <p class="field__note is-bad">世界数据读不出来，试试重新打开。</p>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/desktop" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">角色</h1>
          ${worldMode(state.world) === 'independent' ? '<span class="world-line__tag">角色独立</span>' : ''}
          <div class="topbar__actions">
            <button class="topbar__action jelly" type="button" id="import-toggle"
                    aria-label="导入角色卡">${line('import', 22)}</button>
            <button class="topbar__action jelly" type="button" data-go="/character/new"
                    aria-label="新建角色">${line('plus', 22)}</button>
          </div>
        </header>

        ${worldTabsHTML(state)}
        <input type="file" id="import-file" accept=".png,.json,image/png,application/json" hidden>
        <p class="field__note" id="import-note"></p>

        ${listHTML(state)}
      </div>`;

    /* ---------- 切换世界 / 时间线 ---------- */
    root.querySelectorAll<HTMLElement>('[data-world]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const id = tab.dataset.world ?? '';
        const world = state.worlds.find((w) => w.id === id);
        if (!world) return;
        // 切到这个世界上一次在看的那条时间线
        void switchTimeline(world.id, world.activeBranchId).then(paint);
      });
    });

    /* ---------- 导入角色卡 ---------- */
    const fileInput = must<HTMLInputElement>(root, '#import-file');
    const note = must<HTMLElement>(root, '#import-note');

    must(root, '#import-toggle').addEventListener('click', () => {
      note.textContent = '';
      note.className = 'field__note';
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      void (async () => {
        note.textContent = '正在读取角色卡…';
        note.className = 'field__note';
        try {
          const character = await characterFromFile(file);
          // 导入的卡落在当前世界 + 当前时间线
          await putCharacter({
            ...character,
            worldId: state.world.id,
            branchId: state.branch.id,
          });
          location.hash = `/character/${character.id}`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          note.textContent = `导入失败：${message}`;
          note.className = 'field__note is-bad';
        } finally {
          // 同一个文件再选一次也要能触发 change
          fileInput.value = '';
        }
      })();
    });
  };

  await paint();
}
