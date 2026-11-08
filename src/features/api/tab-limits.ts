import './api.css';
import { bindOnce, esc } from '../../core/dom';
import { putSite } from '../../core/db';
import type { Site, SiteLimits, SiteModel } from '../../core/api-types';
import { DEFAULT_LIMITS } from '../../core/api-types';
import { line } from '../../ui/icons';
import { quotaSnapshot, waitingCount } from '../../ai/call';

/* ==========================================================================
   站点详情 · Tab 3「限制」（设计文档 §6.5）

   站点级五项：并发 / 速率 / 超限时 / 超时 / 重试，0 表示不限。
   顶部一行实时状态：进行中 N / 上限 · 排队 N · 本分钟已用 N / 上限

   模型级限制挂在模型 Tab 的「…」里，默认全部「跟随站点」，
   只有用户主动改过的项才单独生效。

   ⚠️ 实时状态每 1 秒重画一次，但**只改那行数字**，不重建表单 ——
      否则用户正在输入框里打字会被打断。
   ========================================================================== */

interface FieldDef {
  key: keyof Pick<SiteLimits, 'concurrent' | 'rpm' | 'timeout' | 'retry'>;
  label: string;
  hint: string;
  /** 0 在这个字段是不是「不限」 */
  zeroMeansUnlimited: boolean;
}

const FIELDS: FieldDef[] = [
  { key: 'concurrent', label: '并发数', hint: '同时最多几个请求在进行（0 = 不限）', zeroMeansUnlimited: true },
  { key: 'rpm', label: '速率限制', hint: '每分钟最多几次请求（0 = 不限）', zeroMeansUnlimited: true },
  { key: 'timeout', label: '请求超时', hint: '单次请求最长等多少秒', zeroMeansUnlimited: false },
  { key: 'retry', label: '失败重试', hint: '失败后自动重试几次', zeroMeansUnlimited: false },
];

