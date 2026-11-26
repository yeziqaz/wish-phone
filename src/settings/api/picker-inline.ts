import './api.css';
import { esc } from '../../core/dom';
import { line } from '../../ui/icons';
import type { Capability, Site } from '../../core/api-types';
import { CAPABILITY_LABEL } from '../../core/api-types';

/* ==========================================================================
   页内两级模型选择（替代全屏弹层）

   第一级：站点名。第二级：点开某个站点后，它下面带该能力标签的模型。

   和 model-picker.ts 的区别：
     · model-picker 开一层盖住整页的浮层，适合聊天室抽屉那种「临时插一句」的场合；
     · 这里是**在当前界面内就地展开**，改主意时往上滑一下就退出，不丢上下文。

   渲染与状态分离：HTML 由 inlinePickerHTML 生成，状态由调用方自己存
   （分配页每次选完都会重绘整页，所以「展开了哪个站点」必须放在模块级变量里）。

   ⚠️ 只能选和引用，不许在这里改站点或模型。
   ========================================================================== */

export interface InlinePickerState {
  /** 当前展开了哪个站点；null = 只列站点名 */
  expanded: string | null;
}

export interface InlinePickerOptions {
  allowNone?: boolean;
  noneLabel?: string;
}

const CAP: Record<Capability, string> = CAPABILITY_LABEL;

export function inlinePickerHTML(
  kind: Capability,
  sites: Site[],
  current: { siteId: string; modelId: string } | null,
  state: InlinePickerState,
  options: InlinePickerOptions = {},
): string {
  const cap = CAP[kind];

  const groups = sites
    .map((site) => ({
      site,
      models: site.models.filter((model) => model.enabled && model.kinds.includes(kind)),
    }))
    .filter((group) => group.models.length > 0);

  const noneRow = options.allowNone
    ? `<button class="api-picker__none${current ? '' : ' is-on'}" type="button" data-inline-none>
         <span class="api-picker__name">${esc(options.noneLabel ?? '不设置')}</span>
         <span class="api-picker__meta">清掉当前选择</span>
         ${current ? '' : line('check', 16)}
       </button>`
    : '';

  const siteRows = groups
    .map((group) => {
      const open = state.expanded === group.site.id;
      const picked =
        current?.siteId === group.site.id
          ? group.models.find((model) => model.id === current.modelId)
          : undefined;

      return `
        <div class="api-picker__group${open ? ' is-open' : ''}">
          <button class="api-picker__site" type="button"
            data-inline-site="${esc(group.site.id)}" aria-expanded="${open}">
            <span class="api-picker__name">${esc(group.site.name)}</span>
            <span class="api-picker__meta">${
              picked ? `当前：${esc(picked.name)}` : `${group.models.length} 个可用`
            }</span>
            ${line('chevron', 16)}
          </button>
          ${
            open
              ? `<div class="api-picker__models">
                  ${group.models
                    .map((model) => {
                      const on =
                        current?.siteId === group.site.id && current.modelId === model.id;
                      return `<button class="api-picker__model${on ? ' is-on' : ''}" type="button"
                                data-inline-model data-site="${esc(group.site.id)}" data-model="${esc(model.id)}">
                                <span class="api-picker__name">${esc(model.name)}</span>
                                ${on ? line('check', 16) : ''}
                              </button>`;
                    })
                    .join('')}
                </div>`
              : ''
          }
        </div>`;
    })
    .join('');

  const empty =
    groups.length === 0
      ? `<p class="api-picker__empty">还没有可用的${cap}模型。去「站点」里把带「${cap}」标签的模型打开。</p>`
      : '';

  return `
    <div class="api-picker">
      <div class="api-picker__head">
        <span class="api-picker__title">选一个${cap}模型</span>
        <button class="api-picker__close" type="button" data-inline-close>收起</button>
      </div>
      <div class="api-picker__body">
        ${noneRow}
        ${empty}
        ${siteRows}
      </div>
    </div>`;
}