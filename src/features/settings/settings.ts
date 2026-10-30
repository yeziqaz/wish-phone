import { normalizeBaseUrl } from '../../ai/client';
import { listModels, testConnection } from '../../ai/client';
import type { ModelInfo } from '../../ai/types';
import { ApiError } from '../../ai/errors';
import { deleteSetting, getSetting, setSetting } from '../../core/db';
import type { ApiConfigSaved } from '../../ai/types';
import './settings.css';

/* ==========================================================================
   设置页：API 配置 + 连通性自检

   这是整个项目最关键的一屏 —— 能不能连上用户自己的 API，
   决定这个 App 有没有用。
   ========================================================================== */

/** settings 表里存的 key */
const SETTING_KEY = 'apiConfig';

/** 默认值：空配置，不记住 Key */
const DEFAULTS: ApiConfigSaved = {
  baseUrl: '',
  model: '',
  temperature: 0.8,
  rememberKey: false,
};

/** 运行时内存里的 Key。rememberKey=false 时不落库 */
let sessionKey = '';

export async function mountSettings(root: HTMLElement): Promise<void> {
  const saved = (await getSetting<ApiConfigSaved>(SETTING_KEY)) ?? DEFAULTS;
  if (saved.rememberKey) {
    const storedKey = await getSetting<string>('apiKey');
    sessionKey = storedKey ?? '';
  }

  root.innerHTML = `
    <div class="settings">
      <header class="settings__head">
        <button class="settings__back jelly" type="button" data-go="/desktop" aria-label="返回">‹</button>
        <h1 class="settings__title">设置</h1>
      </header>

      <section class="settings__section">
        <h2 class="settings__label">接口地址</h2>
        <input class="input settings__input" id="cfg-url" type="text"
               inputmode="url" autocomplete="off" spellcheck="false"
               placeholder="https://api.example.com/v1"
               value="${esc(saved.baseUrl)}">
        <p class="settings__hint">带不带 /v1 都行，结尾斜杠和空格会自动去掉。</p>
      </section>

      <section class="settings__section">
        <h2 class="settings__label">密钥（API Key）</h2>
        <div class="settings__key-row">
          <input class="input settings__input" id="cfg-key" type="password"
                 autocomplete="off" spellcheck="false"
                 placeholder="sk-..."
                 value="${esc(sessionKey)}">
          <button class="btn jelly settings__eye" type="button" id="cfg-eye" aria-label="显示密钥">显示</button>
        </div>
        <label class="settings__check">
          <input type="checkbox" id="cfg-remember" ${saved.rememberKey ? 'checked' : ''}>
          <span>记住密钥（存在本机，关掉就不存）</span>
        </label>
        <p class="settings__hint settings__hint--warn">
          密钥只存在这台手机的浏览器里，只放在请求头里发出去，不会进地址栏、不会进日志。
        </p>
      </section>

      <section class="settings__section">
        <h2 class="settings__label">模型</h2>
        <div class="settings__key-row">
          <input class="input settings__input" id="cfg-model" type="text"
                 autocomplete="off" spellcheck="false"
                 placeholder="deepseek-chat"
                 value="${esc(saved.model)}">
          <button class="btn jelly" type="button" id="cfg-fetch-models">拉取</button>
        </div>
        <div class="settings__models" id="cfg-model-list"></div>
      </section>

      <section class="settings__section">
        <h2 class="settings__label">随机度（temperature）</h2>
        <div class="settings__slider-row">
          <input class="settings__slider" id="cfg-temp" type="range"
                 min="0" max="2" step="0.1" value="${saved.temperature}">
          <span class="settings__temp-val" id="cfg-temp-val">${saved.temperature.toFixed(1)}</span>
        </div>
        <p class="settings__hint">0 = 刻板精确，2 = 天马行空。一般用 0.7~1.0。</p>
      </section>

      <div class="settings__actions">
        <button class="btn btn--primary jelly" type="button" id="cfg-test">测试连接</button>
        <button class="btn jelly" type="button" id="cfg-save">保存</button>
      </div>

      <div class="settings__result" id="cfg-result"></div>
      <div class="settings__raw" id="cfg-raw" hidden>
        <button class="settings__raw-toggle" type="button" id="cfg-raw-toggle">查看原始错误 ▾</button>
        <pre class="settings__raw-body" id="cfg-raw-body"></pre>
      </div>
    </div>`;

  bindSettings(root);
}

