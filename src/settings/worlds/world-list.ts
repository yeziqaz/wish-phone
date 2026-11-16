import { listBranches, listCharacters, listWorlds } from '../../core/db';
import { esc } from '../../core/dom';
import { getActiveWorldId, worldMode } from '../../core/worlds';
import type { World } from '../../core/types';
import { line } from '../../ui/icons';
import './worlds.css';

/* ==========================================================================
   世界观列表

   设置页是目录，这里也是目录：一眼看到每个世界有几个角色、当前在用哪个。
   真正的编辑在世界详情页（/world/:id）。
   ========================================================================== */

function worldCardHTML(world: World, count: number, branchName: string, active: boolean): string {
  const mode = worldMode(world) === 'independent' ? '角色独立' : `可关联 · ${branchName}`;
  return `
    <button class="world-card jelly" type="button" data-go="/world/${esc(world.id)}">
      <span class="world-card__head">
        <span class="world-card__name">${esc(world.name)}</span>
        ${active ? '<span class="world-card__now">当前</span>' : ''}
      </span>
      <span class="world-card__desc">${esc(world.description || '还没写设定')}</span>
      <span class="world-card__meta">${count} 个角色 · ${esc(mode)}</span>
      <span class="world-card__tail">${line('chevron', 18)}</span>
    </button>`;
}

export async function mountWorldList(root: HTMLElement): Promise<void> {
  const [worlds, characters, activeId] = await Promise.all([
    listWorlds(),
    listCharacters(),
    getActiveWorldId(),
  ]);

  const cards: string[] = [];
  for (const world of worlds) {
    const branches = await listBranches(world.id);
    const branch = branches.find((b) => b.id === world.activeBranchId) ?? branches[0];
    const count = characters.filter((c) => c.worldId === world.id && c.branchId === branch?.id).length;
    cards.push(worldCardHTML(world, count, branch?.name ?? '主线', world.id === activeId));
  }

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">小世界</h1>
        <button class="topbar__action jelly" type="button" data-go="/world/new"
                aria-label="新建小世界">${line('plus', 22)}</button>
      </header>

      <p class="world-list__hint">
        一个小世界是一套设定 + 一组角色。角色独立 = 每人一条线；角色可关联 = 同一个时空。
      </p>

      ${
        cards.length === 0
          ? '<div class="empty"><p class="empty__title">还没有小世界</p><p class="empty__hint">点右上角的「+」建一个。</p></div>'
          : cards.join('')
      }
    </div>`;
}
