import './api.css';
import { bindOnce, esc } from '../../core/dom';
import { listAssignments, listCharacters, listSites } from '../../core/db';
import type { Assignment, Capability } from '../../core/api-types';
import { CAPABILITIES, CAPABILITY_LABEL } from '../../core/api-types';
import { line } from '../../ui/icons';
import { assign, clearCustom } from '../../ai/call';
import { openModelPicker } from './model-picker';
import { inlinePickerHTML } from './picker-inline';

/* ==========================================================================
   分配 Tab（设计文档 §7）

     7.2 当前生效摘要条
     7.3 全局设置（核心 / 创作 / 理解 / 语音 四组）
     7.4 App 设置（折叠，只显示该 App 会用到的能力）
     7.5 角色模型设置（入口行 → 子页 /settings/api/roles）

   ⚠️ §7.6：未自定义的项不许只写「默认」，要显示实际生效的值。
      所以「跟随」的项也往上解析一次，把真实模型名显示出来。
   ⚠️ 分配页只能选择和引用，不许在这里改站点或模型。
   ⚠️ 选模型是**页内两级展开**（先站点、再模型）：用户明确要求
      「在当前界面内下拉」，不要再改回 model-picker 那种全屏覆盖层。
      model-picker 只留给聊天室抽屉这类「临时插一句」的场合。

   实现要点：每行是一个 BlockSpec（读取函数 + 提交函数），
   渲染统一走 blockHTML(spec)；展开/收起只替换那一块 outerHTML，
   所以滚动位置不动、输入框不会被重建。
   ========================================================================== */

interface Group {
  title: string;
  kinds: Capability[];
}

const GROUPS: Group[] = [
  { title: '核心', kinds: ['text'] },
  { title: '创作', kinds: ['image', 'video'] },
  { title: '理解', kinds: ['vision', 'embedding'] },
  { title: '语音', kinds: ['tts'] },
];

const SUMMARY_KINDS: Capability[] = ['text', 'image', 'vision', 'video', 'tts', 'embedding'];

/** 每个 App 实际会用到的能力（文档 §7.4：论坛只显示文本和生图） */
const APPS: Array<{ id: string; name: string; kinds: Capability[] }> = [
  { id: 'chat', name: '聊天', kinds: ['text', 'vision', 'tts'] },
  { id: 'forum', name: '论坛', kinds: ['text', 'image'] },
  { id: 'moments', name: '朋友圈', kinds: ['text', 'image'] },
];

/** 页内选择器当前展开在哪一行；null = 全部收起 */
interface PickState {
  key: string;
  /** 展开到第二级时是哪个站点 */
  expanded: string | null;
}

let pickState: PickState | null = null;

/** 一行「标签 + 当前值 + 箭头 + 可选展开区」的完整描述 */
interface BlockSpec {
  key: string;
  kind: Capability;
  label: string;
  ariaLabel: string;
  aux?: boolean;
  allowNone: boolean;
  noneLabel?: string;
  /** 现算当前值和显示文案，保证选完重绘时是最新的 */
  read(): {
    current: { siteId: string; modelId: string } | null;
    value: string;
    unset: boolean;
  };
  /** 写入选择结果；null = 「跟随上级」/「不要备用模型」 */
  commit(picked: { siteId: string; modelId: string } | null): Promise<void>;
}

