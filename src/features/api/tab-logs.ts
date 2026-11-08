import './api.css';
import { bindOnce, esc } from '../../core/dom';
import { listLogs } from '../../core/db';
import type { Capability, RequestLog, Site } from '../../core/api-types';
import { line } from '../../ui/icons';
import { dayStart, durationText, kindLabel, logTime, rangeStats } from '../../core/log-stats';

/* ==========================================================================
   站点详情 · Tab 2「日志」（设计文档 §6.4）

   复用全站日志，进来自动按当前站点过滤。
   顶部汇总：今日请求 / 本月请求 / Token 总数 / 错误数
   列表每条：时间、模型、能力、输入输出 Token、耗时、状态
   可按模型、能力、状态过滤；点开看错误信息和发起方。
   ========================================================================== */

export async function mountSiteLogsTab(host: HTMLElement, site: Site): Promise<void> {
  const all = await listLogs(500);
  const logs = all.filter((log) => log.siteId === site.id);

  let status: 'all' | 'success' | 'error' = 'all';
  let kind: Capability | 'all' = 'all';
  let model = '';
  let expanded: string | null = null;

  // 这个站点实际出现过的模型，只列有的
  const models = [...new Set(logs.map((log) => log.modelId))];
  const kinds = [...new Set(logs.map((log) => log.kind))];

  function filtered(): RequestLog[] {
    return logs.filter((log) => {
      if (status !== 'all' && log.status !== status) return false;
      if (kind !== 'all' && log.kind !== kind) return false;
      if (model && log.modelId !== model) return false;
      return true;
    });
  }

  function rowHTML(log: RequestLog): string {
    const isOpen = expanded === log.id;
    const tokens =
      log.inputTokens === null && log.outputTokens === null
        ? '—'
        : `${log.inputTokens ?? '—'} / ${log.outputTokens ?? '—'}`;

    return `
      <div class="api-log" data-log="${esc(log.id)}">
        <button class="api-log__head" type="button" data-log-toggle>
          <span class="api-log__main">
            <span class="api-log__title">
              <span class="api-log__dot ${log.status === 'error' ? 'is-bad' : ''}"></span>
              ${esc(log.modelId)}
            </span>
            <span class="api-log__meta">${log.switchedFrom ? `由 ${esc(log.switchedFrom)} 切换而来 · ` : ''}${logTime(log.time)} · ${kindLabel(log.kind)} · ${tokens} token · ${durationText(log.durationMs)}</span>
          </span>
          ${line('chevron', 16)}
        </button>
        ${
          isOpen
            ? `<div class="api-log__detail">
                 <p class="api-log__line">发起方：${
                   log.scope.roleId
                     ? `角色 ${esc(log.scope.roleId)}`
                     : log.scope.appId
                       ? `App ${esc(log.scope.appId)}`
                       : '全局'
                 }</p>
                 <p class="api-log__line">状态：${log.status === 'success' ? '成功' : '失败'}${log.switchedFrom ? `（由 ${esc(log.switchedFrom)} 切换而来）` : ''}</p>
                 <p class="api-log__line">耗时：${durationText(log.durationMs)}</p>
                 ${log.errorMessage ? `<p class="api-log__line is-bad">${esc(log.errorMessage)}</p>` : ''}
               </div>`
            : ''
        }
      </div>`;
  }

  function render(): void {
    const list = filtered();
    const today = rangeStats(logs, dayStart());
    const month = rangeStats(logs, new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime());

    host.innerHTML = `
      <div class="api-body">
        <section class="api-section">
          <h3 class="api-section__title">汇总</h3>
          <div class="api-buckets">
            <div class="api-bucket"><span class="api-bucket__name">今日请求</span><span class="api-bucket__num">${today.count}</span></div>
            <div class="api-bucket"><span class="api-bucket__name">本月请求</span><span class="api-bucket__num">${month.count}</span></div>
            <div class="api-bucket"><span class="api-bucket__name">Token 总数</span><span class="api-bucket__num">${month.tokens === null ? '—' : month.tokens}</span></div>
            <div class="api-bucket"><span class="api-bucket__name">错误数</span><span class="api-bucket__num">${month.errors}</span></div>
          </div>
        </section>

        <div class="api-filters">
          <div class="api-chips">
            <button type="button" data-status="all" aria-pressed="${status === 'all'}">全部</button>
            <button type="button" data-status="success" aria-pressed="${status === 'success'}">成功</button>
            <button type="button" data-status="error" aria-pressed="${status === 'error'}">失败</button>
          </div>
          <div class="api-chips">
            <button type="button" data-kind="all" aria-pressed="${kind === 'all'}">全部能力</button>
            ${kinds
              .map(
                (item) =>
                  `<button type="button" data-kind="${item}" aria-pressed="${kind === item}">${kindLabel(item)}</button>`,
              )
              .join('')}
          </div>
          <select class="input" data-model-filter>
            <option value="">全部模型</option>
            ${models
              .map((id) => `<option value="${esc(id)}"${model === id ? ' selected' : ''}>${esc(id)}</option>`)
              .join('')}
          </select>
        </div>

        ${
          list.length === 0
            ? `<div class="empty">
                 <p class="empty__title">${logs.length === 0 ? '这个站点还没有请求' : '这个筛选下没有记录'}</p>
                 <p class="empty__hint">${
                   logs.length === 0 ? '用它聊两句，这里就会有记录。' : '换个筛选条件试试。'
                 }</p>
               </div>`
            : `<div class="api-logs">${list.slice(0, 100).map(rowHTML).join('')}</div>`
        }
      </div>`;

  }

  bindOnce(host, 'sitelog-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    const statusButton = target.closest<HTMLElement>('[data-status]');
    if (statusButton) {
      status = statusButton.dataset.status as 'all' | 'success' | 'error';
      render();
      return;
    }

    const kindButton = target.closest<HTMLElement>('[data-kind]');
    if (kindButton) {
      kind = (kindButton.dataset.kind as Capability | 'all') ?? 'all';
      render();
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-log-toggle]');
    if (toggle) {
      const id = toggle.closest<HTMLElement>('[data-log]')?.dataset.log ?? null;
      expanded = expanded === id ? null : id;
      render();
    }
  });

  bindOnce(host, 'sitelog-change', 'change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-model-filter]');
    if (!select) return;
    model = select.value;
    render();
  });

  render();
}
