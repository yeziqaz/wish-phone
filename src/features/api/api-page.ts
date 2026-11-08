import './api.css';
import { esc, unbindAll } from '../../core/dom';
import { listAssignments, listSites } from '../../core/db';
import type { Assignment, Site } from '../../core/api-types';
import { SITE_TYPE_LABEL } from '../../core/api-types';
import { parseSites } from '../../core/api-paste';
import type { SiteDraft } from '../../core/api-paste';
import { line } from '../../ui/icons';
import { kindsText, openSiteEditor } from './site-editor';
import { mountAssignView } from './assign-global';
import { mountUsageView } from './assign-usage';

/* ==========================================================================
   API 与模型（设计文档 v1.1 §3 页面树 / §4 站点 Tab）

   三个 Tab 同页切换，不跳路由 —— 切 Tab 不该动浏览器历史。
   步骤 2 只做「站点」，分配和用量等步骤 7 / 8。
   ========================================================================== */

type Tab = 'sites' | 'assign' | 'usage';

const TAB_LABEL: Record<Tab, string> = {
  sites: '站点',
  assign: '分配',
  usage: '用量',
};

export async function mountApiPage(root: HTMLElement): Promise<void> {
  let tab: Tab = 'sites';
  let sites: Site[] = await listSites();
  let assignments: Assignment[] = await listAssignments();

  root.innerHTML = `
    <div class="api-page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">API 与模型</h1>
        <button class="topbar__action jelly" type="button" id="api-add" aria-label="手动添加站点">${line('plus', 22)}</button>
      </header>

      <div class="api-tabs" role="tablist">
        ${(Object.keys(TAB_LABEL) as Tab[])
          .map(
            (key) =>
              `<button type="button" role="tab" data-tab="${key}" aria-selected="${key === tab}">${TAB_LABEL[key]}</button>`,
          )
          .join('')}
      </div>

      <div class="api-body" id="api-body"></div>
    </div>`;

  const bodyHost = root.querySelector<HTMLElement>('#api-body');
  if (!bodyHost) return;
  const body: HTMLElement = bodyHost;

  /** 被引用的次数：分配里指向这个站点的条数 */
  const usageOf = (siteId: string): number =>
    assignments.filter(
      (item) =>
        item.target?.siteId === siteId ||
        item.fallback?.siteId === siteId ||
        item.aux?.siteId === siteId,
    ).length;

  function siteCardHTML(site: Site): string {
    const enabled = site.models.filter((model) => model.enabled).length;
    const light = site.lastTest ? (site.lastTest.ok ? 'is-ok' : 'is-bad') : '';
    const balance = site.balance ? `${site.balance.value} ${site.balance.unit}` : '—';
    const used = usageOf(site.id);
    const kinds = kindsText(site);

    return `
      <button class="api-site" type="button" data-site="${esc(site.id)}">
        <span class="api-site__dot ${light}"></span>
        <span class="api-site__main">
          <span class="api-site__name">${esc(site.name)}</span>
          <span class="api-site__meta">${SITE_TYPE_LABEL[site.siteType]} · 余额 ${esc(balance)} · ${enabled} 个模型${kinds ? ` · ${esc(kinds)}` : ''}${used > 0 ? ` · ${used} 处使用` : ''}</span>
        </span>
        <span class="api-site__tail">${line('chevron', 18)}</span>
      </button>`;
  }

  function sitesHTML(): string {
    if (sites.length === 0) {
      return `
        <div class="empty">
          <p class="empty__title">把你的 API 信息粘贴进来，自动填好</p>
          <p class="empty__hint">名称、地址、Key 一起粘进来就行，格式乱了也能认。</p>
        </div>`;
    }
    return `<div class="api-sites">${sites.map(siteCardHTML).join('')}</div>`;
  }

  function renderSites(): void {
    body.innerHTML = `
      <section class="api-import">
        <h2 class="api-import__title">粘贴导入</h2>
        <p class="api-import__hint">一行名称、一行地址、一行或几行 Key。多粘几个站点也能分开。</p>
        <textarea class="api-import__box" id="api-paste" rows="4" spellcheck="false" autocapitalize="off" placeholder="我的中转站&#10;https://api.example.com/v1&#10;sk-xxxxxxxx"></textarea>
        <div class="field">
          <button class="btn btn--primary jelly" type="button" id="api-recognize">识别</button>
          <p class="field__note" id="api-note"></p>
        </div>
      </section>
      ${sitesHTML()}
`;

    const paste = body.querySelector<HTMLTextAreaElement>('#api-paste');
    const note = body.querySelector<HTMLElement>('#api-note');

    body.querySelector('#api-recognize')?.addEventListener('click', () => {
      const text = paste?.value ?? '';
      const drafts = parseSites(text);

      if (drafts.length === 0) {
        if (note) {
          note.className = 'field__note is-bad';
          note.textContent = '没认出地址来。检查一下是不是少了 https:// 开头的网址。';
        }
        return;
      }
      if (note) {
        note.className = 'field__note is-ok';
        note.textContent = `认出 ${drafts.length} 个站点，确认一下再保存。`;
      }
      openImport(drafts);
    });
  }

  function openImport(drafts: SiteDraft[]): void {
    openSiteEditor({
      title: drafts.length > 1 ? `认出 ${drafts.length} 个站点` : '确认站点信息',
      items: drafts.map((draft) => ({ draft })),
      showType: false,
      onSaved: (message) => void refresh(message),
    });
  }

  function render(): void {
    // 换内容前把上一个 Tab 的绑定摘掉：它们捕获的是上一个 Tab 的状态
    unbindAll(body);
    if (tab === 'sites') renderSites();
    else if (tab === 'assign') void mountAssignView(body, () => render());
    else void mountUsageView(body);
  }

  async function refresh(note?: string): Promise<void> {
    [sites, assignments] = await Promise.all([listSites(), listAssignments()]);
    if (tab === 'sites') {
      renderSites();
      if (note) {
        const line = body.querySelector<HTMLElement>('#api-note');
        if (line) {
          line.className = 'field__note is-ok';
          line.textContent = note;
        }
      }
    }
  }

  // 切 Tab：只换内容区，不动整页
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

  // 点站点卡片 → 站点详情页（步骤 4）
  body.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-site]');
    const id = card?.dataset.site;
    if (id) location.hash = `/settings/api/site/${id}`;
  });

  // 手动添加
  root.querySelector('#api-add')?.addEventListener('click', () => {
    openSiteEditor({
      title: '手动添加站点',
      items: [
        {
          draft: {
            name: '',
            url: '',
            keys: [],
            siteType: 'relay',
            protocol: 'openai',
            notes: [],
            uncertain: { name: false, url: false, keys: false },
          },
        },
      ],
      showType: true,
      onSaved: (message) => {
        if (!message) return;
        tab = 'sites';
        for (const item of root.querySelectorAll<HTMLElement>('[data-tab]')) {
          item.setAttribute('aria-selected', String(item.dataset.tab === 'sites'));
        }
        void refresh(message);
      },
    });
  });

  render();
}