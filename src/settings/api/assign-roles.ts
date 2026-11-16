import './api.css';
import { bindOnce, esc } from '../../core/dom';
import { listAssignments, listCharacters } from '../../core/db';
import type { Assignment, Capability } from '../../core/api-types';
import type { Character } from '../../core/types';
import { CAPABILITIES, CAPABILITY_LABEL } from '../../core/api-types';
import { line } from '../../ui/icons';
import { assign, clearCustom } from '../../ai/call';
import { openModelPicker } from './model-picker';

/* ==========================================================================
   角色模型设置（设计文档 §7.5）

   列出「做过自定义的角色」，每行显示头像、名字、自定义了哪些能力。
   底部一行灰字说明其余角色跟随全局 / App。
   「＋ 添加角色」从已有角色里挑一个，进去配。

   某个角色的设置页就是这一个页面 + ?role=<id> 展开的那一段。
   ========================================================================== */

export async function mountRoleList(root: HTMLElement): Promise<void> {
  const [characters, assignments] = await Promise.all([listCharacters(), listAssignments()]);

  const customKinds = (characterId: string): Capability[] =>
    CAPABILITIES.filter((kind) =>
      assignments.some(
        (item) => item.scope === 'role' && item.scopeId === characterId && item.kind === kind && !!item.target,
      ),
    );

  const custom = characters.filter((character) => customKinds(character.id).length > 0);
  const others = characters.length - custom.length;

  root.innerHTML = `
    <div class="api-detail">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings/api" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">角色模型设置</h1>
      </header>

      <div class="api-body">
        ${
          custom.length === 0
            ? `<div class="empty">
                 <p class="empty__title">还没有角色单独设过模型</p>
                 <p class="empty__hint">想让某个角色用别的模型，就从下面加一个。</p>
               </div>`
            : `<section class="api-section">
                 ${custom
                   .map(
                     (character) => `
                   <button class="api-choice" type="button" data-role="${esc(character.id)}">
                     <span class="api-choice__main">
                       <span class="api-choice__name">${esc(character.name || '未命名')}</span>
                       <span class="api-choice__meta">${customKinds(character.id)
                         .map((kind) => CAPABILITY_LABEL[kind])
                         .join(' · ')}</span>
                     </span>
                     ${line('chevron', 18)}
                   </button>`,
                   )
                   .join('')}
               </section>`
        }

        <p class="page-foot">${others > 0 ? `其余 ${others} 个角色跟随全局 / App 设置` : ''}</p>

        <button class="btn jelly" type="button" data-add>${line('plus', 16)}添加角色</button>
      </div>
    </div>`;

  bindOnce(root, 'role-detail-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    const roleButton = target.closest<HTMLElement>('[data-role]');
    if (roleButton) {
      const id = roleButton.dataset.role;
      if (id) location.hash = `/settings/api/roles?role=${encodeURIComponent(id)}`;
      return;
    }

    if (target.closest('[data-add]')) {
      void (async () => {
        const [latest, all] = await Promise.all([listCharacters(), listAssignments()]);
        const kinds = (id: string): Capability[] =>
          CAPABILITIES.filter((kind) =>
            all.some(
              (item) =>
                item.scope === 'role' && item.scopeId === id && item.kind === kind && !!item.target,
            ),
          );
        void openCharacterPicker(latest, kinds);
      })();
    }
  });
}

/** 挑一个角色去配 */
async function openCharacterPicker(
  characters: Character[],
  customKinds: (id: string) => Capability[],
): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'api-editor';
  overlay.innerHTML = `
    <header class="api-editor__head">
      <h2 class="api-editor__title">选一个角色</h2>
      <button class="api-editor__close" type="button" data-close>取消</button>
    </header>
    <div class="api-editor__list">
      <input class="input" type="search" data-search placeholder="搜角色名" autocomplete="off" />
      <div data-list>
        ${characters
          .map(
            (character) => `
          <button class="api-choice" type="button" data-pick="${esc(character.id)}" data-name="${esc(character.name || '')}">
            <span class="api-choice__main">
              <span class="api-choice__name">${esc(character.name || '未命名')}</span>
              <span class="api-choice__meta">${
                customKinds(character.id).length > 0
                  ? `已自定义 ${customKinds(character.id).length} 项`
                  : '跟随全局'
              }</span>
            </span>
          </button>`,
          )
          .join('')}
      </div>
      ${characters.length === 0 ? '<p class="field__note">还没有角色。先去建一个角色。</p>' : ''}
    </div>`;

  overlay.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-close]')) {
      overlay.remove();
      return;
    }
    const pick = target.closest<HTMLElement>('[data-pick]');
    if (pick?.dataset.pick) {
      overlay.remove();
      location.hash = `/settings/api/roles?role=${encodeURIComponent(pick.dataset.pick)}`;
    }
  });

  overlay.addEventListener('input', (event) => {
    const search = (event.target as HTMLElement).closest<HTMLInputElement>('[data-search]');
    if (!search) return;
    const keyword = search.value.trim().toLowerCase();
    for (const item of overlay.querySelectorAll<HTMLElement>('[data-pick]')) {
      const name = (item.dataset.name ?? '').toLowerCase();
      item.hidden = keyword !== '' && !name.includes(keyword);
    }
  });

  document.body.append(overlay);
}

