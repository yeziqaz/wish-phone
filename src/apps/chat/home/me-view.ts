import { esc } from '../../../core/dom';
import {
  displayUserName,
  setUserAvatar,
  setUserName,
  setUserSignature,
  userAvatarKey,
  userSignatureText,
} from '../../../core/prefs';
import { avatarHTML } from '../../../ui/avatar';
import { avatarDecorOf } from '../beauty/render';
import { openBeautyPanel } from '../beauty/editor/panel';
import { line } from '../../../ui/icons';
import { pickPhoto } from '../../../ui/photo-crop';

/* ==========================================================================
   「我」板块

   做什么：设你在聊天里叫什么、头像、个性签名。
   为什么在这儿：朋友圈发的内容要署名，转账要显示双方身份 —— 都得先有「我」。

   结构照微信「我」：顶部一张身份卡，下面分组列表。
   风格照本项目：黑白灰、描边、不填色。
   ========================================================================== */

export function meViewHTML(): string {
  const name = displayUserName();
  const signature = userSignatureText();
  const avatar = userAvatarKey();

  return `
    <div class="me-view">
      <section class="me-card">
        <button class="me-card__avatar" type="button" id="me-avatar" aria-label="换头像">
          ${avatarHTML(name, 72, avatar, undefined, avatarDecorOf('user'))}
          <span class="me-card__edit">${line('pencil', 14)}</span>
        </button>
        <div class="me-card__text">
          <span class="me-card__name" id="me-name">${esc(name)}</span>
          <span class="me-card__sig" id="me-sig">${esc(signature || '还没写签名')}</span>
        </div>
      </section>

      <section class="me-group">
        <button class="me-row" type="button" id="me-edit-name">
          <span class="me-row__label">名字</span>
          <span class="me-row__value" id="me-row-name">${esc(name)}</span>
          <span class="me-row__chevron">${line('chevron', 16)}</span>
        </button>
        <button class="me-row" type="button" id="me-edit-sig">
          <span class="me-row__label">签名</span>
          <span class="me-row__value" id="me-row-sig">${esc(signature || '未填')}</span>
          <span class="me-row__chevron">${line('chevron', 16)}</span>
        </button>
      </section>

      <section class="me-group">
        <h3 class="me-group__title">外观</h3>
        <button class="me-row" type="button" id="me-beauty">
          <span class="me-row__label">聊天美化</span>
          <span class="me-row__value">头像挂件 · 气泡 · 背景 · 聊天APP</span>
          <span class="me-row__chevron">${line('chevron', 16)}</span>
        </button>
      </section>

    </div>`;
}

/** 名字 / 签名的就地编辑。空着不许保存 —— 名字是别的功能的地基 */
function promptText(
  title: string,
  current: string,
  placeholder: string,
  maxLength: number,
  allowEmpty: boolean,
): Promise<string | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'chat-settings me-prompt';
    root.innerHTML = `
      <div class="chat-settings__mask" data-cancel></div>
      <div class="chat-settings__panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="chat-settings__grip"></div>
        <header class="chat-settings__head">
          <h2 class="chat-settings__title">${esc(title)}</h2>
          <button class="chat-settings__close" type="button" data-cancel aria-label="关闭">✕</button>
        </header>
        <div class="chat-settings__body">
          <label class="field">
            <textarea class="input textarea" id="mp-input" rows="2" maxlength="${maxLength}"
                      spellcheck="false" placeholder="${esc(placeholder)}">${esc(current)}</textarea>
            <span class="field__hint" id="mp-hint">最多 ${maxLength} 个字</span>
          </label>
        </div>
        <footer class="chat-settings__foot">
          <button class="btn btn--primary jelly" type="button" id="mp-save">好了</button>
        </footer>
      </div>`;

    const input = root.querySelector<HTMLTextAreaElement>('#mp-input');
    const hint = root.querySelector<HTMLElement>('#mp-hint');
    let done = false;

    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      window.setTimeout(() => {
        root.remove();
        resolve(value);
      }, 200);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null);
    };

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cancel]')) {
        finish(null);
        return;
      }
      if (target.closest('#mp-save') && input) {
        const value = input.value.trim();
        if (!value && !allowEmpty) {
          if (hint) {
            hint.textContent = '这个不能空着';
            hint.className = 'field__hint is-bad';
          }
          input.focus();
          return;
        }
        finish(value);
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    requestAnimationFrame(() => {
      root.classList.add('is-open');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  });
}

/**
 * 挂载「我」板块的交互。
 *
 * @param body  内容容器（板块切换会重画它）
 * @param onChange 身份变了要通知外面（比如重新渲染）
 */
export function mountMeView(
  body: HTMLElement,
  onChange: () => void,
  signal: AbortSignal,
): void {
  body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('#me-avatar')) {
      void (async () => {
        const photo = await pickPhoto();
        if (!photo) return;
        setUserAvatar(photo.dataUrl);
        onChange();
      })();
      return;
    }

    if (target.closest('#me-edit-name') || target.closest('#me-name')) {
      void (async () => {
        const value = await promptText('你叫什么', displayUserName(), '别人在聊天里看到的名字', 20, false);
        if (value === null) return;
        setUserName(value);
        onChange();
      })();
      return;
    }

    if (target.closest('#me-beauty')) {
      // scope: 'me' —— 除了聊天室那部分，还多一个聊天APP全局
      void openBeautyPanel({
        scope: 'me',
        onChange,
        onAppChange: onChange,
      }).then(onChange);
      return;
    }

    if (target.closest('#me-edit-sig')) {
      void (async () => {
        const value = await promptText('个性签名', userSignatureText(), '写一句话，也可以空着', 40, true);
        if (value === null) return;
        setUserSignature(value);
        onChange();
      })();
    }
  }, { signal });
}