/* ---------- 事件绑定 ---------- */

function bindSettings(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  // 显示 / 隐藏密钥
  $('button#cfg-eye')?.addEventListener('click', () => {
    const input = root.querySelector<HTMLInputElement>('#cfg-key');
    if (!input) return;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    $('button#cfg-eye')!.textContent = showing ? '显示' : '隐藏';
  });

  // temperature 滑块实时显示数值
  $('input#cfg-temp')?.addEventListener('input', () => {
    const input = root.querySelector<HTMLInputElement>('#cfg-temp');
    const val = root.querySelector<HTMLElement>('#cfg-temp-val');
    if (input && val) val.textContent = parseFloat(input.value).toFixed(1);
  });

  // 拉取模型列表
  $('button#cfg-fetch-models')?.addEventListener('click', () => void fetchModels(root));

  // 测试连接
  $('button#cfg-test')?.addEventListener('click', () => void runTest(root));

  // 保存
  $('button#cfg-save')?.addEventListener('click', () => void save(root));

  // 原始错误折叠
  $('button#cfg-raw-toggle')?.addEventListener('click', () => {
    const body = root.querySelector<HTMLElement>('#cfg-raw-body');
    if (!body) return;
    const open = body.hidden;
    body.hidden = !open;
    $('button#cfg-raw-toggle')!.textContent = open ? '收起原始错误 ▴' : '查看原始错误 ▾';
  });
}

/* ---------- 从界面读取当前配置 ---------- */

function readConfig(root: HTMLElement): { baseUrl: string; apiKey: string; model: string; temperature: number; rememberKey: boolean } {
  const baseUrl = root.querySelector<HTMLInputElement>('#cfg-url')?.value ?? '';
  const apiKey = root.querySelector<HTMLInputElement>('#cfg-key')?.value ?? '';
  const model = root.querySelector<HTMLInputElement>('#cfg-model')?.value ?? '';
  const tempStr = root.querySelector<HTMLInputElement>('#cfg-temp')?.value ?? '0.8';
  const rememberKey = root.querySelector<HTMLInputElement>('#cfg-remember')?.checked ?? false;
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey: apiKey.trim(),
    model: model.trim(),
    temperature: parseFloat(tempStr) || 0.8,
    rememberKey,
  };
}

/* ---------- 拉取模型列表 ---------- */

async function fetchModels(root: HTMLElement): Promise<void> {
  const { baseUrl, apiKey } = readConfig(root);
  const listEl = root.querySelector<HTMLElement>('#cfg-model-list');
  if (!listEl) return;

  if (!baseUrl) {
    showResult(root, { kind: 'warn', text: '先填接口地址。' });
    return;
  }

  listEl.innerHTML = '<p class="settings__hint">正在拉取…</p>';

  try {
    const models = await listModels({ baseUrl, apiKey, model: '', temperature: 0.8 });
    if (models.length === 0) {
      listEl.innerHTML = '<p class="settings__hint">这个接口没有返回模型列表。请手填模型名。</p>';
      return;
    }
    renderModelList(root, models);
  } catch (error) {
    listEl.innerHTML = '';
    showError(root, error);
  }
}

function renderModelList(root: HTMLElement, models: ModelInfo[]): void {
  const listEl = root.querySelector<HTMLElement>('#cfg-model-list');
  const input = root.querySelector<HTMLInputElement>('#cfg-model');
  if (!listEl || !input) return;

  const current = input.value.trim();
  listEl.innerHTML = models
    .map(
      (m) =>
        `<button class="settings__model jelly" type="button" data-model="${esc(m.id)}">${esc(m.id)}${m.id === current ? ' ✓' : ''}</button>`,
    )
    .join('');

  listEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-model]');
    if (!target) return;
    input.value = target.dataset.model ?? '';
    // 选完高亮一下
    listEl.querySelectorAll('.settings__model').forEach((b) => {
      const btn = b as HTMLElement;
      btn.classList.toggle('is-selected', btn.dataset.model === input.value);
    });
  });
}

