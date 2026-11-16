import { listCharacters, listProviders } from '../../core/db';
import {
  getBindings,
  setCharacterBinding,
  setKindBinding,
} from '../../core/model-bindings';
import type { Character, ModelKind, ModelRef, Provider } from '../../core/types';
import { MODEL_KIND_LABEL } from '../../core/types';
import { esc } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { openSheet } from '../../ui/sheet';
import './providers.css';

/* ==========================================================================
   API 与模型

   顶层只有四个模块：文本 / 生图 / 语音 / 视频。
   服务商不再单独摆在外面，而是藏在各自的模块里。

   下面一段是「主模型」：
     全局 —— 四类各选一个，文本必须，其余可不设
     角色 —— 给某个角色单独覆盖，不选就跟随全局
   ========================================================================== */

interface Ctx {
  providers: Provider[];
  characters: Character[];
  bindings: Awaited<ReturnType<typeof getBindings>>;
  characterId: string;
  view: 'global' | 'character';
}

const MODULES: { kind: ModelKind; title: string; icon: 'chat' | 'image' | 'mic' | 'video' }[] = [
  { kind: 'text', title: '文本 API', icon: 'chat' },
  { kind: 'image', title: '生图 API', icon: 'image' },
  { kind: 'voice', title: '语音 API', icon: 'mic' },
  { kind: 'video', title: '生视频 API', icon: 'video' },
];

function refSummary(providers: Provider[], ref: ModelRef | undefined): string {
  if (!ref) return '';
  const provider = providers.find((item) => item.id === ref.providerId);
  const model = provider?.models.find((item) => item.id === ref.modelId);
  return provider && model ? `${provider.name} · ${model.id}` : '';
}

function modelChoices(ctx: Ctx, kind: ModelKind): { ref: ModelRef; label: string; group: string }[] {
  const items: { ref: ModelRef; label: string; group: string }[] = [];
  for (const provider of ctx.providers) {
    if ((provider.kind ?? 'text') !== kind) continue;
    for (const model of provider.models) {
      if ((model.kind ?? 'text') !== kind) continue;
      items.push({
        ref: { providerId: provider.id, modelId: model.id },
        label: model.displayName && model.displayName !== model.id ? model.displayName : model.id,
        group: provider.name,
      });
    }
  }
  return items;
}

function chooseModel(
  ctx: Ctx,
  kind: ModelKind,
  allowFollowGlobal: boolean,
): Promise<{ ref: ModelRef | null; label: string } | null> {
  const choices = modelChoices(ctx, kind);
  const globalLabel = refSummary(ctx.providers, ctx.bindings.byKind[kind]) || '未设置';

  return new Promise((resolve) => {
    if (choices.length === 0 && !allowFollowGlobal) {
      resolve(null);
      return;
    }

    const items = [
      ...(allowFollowGlobal
        ? [
            {
              id: '__global__',
              label: '跟随全局',
              meta: globalLabel,
            },
          ]
        : []),
      ...choices.map((choice) => ({
        id: `${choice.ref.providerId}::${choice.ref.modelId}`,
        label: choice.label,
        meta: choice.ref.modelId,
      })),
    ];

    void openSheet({
      title: `选择${MODEL_KIND_LABEL[kind]}模型`,
      items,
      groupOf: (item) => (item.id === '__global__' ? '默认' : (choices.find((c) => `${c.ref.providerId}::${c.ref.modelId}` === item.id)?.group ?? '')),
      single: true,
      confirmLabel: () => '用这个',
      emptyText: '还没有可选模型，先去上面模块里拉取',
    }).then((picked) => {
      const hit = picked?.[0];
      if (!hit) {
        resolve(null);
        return;
      }
      if (hit.id === '__global__') {
        resolve({ ref: null, label: '跟随全局' });
        return;
      }
      const choice = choices.find((c) => `${c.ref.providerId}::${c.ref.modelId}` === hit.id);
      resolve(choice ? { ref: choice.ref, label: choice.label } : null);
    });
  });
}

function moduleRows(ctx: Ctx): string {
  return MODULES.map((module) => {
    const count = ctx.providers.filter((provider) => (provider.kind ?? 'text') === module.kind).length;
    const globalRef = ctx.bindings.byKind[module.kind];
    const global = refSummary(ctx.providers, globalRef);
    
    // 状态徽章：当前使用 / 已配置 / 缺失
    let badgeHTML = '';
    if (global) {
      badgeHTML = '<span class="status-badge status-badge--active">当前使用</span>';
    } else if (count > 0) {
      badgeHTML = '<span class="status-badge status-badge--ready">已配置</span>';
    } else {
      badgeHTML = '<span class="status-badge status-badge--missing">未配置</span>';
    }

    return `
      <button class="nav-item" type="button" data-go="/settings/api/${module.kind}">
        <span class="nav-item__icon">${line(module.icon, 20)}</span>
        <span class="nav-item__text">
          <span class="nav-item__title">${module.title}</span>
          <span class="nav-item__sub">${count} 个服务商 · ${esc(global || '未设置')}</span>
        </span>
        ${badgeHTML}
        <span class="nav-item__tail">${line('chevron', 18)}</span>
      </button>`;
  }).join('');
}

