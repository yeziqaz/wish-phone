import { deleteProviderRecord, getProvider, newId, putProvider } from '../../core/db';
import type { ApiProtocol, Provider, ProviderModel } from '../../core/types';
import { esc, find, must, setText } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
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

function firstKey(provider: Provider): string {
  return provider.keys.find((k) => k.enabled && k.value)?.value ?? provider.keys[0]?.value ?? '';
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
                <button class="mini jelly" type="button" id="p-addkey">+ 添加</button>
              </span>
            </span>
            <div id="p-keys"></div>
          </div>

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

  const blankKey = (): Provider['keys'][number] => ({
    id: newId(),
    value: '',
    enabled: true,
    weight: 1,
    callCount: 0,
    failCount: 0,
  });

  const renderKeys = (): void => {
    const box = must<HTMLElement>(root, '#p-keys');
    // 始终留一个空位可填；要第二个再点「+ 添加」
    if (provider.keys.length === 0) provider.keys.push(blankKey());
    box.innerHTML = provider.keys
      .map(
        (key, index) => `
        <div class="key-row" data-index="${index}">
          <input class="input" type="${showPlain ? 'text' : 'password'}"
                 autocomplete="off" spellcheck="false"
                 data-key-input value="${esc(key.value)}" placeholder="sk-…">
          ${
            provider.keys.length > 1
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
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-key-input]');
    if (!input) return;
    const index = Number(input.closest<HTMLElement>('.key-row')?.dataset.index ?? '-1');
    const key = provider.keys[index];
    if (key) key.value = input.value;
  });

  must(root, '#p-keys').addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-key-remove]');
    if (!button) return;
    const index = Number(button.dataset.keyRemove ?? '-1');
    if (index >= 0) {
      provider.keys.splice(index, 1);
      renderKeys();
    }
  });

  must(root, '#p-addkey').addEventListener('click', () => {
    provider.keys.push(blankKey());
    renderKeys();
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
  let query = '';
  const matches = (model: ProviderModel): boolean =>
    !query ||
    model.id.toLowerCase().includes(query) ||
    model.displayName.toLowerCase().includes(query);

  const renderModels = (): void => {
    const box = find<HTMLElement>(root, '#p-models');
    if (!box) return;
    if (provider.models.length === 0) {
      box.innerHTML =
        '<p class="field__note">还没有模型。点上面的「拉取」自动获取，或「+ 手动」添加。</p>';
      return;
    }
    box.innerHTML = provider.models
      .map(
        (model, index) => `
        <div class="model-row" data-index="${index}"${matches(model) ? '' : ' hidden'}>
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
        </div>`,
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
  });

  find(root, '#p-addmodel')?.addEventListener('click', () => {
    provider.models.push({
      id: '',
      displayName: '',
      contextLength: null,
      enabled: true,
      source: 'manual',
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

      try {
        const list = await listModels({
          baseUrl,
          apiKey: firstKey(provider),
          model: '',
          temperature: 0,
        });

        const known = new Set(provider.models.map((m) => m.id));
        let added = 0;
        for (const item of list) {
          if (known.has(item.id)) continue;
          provider.models.push({
            id: item.id,
            displayName: item.id,
            contextLength: item.contextLength ?? null,
            enabled: true,
            source: 'fetched',
          });
          added += 1;
        }
        renderModels();
        note.textContent = `拉到 ${list.length} 个模型，新增 ${added} 个。`;
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

      // 全是空白的 Key 行直接丢掉，别在库里留噪音
      provider.keys = provider.keys.filter((k) => k.value.trim().length > 0);
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