/* ---------- 测试连接 ---------- */

async function runTest(root: HTMLElement): Promise<void> {
  const cfg = readConfig(root);

  if (!cfg.baseUrl || !cfg.model) {
    showResult(root, { kind: 'warn', text: '接口地址和模型名都要填。' });
    return;
  }

  const btn = root.querySelector<HTMLButtonElement>('#cfg-test');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '测试中…';
  }

  hideRaw(root);

  try {
    const result = await testConnection({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      temperature: cfg.temperature,
    });

    const count = result.models.length;
    showResult(root, {
      kind: 'ok',
      text: count > 0 ? `连接正常 ✓ · 可用模型 ${count} 个` : '连接正常 ✓',
    });
    if (count > 0) renderModelList(root, result.models);
  } catch (error) {
    showError(root, error);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '测试连接';
    }
  }
}

/* ---------- 保存 ---------- */

async function save(root: HTMLElement): Promise<void> {
  const cfg = readConfig(root);

  if (!cfg.baseUrl) {
    showResult(root, { kind: 'warn', text: '至少填一个接口地址。' });
    return;
  }

  const saved: ApiConfigSaved = {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    rememberKey: cfg.rememberKey,
  };

  await setSetting(SETTING_KEY, saved);

  // Key 的存储策略
  if (cfg.rememberKey && cfg.apiKey) {
    await setSetting('apiKey', cfg.apiKey);
  } else if (!cfg.rememberKey) {
    // 不记住 → 清掉之前可能存过的
    await deleteSetting('apiKey');
  }
  // 本次会话不管记不记都先用着：记住与否只影响「关掉应用后还在不在」
  sessionKey = cfg.apiKey;

  showResult(root, { kind: 'ok', text: '已保存。' });
}

/* ---------- 结果显示 ---------- */

type ResultKind = 'ok' | 'warn' | 'error';

function showResult(root: HTMLElement, result: { kind: ResultKind; text: string }): void {
  const el = root.querySelector<HTMLElement>('#cfg-result');
  if (!el) return;
  el.textContent = result.text;
  el.className = `settings__result settings__result--${result.kind}`;
}

function showError(root: HTMLElement, error: unknown): void {
  const apiError = error instanceof ApiError ? error : null;

  if (apiError) {
    showResult(root, { kind: 'error', text: apiError.info.title });
    // 在结果下面追加一行 detail
    const el = root.querySelector<HTMLElement>('#cfg-result');
    if (el) el.innerHTML += `<br><span class="settings__result-detail">${esc(apiError.info.detail)}</span>`;
    showRaw(root, apiError.info.raw ?? '', apiError.info.hint);
  } else {
    const msg = error instanceof Error ? error.message : String(error);
    showResult(root, { kind: 'error', text: '出了点问题' });
    showRaw(root, msg, '');
  }
}

function showRaw(root: HTMLElement, raw: string, hint: string): void {
  const wrap = root.querySelector<HTMLElement>('#cfg-raw');
  const body = root.querySelector<HTMLElement>('#cfg-raw-body');
  const toggle = root.querySelector<HTMLElement>('#cfg-raw-toggle');
  if (!wrap || !body || !toggle) return;

  body.textContent = raw + (hint ? `\n\n建议：${hint}` : '');
  wrap.hidden = false;
  body.hidden = true;
  toggle.textContent = '查看原始错误 ▾';
}

function hideRaw(root: HTMLElement): void {
  const wrap = root.querySelector<HTMLElement>('#cfg-raw');
  if (wrap) wrap.hidden = true;
}

/* ---------- 工具 ---------- */

/** HTML 转义：界面上的值都从用户输入来，不能直接插 innerHTML */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