export function mountLimitsTab(host: HTMLElement, site: Site, onChange: () => void): void {
  let timer: number | null = null;

  function liveHTML(): string {
    const limits = site.limits ?? DEFAULT_LIMITS;
    const snap = quotaSnapshot(site);
    const queued = waitingCount(site.id);
    const concurrentCap = limits.concurrent > 0 ? limits.concurrent : '∞';
    const rpmCap = limits.rpm > 0 ? limits.rpm : '∞';
    return `进行中 ${snap.running} / ${concurrentCap} · 排队 ${queued} · 本分钟已用 ${snap.usedThisMinute} / ${rpmCap}`;
  }

  function fieldHTML(def: FieldDef): string {
    const limits = site.limits ?? DEFAULT_LIMITS;
    return `
      <label class="field">
        <span class="field__label">${def.label}</span>
        <input class="input" type="number" inputmode="numeric" min="0"
               data-limit="${def.key}" value="${limits[def.key]}" />
        <span class="field__hint">${def.hint}</span>
      </label>`;
  }

  function render(): void {
    const limits = site.limits ?? DEFAULT_LIMITS;
    host.innerHTML = `
      <div class="api-body">
        <section class="api-section">
          <h3 class="api-section__title">实时状态</h3>
          <p class="api-limits__live" data-live>${liveHTML()}</p>
          <p class="field__hint">只有在这个浏览器里发出的请求才算数。</p>
        </section>

        <section class="api-section">
          <h3 class="api-section__title">站点限制</h3>
          ${FIELDS.map(fieldHTML).join('')}

          <div class="field">
            <span class="field__label">超限时</span>
            <div class="api-mode" role="radiogroup" aria-label="超限时怎么办">
              <button type="button" role="radio" data-overflow="queue"
                      aria-checked="${limits.overflow === 'queue'}"
                      class="${limits.overflow === 'queue' ? 'is-on' : ''}">排队等待</button>
              <button type="button" role="radio" data-overflow="error"
                      aria-checked="${limits.overflow === 'error'}"
                      class="${limits.overflow === 'error' ? 'is-on' : ''}">直接报错</button>
            </div>
          </div>

          <p class="field__note" data-limit-note></p>
          <button class="btn btn--ghost btn--sm jelly" type="button" data-reset>恢复默认</button>
        </section>

        <section class="api-section">
          <h3 class="api-section__title">模型级限制</h3>
          <p class="field__hint">在「模型」Tab 点某个模型的「…」进去单独设。默认全部跟随站点。</p>
          ${modelLimitsHTML()}
        </section>
      </div>`;

    // 实时状态每 1 秒刷一次，只动那一行文字
    timer = window.setInterval(() => {
      const live = host.querySelector<HTMLElement>('[data-live]');
      if (live) live.textContent = liveHTML();
    }, 1000);
  }

  function modelLimitsHTML(): string {
    const custom = site.models.filter((model) => model.limits && Object.keys(model.limits).length > 0);
    if (site.models.length === 0) return '<p class="field__note">还没有模型。</p>';
    if (custom.length === 0) return '<p class="field__note">所有模型都跟随站点限制。</p>';
    return custom
      .map(
        (model) => `
        <div class="api-assign-row">
          <span class="api-assign-row__main">
            <span class="api-assign-row__label">${esc(model.name)}</span>
            <span class="api-assign-row__value">${esc(describeModelLimits(model))}</span>
          </span>
          <button class="api-key__icon jelly" type="button" data-clear-model="${esc(model.id)}" aria-label="恢复跟随站点">${line('trash', 18)}</button>
        </div>`,
      )
      .join('');
  }

  bindOnce(host, 'limits-change', 'change', (event) => {
    const target = event.target as HTMLElement;

    const numberField = target.closest<HTMLInputElement>('[data-limit]');
    if (numberField) {
      const key = numberField.dataset.limit as FieldDef['key'];
      // 负数没意义，一律当 0
      const value = Math.max(0, Math.floor(Number(numberField.value) || 0));
      numberField.value = String(value);
      void commit((limits) => {
        limits[key] = value;
      });
      return;
    }

    const overflow = target.closest<HTMLElement>('[data-overflow]');
    if (overflow) {
      void commit(
        (limits) => {
          limits.overflow = overflow.dataset.overflow === 'error' ? 'error' : 'queue';
        },
        // 重画：选中态要跳到新按钮上
        true,
      );
    }
  });

  bindOnce(host, 'limits-click', 'click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-reset]')) {
      void commit((limits) => {
        Object.assign(limits, DEFAULT_LIMITS);
      }, true);
      return;
    }

    const clearModel = target.closest<HTMLElement>('[data-clear-model]');
    if (clearModel) {
      const id = clearModel.dataset.clearModel;
      const model = site.models.find((item) => item.id === id);
      if (!model) return;
      model.limits = null;
      void commit(() => {
        /* 只改模型 */
      }, true);
    }
  });

  /** 写库。静默保存，只在旁边闪一句「已保存」 */
  async function commit(mutate: (limits: SiteLimits) => void, rerender = false): Promise<void> {
    const limits: SiteLimits = { ...(site.limits ?? DEFAULT_LIMITS) };
    mutate(limits);
    site.limits = limits;
    site.updatedAt = Date.now();
    await putSite(site);
    onChange();

    if (rerender) {
      stop();
      render();
      return;
    }
    const note = host.querySelector<HTMLElement>('[data-limit-note]');
    if (note) {
      note.className = 'field__note is-ok';
      note.textContent = '已保存';
      window.setTimeout(() => {
        if (note.textContent === '已保存') {
          note.textContent = '';
          note.className = 'field__note';
        }
      }, 1500);
    }
  }

  function stop(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  render();

  // 页面切走时把定时器停掉，别让它在后台空转
  window.addEventListener('hashchange', stop, { once: true });
}

/** 模型限制说成人话，比如「并发 1 · 速率 10」 */
function describeModelLimits(model: SiteModel): string {
  const limits = model.limits;
  if (!limits) return '跟随站点';
  const parts: string[] = [];
  if (typeof limits.concurrent === 'number') parts.push(`并发 ${limits.concurrent}`);
  if (typeof limits.rpm === 'number') parts.push(`速率 ${limits.rpm}`);
  if (typeof limits.timeout === 'number') parts.push(`超时 ${limits.timeout}s`);
  if (typeof limits.retry === 'number') parts.push(`重试 ${limits.retry}`);
  if (limits.overflow) parts.push(limits.overflow === 'queue' ? '排队' : '报错');
  return parts.length > 0 ? parts.join(' · ') : '跟随站点';
}
