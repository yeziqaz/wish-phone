import { deleteProviderRecord, getProvider, newId, putProvider } from '../../core/db';
import type { ApiProtocol, Provider, ProviderModel } from '../../core/types';
import { esc, find, must, setText } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { openSheet } from '../../ui/sheet';
import { listModels, normalizeBaseUrl, testConnection } from '../../ai/client';
import { ApiError } from '../../ai/errors';
import {
  ALL_PROTOCOLS,
  PROTOCOL_LABEL,
  PROTOCOL_READY,
  blankProvider,
  fromParsed,
  takePendingParse,
} from './shared';
import './providers.css';

/* ==========================================================================
   服务商详情

   结构照 AGENTS.md §3.7：折叠卡片，**高频在前、低频在后**。
   第一次添加的人只需要填「基础配置」里的前四项就够用，
   下面的模型 / 生成设置 / 删除，是给愿意细调的人准备的。
   ========================================================================== */

/** 把错误翻译成人话 */
function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.info.title} —— ${error.info.detail}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * 取一个当前能用的 Key。
 * 关着多 Key 模式时只有第一个 Key 算数；开着才去找启用中的那一个。
 * （真正按 Key 轮换/分组的调度在后面的批次接上，这里先保证「测试连接」「拉取」用的是对的。）
 */
function firstKey(provider: Provider): string {
  if (!provider.multiKey) return provider.keys[0]?.value ?? '';
  return (
    provider.keys.find((k) => k.enabled && k.value)?.value ?? provider.keys[0]?.value ?? ''
  );
}

function modelName(model: ProviderModel): string {
  const name = model.displayName.trim();
  return name && name !== model.id ? name : model.id || '未填写模型 ID';
}

function modelMeta(model: ProviderModel): string {
  const parts: string[] = [];
  if (model.displayName.trim() && model.displayName !== model.id) parts.push(model.id);
  if (model.contextLength) parts.push(`${Math.round(model.contextLength / 1000)}K`);
  if (!model.enabled) parts.push('已停用');
  return parts.join(' · ');
}

/**
 * 模型属于哪个系列，用来把长列表分组。
 * 认不出来就取名字的第一段，保证任何模型都有组可归。
 */
