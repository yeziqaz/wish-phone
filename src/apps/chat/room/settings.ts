import { actionNoteVisible, setActionNoteVisible } from '../../../core/prefs';
import { line } from '../../../ui/icons';

/* ==========================================================================
   聊天设置（就地弹出，不跳页）

   用户 2026-11-10 明确要求：这些开关属于「聊天 App 自己的事」，
   不进全局设置页 —— 那是另一栋楼，太远。

   结构照 Apple HIG 的分组列表：组内紧贴 + 细分割线，组间留白。
   不用浮动卡片（显得飘），也不用一堆描边框（显得碎）。

   即时生效：开关一拨就写进 prefs，没有「保存」按钮。
   一个开关有什么可保存的。

   外观（头像挂件 / 气泡 / 背景 / 字体）**不在这里** —— 那是「聊天美化」的事，
   这里只往里跳。以前这里也放了一份头像框和气泡档位，和美化里的两套并存，
   结果点了框聊天里不显示。现在只留一个入口。
   ========================================================================== */

export interface ChatSettingsConfig {
  /** 动作星标开关改了要重画消息流 */
  onActionNoteChange?: () => void;
  /** 点了「聊天美化」，交给调用方决定怎么打开 */
  onOpenBeauty?: () => void;
}

export interface ChatSettingsResult {
  /** 动作 / 心理开关被动过（调用方需要重画消息） */
  actionNoteChanged: boolean;
}

export function openChatSettings(config: ChatSettingsConfig): Promise<ChatSettingsResult | null> {
  return new Promise((resolve) => {
    let actionNoteChanged = false;
    let closed = false;

    const root = document.createElement('div');
    root.className = 'chat-settings';
    root.innerHTML = `
      <div class="chat-settings__mask" data-cancel></div>
      <div class="chat-settings__panel" role="dialog" aria-modal="true" aria-label="聊天设置">
        <div class="chat-settings__grip"></div>
        <header class="chat-settings__head">
          <h2 class="chat-settings__title">聊天设置</h2>
          <button class="chat-settings__close" type="button" data-cancel aria-label="关闭">✕</button>
        </header>

        <div class="chat-settings__body">
          <section class="cs-group">
            <h3 class="cs-group__title">消息显示</h3>
            <label class="cs-row">
              <span class="cs-row__text">
                <span class="cs-row__title">动作与心理描写</span>
                <span class="cs-row__sub">像翻译一样显示在气泡下方，不用点开</span>
              </span>
              <span class="switch">
                <input type="checkbox" id="cs-action-note" ${actionNoteVisible() ? 'checked' : ''}>
                <span class="switch__track"></span>
              </span>
            </label>
          </section>

          <section class="cs-group">
            <h3 class="cs-group__title">外观</h3>
            <button class="me-row" type="button" id="cs-beauty">
              <span class="me-row__label">聊天美化</span>
              <span class="me-row__value">头像挂件 · 气泡 · 背景 · 字体</span>
              <span class="me-row__chevron">${line('chevron', 16)}</span>
            </button>
            <p class="cs-group__note">头像框和气泡样式都移到那里了，和背景、字体一起调。</p>
          </section>
        </div>

        <footer class="chat-settings__foot">
          <button class="btn btn--primary jelly" type="button" data-cancel>好了</button>
        </footer>
      </div>`;

    const finish = (result: ChatSettingsResult | null): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      window.setTimeout(() => {
        root.remove();
        resolve(result);
      }, 200);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null);
    };

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cancel]')) {
        finish({ actionNoteChanged });
        return;
      }

      // 外观全部在「聊天美化」里调，这里只负责把她送过去
      if (target.closest('#cs-beauty')) {
        finish({ actionNoteChanged });
        config.onOpenBeauty?.();
      }
    });

    root
      .querySelector<HTMLInputElement>('#cs-action-note')
      ?.addEventListener('change', (event) => {
        setActionNoteVisible((event.target as HTMLInputElement).checked);
        actionNoteChanged = true;
      });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('is-open'));
  });
}