export async function mountAssignView(host: HTMLElement, onChange: () => void): Promise<void> {
  // 每次重绘都从「没有展开任何选择器」开始
  pickState = null;

  const [sites, assignments, characters] = await Promise.all([
    listSites(),
    listAssignments(),
    listCharacters(),
  ]);

  if (sites.length === 0) {
    host.innerHTML = `
      <div class="empty">
        <p class="empty__title">先加一个站点</p>
        <p class="empty__hint">有了站点和模型，才能决定每种能力用哪个。</p>
      </div>`;
    return;
  }

  const globalOf = (kind: Capability): Assignment | undefined =>
    assignments.find((item) => item.scope === 'global' && item.kind === kind);

  const scopedOf = (scope: Assignment['scope'], scopeId: string, kind: Capability) =>
    assignments.find(
      (item) => item.scope === scope && item.scopeId === scopeId && item.kind === kind,
    );

  function describe(target: { siteId: string; modelId: string } | null | undefined): string {
    if (!target) return '未设置';
    const site = sites.find((item) => item.id === target.siteId);
    if (!site) return '站点已删';
    const model = site.models.find((item) => item.id === target.modelId);
    if (!model) return '模型已删';
    return `${site.name} · ${model.name}`;
  }

  /** 没自定义时的实际生效值：App 往上找全局，角色先 App 再全局 */
  function inheritedText(scope: Assignment['scope'], kind: Capability): string {
    if (scope === 'role') {
      const app = scopedOf('app', 'chat', kind);
      if (app?.target) return `跟随 App · ${describe(app.target)}`;
    }
    const glob = globalOf(kind);
    if (glob?.target) return `跟随全局 · ${describe(glob.target)}`;
    return '未设置';
  }

  // ---------------------------------------------------------------- 渲染

  /** 本次挂载里所有已渲染的块，按 key 索引；局部重绘靠它拿回 spec */
  const specs = new Map<string, BlockSpec>();

  function register(spec: BlockSpec): BlockSpec {
    specs.set(spec.key, spec);
    return spec;
  }

  function rowKey(kind: Capability, scope: Assignment['scope'], scopeId: string): string {
    return `${kind}|${scope}|${scopeId}`;
  }

  function summaryHTML(): string {
    return SUMMARY_KINDS.map((kind) => {
      const item = globalOf(kind);
      const name = item?.target ? describe(item.target) : '未设置';
      return `<span class="api-summary__item"><b>${CAPABILITY_LABEL[kind]}</b> ${esc(name)}</span>`;
    }).join('');
  }

  /** 一个模型分配行（按能力） */
  function modelSpec(kind: Capability, scope: Assignment['scope'], scopeId: string): BlockSpec {
    const own = () => (scope === 'global' ? globalOf(kind) : scopedOf(scope, scopeId, kind));
    return {
      key: rowKey(kind, scope, scopeId),
      kind,
      label: `${CAPABILITY_LABEL[kind]}模型`,
      ariaLabel: `选择${CAPABILITY_LABEL[kind]}模型`,
      allowNone: scope !== 'global',
      noneLabel: scope === 'app' ? '跟随全局' : '跟随上级',
      read: () => {
        const item = own();
        const hasOwn = Boolean(item?.target);
        const value =
          hasOwn || scope === 'global' ? describe(item?.target) : inheritedText(scope, kind);
        return {
          current: item?.target ?? null,
          value,
          unset: !hasOwn && scope !== 'global',
        };
      },
      commit: async (picked) => {
        // 全局必须先有一个；点「跟随上级」在全局没有意义，直接忽略
        if (picked === null && scope === 'global') return;
        await assign(
          scope,
          scopeId,
          kind,
          picked ? { type: 'model', siteId: picked.siteId, modelId: picked.modelId } : null,
        );
      },
    };
  }

  /** 备用文本模型：只在全局·核心·文本下面出现，写入 fallback 字段 */
  function fallbackSpec(): BlockSpec {
    return {
      key: `${rowKey('text', 'global', '')}|fallback`,
      kind: 'text',
      label: '备用文本模型',
      ariaLabel: '设置备用文本模型',
      aux: true,
      allowNone: true,
      noneLabel: '不要备用模型',
      read: () => {
        const fallback = globalOf('text')?.fallback ?? null;
        return {
          current: fallback,
          value: fallback ? describe(fallback) : '没设置（失败就不切换）',
          unset: !fallback,
        };
      },
      commit: async (picked) => {
        const item = globalOf('text');
        if (picked === null && !item?.fallback) return;
        await assign('global', '', 'text', item?.target ?? null, {
          fallback: picked ? { siteId: picked.siteId, modelId: picked.modelId } : null,
        });
      },
    };
  }

  function blockHTML(spec: BlockSpec): string {
    const state = spec.read();
    const open = pickState?.key === spec.key;
    return `
      <div class="api-assign" data-pick-key="${esc(spec.key)}">
        <div class="api-assign-row${spec.aux ? ' is-aux' : ''}">
          <span class="api-assign-row__main">
            <span class="api-assign-row__label">${esc(spec.label)}</span>
            <span class="api-assign-row__value${state.unset ? ' is-unset' : ''}">${esc(state.value)}</span>
          </span>
          <button class="api-assign-row__pick" type="button" data-toggle
            aria-label="${esc(spec.ariaLabel)}" aria-expanded="${open}">${line('chevron', 18)}</button>
        </div>
        ${
          open
            ? `<div class="api-assign__inline">${inlinePickerHTML(
                spec.kind,
                sites,
                state.current,
                { expanded: pickState?.expanded ?? null },
                { allowNone: spec.allowNone, noneLabel: spec.noneLabel },
              )}</div>`
            : ''
        }
      </div>`;
  }

  function rowHTML(kind: Capability, scope: Assignment['scope'], scopeId: string): string {
    return blockHTML(register(modelSpec(kind, scope, scopeId)));
  }

  /** 提示词改写：三选一，仍走小浮层（它不是「挑模型」，是挑模式） */
  function auxRowHTML(kind: Capability): string {
    return `
      <div class="api-assign">
        <div class="api-assign-row is-aux">
          <span class="api-assign-row__main">
            <span class="api-assign-row__label">提示词改写</span>
            <span class="api-assign-row__value">${esc(auxText(globalOf(kind)))}</span>
          </span>
          <button class="api-assign-row__pick" type="button" data-aux-pick="${kind}" aria-label="设置提示词改写">${line('chevron', 18)}</button>
        </div>
      </div>`;
  }

  function groupsHTML(scope: Assignment['scope'], scopeId: string, allowed: Capability[]): string {
    return GROUPS.map((group) => {
      const shown = group.kinds.filter((kind) => allowed.includes(kind));
      if (shown.length === 0) return '';
      return `
        <section class="api-section">
          <h3 class="api-section__title">${group.title}</h3>
          ${shown
            .map((kind) => {
              let extra = '';
              if (kind === 'text' && scope === 'global') {
                extra = blockHTML(register(fallbackSpec()));
              }
              if ((kind === 'image' || kind === 'video') && scope === 'global') {
                extra = auxRowHTML(kind);
              }
              return rowHTML(kind, scope, scopeId) + extra;
            })
            .join('')}
        </section>`;
    }).join('');
  }

  function roleEntryHTML(): string {
    const custom = characters.filter((character) =>
      CAPABILITIES.some((kind) => Boolean(scopedOf('role', character.id, kind)?.target)),
    );
    return `
      <button class="api-choice" type="button" data-roles>
        <span class="api-choice__main">
          <span class="api-choice__name">角色模型设置</span>
          <span class="api-choice__meta">${
            custom.length > 0 ? `已自定义 ${custom.length} 个角色` : '全部角色跟随全局'
          }</span>
        </span>
        ${line('chevron', 18)}
      </button>`;
  }

  host.innerHTML = `
    <section class="api-summary">
      <h2 class="api-summary__title">现在用的是</h2>
      <div class="api-summary__row">${summaryHTML()}</div>
    </section>

    <h2 class="api-part">全局设置</h2>
    ${groupsHTML('global', '', CAPABILITIES)}

    <h2 class="api-part">App 设置</h2>
    ${APPS.map((app) => {
      const custom = app.kinds.filter((kind) => Boolean(scopedOf('app', app.id, kind)?.target));
      return `
        <details class="api-app">
          <summary class="api-app__head">
            <span class="api-app__main">
              <span class="api-app__name">${esc(app.name)}</span>
              <span class="api-app__meta">${
                custom.length > 0 ? `已自定义 ${custom.length} 项` : '跟随全局'
              }</span>
            </span>
            ${line('chevron', 18)}
          </summary>
          <div class="api-app__body">
            ${groupsHTML('app', app.id, app.kinds)}
            <button class="btn btn--ghost btn--sm jelly" type="button" data-reset-app="${esc(app.id)}">这个 App 全部跟随全局</button>
          </div>
        </details>`;
    }).join('')}

    <h2 class="api-part">角色</h2>
    ${roleEntryHTML()}

    <p class="page-foot">分配页只能选择和引用，改站点要去「站点」Tab。</p>`;

  // ---------------------------------------------------------------- 事件

  /** 从任意被点击元素找回它所属的块 */
  function blockOf(element: HTMLElement): { box: HTMLElement; spec: BlockSpec } | null {
    const box = element.closest<HTMLElement>('.api-assign');
    const key = box?.dataset.pickKey;
    const spec = key ? specs.get(key) : undefined;
    if (!box || !spec) return null;
    return { box, spec };
  }

  function repaint(found: { box: HTMLElement; spec: BlockSpec }): void {
    found.box.outerHTML = blockHTML(found.spec);
  }

  bindOnce(host, 'assign-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    // 第一级：点站点名展开 / 收起该站点的模型列表
    const siteButton = target.closest<HTMLElement>('[data-inline-site]');
    if (siteButton) {
      const found = blockOf(siteButton);
      if (!found) return;
      const siteId = siteButton.dataset.inlineSite ?? '';
      pickState = {
        key: found.spec.key,
        expanded: pickState?.expanded === siteId ? null : siteId,
      };
      repaint(found);
      return;
    }

    // 第二级：选中某个模型
    const modelButton = target.closest<HTMLElement>('[data-inline-model]');
    if (modelButton) {
      const found = blockOf(modelButton);
      if (!found) return;
      void (async () => {
        await found.spec.commit({
          siteId: modelButton.dataset.site ?? '',
          modelId: modelButton.dataset.model ?? '',
        });
        pickState = null;
        await mountAssignView(host, onChange);
      })();
      return;
    }

    // 「跟随全局 / 跟随上级 / 不要备用模型」
    if (target.closest('[data-inline-none]')) {
      const found = blockOf(target);
      if (!found) return;
      void (async () => {
        await found.spec.commit(null);
        pickState = null;
        await mountAssignView(host, onChange);
      })();
      return;
    }

    // 收起
    if (target.closest('[data-inline-close]')) {
      const found = blockOf(target);
      if (!found) return;
      pickState = null;
      repaint(found);
      return;
    }

    // 点行右侧箭头：展开 / 收起
    if (target.closest('[data-toggle]')) {
      const found = blockOf(target);
      if (!found) return;
      pickState =
        pickState?.key === found.spec.key ? null : { key: found.spec.key, expanded: null };
      repaint(found);
      return;
    }

    // 提示词改写：三选一的小浮层（挑模式，不是挑模型）
    const auxPick = target.closest<HTMLElement>('[data-aux-pick]');
    if (auxPick) {
      void openAuxSheet(auxPick.dataset.auxPick as Capability, () =>
        mountAssignView(host, onChange),
      );
      return;
    }

    const resetApp = target.closest<HTMLElement>('[data-reset-app]');
    if (resetApp) {
      const appId = resetApp.dataset.resetApp;
      if (!appId) return;
      void (async () => {
        await clearCustom('app', appId);
        await mountAssignView(host, onChange);
      })();
      return;
    }

    if (target.closest('[data-roles]')) location.hash = '/settings/api/roles';
  });
}

