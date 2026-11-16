import './api.css';
import { bindOnce, esc } from '../../core/dom';
import { listLogs, listSites } from '../../core/db';
import type { Capability, RequestLog } from '../../core/api-types';
import { line } from '../../ui/icons';
import {
  bucketBy,
  durationText,
  kindLabel,
  logTime,
  monthStart,
  summarize,
} from '../../core/log-stats';
import { refreshBalance } from '../../ai/adapters/openai';

/* ==========================================================================
   用量 Tab（设计文档 §8）

   上半：本月消耗汇总（可按站点 / 能力 / 模型切换）+ 余额汇总
   下半：全站请求日志（筛选 + 展开详情）
   ========================================================================== */

type Dim = 'site' | 'kind' | 'model';
type StatusFilter = 'all' | 'success' | 'error';

export async function mountUsageView(host: HTMLElement): Promise<void> {
  const [logs, sites] = await Promise.all([listLogs(500), listSites()]);

  let dim: Dim = 'site';
  let status: StatusFilter = 'all';
  let siteFilter = '';
  let expanded: string | null = null;

  const siteName = (id: string): string => sites.find((item) => item.id === id)?.name ?? '已删除的站点';

  function filtered(): RequestLog[] {
    return logs.filter((log) => {
      if (status !== 'all' && log.status !== status) return false;
      if (siteFilter && log.siteId !== siteFilter) return false;
      return true;
    });
  }

  function monthLogs(): RequestLog[] {
    const since = monthStart();
    return logs.filter((log) => log.time >= since);
  }

  // ---------------------------------------------------------------- 上半：汇总

  function summaryHTML(): string {
    const month = monthLogs();
    const stats = summarize(month);
    const dimKey = (log: RequestLog): string =>
      dim === 'site' ? log.siteId : dim === 'model' ? log.modelId : log.kind;
    const buckets = bucketBy(month, dimKey, (key) => {
      if (dim === 'site') return siteName(key);
      if (dim === 'kind') return kindLabel(key as Capability);
      return key || '未记录';
    });

    return `
      <section class="api-summary">
        <h2 class="api-summary__title">本月消耗</h2>
        <div class="api-usage__totals">
          <span class="api-usage__big">${stats.count}<small>次请求</small></span>
          <span class="api-usage__side">
            ${stats.inputTokens === null && stats.outputTokens === null
              ? 'Token —'
              : `Token ${(stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)}`}
            ${stats.errors > 0 ? ` · 出错 ${stats.errors}` : ''}
          </span>
        </div>

        <div class="api-chips">
          <button type="button" data-dim="site" aria-pressed="${dim === 'site'}">按站点</button>
          <button type="button" data-dim="kind" aria-pressed="${dim === 'kind'}">按能力</button>
          <button type="button" data-dim="model" aria-pressed="${dim === 'model'}">按模型</button>
        </div>

        ${
          buckets.length === 0
            ? '<p class="field__note">这个月还没有请求。</p>'
            : `<div class="api-buckets">
                 ${buckets
                   .map(
                     (bucket) => `
                   <div class="api-bucket">
                     <span class="api-bucket__name">${esc(bucket.label)}</span>
                     <span class="api-bucket__num">${bucket.count} 次${
                       bucket.errors > 0 ? ` · 错 ${bucket.errors}` : ''
                     }</span>
                   </div>`,
                   )
                   .join('')}
               </div>`
        }
      </section>`;
  }

  function balanceHTML(): string {
    const withBalance = sites.filter((site) => site.balance);
    const without = sites.filter((site) => !site.balance);

    return `
      <section class="api-section">
        <h3 class="api-section__title">余额</h3>
        ${
          withBalance.length === 0
            ? `<p class="field__note">${
                without.length > 0
                  ? `${without.length} 个站点还没查过余额，点下面的按钮试一次。`
                  : '还没有站点。'
              }</p>`
            : withBalance
                .map(
                  (site) => `
              <div class="api-assign-row">
                <span class="api-assign-row__main">
                  <span class="api-assign-row__label">${esc(site.name)}</span>
                  <span class="api-assign-row__value">${esc(`${site.balance?.value ?? '—'} ${site.balance?.unit ?? ''}`)}</span>
                </span>
              </div>`,
                )
                .join('')
        }
        <button class="btn btn--sm jelly" type="button" data-refresh-balance>${line('refresh', 16)}全部刷新</button>
        <p class="field__note" data-balance-note></p>
      </section>`;
  }

  // ---------------------------------------------------------------- 下半：日志

  function logRowHTML(log: RequestLog): string {
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
              ${esc(siteName(log.siteId))} · ${esc(log.modelId)}
            </span>
            <span class="api-log__meta">${log.switchedFrom ? `由 ${esc(log.switchedFrom)} 切换而来 · ` : ''}${logTime(log.time)} · ${kindLabel(log.kind)} · ${tokens} token · ${durationText(log.durationMs)}</span>
          </span>
          ${line('chevron', 16)}
        </button>
        ${
          isOpen
            ? `<div class="api-log__detail">
                 <p class="api-log__line">发起方：${
                   log.scope.roleId ? `角色 ${esc(log.scope.roleId)}` : log.scope.appId ? `App ${esc(log.scope.appId)}` : '全局'
                 }</p>
                 <p class="api-log__line">状态：${log.status === 'success' ? '成功' : '失败'}${log.switchedFrom ? `（由 ${esc(log.switchedFrom)} 切换而来）` : ''}</p>
                 ${log.errorMessage ? `<p class="api-log__line is-bad">${esc(log.errorMessage)}</p>` : ''}
               </div>`
            : ''
        }
      </div>`;
  }

  function logsHTML(): string {
    const list = filtered();
    return `
      <section class="api-section">
        <h3 class="api-section__title">请求日志</h3>

        <div class="api-chips">
          <button type="button" data-status="all" aria-pressed="${status === 'all'}">全部</button>
          <button type="button" data-status="success" aria-pressed="${status === 'success'}">成功</button>
          <button type="button" data-status="error" aria-pressed="${status === 'error'}">失败</button>
        </div>

        <select class="input" data-site-filter>
          <option value="">全部站点</option>
          ${sites.map((site) => `<option value="${esc(site.id)}"${siteFilter === site.id ? ' selected' : ''}>${esc(site.name)}</option>`).join('')}
        </select>

        ${
          list.length === 0
            ? `<div class="empty">
                 <p class="empty__title">还没有请求记录</p>
                 <p class="empty__hint">每次调用 AI 都会在这里留一条。去聊两句就有了。</p>
               </div>`
            : `<div class="api-logs">${list.slice(0, 100).map(logRowHTML).join('')}</div>
               ${list.length > 100 ? `<p class="field__note">只显示最近 100 条，共 ${list.length} 条。</p>` : ''}`
        }
      </section>`;
  }

  function render(): void {
    host.innerHTML = `
      ${summaryHTML()}
      ${balanceHTML()}
      ${logsHTML()}
      <p class="page-foot">日志保留 30 天，超期自动清理。</p>`;
  }

  // ---------------------------------------------------------------- 事件

  bindOnce(host, 'usage-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    const dimButton = target.closest<HTMLElement>('[data-dim]');
    if (dimButton) {
      dim = dimButton.dataset.dim as Dim;
      render();
      return;
    }

    const statusButton = target.closest<HTMLElement>('[data-status]');
    if (statusButton) {
      status = statusButton.dataset.status as StatusFilter;
      render();
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-log-toggle]');
    if (toggle) {
      const id = toggle.closest<HTMLElement>('[data-log]')?.dataset.log ?? null;
      expanded = expanded === id ? null : id;
      render();
      return;
    }

    if (target.closest('[data-refresh-balance]')) {
      const button = target.closest<HTMLButtonElement>('[data-refresh-balance]');
      const note = host.querySelector<HTMLElement>('[data-balance-note]');
      if (button) {
        button.disabled = true;
        button.textContent = '正在查询…';
      }
      void (async () => {
        let ok = 0;
        let unsupported = 0;
        for (const site of sites) {
          const result = await refreshBalance(site);
          if (result) ok += 1;
          else unsupported += 1;
        }
        if (note) {
          note.className = 'field__note';
          note.textContent =
            ok > 0
              ? `查到 ${ok} 个站点的余额${unsupported > 0 ? `，${unsupported} 个不支持查询` : ''}`
              : '这些站点都不支持查询余额，这不影响正常使用。';
        }
        await mountUsageView(host);
      })();
    }
  });

  bindOnce(host, 'usage-change', 'change', (event) => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-site-filter]');
    if (!select) return;
    siteFilter = select.value;
    render();
  });

  render();
}
