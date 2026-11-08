import './api.css';
import { esc } from '../../core/dom';
import { listSites } from '../../core/db';
import type { Capability, Target } from '../../core/api-types';
import { CAPABILITY_LABEL } from '../../core/api-types';
import { line } from '../../ui/icons';

/* ==========================================================================
   模型选择器（设计文档 §7.6）

   从底部弹出，按站点分组。只列**带当前能力标签且已启用**的模型。
   顶部第一项「跟随上级」（只有 allowNone 时才有意义）。
   底部一个「管理站点 ›」跳回站点 Tab。

   ⚠️ 只能选和引用，绝不能在这里改站点或模型。
   ========================================================================== */

const CAP: Record<Capability, string> = CAPABILITY_LABEL;

export interface PickerOptions {
  /** 顶部给一个「不设置」，返回 null */
  allowNone?: boolean;
  title?: string;
  /** 「跟随上级」的文字，App / 角色页会传自己的说法 */
  noneLabel?: string;
}

export function openModelPicker(
  kind: Capability,
  current: { siteId: string; modelId: string } | null,
  options: PickerOptions = {},
): Promise<Target | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Target | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };

    const overlay = document.createElement('div');
    overlay.className = 'api-editor';

    void (async () => {
      const sites = await listSites();
      const groups = sites
        .map((site) => ({
          site,
          models: site.models.filter(
            (model) => model.enabled && model.kinds.includes(kind),
          ),
        }))
        .filter((group) => group.models.length > 0);

      const body =
        groups.length === 0
          ? `<div class="empty">
               <p class="empty__title">没有可用的${CAP[kind]}模型</p>
               <p class="empty__hint">去站点的「模型」Tab 里，把带「${CAP[kind]}」标签的模型打开。</p>
             </div>`
          : groups
              .map(
                (group) => `
                <section class="api-section">
                  <h3 class="api-section__title">${esc(group.site.name)} · ${group.models.length} 个可用</h3>
                  ${group.models
                    .map((model) => {
                      const selected =
                        current?.siteId === group.site.id && current.modelId === model.id;
                      return `<button class="api-choice${selected ? ' is-on' : ''}" type="button"
                                data-site="${esc(group.site.id)}" data-model="${esc(model.id)}">
                                <span class="api-choice__main">
                                  <span class="api-choice__name">${esc(model.name)}</span>
                                  <span class="api-choice__meta">${esc(model.kinds.map((item) => CAP[item]).join(' · '))}</span>
                                </span>
                                ${selected ? line('check', 18) : ''}
                              </button>`;
                    })
                    .join('')}
                </section>`,
              )
              .join('');

      overlay.innerHTML = `
        <header class="api-editor__head">
          <h2 class="api-editor__title">${esc(options.title ?? `选一个${CAP[kind]}模型`)}</h2>
          <button class="api-editor__close" type="button" data-close>取消</button>
        </header>
        <div class="api-editor__list">
          ${
            options.allowNone
              ? `<button class="api-choice" type="button" data-none>
                   <span class="api-choice__main">
                     <span class="api-choice__name">${esc(options.noneLabel ?? '不设置')}</span>
                     <span class="api-choice__meta">清掉当前选择</span>
                   </span>
                 </button>`
              : ''
          }
          ${body}
          <button class="api-choice" type="button" data-manage>
            <span class="api-choice__main">
              <span class="api-choice__name">管理站点 ›</span>
              <span class="api-choice__meta">加站点、拉模型、改 Key</span>
            </span>
          </button>
        </div>`;

      overlay.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('[data-close]')) {
          finish(null);
          return;
        }
        if (target.closest('[data-none]')) {
          finish(null);
          return;
        }
        if (target.closest('[data-manage]')) {
          finish(null);
          location.hash = '/settings/api';
          return;
        }

        const choice = target.closest<HTMLElement>('[data-model]');
        if (!choice) return;
        const siteId = choice.dataset.site;
        const modelId = choice.dataset.model;
        if (!siteId || !modelId) return;
        finish({ type: 'model', siteId, modelId });
      });
    })();

    document.body.append(overlay);
  });
}