/** 提示词改写当前状态的一句话 */
function auxText(item: Assignment | undefined): string {
  const aux = item?.aux;
  if (!aux || aux.mode === 'off') return '关闭（直接用原句）';
  if (aux.mode === 'followText') return '跟随文本模型';
  return '指定了模型';
}

/** 提示词改写：关闭 / 跟随文本 / 指定 */
async function openAuxSheet(kind: Capability, onDone: () => void): Promise<void> {
  const assignments = await listAssignments();
  const item = assignments.find((entry) => entry.scope === 'global' && entry.kind === kind);
  const aux = item?.aux;

  const overlay = document.createElement('div');
  overlay.className = 'api-editor';
  overlay.innerHTML = `
    <header class="api-editor__head">
      <h2 class="api-editor__title">提示词改写</h2>
      <button class="api-editor__close" type="button" data-close>取消</button>
    </header>
    <div class="api-editor__list">
      <p class="field__hint">你说「画一个雨天的教室」，先交给改写模型扩写成详细描述，再交给生图模型。关闭时直接用原句。</p>
      <div class="api-choice-list">
        <button class="api-choice${!aux || aux.mode === 'off' ? ' is-on' : ''}" type="button" data-mode="off">
          <span class="api-choice__main"><span class="api-choice__name">关闭</span><span class="api-choice__meta">直接用原句</span></span>
        </button>
        <button class="api-choice${aux?.mode === 'followText' ? ' is-on' : ''}" type="button" data-mode="followText">
          <span class="api-choice__main"><span class="api-choice__name">跟随文本模型</span><span class="api-choice__meta">用你设的文本模型来改写</span></span>
        </button>
        <button class="api-choice${aux?.mode === 'custom' ? ' is-on' : ''}" type="button" data-mode="custom">
          <span class="api-choice__main"><span class="api-choice__name">指定一个模型</span><span class="api-choice__meta">单独挑一个来改写</span></span>
        </button>
      </div>
    </div>`;

  overlay.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-close]')) {
      overlay.remove();
      return;
    }

    const modeButton = target.closest<HTMLElement>('[data-mode]');
    if (!modeButton) return;
    const mode = modeButton.dataset.mode as 'off' | 'followText' | 'custom';
    const next = item?.target ?? null;

    if (mode === 'custom') {
      void (async () => {
        overlay.remove();
        const picked = await openModelPicker('text', null, { title: '用哪个模型改写' });
        if (!picked) return;
        await assign('global', '', kind, next, {
          aux: { mode: 'custom', siteId: picked.siteId, modelId: picked.modelId },
        });
        onDone();
      })();
      return;
    }

    void (async () => {
      await assign('global', '', kind, next, { aux: { mode, siteId: '', modelId: '' } });
      overlay.remove();
      onDone();
    })();
  });

  document.body.append(overlay);
}