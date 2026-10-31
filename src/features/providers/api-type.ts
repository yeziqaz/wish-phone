import { listProviders, newId, putProvider } from '../../core/db';
import { getBindings, setKindBinding } from '../../core/model-bindings';
import type { ModelKind, ModelRef, Provider } from '../../core/types';
import { MODEL_KIND_LABEL } from '../../core/types';
import { esc, find, must } from '../../core/dom';
import { line } from '../../ui/icons';
import { openSheet } from '../../ui/sheet';
import { listModels, normalizeBaseUrl } from '../../ai/client';
import { ApiError } from '../../ai/errors';
import { PROTOCOL_LABEL, blankProvider, guessModelKind } from './shared';
import './providers.css';

/* ==========================================================================
   生图 / 语音 / 生视频 API

   每个页面只做三件事：
     1. 看当前选的是哪个模型
     2. 从已有服务商拉取（拉回来只留这一类模型）
     3. 新建一个服务商，直接拉取

   类型判断是猜的（见 shared.ts 的 guessModelKind），猜错了可以换服务商试。
   ========================================================================== */

const KINDS: ModelKind[] = ['image', 'voice', 'video'];

const KIND_PAGE: Record<
  Exclude<ModelKind, 'text'>,
  { hint: string; providerHint: string }
