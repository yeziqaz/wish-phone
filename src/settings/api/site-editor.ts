import './api.css';
import { esc } from '../../core/dom';
import { deleteSite, getSite, newId, putSite } from '../../core/db';
import type { Site, SiteKey, SiteType } from '../../core/api-types';
import { CAPABILITY_LABEL, DEFAULT_LIMITS } from '../../core/api-types';
import { inferProtocol, inferSiteType, normalizeBaseUrl } from '../../core/api-catalog';
import type { SiteDraft } from '../../core/api-paste';
import { pullModels, testSite } from '../../ai/adapters/openai';

/* ==========================================================================
   站点编辑浮层（设计文档 §5.3 识别结果确认卡 / §5.4 手动添加）

   三处共用同一个组件，只是参数不同：
     · 粘贴导入 → 多张卡，可逐张删除，类型只显示不可改（§5.3 只要三项可编辑）
     · 手动添加 → 一张空卡，可以改类型（§5.4 要求有站点类型）
     · 点已有站点 → 一张填好的卡，底部多「测试连接 / 拉取模型 / 删除」

   ⚠️ 保存前不再二次询问：确认卡本身就是确认步骤。
   ⚠️ 联网只有两个入口：测试连接、拉取模型。识别本身永远离线。
   ========================================================================== */

export interface EditorItem {
  draft: SiteDraft;
  /** 有值 = 改已有站点；没有 = 新建 */
  siteId?: string;
}

export interface EditorOptions {
  title: string;
  items: EditorItem[];
  /** 手动添加时给 true，让用户能选类型 */
  showType: boolean;
  /** 保存 / 删除之后的回调，参数是给用户看的一句话（空串 = 不提示） */
  onSaved: (message: string) => void;
  /** 浮层还开着但库里已经变了（测试连接 / 拉取模型），外面要跟着重画 */
  onChanged?: () => void;
}

/** 把已有站点倒成草稿，好复用到同一个编辑器里 */
export function draftFromSite(site: Site): SiteDraft {
  return {
    name: site.name,
    url: site.url,
    keys: site.keys.map((key) => key.value),
    siteType: site.siteType,
    protocol: site.protocol,
    notes: [],
    uncertain: { name: false, url: false, keys: site.keys.length === 0 },
  };
}

const SITE_TYPES: SiteType[] = ['official', 'relay', 'aggregator'];

const SITE_TYPE_TEXT: Record<SiteType, string> = {
  official: '官方直连',
  relay: '中转站',
  aggregator: '聚合平台',
};

function cardHTML(item: EditorItem, index: number, total: number, showType: boolean): string {
  const hints: string[] = [...item.draft.notes];
  if (item.draft.uncertain.name) hints.push('名称没认出来，已按域名填，可以直接改');

  return `
    <section class="api-card" data-card data-index="${index}">
      ${
        total > 1
          ? `<div class="api-card__head">
               <p class="api-card__index">第 ${index + 1} / ${total} 个</p>
               <button class="api-card__drop" type="button" data-drop>不要这个</button>
             </div>`
          : ''
      }

      <label class="field${item.draft.uncertain.name ? ' is-warn' : ''}">
        <span class="field__label">名称</span>
        <input class="input" type="text" data-field="name" value="${esc(item.draft.name)}" placeholder="比如：我的中转站" />
      </label>

      <label class="field">
        <span class="field__label">地址</span>
        <input class="input" type="url" data-field="url" value="${esc(item.draft.url)}" placeholder="https://…/v1" spellcheck="false" autocapitalize="off" />
      </label>

      <label class="field${item.draft.uncertain.keys ? ' is-warn' : ''}">
        <span class="field__label">Key</span>
        <textarea class="api-import__box" data-field="keys" rows="3" spellcheck="false" autocapitalize="off" placeholder="一行一个，可以填多个">${esc(item.draft.keys.join('\n'))}</textarea>
      </label>

      ${
        showType
          ? `<label class="field">
               <span class="field__label">站点类型</span>
               <select class="input" data-field="type">
                 ${SITE_TYPES.map(
                   (type) =>
                     `<option value="${type}"${item.draft.siteType === type ? ' selected' : ''}>${SITE_TYPE_TEXT[type]}</option>`,
                 ).join('')}
               </select>
             </label>`
          : `<ul class="api-card__notes"><li>类型：${SITE_TYPE_TEXT[item.draft.siteType]}（点开站点就能改）</li></ul>`
      }

      ${hints.length > 0 ? `<ul class="api-card__notes">${hints.map((hint) => `<li>${esc(hint)}</li>`).join('')}</ul>` : ''}

      ${
        item.siteId
          ? `<div class="api-card__actions">
               <button class="btn btn--sm" type="button" data-test>查询模型接口</button>
               <button class="btn btn--sm" type="button" data-pull>拉取模型</button>
             </div>
             <p class="field__note" data-card-note></p>
             <div class="api-card__head">
               <p class="api-card__index">已存 ${item.draft.protocol === 'openai' ? 'OpenAI 兼容' : item.draft.protocol}</p>
               <button class="api-card__drop" type="button" data-delete>删除站点</button>
             </div>`
          : ''
      }
    </section>`;
}

