import {
  countCharactersInBranch,
  deleteWorldData,
  getWorld,
  listWorlds,
  putWorld,
} from '../../core/db';
import { esc, find, must } from '../../core/dom';
import { back } from '../../core/router';
import {
  createWorld,
  getActiveWorldId,
  nextWorldName,
  setActiveWorldId,
  worldMode,
} from '../../core/worlds';
import { line } from '../../ui/icons';
import './worlds.css';

/* ==========================================================================
   小世界详情

   只做三件事：改名字、改设定、改「角色独立 / 角色可关联」。
   时间线（平行时空）已经按用户要求整个拿掉了 —— 数据层还留着一条默认主线，
   但界面上不再出现。

   新建（/world/new）是同一个文件的另一条分支。
   ========================================================================== */

type Mode = 'independent' | 'linked';

function modeHint(mode: Mode): string {
  return mode === 'independent'
    ? '每张角色卡自己跑一条线。别的角色不会自动出现；只读这个角色自己的卡和世界书。'
    : '同一个时空。角色可以互相认识，也可以互不认识；记忆会按关系同步。';
}

function modePickerHTML(mode: Mode): string {
  return `
    <div class="mode-pick" role="radiogroup" aria-label="角色关系">
      <button class="mode-pick__item" type="button" data-mode="independent"
              role="radio" aria-checked="${mode === 'independent'}">角色独立</button>
      <button class="mode-pick__item" type="button" data-mode="linked"
              role="radio" aria-checked="${mode === 'linked'}">角色可关联</button>
    </div>
    <p class="field__hint" id="mode-hint">${modeHint(mode)}</p>`;
}

/** 当前页面选中的模式。用 WeakMap 存，不往 DOM 上挂私有字段 */
const modeState = new WeakMap<HTMLElement, Mode>();

function bindModePicker(root: HTMLElement, initial: Mode): void {
  modeState.set(root, initial);
  const hint = find<HTMLElement>(root, '#mode-hint');

  root.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode === 'independent' ? 'independent' : 'linked';
      if (mode === modeState.get(root)) return;
      modeState.set(root, mode);
      root.querySelectorAll<HTMLElement>('[data-mode]').forEach((item) => {
        item.setAttribute('aria-checked', String(item.dataset.mode === mode));
      });
      if (hint) hint.textContent = modeHint(mode);
    });
  });
}

function readMode(root: HTMLElement): Mode {
  return modeState.get(root) === 'independent' ? 'independent' : 'linked';
}

function notFound(): string {
  return `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/character" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">找不到</h1>
      </header>
      <p class="field__note">这个小世界已经不在了，可能刚被删掉。</p>
    </div>`;
}

/* ============================ 新建 ============================ */

async function mountNewWorld(root: HTMLElement): Promise<void> {
  const suggested = await nextWorldName();

  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" id="w-back" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">新建小世界</h1>
      </header>

      <label class="field">
        <span class="field__label">名字</span>
        <input class="input" id="w-name" type="text" autocomplete="off" spellcheck="false"
               value="${esc(suggested)}" placeholder="小世界1">
        <span class="field__hint">不想要名字就保持默认，会自动排成小世界1、小世界2。</span>
      </label>

      <div class="field">
        <span class="field__label">角色关系</span>
        ${modePickerHTML('linked')}
      </div>

      <label class="field">
        <span class="field__label">设定</span>
        <textarea class="input textarea" id="w-desc" rows="6" spellcheck="false"
                  placeholder="这是个什么样的地方。年代、城市、规则，还有「你」在这里是谁。"></textarea>
        <span class="field__hint">这段会进提示词，写得越具体，角色越不会跑偏。</span>
      </label>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="w-create">创建小世界</button>
      </div>
      <p class="field__note" id="w-result"></p>
    </div>`;

  bindModePicker(root, 'linked');
  must(root, '#w-back').addEventListener('click', () => back());

  must(root, '#w-create').addEventListener('click', () => {
    void (async () => {
      const name = must<HTMLInputElement>(root, '#w-name').value.trim();
      const desc = must<HTMLTextAreaElement>(root, '#w-desc').value;
      const result = must<HTMLElement>(root, '#w-result');

      try {
        await createWorld(name, desc, readMode(root));
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

export async function mountWorldEdit(root: HTMLElement, id: string): Promise<void> {
  if (id === 'new') {
    await mountNewWorld(root);
    return;
  }

  const initial = await getWorld(id);
  if (!initial) {
    root.innerHTML = notFound();
    return;
  }

  const world = initial;
  const mode = worldMode(world);
  const characterCount = await countCharactersInBranch(world.activeBranchId);
  const isOnlyWorld = (await listWorlds()).length <= 1;

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
                   value="${esc(world.name)}" placeholder="小世界">
          </label>

          <div class="field">
            <span class="field__label">角色关系</span>
            ${modePickerHTML(mode)}
          </div>

          <label class="field">
            <span class="field__label">设定</span>
            <textarea class="input textarea" id="w-desc" rows="8" spellcheck="false"
                      placeholder="这是个什么样的地方">${esc(world.description)}</textarea>
            <span class="field__hint">这段会进提示词。改完记得点下面的「保存」。</span>
          </label>
        </div>
      </section>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="w-save">保存</button>
      </div>
      <p class="field__note" id="w-result"></p>

      <div class="danger-zone">
        <h2 class="danger-zone__title">删除这个小世界</h2>
        <p class="danger-zone__hint">
          连同这里 ${characterCount} 个角色一起删掉，不能恢复。
          ${isOnlyWorld ? '这是最后一个小世界，至少要留一个。' : ''}
        </p>
        <button class="btn btn--danger jelly" type="button" id="w-delete"
                ${isOnlyWorld ? 'disabled' : ''}>删除</button>
      </div>
    </div>`;

  bindModePicker(root, mode);
  must(root, '#w-back').addEventListener('click', () => back());

  /* ---------- 折叠 ---------- */
  root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
    head.addEventListener('click', () => {
      const expanded = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!expanded));
      const body = head.nextElementSibling;
      if (body instanceof HTMLElement) body.hidden = expanded;
    });
  });

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
        await putWorld({
          ...world,
          name,
          description: desc,
          mode: readMode(root),
          updatedAt: Date.now(),
        });
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

  /* ---------- 删除小世界（点一次变确认，再点才删） ---------- */
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
      location.hash = '/character';
    })();
  });
}
