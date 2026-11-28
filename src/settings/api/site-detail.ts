import './api.css';
import { esc } from '../../core/dom';
import { deleteSite, getSite, listAssignments, newId, putSite } from '../../core/db';
import type { Assignment, Site, SiteKey, SiteType } from '../../core/api-types';
import { CAPABILITY_LABEL, SITE_TYPE_LABEL } from '../../core/api-types';
import { normalizeBaseUrl } from '../../core/api-catalog';
import { line } from '../../ui/icons';
import { testSite } from '../../ai/adapters/openai';
import { mountModelsTab } from './tab-models';
import { mountLimitsTab } from './tab-limits';
import { mountSiteLogsTab } from './tab-logs';

/* ==========================================================================
   站点详情页（设计文档 §6）

   四个 Tab：模型 → 日志 → 限制 → 配置，默认打开模型。
   顶部信息卡在所有 Tab 下都固定显示（§6.1）。

   步骤 4 只做「配置 Tab」。模型 Tab 是步骤 5，日志/限制 是步骤 8/10，
   都先给一句明确的占位，不做假界面。

   ⚠️ 其它改动会即时落库；配置 Tab 底部另提供「保存修改」按钮，
      用来把当前改动覆盖保存到当前站点、不影响即时保存机制。
      删除不可逆，所以它走就地二次确认。
   ========================================================================== */

type Tab = 'models' | 'logs' | 'limits' | 'config';

const TAB_LABEL: Record<Tab, string> = {
  models: '模型',
  logs: '日志',
  limits: '限制',
  config: '配置',
};

const TAB_ORDER: Tab[] = ['models', 'logs', 'limits', 'config'];
const SITE_TYPES: SiteType[] = ['official', 'relay', 'aggregator'];

/** Key 只露首尾，中间打码。用户点眼睛才看全 */
function maskKey(value: string): string {
  if (value.length > 16) return `${value.slice(0, 6)}****${value.slice(-4)}`;
  if (value.length > 8) return `${value.slice(0, 4)}****`;
  return '****';
}

/** 把一条分配说成人话，用在「有 N 处在用」的列表里 */
function describeAssignment(item: Assignment): string {
  const scope =
    item.scope === 'global'
      ? '全局'
      : item.scope === 'app'
        ? `App · ${item.scopeId}`
        : `角色 · ${item.scopeId}`;
  return `${scope} › ${CAPABILITY_LABEL[item.kind]}`;
}