> = {
  image: {
    hint: '生成角色图、表情、场景图时用这个模型。',
    providerHint: '支持 OpenAI 兼容接口（大多数中转站都算）。NovelAI 的原生接口要单独适配，下一版做。',
  },
  voice: {
    hint: '把文字读出来时用这个模型。',
    providerHint:
      '支持 OpenAI 兼容接口。ElevenLabs / MiniMax / FishAudio 的原生接口要单独适配，下一版做。',
  },
  video: {
    hint: '生成短视频时用这个模型。',
    providerHint:
      '支持 OpenAI 兼容接口。Sora / Veo / Kling 等原生接口要单独适配，下一版做。',
  },
};

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.info.title} —— ${error.info.detail}`;
  return error instanceof Error ? error.message : String(error);
}

function usableKey(provider: Provider): string {
  return provider.keys.find((key) => key.enabled && key.value)?.value ?? provider.keys[0]?.value ?? '';
}

function refKey(ref: ModelRef): string {
  return `${ref.providerId}::${ref.modelId}`;
}

interface Resolved {
  provider: Provider;
  modelId: string;
}

/** 把绑定还原成「服务商 + 模型」。找不到（被删了）返回 null */
function resolveRef(providers: Provider[], ref: ModelRef | undefined): Resolved | null {
  if (!ref) return null;
  const provider = providers.find((item) => item.id === ref.providerId);
  if (!provider || !provider.models.some((model) => model.id === ref.modelId)) return null;
  return { provider, modelId: ref.modelId };
}

export async function mountApiType(root: HTMLElement, rawKind: string): Promise<void> {
  const kind = rawKind as ModelKind;
  if (!KINDS.includes(kind)) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">找不到</h1>
        </header>
        <p class="field__note">没有这个 API 类型。</p>
      </div>`;
    return;
  }

  const page = KIND_PAGE[kind as Exclude<ModelKind, 'text'>];
  const label = MODEL_KIND_LABEL[kind];
  const pageTitle = kind === 'video' ? '生视频 API' : `${label} API`;

  /** 重画之后想留一句话给用户看 */
  let flash = '';
  let flashBad = false;

  const paint = async (): Promise<void> => {
    const providers = await listProviders();
    const bindings = await getBindings();
    const current = resolveRef(providers, bindings.byKind[kind]);

    const providerRows = providers
      .map(
        (provider) => `
        <div class="api-provider">
          <div class="api-provider__text">
            <span class="api-provider__name">${esc(provider.name)}</span>
            <span class="api-provider__sub">
              ${esc(PROTOCOL_LABEL[provider.protocol])} · ${provider.models.length} 个模型
            </span>
          </div>
          <button class="btn btn--sm" type="button" data-pull="${esc(provider.id)}">拉取</button>
        </div>`,
      )
      .join('');

    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/settings/providers" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">${pageTitle}</h1>
        </header>

        <p class="api-type__hint">${esc(page.hint)}</p>

        <div class="api-current">
          <p class="api-current__label">当前${label}模型</p>
          <p class="api-current__name">
            ${current ? `${esc(current.provider.name)} · ${esc(current.modelId)}` : '还没设置'}
          </p>
          <div class="api-current__actions">
            <button class="btn ${current ? 'btn--sm' : 'btn--primary'}" type="button" id="api-pick">
              ${current ? '更换' : '选一个'}
            </button>
            ${current ? '<button class="btn btn--sm btn--ghost" type="button" id="api-clear">清除</button>' : ''}
          </div>
        </div>

        ${
          flash
            ? `<p class="field__note ${flashBad ? 'is-bad' : 'is-ok'}">${esc(flash)}</p>`
            : ''
        }

        <h2 class="api-type__title">从已有服务商拉取</h2>
        <p class="api-type__hint">拉取时只留${label}模型，其他类型会自动筛掉。</p>

        ${
          providers.length === 0
            ? '<p class="field__note">还没有服务商。在下面新建一个。</p>'
            : `<div class="nav-group api-providers">${providerRows}</div>`
        }

        <section class="fold">
          <button class="fold__head" type="button" data-fold aria-expanded="false">
            新建服务商<span class="fold__chevron">${line('chevron', 16)}</span>
          </button>
          <div class="fold__body" hidden>
            <p class="field__hint">${esc(page.providerHint)}</p>
            <label class="field">
              <span class="field__label">名字</span>
              <input class="input" id="np-name" type="text" autocomplete="off" spellcheck="false"
                     value="${label}服务商" placeholder="只给自己看">
            </label>
            <label class="field">
              <span class="field__label">Base URL</span>
              <input class="input" id="np-url" type="url" autocomplete="off" spellcheck="false"
                     placeholder="https://api.example.com/v1">
            </label>
            <label class="field">
              <span class="field__label">API Key</span>
              <input class="input" id="np-key" type="text" autocomplete="off" spellcheck="false"
                     placeholder="sk-...">
              <span class="field__hint">Key 只存在这台设备上。</span>
            </label>
            <button class="btn jelly" type="button" id="np-create">保存并拉取</button>
            <p class="field__note" id="np-note"></p>
          </div>
        </section>
      </div>`;

    flash = '';

    const setNote = (el: HTMLElement | null, message: string, bad = false): void => {
      if (!el) return;
      el.textContent = message;
      el.className = `field__note${bad ? ' is-bad' : message ? ' is-ok' : ''}`;
    };

    /* ---------- 选当前模型 ---------- */
    const pickable: { ref: ModelRef; label: string; group: string }[] = [];
    for (const provider of providers) {
      for (const model of provider.models) {
        if ((model.kind ?? 'text') !== kind) continue;
        pickable.push({
          ref: { providerId: provider.id, modelId: model.id },
          label: model.displayName && model.displayName !== model.id ? model.displayName : model.id,
          group: provider.name,
        });
      }
    }

    must(root, '#api-pick').addEventListener('click', () => {
      void (async () => {
        if (pickable.length === 0) {
          flash = `还没有任何${label}模型。先从下面的服务商拉取一个。`;
          flashBad = true;
          await paint();
          return;
        }

        const picked = await openSheet({
          title: `选择${label}模型`,
          items: pickable.map((item) => ({
            id: refKey(item.ref),
            label: item.label,
            meta: item.ref.modelId,
          })),
          groupOf: (item) => pickable.find((p) => refKey(p.ref) === item.id)?.group ?? '',
          single: true,
          confirmLabel: () => '用这个',
          emptyText: '还没有可选的模型',
        });

        const hit = picked?.[0] ? pickable.find((item) => refKey(item.ref) === picked[0]!.id) : null;
        if (!hit) return;

        await setKindBinding(kind, hit.ref);
        flash = `已设为${label}模型：${hit.label}`;
        flashBad = false;
        await paint();
      })();
    });

    const clear = root.querySelector<HTMLElement>('#api-clear');
    clear?.addEventListener('click', () => {
      void (async () => {
        await setKindBinding(kind, null);
        flash = `已清除${label}模型。`;
        flashBad = false;
        await paint();
      })();
    });

    /* ---------- 从已有服务商拉取 ---------- */
    root.querySelectorAll<HTMLElement>('[data-pull]').forEach((button) => {
      button.addEventListener('click', () => {
        const providerId = button.dataset.pull ?? '';
        const provider = providers.find((item) => item.id === providerId);
        if (!provider) return;
        void pullFrom(provider);
      });
    });

    const pullFrom = async (provider: Provider): Promise<void> => {
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
          flash = `「${provider.name}」没返回${label}模型。换个服务商，或在它的详情页手动添加模型。`;
          flashBad = true;
          await paint();
          return;
        }

        const known = new Set(provider.models.map((model) => model.id));
        const picked = await openSheet({
          title: `选择${label}模型 · ${provider.name}`,
          items: filtered.map((item) => ({
            id: item.id,
            label: item.id,
            meta: known.has(item.id) ? '已添加' : '',
            taken: false,
          })),
          groupOf: () => provider.name,
          single: true,
          confirmLabel: () => '用这个',
          emptyText: `这个服务商没有${label}模型`,
        });

        const hit = picked?.[0];
        if (!hit) {
          await paint();
          return;
        }

        if (!known.has(hit.id)) {
          const contextLength = list.find((item) => item.id === hit.id)?.contextLength ?? null;
          provider.models.push({
            id: hit.id,
            displayName: hit.id,
            kind,
            contextLength,
            maxOutput: null,
            enabled: true,
            source: 'fetched',
          });
          provider.updatedAt = Date.now();
          await putProvider(provider);
        }

        await setKindBinding(kind, { providerId: provider.id, modelId: hit.id });
        flash = `已设为${label}模型：${hit.id}`;
        flashBad = false;
        await paint();
      } catch (error) {
        flash = describe(error);
        flashBad = true;
        await paint();
      }
    };

    /* ---------- 新建服务商：保存后直接拉取 ---------- */
    root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
      head.addEventListener('click', () => {
        const expanded = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!expanded));
        const body = head.nextElementSibling;
        if (body instanceof HTMLElement) body.hidden = expanded;
      });
    });

    must(root, '#np-create').addEventListener('click', () => {
      void (async () => {
        const note = find<HTMLElement>(root, '#np-note');
        const name = must<HTMLInputElement>(root, '#np-name').value.trim() || `${label}服务商`;
        const baseUrl = normalizeBaseUrl(must<HTMLInputElement>(root, '#np-url').value);
        const key = must<HTMLInputElement>(root, '#np-key').value.trim();

        if (!baseUrl) {
          setNote(note, 'Base URL 要填。', true);
          return;
        }

        const provider = blankProvider(name);
        provider.baseUrl = baseUrl;
        provider.keys = key
          ? [
              {
                id: newId(),
                value: key,
                label: 'Key 1',
                enabled: true,
                weight: 1,
                callCount: 0,
                failCount: 0,
              },
            ]
          : [];
        await putProvider(provider);

        // 按钮写的是「保存并拉取」，那就接着拉，别只保存
        flash = `已保存「${provider.name}」，正在拉取…`;
        flashBad = false;
        await paint();

        await pullFrom(provider);
      })();
    });
  };

  await paint();
}
