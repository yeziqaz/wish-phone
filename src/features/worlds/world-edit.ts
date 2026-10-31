import {
  countCharactersInBranch,
  deleteWorldData,
  getWorld,
  listBranches,
  listWorlds,
  putWorld,
} from '../../core/db';
import { esc, find, must } from '../../core/dom';
import { back } from '../../core/router';
import {
  createWorld,
  forkBranch,
  getActiveWorldId,
  setActiveWorldId,
  switchTimeline,
} from '../../core/worlds';
import type { Branch } from '../../core/types';
import { line } from '../../ui/icons';
import './worlds.css';

/* ==========================================================================
   世界详情

   两件事：
     1. 改世界的名字和设定（设定会进提示词，所以认真写）
     2. 管时间线 —— 平行时空就是「世界设定不变，角色另存一份」

   新建（/world/new）是同一个文件的另一条分支，省得两套表单长得不一样。
   ========================================================================== */

function notFound(backTo: string): string {
  return `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="${backTo}" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">找不到</h1>
      </header>
      <p class="field__note">这个世界已经不在了，可能刚被删掉。</p>
    </div>`;
}

/* ============================ 新建 ============================ */

async function mountNewWorld(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" id="w-back" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">新建世界</h1>
      </header>

      <label class="field">
        <span class="field__label">名字</span>
        <input class="input" id="w-name" type="text" autocomplete="off" spellcheck="false"
               placeholder="比如：现代都市、雾港、七月的学校">
      </label>

      <label class="field">
        <span class="field__label">世界设定</span>
        <textarea class="input textarea" id="w-desc" rows="6" spellcheck="false"
                  placeholder="这是个什么样的地方。年代、城市、规则，还有「你」在这里是谁。"></textarea>
        <span class="field__hint">这段会进提示词，写得越具体，角色越不会跑偏。</span>
      </label>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="w-create">创建世界</button>
      </div>
      <p class="field__note" id="w-result"></p>
    </div>`;

  must(root, '#w-back').addEventListener('click', () => back());

  must(root, '#w-create').addEventListener('click', () => {
    void (async () => {
      const name = must<HTMLInputElement>(root, '#w-name').value.trim();
      const desc = must<HTMLTextAreaElement>(root, '#w-desc').value;
      const result = must<HTMLElement>(root, '#w-result');

      if (!name) {
        result.textContent = '给世界起个名字吧。';
        result.className = 'field__note is-bad';
        return;
      }

      try {
        await createWorld(name, desc);
        // 直接回角色页 —— 新世界是空的，用户下一步就是往里面放人
        location.hash = '/character';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.textContent = `创建失败：${message}`;
        result.className = 'field__note is-bad';
      }
    })();
  });
}

/* ============================ 详情 ============================ */

function branchRowHTML(branch: Branch, currentId: string, count: number): string {
  const current = branch.id === currentId;
  return `
    <div class="branch-item">
      <div class="branch-item__main">
        <div class="branch-item__title">
          <span class="branch-item__name">${esc(branch.name)}</span>
          ${current ? '<span class="branch-item__now">当前</span>' : ''}
        </div>
        ${branch.note ? `<p class="branch-item__note">${esc(branch.note)}</p>` : ''}
        <p class="branch-item__meta">${count} 个角色</p>
      </div>
      ${
        current
          ? ''
          : `<button class="btn btn--ghost branch-item__go" type="button" data-switch="${esc(branch.id)}">进入</button>`
      }
    </div>`;
}

export async function mountWorldEdit(root: HTMLElement, id: string): Promise<void> {
  if (id === 'new') {
    await mountNewWorld(root);
    return;
  }

  const initial = await getWorld(id);
  if (!initial) {
    root.innerHTML = notFound('/settings/worlds');
    return;
  }

  const paint = async (): Promise<void> => {
    const world = await getWorld(id);
    if (!world) {
      root.innerHTML = notFound('/settings/worlds');
      return;
    }
    const branches = await listBranches(world.id);
    const counts = new Map<string, number>();
    for (const branch of branches) counts.set(branch.id, await countCharactersInBranch(branch.id));

    const worldCount = (await listWorlds()).length;
    const isOnlyWorld = worldCount <= 1;

    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" id="w-back" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title" id="w-title">${esc(world.name)}</h1>
        </header>

        <section class="fold">
          <button class="fold__head" type="button" data-fold aria-expanded="true">
            基本信息<span class="fold__chevron">${line('chevron', 16)}</span>
          </button>
          <div class="fold__body">
            <label class="field">
              <span class="field__label">名字</span>
              <input class="input" id="w-name" type="text" autocomplete="off" spellcheck="false"
                     value="${esc(world.name)}" placeholder="世界名">
            </label>
            <label class="field">
              <span class="field__label">世界设定</span>
              <textarea class="input textarea" id="w-desc" rows="6" spellcheck="false"
                        placeholder="这是个什么样的地方">${esc(world.description)}</textarea>
              <span class="field__hint">这段会进提示词。改完记得点下面的「保存」。</span>
            </label>
          </div>
        </section>

        <section class="fold">
          <button class="fold__head" type="button" data-fold aria-expanded="true">
            时间线（平行时空）<span class="fold__chevron">${line('chevron', 16)}</span>
          </button>
          <div class="fold__body">
            <p class="field__hint">世界设定不变，角色各存一份。想重开一条「如果当时选的是另外一个人」的线，就复制一条。</p>
            <div class="branch-list">
              ${branches.map((b) => branchRowHTML(b, world.activeBranchId, counts.get(b.id) ?? 0)).join('')}
            </div>

            <button class="btn" type="button" id="fork-toggle">复制一条新时间线</button>
            <div class="fork-form" id="fork-form" hidden>
              <label class="field">
                <span class="field__label">新时间线的名字</span>
                <input class="input" id="fork-name" type="text" autocomplete="off" spellcheck="false"
                       placeholder="比如：另一条线、如果那天没分手">
              </label>
              <label class="field">
                <span class="field__label">和原来哪里不一样（可选）</span>
                <textarea class="input textarea" id="fork-note" rows="3" spellcheck="false"
                          placeholder="比如：这一条里男朋友是陈默。"></textarea>
              </label>
              <button class="btn btn--primary jelly" type="button" id="fork-create">复制出新时空</button>
            </div>
          </div>
        </section>

        <div class="row-actions row-actions--main">
          <button class="btn btn--primary jelly" type="button" id="w-save">保存</button>
        </div>
        <p class="field__note" id="w-result"></p>

        <div class="danger-zone">
          <h2 class="danger-zone__title">删除这个世界</h2>
          <p class="danger-zone__hint">
            连同这个世界里 ${branches.reduce((n, b) => n + (counts.get(b.id) ?? 0), 0)} 个角色一起删掉，不能恢复。
            ${
              isOnlyWorld
                ? '这是最后一个世界，至少要留一个。'
                : '只想重来的话，更推荐复制一条时间线。'
            }
          </p>
          <button class="btn btn--danger jelly" type="button" id="w-delete"
                  ${isOnlyWorld ? 'disabled' : ''}>删除</button>
        </div>
      </div>`;

    /* ---------- 折叠 ---------- */
    root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
      head.addEventListener('click', () => {
        const expanded = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!expanded));
        const body = head.nextElementSibling;
        if (body instanceof HTMLElement) body.hidden = expanded;
      });
    });

    must(root, '#w-back').addEventListener('click', () => back());

    /* ---------- 保存 ---------- */
    must(root, '#w-save').addEventListener('click', () => {
      void (async () => {
        const result = must<HTMLElement>(root, '#w-result');
        const name = must<HTMLInputElement>(root, '#w-name').value.trim();
        const desc = must<HTMLTextAreaElement>(root, '#w-desc').value;
        if (!name) {
          result.textContent = '名字不能空着。';
          result.className = 'field__note is-bad';
          return;
        }
        try {
          await putWorld({ ...world, name, description: desc, updatedAt: Date.now() });
          must<HTMLElement>(root, '#w-title').textContent = name;
          result.textContent = '已保存。';
          result.className = 'field__note is-ok';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.textContent = `保存失败：${message}`;
          result.className = 'field__note is-bad';
        }
      })();
    });

    /* ---------- 切换时间线 ---------- */
    root.querySelectorAll<HTMLElement>('[data-switch]').forEach((button) => {
      button.addEventListener('click', () => {
        const branchId = button.dataset.switch ?? '';
        if (!branchId) return;
        void switchTimeline(world.id, branchId).then(paint);
      });
    });

    /* ---------- 复制平行时空 ---------- */
    const forkForm = must<HTMLElement>(root, '#fork-form');
    must(root, '#fork-toggle').addEventListener('click', () => {
      forkForm.hidden = !forkForm.hidden;
    });

    must(root, '#fork-create').addEventListener('click', () => {
      void (async () => {
        const result = must<HTMLElement>(root, '#w-result');
        const current = branches.find((b) => b.id === world.activeBranchId) ?? branches[0];
        if (!current) return;

        const name = find<HTMLInputElement>(root, '#fork-name')?.value.trim() ?? '';
        const note = find<HTMLTextAreaElement>(root, '#fork-note')?.value ?? '';
        if (!name) {
          result.textContent = '给新的时间线起个名字。';
          result.className = 'field__note is-bad';
          return;
        }

        try {
          const created = await forkBranch(world, current, name, note);
          await switchTimeline(world.id, created.id);
          await paint();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.textContent = `复制失败：${message}`;
          result.className = 'field__note is-bad';
        }
      })();
    });

    /* ---------- 删除世界（点一次变确认，再点才删） ---------- */
    const deleteButton = must<HTMLButtonElement>(root, '#w-delete');
    let armed = false;
    let timer = 0;
    deleteButton.addEventListener('click', () => {
      if (deleteButton.disabled) return;
      if (!armed) {
        armed = true;
        deleteButton.textContent = '确认删除';
        timer = window.setTimeout(() => {
          armed = false;
          deleteButton.textContent = '删除';
        }, 3000);
        return;
      }
      window.clearTimeout(timer);
      void (async () => {
        const activeId = await getActiveWorldId();
        await deleteWorldData(world.id);
        if (activeId === world.id) {
          const rest = await listWorlds();
          if (rest[0]) await setActiveWorldId(rest[0].id);
        }
        location.hash = '/settings/worlds';
      })();
    });
  };

  await paint();
}