export async function mountSiteDetail(root: HTMLElement, siteId: string): Promise<void> {
  let site = await getSite(siteId);
  let tab: Tab = 'models';
  /** 哪些 Key 现在露出来了。只在这个页面里有效，刷新即收回 */
  const revealed = new Set<string>();

  if (!site) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/api" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">站点</h1>
        </header>
        <div class="empty">
          <p class="empty__title">这个站点已经不在了</p>
          <p class="empty__hint">可能刚被删掉。回上一页看看还有哪些站点。</p>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="api-detail">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings/api" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">站点</h1>
      </header>

      <div id="api-hero"></div>

      <div class="api-tabs" role="tablist">
        ${TAB_ORDER.map(
          (key) =>
            `<button type="button" role="tab" data-tab="${key}" aria-selected="${key === tab}">${TAB_LABEL[key]}</button>`,
        ).join('')}
      </div>

      <div class="api-body" id="api-detail-body"></div>
    </div>`;

  const heroHost = root.querySelector<HTMLElement>('#api-hero');
  const bodyHost = root.querySelector<HTMLElement>('#api-detail-body');
  if (!heroHost || !bodyHost) return;
  // TS 不会跨闭包收窄可空值，所以固定成两个非空别名
  const heroEl: HTMLElement = heroHost;
  const bodyEl: HTMLElement = bodyHost;

  // ================================================================ 顶部信息卡

  function renderHero(): void {
    const current = site;
    if (!current) return;

    const light = current.lastTest ? (current.lastTest.ok ? 'is-ok' : 'is-bad') : '';
    const balance = current.balance
      ? `${current.balance.value} ${current.balance.unit}`
      : '不支持查询';
    const enabledCount = current.models.filter((model) => model.enabled).length;

    heroEl.innerHTML = `
      <section class="api-hero">
        <div class="api-hero__title">
          <span class="api-site__dot ${light}"></span>
          <h2 class="api-hero__name">${esc(current.name)}</h2>
          <span class="tag">${SITE_TYPE_LABEL[current.siteType]}</span>
        </div>

        <div class="api-hero__stats">
          <span class="api-hero__stat">余额 <b>${esc(balance)}</b></span>
          <span class="api-hero__stat">·</span>
          <span class="api-hero__stat"><b>${enabledCount}</b> 个模型</span>
        </div>

        ${
          current.lastTest
            ? `<p class="field__note ${current.lastTest.ok ? 'is-ok' : 'is-bad'}">${esc(current.lastTest.message)}</p>`
            : ''
        }

        <div class="row-actions">
          <button class="btn btn--sm jelly" type="button" data-test>查询模型接口</button>
        </div>

        ${
          current.links.length > 0
            ? `<div class="api-hero__links">
                 ${current.links
                   .map(
                     (link) =>
                       `<a class="api-hero__link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${line('world', 16)}${esc(link.name || '链接')}</a>`,
                   )
                   .join('')}
               </div>`
            : ''
        }

        <button class="api-hero__note" type="button" data-goto-config>
          <span>${current.note ? esc(current.note.split('\n')[0] ?? '') : '还没有备注'}</span>
          ${line('chevron', 16)}
        </button>
      </section>`;
  }

  // ================================================================ 配置 Tab

  function renderConfig(): void {
    const current = site;
    if (!current) return;

    bodyEl.innerHTML = `
      <section class="api-section">
        <h3 class="api-section__title">基本信息</h3>

        <label class="field">
          <span class="field__label">名称</span>
          <input class="input" type="text" data-field="name" value="${esc(current.name)}" placeholder="比如：我的中转站" />
        </label>

        <label class="field">
          <span class="field__label">地址</span>
          <input class="input" type="url" data-field="url" value="${esc(current.url)}" placeholder="https://…/v1" spellcheck="false" autocapitalize="off" />
        </label>

        <label class="field">
          <span class="field__label">站点类型</span>
          <select class="input" data-field="siteType">
            ${SITE_TYPES.map(
              (type) =>
                `<option value="${type}"${current.siteType === type ? ' selected' : ''}>${SITE_TYPE_LABEL[type]}</option>`,
            ).join('')}
          </select>
        </label>

        <p class="field__note" data-basic-note></p>
      </section>

      <section class="api-section">
        <h3 class="api-section__title">Key 管理</h3>

        <div class="api-mode" role="radiogroup" aria-label="Key 使用方式">
          <button type="button" role="radio" data-mode="roundrobin"
                  aria-checked="${current.keyMode === 'roundrobin'}"
                  class="${current.keyMode === 'roundrobin' ? 'is-on' : ''}">轮询</button>
          <button type="button" role="radio" data-mode="fixed"
                  aria-checked="${current.keyMode === 'fixed'}"
                  class="${current.keyMode === 'fixed' ? 'is-on' : ''}">固定</button>
        </div>

        <p class="field__hint">轮询：按顺序轮流用。固定：只用你选中的那一个。</p>

        <div id="api-key-list"></div>

        <button class="btn btn--sm jelly" type="button" data-add-key>${line('plus', 16)}添加 Key</button>
      </section>

      <section class="api-section">
        <h3 class="api-section__title">官网链接</h3>
        <div id="api-link-list"></div>
        <button class="btn btn--sm jelly" type="button" data-add-link>${line('plus', 16)}添加链接</button>
      </section>

      <section class="api-section">
        <h3 class="api-section__title">备注</h3>
        <textarea class="input textarea" data-field="note" rows="4" placeholder="记点注意事项，比如「晚高峰很慢」「周末容易断」">${esc(current.note)}</textarea>
      </section>

      <section class="api-section">
        <div class="row-actions">
          <button class="btn btn--primary jelly" type="button" data-save-site>保存修改</button>
        </div>
        <p class="field__hint">修改内容会覆盖保存到当前站点，不会新增一条。</p>
        <p class="field__note" data-save-note></p>
      </section>

      <section class="danger-zone">
        <h3 class="danger-zone__title">删除站点</h3>
        <p class="danger-zone__hint" data-refs-hint>删掉之后不能恢复，Key 也会一起没了。</p>
        <ul class="api-refs" data-refs></ul>
        <div class="row-actions" data-delete-area>
          <button class="btn btn--danger jelly" type="button" data-remove>删除站点</button>
        </div>
      </section>`;

    renderKeys();
    renderLinks();
    void renderRefs();
  }

  function renderKeys(): void {
    const current = site;
    const list = bodyEl.querySelector<HTMLElement>('#api-key-list');
    if (!current || !list) return;

    if (current.keys.length === 0) {
      list.innerHTML = `<p class="field__note">还没有 Key。没有 Key 的站点没法用。</p>`;
      return;
    }

    list.innerHTML = current.keys
      .map((key) => {
        const shown = revealed.has(key.id);
        return `
          <div class="api-key" data-key="${esc(key.id)}">
            ${
              current.keyMode === 'fixed'
                ? // 固定模式：行首这个点变成「用哪个 Key」的选择位。
                  // 不再塞一个裸 radio —— 浏览器默认样式会渲染成一个突兀的大黑圆。
                  `<button class="api-key__choose${current.fixedKeyId === key.id ? ' is-on' : ''}"
                           type="button" data-key-fixed="${esc(key.id)}"
                           aria-pressed="${current.fixedKeyId === key.id}"
                           aria-label="固定用这个 Key"></button>`
                : `<span class="api-key__dot ${key.abnormal ? 'is-bad' : ''}"></span>`
            }
            <span class="api-key__main">
              <span class="api-key__value">${esc(shown ? key.value : maskKey(key.value) || '（还没填）')}</span>
              <button class="api-key__label" type="button" data-key-label>${esc(key.label || '点这里写个备注名')}</button>
            </span>
            <span class="api-key__ops">
              <button class="api-key__icon jelly" type="button" data-key-eye aria-label="${shown ? '隐藏' : '显示'}">${line(shown ? 'eyeOff' : 'eye', 18)}</button>
              <label class="switch">
                <input type="checkbox" data-key-enabled${key.enabled ? ' checked' : ''} aria-label="启用这个 Key" />
                <span class="switch__track"></span>
              </label>
              <button class="api-key__icon jelly" type="button" data-key-remove aria-label="删除这个 Key">${line('trash', 18)}</button>
            </span>
          </div>`;
      })
      .join('');
  }

  function renderLinks(): void {
    const current = site;
    const list = bodyEl.querySelector<HTMLElement>('#api-link-list');
    if (!current || !list) return;

    if (current.links.length === 0) {
      list.innerHTML = `<p class="field__note">还没有链接。加上官网、文档、控制台，以后一眼就能跳过去。</p>`;
      return;
    }

    list.innerHTML = current.links
      .map(
        (link, index) => `
        <div class="api-link-row" data-link="${index}">
          <span class="api-link-row__main">
            <span class="api-link-row__name">${esc(link.name || '未命名')}</span>
            <span class="api-link-row__url">${esc(link.url)}</span>
          </span>
          <a class="api-key__icon jelly" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="打开">${line('world', 18)}</a>
          <button class="api-key__icon jelly" type="button" data-link-remove aria-label="删除这条链接">${line('trash', 18)}</button>
        </div>`,
      )
      .join('');
  }

  /** 有哪些分配在用这个站点 */
  async function refsFor(): Promise<Assignment[]> {
    const all = await listAssignments();
    const id = site?.id;
    if (!id) return [];
    return all.filter(
      (item) =>
        item.target?.siteId === id ||
        item.fallback?.siteId === id ||
        item.aux?.siteId === id,
    );
  }

  async function renderRefs(): Promise<void> {
    const list = bodyEl.querySelector<HTMLElement>('[data-refs]');
    const hint = bodyEl.querySelector<HTMLElement>('[data-refs-hint]');
    if (!list || !hint) return;

    const assignments = await refsFor();
    if (assignments.length === 0) {
      list.innerHTML = '';
      hint.textContent = '删掉之后不能恢复，Key 也会一起没了。';
      return;
    }

    // 有地方在用：先说清楚有几处、在哪，再让用户自己决定
    hint.textContent = `有 ${assignments.length} 处在用这个站点。删掉后这些地方会变回「没有设置」。`;
    list.innerHTML = assignments
      .map((item) => `<li>${esc(describeAssignment(item))}</li>`)
      .join('');
  }

  function render(): void {
    if (!site) return;
    if (tab === 'config') renderConfig();
    else if (tab === 'models') mountModelsTab(bodyEl, site, renderHero);
    else if (tab === 'limits') mountLimitsTab(bodyEl, site, renderHero);
    else void mountSiteLogsTab(bodyEl, site);
  }

  /** 写库 + 视觉刷新。所有即时保存都从这里出去 */
  async function commit(mutate: (value: Site) => void, redraw: () => void): Promise<void> {
    const current = site;
    if (!current) return;
    mutate(current);
    current.updatedAt = Date.now();
    await putSite(current);
    renderHero();
    redraw();
  }

  // ================================================================ 事件

  root.querySelector('.api-tabs')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    const next = button?.dataset.tab as Tab | undefined;
    if (!next || next === tab) return;
    tab = next;
    for (const item of root.querySelectorAll<HTMLElement>('[data-tab]')) {
      item.setAttribute('aria-selected', String(item.dataset.tab === tab));
    }
    render();
  });

  heroEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const testButton = target.closest<HTMLButtonElement>('[data-test]');
    if (testButton) {
      testButton.disabled = true;
      testButton.textContent = '正在测试…';
      void (async () => {
        const current = site;
        if (!current) return;
        const result = await testSite(current);
        await commit((value) => {
          value.lastTest = result;
        }, () => {
          /* hero 自己会重画，这里没有额外要刷的 */
        });
      })();
      return;
    }

    if (target.closest('[data-goto-config]')) {
      tab = 'config';
      for (const item of root.querySelectorAll<HTMLElement>('[data-tab]')) {
        item.setAttribute('aria-selected', String(item.dataset.tab === 'config'));
      }
      render();
    }
  });

  bodyEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    // ---- Key：眼睛 / 备注名 / 删除 / 新增

    const eye = target.closest<HTMLElement>('[data-key-eye]');
    if (eye) {
      const id = eye.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (!id) return;
      if (revealed.has(id)) revealed.delete(id);
      else revealed.add(id);
      renderKeys();
      return;
    }

    const labelButton = target.closest<HTMLElement>('[data-key-label]');
    if (labelButton) {
      const row = labelButton.closest<HTMLElement>('[data-key]');
      const key = site?.keys.find((item) => item.id === row?.dataset.key);
      if (!row || !key) return;
      editKeyLabel(key, labelButton);
      return;
    }

    const removeKey = target.closest<HTMLElement>('[data-key-remove]');
    if (removeKey) {
      const id = removeKey.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (!id) return;
      void commit(
        (value) => {
          value.keys = value.keys.filter((item) => item.id !== id);
          if (value.fixedKeyId === id) value.fixedKeyId = '';
        },
        renderKeys,
      );
      return;
    }

    if (target.closest('[data-add-key]')) {
      const key: SiteKey = { id: newId(), value: '', label: '', enabled: true, abnormal: false };
      void (async () => {
        await commit(
          (value) => {
            value.keys.push(key);
          },
          renderKeys,
        );
        // 新 Key 是空的，直接把光标送进去，别让用户再点一次
        const row = bodyEl.querySelector<HTMLElement>(`[data-key="${key.id}"]`);
        const button = row?.querySelector<HTMLElement>('[data-key-label]');
        if (row && button) {
          const created = site?.keys.find((item) => item.id === key.id);
          if (created) editKeyLabel(created, button);
        }
      })();
      return;
    }

    // ---- 链接：删除 / 新增 / 编辑

    const removeLink = target.closest<HTMLElement>('[data-link-remove]');
    if (removeLink) {
      const index = Number(removeLink.closest<HTMLElement>('[data-link]')?.dataset.link ?? '-1');
      if (index < 0) return;
      void commit(
        (value) => {
          value.links.splice(index, 1);
        },
        renderLinks,
      );
      return;
    }

    if (target.closest('[data-add-link]')) {
      void (async () => {
        await commit(
          (value) => {
            value.links.push({ name: '', url: '' });
          },
          renderLinks,
        );
        editLink((site?.links.length ?? 1) - 1);
      })();
      return;
    }

    const linkRow = target.closest<HTMLElement>('[data-link]');
    if (linkRow && !target.closest('a')) {
      editLink(Number(linkRow.dataset.link ?? '-1'));
      return;
    }

    // ---- 删除站点：就地二次确认，不用弹层

    const remove = target.closest<HTMLElement>('[data-remove]');
    if (remove) {
      const area = bodyEl.querySelector<HTMLElement>('[data-delete-area]');
      if (!area) return;
      area.innerHTML = `
        <button class="btn btn--danger jelly" type="button" data-remove-yes>确认删除</button>
        <button class="btn btn--ghost jelly" type="button" data-remove-no>取消</button>`;
      area.querySelector('[data-remove-yes]')?.addEventListener('click', () => {
        void (async () => {
          if (!site) return;
          await deleteSite(site.id);
          location.hash = '/settings/api';
        })();
      });
      area.querySelector('[data-remove-no]')?.addEventListener('click', () => {
        area.innerHTML = `<button class="btn btn--danger jelly" type="button" data-remove>删除站点</button>`;
      });
      return;
    }
  });

  bodyEl.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;

    const enabled = target.closest<HTMLInputElement>('[data-key-enabled]');
    if (enabled) {
      const id = enabled.closest<HTMLElement>('[data-key]')?.dataset.key;
      void commit(
        (value) => {
          const key = value.keys.find((item) => item.id === id);
          if (key) key.enabled = enabled.checked;
        },
        () => {
          /* 开关本身就是反馈，不重画，免得把手指下的元素抽走 */
        },
      );
      return;
    }

    const fixed = target.closest<HTMLElement>('[data-key-fixed]');
    if (fixed?.dataset.keyFixed) {
      const pickedId = fixed.dataset.keyFixed;
      void commit(
        (value) => {
          value.keyMode = 'fixed';
          value.fixedKeyId = pickedId;
        },
        // 重画一次：选中的圆点要跳过去，不然只有第一次点有效
        renderKeys,
      );
      return;
    }

    const mode = target.closest<HTMLElement>('[data-mode]');
    if (mode) {
      const next = mode.dataset.mode === 'fixed' ? 'fixed' : 'roundrobin';
      void commit(
        (value) => {
          value.keyMode = next;
          value.fixedKeyId =
            next === 'fixed' ? (value.keys.find((item) => item.enabled)?.id ?? '') : '';
        },
        renderKeys,
      );
      return;
    }

    const field = target.closest<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      '[data-field]',
    );
    if (field) void commitField(field);

    if (target.closest('[data-save-site]')) {
      const saveNote = bodyEl.querySelector<HTMLElement>('[data-save-note]');
      const current = site;
      if (!current) return;
      const nameEl = bodyEl.querySelector<HTMLInputElement>('[data-field="name"]');
      const urlEl = bodyEl.querySelector<HTMLInputElement>('[data-field="url"]');
      const typeEl = bodyEl.querySelector<HTMLSelectElement>('[data-field="siteType"]');
      const noteEl = bodyEl.querySelector<HTMLTextAreaElement>('[data-field="note"]');

      if (urlEl) {
        const { url } = normalizeBaseUrl(urlEl.value.trim(), current.protocol);
        if (!url) {
          showNote(saveNote, '地址不能空着', false);
          urlEl.value = current.url;
          return;
        }
        urlEl.value = url;
      }

      void commit(
        (value) => {
          const nextName = nameEl?.value.trim();
          if (nextName) value.name = nextName;
          else if (nameEl) nameEl.value = value.name;
          if (urlEl) {
            const { url } = normalizeBaseUrl(urlEl.value.trim(), value.protocol);
            if (url) value.url = url;
          }
          if (typeEl) value.siteType = typeEl.value as SiteType;
          if (noteEl) value.note = noteEl.value;
        },
        () => {},
      ).then(() => showNote(saveNote, '已保存到当前站点', true));
    }
  });

  // 文本框用失焦保存，避免每敲一个字就写一次库
  bodyEl.addEventListener(
    'blur',
    (event) => {
      const field = (event.target as HTMLElement).closest<
        HTMLInputElement | HTMLTextAreaElement
      >('[data-field]');
      if (field) void commitField(field);
    },
    true,
  );

  /** 基本信息 / 备注的落库 */
  async function commitField(
    field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ): Promise<void> {
    const current = site;
    if (!current) return;
    const name = field.dataset.field;
    const note = bodyEl.querySelector<HTMLElement>('[data-basic-note]');

    if (name === 'name') {
      const next = field.value.trim();
      if (!next) {
        field.value = current.name;
        return;
      }
      if (next === current.name) return;
      await commit((value) => {
        value.name = next;
      }, () => {});
      return;
    }

    if (name === 'url') {
      const { url } = normalizeBaseUrl(field.value.trim(), current.protocol);
      if (!url) {
        showNote(note, '地址不能空着', false);
        field.value = current.url;
        return;
      }
      if (url === current.url) return;
      field.value = url;
      await commit((value) => {
        value.url = url;
      }, () => {});
      showNote(note, '地址已保存', true);
      return;
    }

    if (name === 'siteType') {
      await commit((value) => {
        value.siteType = field.value as SiteType;
      }, () => {});
      showNote(note, '已保存', true);
      return;
    }

    if (name === 'note') {
      if (field.value === current.note) return;
      await commit((value) => {
        value.note = field.value;
      }, () => {});
      showNote(note, '备注已保存', true);
    }
  }

  function showNote(note: HTMLElement | null, text: string, ok: boolean): void {
    if (!note) return;
    note.className = `field__note ${ok ? 'is-ok' : 'is-bad'}`;
    note.textContent = text;
    if (!ok) return;
    setTimeout(() => {
      if (note.textContent === text) {
        note.textContent = '';
        note.className = 'field__note';
      }
    }, 1600);
  }

  /** Key 的备注名：点一下就地变成输入框 */
  function editKeyLabel(key: SiteKey, button: HTMLElement): void {
    const input = document.createElement('input');
    input.className = 'input';
    input.type = 'text';
    input.value = key.value;
    input.placeholder = 'sk-… 粘进来';
    input.spellcheck = false;
    input.autocapitalize = 'off';

    const labelInput = document.createElement('input');
    labelInput.className = 'input';
    labelInput.type = 'text';
    labelInput.value = key.label;
    labelInput.placeholder = '备注名，比如「主号」';

    const wrap = document.createElement('span');
    wrap.className = 'api-key__main';
    wrap.append(input, labelInput);
    button.replaceWith(wrap);
    (key.value ? labelInput : input).focus();

    let done = false;
    const finish = async (): Promise<void> => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      const label = labelInput.value.trim();
      await commit(
        (siteValue) => {
          const target = siteValue.keys.find((item) => item.id === key.id);
          if (!target) return;
          // 清空了 Key 值就把这条删掉，不留空壳
          if (!value) {
            siteValue.keys = siteValue.keys.filter((item) => item.id !== key.id);
            if (siteValue.fixedKeyId === key.id) siteValue.fixedKeyId = '';
            return;
          }
          target.value = value;
          target.label = label;
        },
        renderKeys,
      );
    };

    // 两个输入框是一体的：焦点在它们之间移动时不算「填完了」，
    // 只有焦点真的离开这一整块才提交。否则填完 Key 再点备注名，前半截会被吞掉。
    wrap.addEventListener('focusout', (ev) => {
      const next = (ev as FocusEvent).relatedTarget as Node | null;
      if (next && wrap.contains(next)) return;
      void finish();
    });
    for (const el of [input, labelInput]) {
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void finish();
        }
      });
    }
  }

  /** 编辑一条链接：名称 + 网址，就地展开 */
  function editLink(index: number): void {
    const current = site;
    const link = current?.links[index];
    if (!current || !link) return;

    const row = bodyEl.querySelector<HTMLElement>(`[data-link="${index}"]`);
    if (!row) return;

    row.innerHTML = `
      <span class="api-link-row__main">
        <input class="input" type="text" data-link-name value="${esc(link.name)}" placeholder="官网 / 文档 / 控制台" />
        <input class="input" type="url" data-link-url value="${esc(link.url)}" placeholder="https://" spellcheck="false" autocapitalize="off" />
      </span>
      <button class="api-key__icon jelly" type="button" data-link-done aria-label="完成">${line('check', 18)}</button>`;

    const nameInput = row.querySelector<HTMLInputElement>('[data-link-name]');
    const urlInput = row.querySelector<HTMLInputElement>('[data-link-url]');
    nameInput?.focus();

    let done = false;
    const finish = async (): Promise<void> => {
      if (done) return;
      done = true;
      const name = nameInput?.value.trim() ?? '';
      const raw = urlInput?.value.trim() ?? '';

      await commit(
        (value) => {
          // 没填网址就把这条丢掉，不留下半截数据
          if (!raw) {
            value.links.splice(index, 1);
            return;
          }
          value.links[index] = {
            name,
            url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
          };
        },
        renderLinks,
      );
    };

    // 和 Key 一样：两个框是一体的，焦点在这块内部移动不算填完
    row.addEventListener('focusout', (ev) => {
      const next = (ev as FocusEvent).relatedTarget as Node | null;
      if (next && row.contains(next)) return;
      void finish();
    });
    for (const el of [nameInput, urlInput]) {
      el?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void finish();
        }
      });
    }
  }

  renderHero();
  render();
}