import { bindOnce, esc } from '../../core/dom';
import { putSite } from '../../core/db';
import type { Capability, Series, Site, SiteModel } from '../../core/api-types';
import { CAPABILITIES, CAPABILITY_LABEL, SERIES_LABEL, SERIES_ORDER } from '../../core/api-types';
import { line } from '../../ui/icons';
import { pullModels } from '../../ai/adapters/openai';
import { inferSubSeries, subSeriesLabel } from '../../core/api-catalog';

/* ==========================================================================
   站点详情 · Tab 1「模型」（设计文档 §6.3）

   两行筛选（能力 + 系列）可以同时生效，是「且」的关系。
   再加一个搜索框、一个「已启用 / 全部可用」切换。

   ⚠️ 筛选状态只活在这一次打开里，不落库 —— 它是「我现在想找什么」，
      不是站点的属性。切走再回来重置成「全部 + 已启用」很自然。
   ========================================================================== */

type View = 'enabled' | 'all';

interface Filter {
  kind: Capability | 'all';
  series: Series | 'all';
  text: string;
  view: View;
}

export function mountModelsTab(
  host: HTMLElement,
  site: Site,
  onChange: () => void,
): void {
  const filter: Filter = { kind: 'all', series: 'all', text: '', view: 'all' };

  /** 折叠了哪些分组。key 是 `系列/小类`，不在这个集合里就是展开的 */
  const collapsed = new Set<string>();

  // 系列按钮只显示这个站点实际有的（文档 §6.3）
  // 系列筛选按钮按用户指定的固定顺序排，不是按出现顺序
  const presentSeries = SERIES_ORDER.filter((series) =>
    site.models.some((model) => model.series === series),
  );

  function visible(): SiteModel[] {
    const keyword = filter.text.trim().toLowerCase();
    return site.models.filter((model) => {
      if (filter.view === 'enabled' && !model.enabled) return false;
      if (filter.kind !== 'all' && !model.kinds.includes(filter.kind)) return false;
      if (filter.series !== 'all' && model.series !== filter.series) return false;
      if (keyword && !model.id.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }

  /** 一个扁平分组：系列 + 小类合成一个名字，例如「Claude Opus」 */
  interface FlatGroup {
    /** 折叠标记用的唯一键：系列 + 小类 */
    key: string;
    /** 显示名：小类为空就是系列名，否则「系列名 + 小类名」 */
    label: string;
    series: Series;
    models: SiteModel[];
    count: number;
    enabledCount: number;
  }

  /** 把筛完的模型按「系列 + 小类」合成**一层**分组。
      例如 claude-opus-4-5 → 分组「Claude Opus」，里面才是模型。 */
  function grouped(): FlatGroup[] {
    const byKey = new Map<string, FlatGroup>();
    for (const model of visible()) {
      const sub = inferSubSeries(model.id);
      const key = `${model.series}/${sub}`;
      const group = byKey.get(key);
      if (group) {
        group.models.push(model);
        group.count += 1;
        if (model.enabled) group.enabledCount += 1;
      } else {
        byKey.set(key, {
          key,
          label: sub === '' ? SERIES_LABEL[model.series] : `${SERIES_LABEL[model.series]} ${subSeriesLabel(sub)}`, 
          series: model.series,
          models: [model],
          count: 1,
          enabledCount: model.enabled ? 1 : 0,
        });
      }
    }

    const order = (series: Series): number => {
      const index = SERIES_ORDER.indexOf(series);
      return index === -1 ? SERIES_ORDER.length : index;
    };
    return [...byKey.values()].sort((a, b) => order(a.series) - order(b.series) || a.label.localeCompare(b.label));
  }

  function rowHTML(model: SiteModel): string {
    const kinds = model.kinds.map((kind) => `<span class="tag">${CAPABILITY_LABEL[kind]}</span>`).join('');
    return `
      <div class="api-model${model.enabled ? '' : ' is-off'}" data-model="${esc(model.id)}">
        <label class="switch api-model__switch">
          <input type="checkbox" data-model-enabled${model.enabled ? ' checked' : ''} aria-label="启用 ${esc(model.id)}" />
          <span class="switch__track"></span>
        </label>
        <span class="api-model__main">
          <span class="api-model__name" title="${esc(model.id)}">${esc(model.name)}</span>
          <span class="api-model__tags">
            ${kinds}
            <span class="api-model__series">${SERIES_LABEL[model.series]}</span>
            ${model.contextLength ? `<span class="api-model__ctx">${Math.round(model.contextLength / 1000)}K</span>` : ''}
          </span>
        </span>
        <button class="api-key__icon jelly" type="button" data-model-edit aria-label="更多">${line('more', 18)}</button>
      </div>`;
  }

  function render(): void {
    const list = visible();
    const total = site.models.length;
    const enabledTotal = site.models.filter((model) => model.enabled).length;
    const groups = grouped();

    host.innerHTML = `
      <div class="api-filters">
        <div class="api-chips" data-kind-row>
          <button type="button" data-kind="all" aria-pressed="${filter.kind === 'all'}">全部</button>
          ${CAPABILITIES.map(
            (kind) =>
              `<button type="button" data-kind="${kind}" aria-pressed="${filter.kind === kind}">${CAPABILITY_LABEL[kind]}</button>`,
          ).join('')}
        </div>
        <div class="api-chips" data-series-row>
          <button type="button" data-series="all" aria-pressed="${filter.series === 'all'}">全部</button>
          ${presentSeries
            .map(
              (series) =>
                `<button type="button" data-series="${series}" aria-pressed="${filter.series === series}">${SERIES_LABEL[series]}</button>`,
            )
            .join('')}
        </div>
        <div class="api-search-row">
          <input class="input api-search" type="search" data-search value="${esc(filter.text)}" placeholder="搜模型名" autocomplete="off" />
          <div class="api-view-switch" data-view-row role="group" aria-label="模型显示范围">
            <button type="button" class="api-view-switch__item" data-view="all" aria-pressed="${filter.view === 'all'}">全部可用</button>
            <button type="button" class="api-view-switch__item" data-view="enabled" aria-pressed="${filter.view === 'enabled'}">仅启用</button>
          </div>
        </div>
      </div>

      ${
        total === 0
          ? `<div class="empty">
               <p class="empty__title">还没拉过模型</p>
               <p class="empty__hint">点下面的「重新拉取模型」，获取站点返回的模型名；实际能否调用需另行验证。</p>
             </div>`
          : list.length === 0
            ? `<div class="empty">
                 <p class="empty__title">这个筛选下没有模型</p>
                 <p class="empty__hint">换个能力或系列试试，或者把搜索词清掉。</p>
               </div>`
            : `<div class="api-models-box">
                 ${groups.map(groupHTML).join('')}
               </div>`
      }

      <div class="api-models__foot">
        <button class="btn jelly" type="button" data-pull>${line('refresh', 16)}重新拉取模型</button>
        <p class="field__note" data-pull-note></p>
        <p class="api-models__count">${
          total === 0 ? '' : `共 ${total} 个，已启用 ${enabledTotal} 个`
        }</p>
      </div>`;
  }

  /** 一个分组（如「Claude Opus」）：可折叠，里面直接就是模型 */
  function groupHTML(group: FlatGroup): string {
    const open = !collapsed.has(group.key);
    return `
      <section class="api-group${open ? ' is-open' : ''}">
        <button class="api-group__head" type="button" data-group="${esc(group.key)}" aria-expanded="${open}">
          <span class="api-group__title">${esc(group.label)}</span>
          <span class="api-group__meta">${group.count} 个${group.enabledCount > 0 ? ` · 已启用 ${group.enabledCount}` : ''}</span>
          ${line('chevron', 16)}
        </button>
        ${
          open
            ? `<div class="api-group__body">${group.models.map(rowHTML).join('')}</div>`
            : ''
        }
      </section>`;
  }

  // ---------------------------------------------------------------- 事件

  bindOnce(host, 'models-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    // 折叠 / 展开一个系列
    const group = target.closest<HTMLElement>('[data-group]');
    if (group?.dataset.group) {
      const key = group.dataset.group;
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      render();
      return;
    }

    const kind = target.closest<HTMLElement>('[data-kind]');
    if (kind) {
      filter.kind = (kind.dataset.kind as Capability | 'all') ?? 'all';
      render();
      return;
    }

    const series = target.closest<HTMLElement>('[data-series]');
    if (series) {
      filter.series = (series.dataset.series as Series | 'all') ?? 'all';
      render();
      return;
    }

    const view = target.closest<HTMLElement>('[data-view]');
    if (view) {
      filter.view = view.dataset.view === 'all' ? 'all' : 'enabled';
      render();
      return;
    }

    const edit = target.closest<HTMLElement>('[data-model-edit]');
    if (edit) {
      const id = edit.closest<HTMLElement>('[data-model]')?.dataset.model;
      const model = site.models.find((item) => item.id === id);
      if (model) openModelMenu(model);
      return;
    }

    const pull = target.closest<HTMLButtonElement>('[data-pull]');
    if (pull) {
      pull.disabled = true;
      pull.textContent = '正在拉取…';
      void (async () => {
        const result = await pullModels(site);
        if (!result.ok) {
          const note = host.querySelector<HTMLElement>('[data-pull-note]');
          if (note) {
            note.className = 'field__note is-bad';
            note.textContent = result.message;
          }
          pull.disabled = false;
          pull.innerHTML = `${line('refresh', 16)}重新拉取模型`;
          return;
        }
        site.models = result.models;
        site.updatedAt = Date.now();
        await putSite(site);
        onChange();
        render();
        // render 把按钮重建了，重新拿一个来写提示
        const note = host.querySelector<HTMLElement>('[data-pull-note]');
        if (note) {
          note.className = 'field__note is-ok';
          note.textContent = result.message;
        }
      })();
    }
  });

  let viewSwipeStartX: number | null = null;
  bindOnce(host, 'models-view-swipe-start', 'touchstart', (event) => {
    const touch = (event as TouchEvent).changedTouches[0];
    if (!touch || !(event.target as HTMLElement).closest('[data-view-row]')) return;
    viewSwipeStartX = touch.clientX;
  });

  bindOnce(host, 'models-view-swipe-end', 'touchend', (event) => {
    const touch = (event as TouchEvent).changedTouches[0];
    const startX = viewSwipeStartX;
    viewSwipeStartX = null;
    if (!touch || startX === null || Math.abs(touch.clientX - startX) < 28) return;
    filter.view = touch.clientX < startX ? 'enabled' : 'all';
    render();
  });

  bindOnce(host, 'models-change', 'change', (event) => {
    const enabled = (event.target as HTMLElement).closest<HTMLInputElement>('[data-model-enabled]');
    if (!enabled) return;
    const id = enabled.closest<HTMLElement>('[data-model]')?.dataset.model;
    const model = site.models.find((item) => item.id === id);
    if (!model) return;
    model.enabled = enabled.checked;
    site.updatedAt = Date.now();
    void putSite(site).then(() => {
      onChange();
      render();
    });
  });

  bindOnce(host, 'models-input', 'input', (event) => {
    const search = (event.target as HTMLElement).closest<HTMLInputElement>('[data-search]');
    if (!search) return;
    filter.text = search.value;
    // 搜索是逐字输入，只重画列表区，不重建搜索框（否则丢焦点）
    const listHost = host.querySelector<HTMLElement>('.api-models-box');
    if (!listHost) {
      render();
      return;
    }
    listHost.innerHTML = grouped().map(groupHTML).join('');
  });

  /** 模型级限制的四格（文档 §10.4 第一版：并发 / 速率 / 超时 / 重试，0 或留空 = 跟随站点） */
  function modelLimitFields(model: SiteModel): string {
    const limits = model.limits ?? {};
    const cell = (key: 'concurrent' | 'rpm' | 'timeout' | 'retry', label: string): string => `
      <label class="field">
        <span class="field__label">${label}</span>
        <input class="input" type="number" inputmode="numeric" min="0"
               data-model-limit="${key}" placeholder="跟随站点"
               value="${key in limits ? limits[key] : ''}" />
      </label>`;
    const clear =
      Object.keys(limits).length > 0
        ? `<button class="btn btn--ghost btn--sm jelly" type="button" data-model-limits-clear>清空，全部跟随站点</button>`
        : '';
    return `
      <div class="api-model-limits">
        ${cell('concurrent', '并发')}
        ${cell('rpm', '速率')}
        ${cell('timeout', '超时')}
        ${cell('retry', '重试')}
      </div>
      ${clear}`;
  }

  /** 把浮层里的四个数字读出来写回 model.limits。全是空 = 没有单独限制 */
  async function commitModelLimits(model: SiteModel, overlay: HTMLElement): Promise<void> {
    const next: Record<string, number> = {};
    for (const input of overlay.querySelectorAll<HTMLInputElement>('[data-model-limit]')) {
      const value = input.value.trim();
      if (value !== '') next[input.dataset.modelLimit as string] = Math.max(0, Math.floor(Number(value) || 0));
    }
    model.limits = Object.keys(next).length > 0 ? (next as typeof model.limits) : null;
    site.updatedAt = Date.now();
    await putSite(site);
    onChange();
    // 重画浮层，把新写进去的值显示出来，也刷新「清空」按钮的有无
    const wasOpen = document.body.contains(overlay);
    if (wasOpen) {
      overlay.querySelector('.api-section:has([data-model-limit])')?.remove();
      // 简单点：关掉浮层再重开，用户本来就在看着这个模型
      overlay.remove();
      openModelMenu(model);
    }
  }

  /** 单个模型的「…」菜单：改能力标签、改系列、单独设限制 */
  function openModelMenu(model: SiteModel): void {
    const overlay = document.createElement('div');
    overlay.className = 'api-editor';
    overlay.innerHTML = `
      <header class="api-editor__head">
        <h2 class="api-editor__title">${esc(model.name)}</h2>
        <button class="api-editor__close" type="button" data-close>关闭</button>
      </header>
      <div class="api-editor__list">
        <section class="api-section">
          <h3 class="api-section__title">能力标签</h3>
          <p class="field__hint">一个模型可以同时是好几样。改过之后，重新拉取模型也不会覆盖。</p>
          <div class="api-chips api-chips--wrap">
            ${CAPABILITIES.map(
              (kind) =>
                `<button type="button" data-pick-kind="${kind}" aria-pressed="${model.kinds.includes(kind)}">${CAPABILITY_LABEL[kind]}</button>`,
            ).join('')}
          </div>
        </section>

        <section class="api-section">
          <h3 class="api-section__title">系列</h3>
          <div class="api-chips api-chips--wrap">
            ${(Object.keys(SERIES_LABEL) as Series[])
              .map(
                (series) =>
                  `<button type="button" data-pick-series="${series}" aria-pressed="${model.series === series}">${SERIES_LABEL[series]}</button>`,
              )
              .join('')}
          </div>
        </section>

        <section class="api-section">
          <h3 class="api-section__title">单独的限制</h3>
          <p class="field__hint">默认跟随站点限制。填了的项单独生效，留空就跟随。删掉全部就恢复跟随。</p>
          ${modelLimitFields(model)}
        </section>

        <section class="api-section">
          <h3 class="api-section__title">主模型</h3>
          <p class="field__hint">星标只是给自己看的记号，不影响调用。</p>
          <button class="btn btn--sm jelly" type="button" data-primary>${model.isPrimary ? '取消星标' : '设为星标'}</button>
        </section>
      </div>`;

    overlay.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-close]')) {
        overlay.remove();
        return;
      }

      const limitInput = target.closest<HTMLElement>('[data-model-limit]');
      if (limitInput) {
        void commitModelLimits(model, overlay);
        return;
      }

      if (target.closest('[data-model-limits-clear]')) {
        model.limits = null;
        void putSite(site).then(() => {
          overlay.remove();
          render();
        });
        return;
      }

      const kindButton = target.closest<HTMLElement>('[data-pick-kind]');
      if (kindButton) {
        const kind = kindButton.dataset.pickKind as Capability;
        const has = model.kinds.includes(kind);
        // 至少留一个能力，不允许把模型改成「什么都不会」
        if (has && model.kinds.length === 1) return;
        model.kinds = has ? model.kinds.filter((item) => item !== kind) : [...model.kinds, kind];
        model.manualEdited.kinds = true;
        kindButton.setAttribute('aria-pressed', String(!has));
        void putSite(site).then(onChange);
        return;
      }

      const seriesButton = target.closest<HTMLElement>('[data-pick-series]');
      if (seriesButton) {
        model.series = seriesButton.dataset.pickSeries as Series;
        model.manualEdited.series = true;
        for (const item of overlay.querySelectorAll<HTMLElement>('[data-pick-series]')) {
          item.setAttribute('aria-pressed', String(item.dataset.pickSeries === model.series));
        }
        void putSite(site).then(onChange);
        return;
      }

      if (target.closest('[data-primary]')) {
        const next = !model.isPrimary;
        // 星标是「一个站点里挑一个」，所以先把别的取消掉
        if (next) for (const item of site.models) item.isPrimary = false;
        model.isPrimary = next;
        void putSite(site).then(() => {
          onChange();
          overlay.remove();
          render();
        });
      }
    });

    overlay.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-close]')) {
        render();
      }
    });

    document.body.append(overlay);
  }

  render();
}