/* ==========================================================================
   单个角色的设置页
   ========================================================================== */

const ROLE_GROUPS: Array<{ title: string; kinds: Capability[] }> = [
  { title: '核心', kinds: ['text'] },
  { title: '创作', kinds: ['image'] },
  { title: '理解', kinds: ['vision'] },
  { title: '语音', kinds: ['tts'] },
];

/** 当前正在看的角色。重绘时更新它，监听器只绑一次却总能拿到最新的 */
let currentRoleId = '';

export async function mountRoleDetail(root: HTMLElement, roleId: string): Promise<void> {
  currentRoleId = roleId;
  const [characters, assignments] = await Promise.all([listCharacters(), listAssignments()]);
  const character = characters.find((item) => item.id === roleId);

  if (!character) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/api/roles" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">角色</h1>
        </header>
        <div class="empty">
          <p class="empty__title">这个角色已经不在了</p>
          <p class="empty__hint">可能刚被删掉。</p>
        </div>
      </div>`;
    return;
  }

  function ownOf(kind: Capability): Assignment | undefined {
    return assignments.find(
      (item) => item.scope === 'role' && item.scopeId === currentRoleId && item.kind === kind,
    );
  }

  /** 上级实际生效的值：先 App(chat)，再全局 */
  function inheritedText(kind: Capability): string {
    const app = assignments.find(
      (item) => item.scope === 'app' && item.scopeId === 'chat' && item.kind === kind && !!item.target,
    );
    if (app?.target) return `跟随 App · ${app.target.modelId}`;
    const glob = assignments.find(
      (item) => item.scope === 'global' && item.kind === kind && !!item.target,
    );
    if (glob?.target) return `跟随全局 · ${glob.target.modelId}`;
    return '未设置';
  }

  const customCount = CAPABILITIES.filter((kind) => Boolean(ownOf(kind)?.target)).length;

  root.innerHTML = `
    <div class="api-detail">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings/api/roles" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">${esc(character.name || '角色')}</h1>
      </header>

      <div class="api-body">
        <p class="field__hint">这里只决定「用哪个模型」。音色、外貌这些属于角色资料，在角色卡里改。</p>

        ${ROLE_GROUPS.map((group) => {
          const shown = group.kinds;
          return `
          <section class="api-section">
            <h3 class="api-section__title">${group.title}</h3>
            ${shown
              .map((kind) => {
                const own = ownOf(kind);
                const text = own?.target ? own.target.modelId : inheritedText(kind);
                return `
                <div class="api-assign-row">
                  <span class="api-assign-row__main">
                    <span class="api-assign-row__label">${CAPABILITY_LABEL[kind]}模型</span>
                    <span class="api-assign-row__value${own?.target ? '' : ' is-unset'}">${esc(text)}</span>
                  </span>
                  <button class="api-assign-row__pick" type="button" data-pick="${kind}" aria-label="选择${CAPABILITY_LABEL[kind]}模型">${line('chevron', 18)}</button>
                </div>`;
              })
              .join('')}
          </section>`;
        }).join('')}

        <div class="danger-zone">
          <h3 class="danger-zone__title">清除自定义</h3>
          <p class="danger-zone__hint">${
            customCount > 0
              ? `这个角色单独设了 ${customCount} 项。清掉之后全部跟随上级。`
              : '这个角色现在没有自定义，全部跟随上级。'
          }</p>
          <button class="btn btn--ghost jelly" type="button" data-reset${customCount === 0 ? ' disabled' : ''}>清除该角色的全部自定义</button>
        </div>
      </div>
    </div>`;

  bindOnce(root, 'role-detail-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    const pickButton = target.closest<HTMLElement>('[data-pick]');
    if (pickButton) {
      const kind = pickButton.dataset.pick as Capability;
      void (async () => {
        const current = ownOf(kind)?.target ?? null;
        const picked = await openModelPicker(kind, current, {
          allowNone: true,
          noneLabel: '跟随上级',
        });
        await assign('role', currentRoleId, kind, picked);
        await mountRoleDetail(root, currentRoleId);
      })();
      return;
    }

    if (target.closest('[data-reset]')) {
      void (async () => {
        await clearCustom('role', currentRoleId);
        await mountRoleDetail(root, currentRoleId);
      })();
    }
  });
}