function modelSeries(id: string): string {
  const s = id.toLowerCase();
  if (!s) return '未命名';

  if (s.includes('claude')) {
    if (s.includes('opus')) return 'Claude Opus';
    if (s.includes('sonnet')) return 'Claude Sonnet';
    if (s.includes('haiku')) return 'Claude Haiku';
    return 'Claude 其他';
  }
  if (s.includes('gemini')) return 'Gemini';
  if (s.includes('deepseek')) return 'DeepSeek';
  if (s.includes('qwen') || s.includes('qwq') || s.includes('tongyi')) return 'Qwen';
  if (s.includes('glm') || s.includes('chatglm')) return 'GLM';
  if (s.includes('kimi') || s.includes('moonshot')) return 'Kimi';
  if (s.includes('grok')) return 'Grok';
  if (s.includes('llama')) return 'Llama';
  if (s.includes('mistral') || s.includes('mixtral')) return 'Mistral';
  if (s.includes('doubao') || s.includes('seed')) return '豆包';
  if (s.includes('ernie')) return '文心';
  if (s.includes('gpt') || /^o[1-4](-|$)/.test(s)) {
    const major = s.match(/^(gpt-[0-9.]+[a-z]?)/);
    return major?.[1] ? `GPT-${major[1].slice(4)}` : 'GPT 其他';
  }

  const first = id.split(/[-_./:]/)[0];
  return first || '其他';
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export async function mountProviderEdit(root: HTMLElement, id: string): Promise<void> {
  let provider: Provider;

  if (id === 'new') {
    const parsed = takePendingParse();
    provider = parsed ? fromParsed(parsed) : blankProvider();
  } else {
    const existing = await getProvider(id);
    if (!existing) {
      root.innerHTML = `
        <div class="page">
          <header class="topbar">
            <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
            <h1 class="topbar__title">找不到</h1>
          </header>
          <p class="field__note">这个服务商已经不在了，可能刚被删掉。</p>
        </div>`;
      return;
    }
    provider = existing;
  }

  // 新建 = 快速设置（只有基础配置）；点进已有的才是完整详情页
  const quick = id === 'new';
  render(root, provider, quick);
  bind(root, provider, quick);
}

/* ============================ 渲染 ============================ */

function render(root: HTMLElement, p: Provider, quick: boolean): void {
  root.innerHTML = `
    <div class="page">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
        <span id="edit-avatar">${avatarHTML(p.name, 34)}</span>
        <h1 class="topbar__title" id="edit-title">${esc(p.name)}</h1>
      </header>

      ${quick ? '<p class="field__note field__note--top">先填基础信息，点「完成」保存。模型、生成参数等更细的设置，保存后点进这个服务商再调。</p>' : ''}

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          基础配置<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <label class="field field--row">
            <span class="field__label">服务商名称</span>
            <input class="input" id="p-name" type="text" autocomplete="off"
                   spellcheck="false" value="${esc(p.name)}" placeholder="只给自己看">
          </label>

          <label class="field field--row">
            <span class="field__label">API 协议</span>
            <select class="input" id="p-protocol">
              ${ALL_PROTOCOLS.map((proto) => {
                const ready = PROTOCOL_READY[proto];
                return `<option value="${proto}"${proto === p.protocol ? ' selected' : ''}>${
                  PROTOCOL_LABEL[proto]
                }${ready ? '' : '（还没做）'}</option>`;
              }).join('')}
            </select>
          </label>
          <p class="field__note" id="protocol-note"></p>

          <label class="field field--row">
            <span class="field__label">Base URL</span>
            <input class="input" id="p-url" type="text" inputmode="url" autocomplete="off"
                   spellcheck="false" value="${esc(p.baseUrl)}"
                   placeholder="https://api.example.com/v1">
          </label>

          <div class="field">
            <span class="field__label field__label--row">
              API Key
              <span class="field__tools">
                <button class="mini jelly" type="button" id="p-eye">显示</button>
                <button class="mini jelly" type="button" id="p-addkey"${p.multiKey ? '' : ' hidden'}>+ 添加</button>
              </span>
            </span>
            <div id="p-keys"></div>
          </div>

          <label class="field field--row field--switch">
            <span class="field__label">多 Key 模式</span>
            <span class="switch">
              <input type="checkbox" id="p-multikey" ${p.multiKey ? 'checked' : ''}>
              <span class="switch__track"></span>
            </span>
          </label>

          <div class="field field--row" id="p-keymode-row"${p.multiKey ? '' : ' hidden'}>
            <span class="field__label">Key 用法</span>
            <div class="segmented" role="radiogroup" aria-label="Key 用法">
              <button type="button" role="radio" data-keymode="rotate"
                      aria-checked="${p.keyMode === 'rotate'}">轮询</button>
              <button type="button" role="radio" data-keymode="group"
                      aria-checked="${p.keyMode === 'group'}">分组</button>
            </div>
          </div>
          <p class="field__note" id="p-keymode-note"${p.multiKey ? '' : ' hidden'}></p>

          <label class="field field--row">
            <span class="field__label">API 路径</span>
            <input class="input" id="p-path" type="text" autocomplete="off" spellcheck="false"
                   value="${esc(p.apiPath)}" placeholder="/chat/completions">
          </label>

          ${quick ? '' : `
          <div class="row-actions">
            <button class="btn jelly" type="button" id="p-test">测试连接</button>
          </div>
          <p class="field__note" id="p-test-result"></p>`}
        </div>
      </section>

      ${quick ? '' : `
      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          模型<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <div class="field field--row" id="p-fetch-key-row" hidden>
            <span class="field__label">给哪个 Key</span>
            <select class="input" id="p-fetch-key"></select>
          </div>
          <div class="model-tools">
            <button class="mini jelly" type="button" id="p-fetch">拉取</button>
            <button class="mini jelly" type="button" id="p-addmodel">+ 手动</button>
            <input class="input model-tools__search" id="p-model-search" type="search"
                   autocomplete="off" spellcheck="false" placeholder="搜索模型">
          </div>
          <p class="field__note" id="p-model-note"></p>
          <div class="model-list" id="p-models"></div>
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          生成设置<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <label class="field">
            <span class="field__label">随机度 temperature</span>
            <div class="slider-row">
              <input class="slider" id="p-temp" type="range" min="0" max="2" step="0.1"
                     value="${p.generation.temperature}">
              <span class="slider__value" id="p-temp-value">${p.generation.temperature.toFixed(1)}</span>
            </div>
            <span class="field__hint">0 = 刻板精确，2 = 天马行空。一般 0.7~1.0。</span>
          </label>

          <label class="field field--row">
            <span class="field__label">最大输出长度</span>
            <input class="input" id="p-maxtokens" type="text" inputmode="numeric"
                   autocomplete="off" value="${p.generation.maxTokens ?? ''}" placeholder="留空用默认">
          </label>

          <label class="field field--row">
            <span class="field__label">Top P</span>
            <input class="input" id="p-topp" type="text" inputmode="decimal"
                   autocomplete="off" value="${p.generation.topP ?? ''}" placeholder="留空用默认">
          </label>
        </div>
      </section>`}

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="p-save">${quick ? '完成' : '保存'}</button>
      </div>
      <p class="field__note" id="p-save-result"></p>

      ${quick ? '' : `
      <section class="fold fold--danger">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          删除这个服务商<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <p class="field__note">只删掉这份接口配置，<strong>不会动你的角色和聊天记录</strong>。</p>
          <button class="btn btn--danger jelly" type="button" id="p-delete">确认删除</button>
        </div>
      </section>`}
    </div>`;
}

/* ============================ 绑定 ============================ */

function bind(root: HTMLElement, provider: Provider, quick: boolean): void {
  const nameInput = must<HTMLInputElement>(root, '#p-name');
  const title = must<HTMLElement>(root, '#edit-title');
  const avatarSlot = must<HTMLElement>(root, '#edit-avatar');
  const protocol = must<HTMLSelectElement>(root, '#p-protocol');
  const protocolNote = must<HTMLElement>(root, '#protocol-note');

  // 名称 → 顶上标题和头像实时同步
  nameInput.addEventListener('input', () => {
    const value = nameInput.value.trim() || '未命名';
    title.textContent = value;
    avatarSlot.innerHTML = avatarHTML(value, 34);
  });

  // 折叠卡片
  root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
    head.addEventListener('click', () => {
      const expanded = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!expanded));
      const body = head.nextElementSibling;
      if (body instanceof HTMLElement) body.hidden = expanded;
    });
  });

  // 协议提示：没做的协议要当场说清楚，别让用户填完才发现不通
  const syncProtocolNote = (): void => {
    const value = protocol.value as ApiProtocol;
    protocolNote.textContent = PROTOCOL_READY[value]
      ? ''
      : '这个协议的原生格式还在做，现在填了也连不通。可以先用「OpenAI 兼容」。';
  };
  protocol.addEventListener('change', syncProtocolNote);
  syncProtocolNote();

  /* ---------- Key 列表 ---------- */

  let showPlain = false;

  /** Key 的显示名：优先备注，没有就用序号 */
  const keyNameOf = (keyId?: string): string => {
    const index = provider.keys.findIndex((k) => k.id === keyId);
    const key = index < 0 ? undefined : provider.keys[index];
    if (!key) return '';
    return key.label.trim() || `Key ${index + 1}`;
  };

  /** 是不是「每个 Key 管自己的模型」那种用法 */
  const groupMode = (): boolean => provider.multiKey && provider.keyMode === 'group';

  /** 分组模式下要选「这次给哪个 Key 拉取」 */
  const fetchKeyRow = find<HTMLElement>(root, '#p-fetch-key-row');
  const fetchKeySelect = find<HTMLSelectElement>(root, '#p-fetch-key');

  const syncFetchKey = (): void => {
    if (!fetchKeyRow || !fetchKeySelect) return;
    const show = groupMode();
    fetchKeyRow.hidden = !show;
    if (!show) return;
    const current = fetchKeySelect.value;
    fetchKeySelect.innerHTML = provider.keys
      .map(
        (key) =>
          `<option value="${esc(key.id)}">${esc(keyNameOf(key.id))}${
            key.enabled ? '' : '（已停用）'
          }</option>`,
      )
      .join('');
    if (provider.keys.some((key) => key.id === current)) fetchKeySelect.value = current;
  };

  const blankKey = (): Provider['keys'][number] => ({
    id: newId(),
    value: '',
    label: '',
    enabled: true,
    weight: 1,
    callCount: 0,
    failCount: 0,
  });

  // 单 Key 模式只显示第一个；其余 Key 保留在数据里，重新打开多 Key 时还在
  const renderKeys = (): void => {
    const box = must<HTMLElement>(root, '#p-keys');
    // 始终留一个空位可填；要第二个再点「+ 添加」
    if (provider.keys.length === 0) provider.keys.push(blankKey());
    const shown = provider.multiKey ? provider.keys : provider.keys.slice(0, 1);
    box.innerHTML = shown
      .map(
        (key, index) => `
        <div class="key-row${provider.multiKey ? ' key-row--multi' : ''}" data-index="${index}">
          ${
            provider.multiKey
              ? `<input type="checkbox" data-key-toggle ${key.enabled ? 'checked' : ''}
                        aria-label="启用这个 Key">
                 <input class="input key-row__label" type="text" autocomplete="off"
                        spellcheck="false" data-key-label value="${esc(key.label)}"
                        placeholder="备注，如 大号">`
              : ''
          }
          <input class="input key-row__value" type="${showPlain ? 'text' : 'password'}"
                 autocomplete="off" spellcheck="false"
                 data-key-input value="${esc(key.value)}" placeholder="sk-…">
          ${
            provider.multiKey && provider.keys.length > 1
              ? `<button class="mini jelly" type="button" data-key-remove="${index}"
                  aria-label="删除这个 Key">${line('trash', 18)}</button>`
              : ''
          }
        </div>`,
      )
      .join('');
  };

  renderKeys();

  // ⚠️ 输入时只更新数据，**绝不重建 DOM** —— 重建会让输入框失焦（宪法 §7.6）
  must(root, '#p-keys').addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const index = Number(target.closest<HTMLElement>('.key-row')?.dataset.index ?? '-1');
    const key = provider.keys[index];
    if (!key) return;
    if (target.matches('[data-key-input]')) key.value = target.value;
    else if (target.matches('[data-key-label]')) {
      key.label = target.value;
      syncFetchKey();
    }
  });

  must(root, '#p-keys').addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (!target.matches('[data-key-toggle]')) return;
    const index = Number(target.closest<HTMLElement>('.key-row')?.dataset.index ?? '-1');
    const key = provider.keys[index];
    if (!key) return;
    key.enabled = target.checked;
    syncFetchKey();
  });

  /* ---------- 多 Key 开关 + 用法 ---------- */

  const addKeyBtn = must<HTMLButtonElement>(root, '#p-addkey');
  const modeRow = must<HTMLElement>(root, '#p-keymode-row');
  const modeNote = must<HTMLElement>(root, '#p-keymode-note');

  const syncKeyMode = (): void => {
    addKeyBtn.hidden = !provider.multiKey;
    modeRow.hidden = !provider.multiKey;
    modeNote.hidden = !provider.multiKey;
    root.querySelectorAll<HTMLElement>('[data-keymode]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.dataset.keymode === provider.keyMode));
    });
    modeNote.textContent =
      provider.keyMode === 'rotate'
        ? '轮询：同一个站的几个号轮流用，模型大家共用。'
        : '分组：每个 Key 管自己的模型，适合站子按模型系列发 Key。';
    syncFetchKey();
  };
  syncKeyMode();

  must<HTMLInputElement>(root, '#p-multikey').addEventListener('change', (e) => {
    provider.multiKey = (e.target as HTMLInputElement).checked;
    syncKeyMode();
    renderKeys();
  });

  modeRow.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-keymode]');
    const mode = btn?.dataset.keymode;
    if (mode !== 'rotate' && mode !== 'group') return;
    provider.keyMode = mode;
    syncKeyMode();
  });

  must(root, '#p-keys').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-key-remove]');
    if (!button) return;
    const index = Number(button.dataset.keyRemove ?? '-1');
    if (index >= 0) {
      provider.keys.splice(index, 1);
      renderKeys();
      syncFetchKey();
    }
  });

  must(root, '#p-addkey').addEventListener('click', () => {
    provider.keys.push(blankKey());
    renderKeys();
    syncFetchKey();
    const inputs = root.querySelectorAll<HTMLInputElement>('[data-key-input]');
    inputs[inputs.length - 1]?.focus();
  });

  must(root, '#p-eye').addEventListener('click', () => {
    showPlain = !showPlain;
    must(root, '#p-eye').textContent = showPlain ? '隐藏' : '显示';
    renderKeys();
  });

  /* ---------- 模型列表 ---------- */

  // 默认每个模型只占一行；点名字才展开编辑框
  const openModels = new Set<number>();
  // 折起来的模型组（默认全展开，点组头才合拢）
  const closedGroups = new Set<string>();
  let query = '';
  const matches = (model: ProviderModel): boolean =>
    !query ||
    model.id.toLowerCase().includes(query) ||
    model.displayName.toLowerCase().includes(query);

  /** 一个模型一行：勾选 · 名字/副信息 · 删除；点名字展开编辑框 */
  const modelRowHTML = (model: ProviderModel, index: number): string => `
    <div class="model-row" data-index="${index}">
      <input type="checkbox" data-model-toggle="${index}"
             ${model.enabled ? 'checked' : ''} aria-label="启用">
      <button class="model-row__main" type="button" data-model-edit="${index}">
        <span class="model-row__name">${esc(modelName(model))}</span>
        <span class="model-row__meta">${esc(modelMeta(model))}</span>
      </button>
      <button class="model-row__del" type="button" data-model-remove="${index}"
              aria-label="删除这个模型">${line('trash', 16)}</button>
      <div class="model-row__edit"${openModels.has(index) ? '' : ' hidden'}>
        <input class="input" type="text" autocomplete="off"
               spellcheck="false" data-model-field="id" data-index="${index}"
               value="${esc(model.id)}" placeholder="模型 ID（发请求用）">
        <div class="model-row__sub">
          <input class="input" type="text" autocomplete="off" spellcheck="false"
                 data-model-field="displayName" data-index="${index}"
                 value="${esc(model.displayName === model.id ? '' : model.displayName)}"
                 placeholder="显示名称（可不填）">
          <input class="input model-row__ctx" type="text" inputmode="numeric"
                 autocomplete="off" data-model-field="contextLength" data-index="${index}"
                 value="${model.contextLength ?? ''}" placeholder="上下文">
        </div>
      </div>
    </div>`;

  const renderModels = (): void => {
    const box = find<HTMLElement>(root, '#p-models');
    if (!box) return;
    if (provider.models.length === 0) {
      box.innerHTML =
        '<p class="field__note">还没有模型。点上面的「拉取」自动获取，或「+ 手动」添加。</p>';
      return;
    }

    // 分组模式按 Key 归堆；否则按系列归堆
    const groups = new Map<string, { index: number; model: ProviderModel }[]>();
    provider.models.forEach((model, index) => {
      const name = groupMode() ? keyNameOf(model.keyId) || '未分配 Key' : modelSeries(model.id);
      const list = groups.get(name);
      if (list) list.push({ index, model });
      else groups.set(name, [{ index, model }]);
    });

    // 按 Key 分组时组的顺序跟着 Key 走，不随模型顺序乱跳
    let entries = [...groups.entries()];
    if (groupMode()) {
      const order = [...provider.keys.map((key) => keyNameOf(key.id)), '未分配 Key'];
      entries = entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    }

    box.innerHTML = entries
      .map(
        ([name, items]) => `
      <section class="model-group" data-group-name="${esc(name)}">
        <button class="model-group__head" type="button" data-group-toggle
                aria-expanded="${closedGroups.has(name) ? 'false' : 'true'}">
          <span class="model-group__name">${esc(name)}</span>
          <span class="model-group__count">${items.length}</span>
          <span class="model-group__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="model-group__body"${closedGroups.has(name) ? ' hidden' : ''}>
          ${items.map(({ index, model }) => modelRowHTML(model, index)).join('')}
        </div>
      </section>`,
      )
      .join('');
  };

  renderModels();

  find(root, '#p-models')?.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-model-field]');
    if (!input) return;
    const model = provider.models[Number(input.dataset.index ?? '-1')];
    if (!model) return;
    const field = input.dataset.modelField;
    if (field === 'id') model.id = input.value;
    else if (field === 'displayName') model.displayName = input.value;
    else if (field === 'contextLength') {
      const n = Number(input.value.trim());
      model.contextLength = input.value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    // 只改这一行的文字，不重建输入框
    const row = input.closest<HTMLElement>('.model-row');
    if (row) {
      setText(row.querySelector('.model-row__name'), modelName(model));
      setText(row.querySelector('.model-row__meta'), modelMeta(model));
    }
  });

  find(root, '#p-models')?.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('[data-model-toggle]');
    if (!box) return;
    const index = Number(box.dataset.modelToggle ?? '-1');
    const model = provider.models[index];
    if (!model) return;
    model.enabled = box.checked;
    setText(box.closest('.model-row')?.querySelector('.model-row__meta') ?? null, modelMeta(model));
  });

  find(root, '#p-models')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // 组头：合拢 / 展开
    const groupHead = target.closest<HTMLElement>('[data-group-toggle]');
    if (groupHead) {
      const section = groupHead.closest<HTMLElement>('.model-group');
      const name = section?.dataset.groupName ?? '';
      const body = section?.querySelector<HTMLElement>('.model-group__body');
      if (!body) return;
      const willClose = !body.hidden;
      body.hidden = willClose;
      groupHead.setAttribute('aria-expanded', String(!willClose));
      if (willClose) closedGroups.add(name);
      else closedGroups.delete(name);
      return;
    }

    const edit = target.closest<HTMLElement>('[data-model-edit]');
    if (edit) {
      const index = Number(edit.dataset.modelEdit ?? '-1');
      const panel = edit.parentElement?.querySelector<HTMLElement>('.model-row__edit');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (panel.hidden) openModels.delete(index);
      else openModels.add(index);
      return;
    }
    const button = target.closest<HTMLElement>('[data-model-remove]');
    if (!button) return;
    const index = Number(button.dataset.modelRemove ?? '-1');
    if (index >= 0) {
      provider.models.splice(index, 1);
      // 序号变了，展开状态作废
      openModels.clear();
      renderModels();
    }
  });

  find<HTMLInputElement>(root, '#p-model-search')?.addEventListener('input', (e) => {
    query = (e.target as HTMLInputElement).value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>('.model-row').forEach((row) => {
      const model = provider.models[Number(row.dataset.index ?? '-1')];
      row.hidden = model ? !matches(model) : true;
    });
    // 搜索时组一律展开；整组都不匹配就把这组收起来
    root.querySelectorAll<HTMLElement>('.model-group').forEach((section) => {
      const rows = [...section.querySelectorAll<HTMLElement>('.model-row')];
      const shown = rows.filter((row) => !row.hidden).length;
      section.hidden = shown === 0;
      const body = section.querySelector<HTMLElement>('.model-group__body');
      const head = section.querySelector<HTMLElement>('[data-group-toggle]');
      if (query) {
        if (body) body.hidden = false;
        head?.setAttribute('aria-expanded', 'true');
      } else if (body) {
        const name = section.dataset.groupName ?? '';
        body.hidden = closedGroups.has(name);
        head?.setAttribute('aria-expanded', String(!closedGroups.has(name)));
      }
    });
  });

  find(root, '#p-addmodel')?.addEventListener('click', () => {
    const manualKey = groupMode() ? fetchKeySelect?.value : undefined;
    provider.models.push({
      id: '',
      displayName: '',
      contextLength: null,
      enabled: true,
      source: 'manual',
      ...(manualKey ? { keyId: manualKey } : {}),
    });
    openModels.add(provider.models.length - 1);
    renderModels();
    // 加了就把光标送到新那行的输入框
    const inputs = root.querySelectorAll<HTMLInputElement>('[data-model-field="id"]');
    inputs[inputs.length - 1]?.focus();
  });

  find(root, '#p-fetch')?.addEventListener('click', () => {
    void (async () => {
      const note = must<HTMLElement>(root, '#p-model-note');
      const baseUrl = normalizeBaseUrl(must<HTMLInputElement>(root, '#p-url').value);
      if (!baseUrl) {
        note.textContent = '先把 Base URL 填上。';
        note.className = 'field__note is-bad';
        return;
      }

      note.textContent = '正在拉取…';
      note.className = 'field__note';

      // 分组模式：这次拉的模型归选中的那个 Key
      const targetKey = groupMode() ? fetchKeySelect?.value : undefined;
      const targetKeyValue = targetKey
        ? (provider.keys.find((k) => k.id === targetKey)?.value ?? firstKey(provider))
        : firstKey(provider);

      if (groupMode() && !targetKey) {
        note.textContent = '先添加一个 Key，再拉模型。';
        note.className = 'field__note is-bad';
        return;
      }

      try {
        const list = await listModels({
          baseUrl,
          apiKey: targetKeyValue,
          model: '',
          temperature: 0,
        });

        const known = new Set(provider.models.map((m) => m.id));
        note.textContent = `拉到 ${list.length} 个，挑要用的：`;
        note.className = 'field__note';

        // 先让用户在抽屉里挑，勾中的才进列表
        const picked = await openSheet({
          title: targetKey ? `选择模型 · ${keyNameOf(targetKey)}` : '选择模型',
          items: list.map((item) => ({
            id: item.id,
            label: item.id,
            meta: item.contextLength ? `${Math.round(item.contextLength / 1000)}K` : '',
            taken: known.has(item.id),
          })),
          groupOf: (item) => modelSeries(item.id),
          emptyText: '接口没返回任何模型',
          confirmLabel: (count) => (count === 0 ? '添加' : `添加 ${count} 个`),
        });

        if (!picked) {
          note.textContent = `拉到 ${list.length} 个，这次没选。`;
          note.className = 'field__note';
          return;
        }

        const lengthOf = new Map(list.map((item) => [item.id, item.contextLength ?? null]));
        for (const item of picked) {
          provider.models.push({
            id: item.id,
            displayName: item.id,
            contextLength: lengthOf.get(item.id) ?? null,
            enabled: true,
            source: 'fetched',
            ...(targetKey ? { keyId: targetKey } : {}),
          });
        }
        openModels.clear();
        renderModels();
        note.textContent = `已添加 ${picked.length} 个模型。`;
        note.className = 'field__note is-ok';
      } catch (error) {
        note.textContent = describe(error);
        note.className = 'field__note is-bad';
      }
    })();
  });

  /* ---------- 生成设置 ---------- */

  const temp = find<HTMLInputElement>(root, '#p-temp');
  temp?.addEventListener('input', () => {
    must(root, '#p-temp-value').textContent = Number(temp.value).toFixed(1);
  });

  /* ---------- 测试连接 ---------- */

  find(root, '#p-test')?.addEventListener('click', () => {
    void (async () => {
      const result = must<HTMLElement>(root, '#p-test-result');
      const baseUrl = normalizeBaseUrl(must<HTMLInputElement>(root, '#p-url').value);
      if (!baseUrl) {
        result.textContent = '先把 Base URL 填上。';
        result.className = 'field__note is-bad';
        return;
      }

      result.textContent = '测试中…';
      result.className = 'field__note';

      try {
        const outcome = await testConnection({
          baseUrl,
          apiKey: firstKey(provider),
          model: provider.models[0]?.id ?? '',
          temperature: 0,
        });
        result.textContent = `连接正常 ✓ · 可用模型 ${outcome.models.length} 个`;
        result.className = 'field__note is-ok';
      } catch (error) {
        result.textContent = describe(error);
        result.className = 'field__note is-bad';
      }
    })();
  });

  /* ---------- 保存 ---------- */

  must(root, '#p-save').addEventListener('click', () => {
    void (async () => {
      const result = must<HTMLElement>(root, '#p-save-result');

      provider.name = nameInput.value.trim() || '未命名';
      provider.protocol = protocol.value as ApiProtocol;
      provider.baseUrl = normalizeBaseUrl(must<HTMLInputElement>(root, '#p-url').value);
      provider.apiPath =
        must<HTMLInputElement>(root, '#p-path').value.trim() || '/chat/completions';
      // 快速设置页没有生成参数这一块，保留原值
      if (temp) provider.generation.temperature = Number(temp.value);
      const maxTokens = find<HTMLInputElement>(root, '#p-maxtokens');
      if (maxTokens) provider.generation.maxTokens = numberOrNull(maxTokens.value);
      const topP = find<HTMLInputElement>(root, '#p-topp');
      if (topP) provider.generation.topP = numberOrNull(topP.value);
      provider.updatedAt = Date.now();

      // 关掉多 Key 模式就只留第一个 —— 界面上本来也只显示这一个，
      // 存着多余的 Key 只会让人以后疑惑「怎么还有几个」
      if (!provider.multiKey) provider.keys = provider.keys.slice(0, 1);

      // 全是空白的 Key 行直接丢掉，别在库里留噪音
      provider.keys = provider.keys.filter((k) => k.value.trim().length > 0);
      // 删掉的 Key 名下如果还挂着模型，那些模型跟着去掉，避免出现取不到 Key 的孤儿模型
      if (provider.keyMode === 'group') {
        const alive = new Set(provider.keys.map((k) => k.id));
        provider.models = provider.models.filter((m) => !m.keyId || alive.has(m.keyId));
      }
      // 同理，空模型名也丢掉
      provider.models = provider.models.filter((m) => m.id.trim().length > 0);
      provider.models.forEach((m) => {
        m.id = m.id.trim();
        if (!m.displayName) m.displayName = m.id;
      });

      if (!provider.baseUrl) {
        result.textContent = 'Base URL 不能空着。';
        result.className = 'field__note is-bad';
        return;
      }

      try {
        await putProvider(provider);
        if (quick) {
          location.hash = '/settings/providers';
          return;
        }
        result.textContent = '已保存。';
        result.className = 'field__note is-ok';
        renderKeys();
        // 保存时会丢掉空行，序号可能变了
        openModels.clear();
        renderModels();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.textContent = `保存失败：${message}`;
        result.className = 'field__note is-bad';
      }
    })();
  });

  /* ---------- 删除 ---------- */

  find(root, '#p-delete')?.addEventListener('click', () => {
    void (async () => {
      await deleteProviderRecord(provider.id);
      location.hash = '/settings/providers';
    })();
  });
}