interface CardInput {
  name: string;
  url: string;
  keys: string[];
  type: SiteType | '';
}

/** 读一张卡里的值。type 为空串表示这张卡上没给类型选择器（粘贴导入时） */
function readCard(card: HTMLElement): CardInput {
  const value = (field: string): string => {
    const el = card.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-field="${field}"]`,
    );
    return el?.value.trim() ?? '';
  };

  const raw = value('type') as SiteType;
  return {
    name: value('name'),
    url: value('url'),
    keys: value('keys')
      .split(/\r?\n/)
      .map((key) => key.trim())
      .filter(Boolean),
    type: SITE_TYPES.includes(raw) ? raw : '',
  };
}

function keysOf(values: string[], previous: SiteKey[]): SiteKey[] {
  return values.map((value) => {
    const old = previous.find((key) => key.value === value);
    return old ?? { id: newId(), value, label: '', enabled: true, abnormal: false };
  });
}

/** 把一张卡变成完整的 Site；地址为空返回 null */
async function siteFromCard(card: HTMLElement, item: EditorItem): Promise<Site | null> {
  const input = readCard(card);
  if (!input.url) return null;

  const previous = item.siteId ? await getSite(item.siteId) : undefined;
  // 用户可能只填了裸域名，落库前统一规范化一次
  const protocol = previous?.protocol ?? inferProtocol(input.url);
  const { url } = normalizeBaseUrl(input.url, protocol);
  const now = Date.now();

  return {
    id: previous?.id ?? newId(),
    name: input.name || url.replace(/^https?:\/\//i, '').split('/')[0] || '未命名站点',
    // 类型优先用用户选的；粘贴导入没有选择器，就沿用识别出来的那个
    siteType: input.type || previous?.siteType || item.draft.siteType || inferSiteType(url),
    protocol,
    url,
    keys: keysOf(input.keys, previous?.keys ?? []),
    keyMode: previous?.keyMode ?? 'roundrobin',
    fixedKeyId: previous?.fixedKeyId ?? '',
    limits: previous?.limits ?? { ...DEFAULT_LIMITS },
    models: previous?.models ?? [],
    links: previous?.links ?? [],
    note: previous?.note ?? '',
    balance: previous?.balance ?? null,
    lastTest: previous?.lastTest ?? null,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

function noteOf(card: HTMLElement, text: string, ok: boolean): void {  const note = card.querySelector<HTMLElement>('[data-card-note]');
  if (!note) return;
  note.className = `field__note ${ok ? 'is-ok' : 'is-bad'}`;
  note.textContent = text;
}

export function openSiteEditor(options: EditorOptions): void {
  const { title, items, showType, onSaved, onChanged } = options;
  const overlay = document.createElement('div');
  overlay.className = 'api-editor';
  overlay.innerHTML = `
    <header class="api-editor__head">
      <h2 class="api-editor__title">${esc(title)}</h2>
      <button class="api-editor__close" type="button" data-close>取消</button>
    </header>
    <div class="api-editor__list" data-list>
      ${items.map((item, index) => cardHTML(item, index, items.length, showType)).join('')}
    </div>
    <footer class="api-editor__foot">
      <button class="btn btn--ghost jelly" type="button" data-save-pull>保存并拉取模型</button>
      <button class="btn btn--primary jelly" type="button" data-save>${
        items.length === 1 && !items[0]?.siteId ? '保存' : '全部保存'
      }</button>
      <p class="field__note" data-foot-note></p>
    </footer>`;

  const listEl = overlay.querySelector<HTMLElement>('[data-list]');
  if (!listEl) return;

  const close = (): void => overlay.remove();

  const cards = (): HTMLElement[] => [...overlay.querySelectorAll<HTMLElement>('[data-card]')];

  /**
   * 存下所有卡。返回存好的站点、以及有几张缺地址。
   * 缺地址时那一张不写库，让用户补完再存 —— 不许静默丢数据。
   */
  async function saveAll(): Promise<{ saved: Site[]; missing: number }> {
    const saved: Site[] = [];
    let missing = 0;

    for (const card of cards()) {
      const item = items[Number(card.dataset.index ?? '-1')];
      if (!item) continue;

      const site = await siteFromCard(card, item);
      if (!site) {
        missing += 1;
        card
          .querySelector<HTMLElement>('[data-field="url"]')
          ?.closest('.field')
          ?.classList.add('is-warn');
        if (missing === 1) card.querySelector<HTMLInputElement>('[data-field="url"]')?.focus();
        continue;
      }
      await putSite(site);
      saved.push(site);
    }

    if (missing > 0) {
      const note = overlay.querySelector<HTMLElement>('[data-foot-note]');
      if (note) {
        note.className = 'field__note is-bad';
        note.textContent = `还有 ${missing} 个站点没填地址，填好再保存`;
      }
    }
    return { saved, missing };
  }

  /** 按钮忙起来：宽度不变，只换文字（见 mobile-ui-craft §7） */
  async function withBusy(button: HTMLButtonElement, label: string, run: () => Promise<void>): Promise<void> {
    const original = button.textContent ?? '';
    button.disabled = true;
    button.textContent = label;
    try {
      await run();
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  overlay.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('[data-close]')) {
      close();
      return;
    }

    const drop = target.closest<HTMLElement>('[data-drop]');
    if (drop) {
      drop.closest<HTMLElement>('[data-card]')?.remove();
      return;
    }

    const remove = target.closest<HTMLElement>('[data-delete]');
    if (remove) {
      const card = remove.closest<HTMLElement>('[data-card]');
      const item = items[Number(card?.dataset.index ?? '-1')];
      if (!item?.siteId) return;
      void deleteSite(item.siteId).then(() => {
        close();
        onSaved('');
      });
      return;
    }

    const testButton = target.closest<HTMLButtonElement>('[data-test]');
    if (testButton) {
      const card = testButton.closest<HTMLElement>('[data-card]');
      const item = items[Number(card?.dataset.index ?? '-1')];
      if (!card || !item) return;
      void withBusy(testButton, '正在测试…', async () => {
        const site = await siteFromCard(card, item);
        if (!site) {
          noteOf(card, '先填地址再测试', false);
          return;
        }
        const result = await testSite(site);
        // 状态灯读的是库里的 lastTest，所以测完要落库
        const stored = item.siteId ? await getSite(item.siteId) : undefined;
        if (stored) {
          stored.lastTest = result;
          stored.updatedAt = Date.now();
          await putSite(stored);
        }
        noteOf(card, result.message, result.ok);
        onChanged?.();
      });
      return;
    }

    const pullButton = target.closest<HTMLButtonElement>('[data-pull]');
    if (pullButton) {
      const card = pullButton.closest<HTMLElement>('[data-card]');
      const item = items[Number(card?.dataset.index ?? '-1')];
      if (!card || !item) return;
      void withBusy(pullButton, '正在拉取…', async () => {
        const site = await siteFromCard(card, item);
        if (!site) {
          noteOf(card, '先填地址再拉取', false);
          return;
        }
        // 先把卡上的改动落库再拉：否则「拉到的模型」和「库里的地址」可能对不上
        await putSite(site);
        const result = await pullModels(site);
        if (!result.ok) {
          noteOf(card, result.message, false);
          onChanged?.();
          return;
        }
        site.models = result.models;
        await putSite(site);
        noteOf(card, result.message, true);
        onChanged?.();
      });
    }
  });

  overlay.querySelector('[data-save]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void withBusy(button, '正在保存…', async () => {
      if (cards().length === 0) {
        close();
        onSaved('');
        return;
      }
      const { saved, missing } = await saveAll();
      if (missing > 0) return;
      close();
      onSaved(saved.length > 0 ? `已保存 ${saved.length} 个站点` : '');
    });
  });

  overlay.querySelector('[data-save-pull]')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void withBusy(button, '正在保存…', async () => {
      const { saved, missing } = await saveAll();
      if (missing > 0 || saved.length === 0) return;

      button.textContent = '正在拉取…';
      let pulled = 0;
      const failures: string[] = [];
      for (const site of saved) {
        const result = await pullModels(site);
        if (!result.ok) {
          failures.push(`${site.name}：${result.message}`);
          continue;
        }
        site.models = result.models;
        await putSite(site);
        pulled += result.models.length;
      }

      close();
      onSaved(
        failures.length > 0
          ? `已保存 ${saved.length} 个站点，其中 ${failures.length} 个拉取失败。${failures.join('；')}`
          : `已保存 ${saved.length} 个站点，拉到 ${pulled} 个模型名；尚未验证实际调用。`,
      );
    });
  });

  document.body.append(overlay);
}

/** 站点卡片上那行「文本 · 看图」——只统计启用中的模型 */
export function kindsText(site: Site): string {
  const kinds = new Set<string>();
  for (const model of site.models) {
    if (!model.enabled) continue;
    for (const kind of model.kinds) kinds.add(CAPABILITY_LABEL[kind]);
  }
  return [...kinds].join(' · ');
}