function bindRows(ctx: Ctx): string {
  const character = ctx.characters.find((item) => item.id === ctx.characterId);
  const forCharacter = ctx.view === 'character';

  const rows = MODULES.map((module) => {
    const global = refSummary(ctx.providers, ctx.bindings.byKind[module.kind]);
    const override = character
      ? ctx.bindings.characters[character.id]?.[module.kind]
      : undefined;
    const overrideSummary = refSummary(ctx.providers, override);

    let badgeHTML = '';
    let value = '';

    if (forCharacter) {
      if (overrideSummary) {
        value = overrideSummary;
        badgeHTML = '<span class="status-badge status-badge--active">专属覆盖</span>';
      } else {
        value = global ? `跟随全局（${global}）` : '未设置';
        badgeHTML = '<span class="status-badge status-badge--inherit">继承全局</span>';
      }
    } else {
      if (global) {
        value = global;
        badgeHTML = '<span class="status-badge status-badge--active">当前使用</span>';
      } else {
        value = '未设置';
        badgeHTML = module.kind === 'text'
          ? '<span class="status-badge status-badge--missing">必须设置</span>'
          : '<span class="status-badge status-badge--missing">未设置</span>';
      }
    }

    return `
      <button class="nav-item" type="button" data-pick="${module.kind}">
        <span class="nav-item__text">
          <span class="nav-item__title">${MODEL_KIND_LABEL[module.kind]}模型</span>
          <span class="nav-item__sub">${esc(value)}</span>
        </span>
        ${badgeHTML}
        <span class="nav-item__tail">${line('chevron', 18)}</span>
      </button>`;
  }).join('');

  const characterRow = forCharacter
    ? `
      <button class="nav-item" type="button" id="pick-character">
        ${character ? avatarHTML(character.name, 32) : `<span class="nav-item__icon">${line('character', 20)}</span>`}
        <span class="nav-item__text">
          <span class="nav-item__title">${character ? esc(character.name) : '选择角色'}</span>
          <span class="nav-item__sub">${character ? '下面的模型只对这个角色生效' : '先选一个角色'}</span>
        </span>
        <span class="nav-item__tail">${line('chevron', 18)}</span>
      </button>`
    : '';

  return `
    <div class="nav-group">${characterRow}${rows}</div>
    ${forCharacter && !character ? '<p class="field__note">还没有角色。先去角色页建一个。</p>' : ''}`;
}

export async function mountProviderList(root: HTMLElement): Promise<void> {
  const state: Ctx = {
    providers: await listProviders(),
    characters: await listCharacters(),
    bindings: await getBindings(),
    characterId: '',
    view: 'global',
  };
  state.characterId = state.characters[0]?.id ?? '';

  const paint = (): void => {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">API 与模型</h1>
        </header>

        <p class="api-hub__hint">先选一个模块，把站子和模型加进去；再在下面选主模型。</p>

        <div class="nav-group">${moduleRows(state)}</div>

        <h2 class="api-hub__title">主模型</h2>
        <div class="segmented api-scope" role="radiogroup" aria-label="主模型作用范围">
          <button type="button" data-scope="global" aria-checked="${state.view === 'global'}">全局</button>
          <button type="button" data-scope="character" aria-checked="${state.view === 'character'}">角色</button>
        </div>

        ${bindRows(state)}
        <p class="api-hub__hint">
          ${state.view === 'global'
            ? '文本模型是必须的；生图、语音、视频可以不设。'
            : '不选就跟随全局；选了之后只对这个角色生效。'}
        </p>
      </div>`;

    root.querySelectorAll<HTMLElement>('[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        const scope = button.dataset.scope === 'character' ? 'character' : 'global';
        if (scope === state.view) return;
        state.view = scope;
        paint();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-pick]').forEach((button) => {
      button.addEventListener('click', () => {
        const kind = button.dataset.pick as ModelKind | undefined;
        if (!kind) return;
        const forCharacter = state.view === 'character';

        if (forCharacter && !state.characters.some((item) => item.id === state.characterId)) {
          return;
        }

        // 先去选一个模型；没有模型时给一句人话
        if (modelChoices(state, kind).length === 0) {
          // 同一时刻只留一条提示：连点或换一类点，都替换而不是叠加
          root.querySelectorAll('.field__note.is-bad').forEach((node) => node.remove());
          const note = document.createElement('p');
          note.className = 'field__note is-bad';
          note.textContent = `还没有${MODEL_KIND_LABEL[kind]}模型，先点上面的「${MODEL_KIND_LABEL[kind]} API」拉取。`;
          button.after(note);
          return;
        }

        void (async () => {
          const picked = await chooseModel(state, kind, forCharacter);
          if (!picked) return;
          if (forCharacter) {
            await setCharacterBinding(state.characterId, kind, picked.ref);
          } else {
            await setKindBinding(kind, picked.ref);
          }
          state.bindings = await getBindings();
          paint();
        })();
      });
    });

    root.querySelector<HTMLElement>('#pick-character')?.addEventListener('click', () => {
      void (async () => {
        const picked = await openSheet({
          title: '选择角色',
          items: state.characters.map((character) => ({
            id: character.id,
            label: character.name || '未命名',
            meta: character.relationToUser || '',
          })),
          single: true,
          confirmLabel: () => '用这个',
          emptyText: '还没有角色',
        });
        const hit = picked?.[0];
        if (!hit) return;
        state.characterId = hit.id;
        paint();
      })();
    });
  };

  paint();
}
