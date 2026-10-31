import { listProviders, putProvider } from '../../core/db';
import { getBindings } from '../../core/model-bindings';
import type { ModelKind, ModelRef, Provider } from '../../core/types';
import { MODEL_KIND_LABEL } from '../../core/types';
import { esc, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { openSheet } from '../../ui/sheet';
import { listModels, normalizeBaseUrl } from '../../ai/client';
import { ApiError } from '../../ai/errors';
import { PROTOCOL_LABEL, PROTOCOL_READY, fromParsed, guessModelKind } from './shared';
import { parseProvidersText } from './smart-parse';
import './providers.css';

/* ==========================================================================
   一个 API 模块（文本 / 生图 / 语音 / 视频）

   只做三件事：
     1. 智能添加 / 新建站子
     2. 从站子拉取模型（只留这个模块对应的类型）
     3. 列出现有站子，点进详情改 Key / 地址

   主模型的选择不在这里，在「API 与模型」页下面的全局/角色里。
   ========================================================================== */

const PAGE_TITLE: Record<ModelKind, string> = {
  text: '文本 API',
  image: '生图 API',
  voice: '语音 API',
  video: '生视频 API',
};

const KIND_HINT: Record<ModelKind, string> = {
  text: '只拉取输出文字的模型。',
  image: '只拉取输出图片的模型。',
  voice: '只拉取语音合成 / 朗读的模型。',
  video: '只拉取输出视频的模型。',
};

const NATIVE_HINT: Record<ModelKind, string> = {
  text: '文本模块支持 OpenAI 兼容；Gemini / Claude 的原生格式还没适配。',
  image: '生图模块支持 OpenAI 兼容；NovelAI 的原生接口还没适配。',
  voice: '语音模块支持 OpenAI 兼容；ElevenLabs / MiniMax / FishAudio 的原生接口还没适配。',
  video: '视频模块支持 OpenAI 兼容；Sora / Veo / Kling 的原生接口还没适配。',
};

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.info.title} —— ${error.info.detail}`;
  return error instanceof Error ? error.message : String(error);
}

function usableKey(provider: Provider): string {
  return provider.keys.find((key) => key.enabled && key.value)?.value ?? provider.keys[0]?.value ?? '';
}

export async function mountApiType(root: HTMLElement, rawKind: string): Promise<void> {
  const kind = rawKind as ModelKind;
  if (!(kind in PAGE_TITLE)) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">找不到</h1>
        </header>
        <p class="field__note">没有这个 API 模块。</p>
      </div>`;
    return;
  }

  const label = MODEL_KIND_LABEL[kind];
  let flash = '';
  let flashBad = false;

  const paint = async (): Promise<void> => {
    const [allProviders, bindings] = await Promise.all([listProviders(), getBindings()]);
    const providers = allProviders.filter((provider) => (provider.kind ?? 'text') === kind);
    const mainRef: ModelRef | undefined = bindings.byKind[kind];
    const mainProvider = mainRef ? allProviders.find((p) => p.id === mainRef.providerId) : undefined;
    const mainModel = mainProvider?.models.find((m) => m.id === mainRef?.modelId);
    const mainText = mainProvider && mainModel ? `${mainProvider.name} · ${mainModel.id}` : '未设置';

    const providerRows = providers
      .map(
        (provider) => `
        <div class="api-provider">
          <button class="api-provider__main" type="button" data-edit="${esc(provider.id)}">
            ${avatarHTML(provider.name, 36)}
            <span class="api-provider__text">
              <span class="api-provider__name">${esc(provider.name)}</span>
              <span class="api-provider__sub">
                ${esc(PROTOCOL_LABEL[provider.protocol])} · ${provider.models.length} 个模型
              </span>
            </span>
            <span class="api-provider__tail">${line('chevron', 18)}</span>
          </button>
          <button class="api-provider__pull" type="button" data-pull="${esc(provider.id)}"
                  aria-label="从 ${esc(provider.name)} 拉取模型">${line('import', 20)}</button>
        </div>`,
      )
      .join('');

    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">${PAGE_TITLE[kind]}</h1>
          <button class="topbar__action jelly" type="button" data-new="1"
                  aria-label="新建服务商">${line('plus', 22)}</button>
        </header>

        <p class="api-type__hint">${KIND_HINT[kind]}模型会留在这里，主模型去上一页选。</p>

        <div class="api-current api-current--row">
          <div>
            <p class="api-current__label">当前${label}主模型</p>
            <p class="api-current__name">${esc(mainText)}</p>
          </div>
          <button class="btn btn--sm" type="button" data-go="/settings/providers">去选</button>
        </div>

        ${flash ? `<p class="field__note ${flashBad ? 'is-bad' : 'is-ok'}">${esc(flash)}</p>` : ''}

        <button class="smart-add jelly" type="button" id="smart-toggle">
          <span class="smart-add__wand">${line('wand', 20)}</span>
          <span class="smart-add__text">
            <span class="smart-add__title">智能添加</span>
            <span class="smart-add__sub">粘贴站子给的一整段信息，自动认出地址、密钥</span>
          </span>
        </button>

        <div class="smart-panel" id="smart-panel" hidden>
          <textarea class="input smart-panel__area" id="smart-text" rows="7"
                    spellcheck="false" autocomplete="off"
                    placeholder="站名&#10;https://api.example.com/v1&#10;key1:sk-xxxxxxxxxxxx&#10;&#10;（空一行可以接着写下一个站子）"></textarea>
          <div class="smart-panel__actions">
            <button class="btn jelly" type="button" id="smart-cancel">取消</button>
            <button class="btn btn--primary jelly" type="button" id="smart-run">识别并添加</button>
          </div>
          <p class="smart-panel__note">识别全程在本地完成，粘进来的内容不会发到任何地方。</p>
        </div>

        <h2 class="api-type__title">已有服务商</h2>
        ${
          providers.length === 0
            ? '<div class="empty"><p class="empty__title">这个模块还没有服务商</p><p class="empty__hint">用上面的智能添加，<br>或者点右上角的「+」新建。</p></div>'
            : `<div class="nav-group api-providers">${providerRows}</div>`
        }
        <p class="api-type__hint">${NATIVE_HINT[kind]}</p>
      </div>`;

    flash = '';

    root.querySelectorAll<HTMLElement>('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        location.hash = `/settings/providers/${button.dataset.edit ?? ''}`;
      });
    });

    root.querySelector<HTMLElement>('[data-new]')?.addEventListener('click', () => {
      location.hash = `/settings/providers/new?kind=${kind}`;
    });

    /* ---------- 智能添加 ---------- */
    const panel = must<HTMLElement>(root, '#smart-panel');
    const textarea = must<HTMLTextAreaElement>(root, '#smart-text');

    must(root, '#smart-toggle').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) textarea.focus();
    });

    must(root, '#smart-cancel').addEventListener('click', () => {
      panel.hidden = true;
    });

    must(root, '#smart-run').addEventListener('click', () => {
      void (async () => {
        const parsed = parseProvidersText(textarea.value);
        if (parsed.length === 0) {
          flash = '没认出站子。至少要有一行地址。';
          flashBad = true;
          await paint();
          return;
        }

        for (const item of parsed) {
          const provider = fromParsed(item);
          provider.kind = kind;
          await putProvider(provider);
        }

        flash = `已添加 ${parsed.length} 个服务商。点右边的下载图标拉取模型。`;
        flashBad = false;
        await paint();
      })();
    });

    /* ---------- 拉取模型 ---------- */
    root.querySelectorAll<HTMLElement>('[data-pull]').forEach((button) => {
      button.addEventListener('click', () => {
        const provider = providers.find((item) => item.id === button.dataset.pull);
        if (provider) void pullModels(provider);
      });
    });

    const pullModels = async (provider: Provider): Promise<void> => {
      if (!PROTOCOL_READY[provider.protocol]) {
        flash = `「${provider.name}」用的 ${PROTOCOL_LABEL[provider.protocol]} 还没适配，暂时拉不了模型。`;
        flashBad = true;
        await paint();
        return;
      }

      const key = usableKey(provider);
      if (!key) {
        flash = `「${provider.name}」还没填 API Key。`;
        flashBad = true;
        await paint();
        return;
      }

      try {
        const list = await listModels({
          baseUrl: normalizeBaseUrl(provider.baseUrl),
          apiKey: key,
          model: '',
          temperature: 0,
        });
        const filtered = list.filter((item) => guessModelKind(item.id) === kind);

        if (filtered.length === 0) {
          flash = `「${provider.name}」没返回${label}模型。可能这个站子不提供这一类。`;
          flashBad = true;
          await paint();
          return;
        }

        const known = new Set(provider.models.map((model) => model.id));
        const picked = await openSheet({
          title: `拉取${label}模型 · ${provider.name}`,
          items: filtered.map((item) => ({
            id: item.id,
            label: item.id,
            meta: known.has(item.id) ? '已添加' : '',
            taken: known.has(item.id),
          })),
          groupOf: () => provider.name,
          confirmLabel: (count) => (count === 0 ? '添加' : `添加 ${count} 个`),
          emptyText: `这个站子没有${label}模型`,
        });

        if (!picked) {
          await paint();
          return;
        }

        for (const item of picked) {
          provider.models.push({
            id: item.id,
            kind,
            displayName: item.id,
            contextLength: null,
            maxOutput: null,
            enabled: true,
            source: 'fetched',
          });
        }
        provider.updatedAt = Date.now();
        await putProvider(provider);

        flash = `已添加 ${picked.length} 个模型。去「API 与模型」里选一个作为${label}主模型。`;
        flashBad = false;
        await paint();
      } catch (error) {
        flash = describe(error);
        flashBad = true;
        await paint();
      }
    };
  };

  await paint();
}
