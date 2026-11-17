import { esc } from '../../../../core/dom';
import { line } from '../../../../ui/icons';
import { pickPhoto } from '../../../../ui/photo-crop';
import {
  BEAUTY_TABS,
  BUBBLE_PRESETS,
  NO_SHAPE,
  PENDANT_PRESETS,
  allPendants,
  type BeautyRole,
  type BeautyScheme,
  type BubbleShape,
  type Sticker,
  type StickerCorner,
} from '../model';
import { pickCustomBubble } from './bubble-crop';
import { pendantSVG } from '../pendant';
import {
  activeScheme,
  assetUrl,
  beautyData,
  editActive,
  ensureFlippedBubbleAsset,
  importAssetFromDataUrl,
  importCustomBubble,
  loadAppAppearance,
  loadBeauty,
  removeCustomAsset,
  removeScheme,
  renameScheme,
  resetActive,
  resetAppAppearance,
  saveScheme,
  selectScheme,
  setAppAppearance,
  type AppAppearance,
} from '../store';
import { previewBubbleStyle } from '../css';
import { colorRow } from './rows';
import { backgroundTabHTML } from './tab-background';
import { appTabHTML } from './tab-app';
import { avatarTabHTML } from './tab-avatar';
import { bubbleTabHTML } from './tab-bubble';
import { fontTabHTML } from './tab-font';
import { schemeTabHTML } from './tab-scheme';

/* ==========================================================================
   聊天美化面板

   ⚠️ 结构与交互移植自用户自己的项目 apps/chat/ChatBeautyEditor.vue。
      6 个板块、实时预览、分段切换、分类横滑、贴纸微调、方案管理、代码模式，
      一个都没删。只把 Vue 模板换成 DOM 拼串。

   与原项目的两处差异（都已当面说明）：
     1. 原项目是「占满整个 chatApp 的覆盖层」，这里是底部全屏面板 ——
        本项目聊天页本身没有 chatApp 这一层，全屏面板是等效的。
     2. 原项目有「字体导入」，但这需要 FontFace API + 字体文件存储。
        本轮先留出位置和文案，功能标为未实现，不假装能点。
   ========================================================================== */

/** 回调：改完之后让聊天页重挂变量 */
/**
 * 面板的作用域。
 *
 * 两个入口，两套东西：
 *   'room' —— 从聊天室左上角进。只管这一个聊天室：气泡、头像挂件、背景、字体。
 *   'me'   —— 从「我」进。包含 room 那部分，**再加**聊天 APP 全局外观。
 *
 * 为什么不是两套完全独立的界面：
 *   那样用户要在两个地方调同一件事（气泡圆角），学两遍。
 *   现在是同一套面板，room 模式少一个板块、me 模式多一个 —— 少学一次。
 */
export type BeautyScope = 'room' | 'me';

export interface BeautyPanelConfig {
  /** 'room' 需要角色 id；'me' 不需要 */
  scope: BeautyScope;
  /** 聊天室作用域下是角色 id */
  characterId?: string;
  /** 聊天室作用域下的角色名，用在标题里 */
  characterName?: string;
  /** 改完通知调用方重挂变量 */
  onChange: () => void;
  /** 只作用于「聊天APP全局」部分的回调（me 模式才有） */
  onAppChange?: () => void;
}

const APP_FIELDS: Array<{ key: keyof BeautyScheme['app']; label: string }> = [
  { key: 'background', label: '界面背景' },
  { key: 'panel', label: '列表与卡片' },
  { key: 'navigation', label: '顶部与导航栏' },
  { key: 'accent', label: '选中颜色' },
  { key: 'ink', label: '界面文字' },
  { key: 'muted', label: '次要文字' },
];

/**
 * 打开美化面板。
 *
 * 返回的 Promise 在面板关掉时 resolve —— 调用方只关心「关掉了」这件事，
 * 具体改了什么已经实时写库了。
 */
export async function openBeautyPanel(config: BeautyPanelConfig): Promise<void> {
  // 先切到对应作用域，把那一套配置读出来 —— 之后所有读写自动跟着走
  await loadBeauty(config.scope === 'room' ? (config.characterId ?? '') : '');
  if (config.scope === 'me') await loadAppAppearance();

  return new Promise((resolve) => {
    let tab = config.scope === 'room' ? 'avatar' : 'app';
    let mode: 'preview' | 'code' = 'preview';
    let subject: BeautyRole = 'user';
    let avatarTab: 'frame' | 'sticker' = 'frame';
    let category = '全部';
    let message = '';
    let closed = false;
    let selectedAvatarSticker = '';
    let selectedBubbleSticker = '';
    let schemeName = '';
    let editingScheme = false;
    let renamingScheme = false;
    /** 代码模式的两份草稿。改完点「校验并应用」才写库 */
    let customDraft = '';

    const root = document.createElement('div');
    root.className = 'beauty-panel';
    root.innerHTML = `
      <div class="beauty-panel__mask" data-close></div>
      <div class="beauty-panel__sheet" role="dialog" aria-modal="true" aria-label="聊天美化">
        <header class="beauty-panel__head">
          <button class="beauty-panel__back" type="button" data-close aria-label="返回聊天">
            ${line('back', 20)}
          </button>
          <div class="beauty-panel__titles">
            <h1 class="beauty-panel__title">聊天美化</h1>
            <p class="beauty-panel__sub" id="bp-sub"></p>
          </div>
          <button class="beauty-panel__reset" type="button" id="bp-reset" aria-label="恢复当前方案">
            ${line('refresh', 18)}
          </button>
        </header>

        <div class="beauty-mode" role="tablist" aria-label="编辑模式">
          <button class="beauty-mode__item" type="button" role="tab" data-mode="preview">预览</button>
          <button class="beauty-mode__item" type="button" role="tab" data-mode="code">代码</button>
        </div>

        <div class="beauty-panel__body" id="bp-body"></div>
      </div>`;

    const sheet = root.querySelector<HTMLElement>('.beauty-panel__sheet')!;
    const body = root.querySelector<HTMLElement>('#bp-body')!;
    const sub = root.querySelector<HTMLElement>('#bp-sub')!;

    /* ---------- 绘制 ---------- */

    /** 实时预览：一左一右两个气泡，用的是和真实聊天气泡完全相同的样式函数 */
    const previewHTML = (scheme: BeautyScheme): string => {
      const avatar = (role: BeautyRole, label: string): string => {
        const deco = scheme.participants[role].avatar;
        const frame = deco.frameId ? assetUrl(deco.frameId) || '' : '';
        const preset = frame ? undefined : PENDANT_PRESETS.find((item) => item.id === deco.frameId);
        const frameHTML = frame
          ? `<img class="beauty-prev__pendant" src="${esc(frame)}" alt="">`
          : preset
            ? `<span class="beauty-prev__pendant">${pendantSVG(preset)}</span>`
            : '';
        return `<span class="beauty-prev__avatar beauty-prev__avatar--${role}">${esc(label)}${frameHTML}</span>`;
      };

      const bubbleStickers = (role: BeautyRole): string =>
        scheme.participants[role].bubble.stickers
          .map((item) => {
            const preset = allPendants(beautyData()).find((value) => value.id === item.assetId);
            const url = assetUrl(item.assetId);
            return `<span class="bubble-sticker" style="left:${item.corner.endsWith('left') ? '0%' : '100%'};` +
              `top:${item.corner.startsWith('top') ? '0%' : '100%'};z-index:${item.zIndex + 2};` +
              `transform:translate(calc(-50% + ${item.x}px), calc(-50% + ${item.y}px)) rotate(${item.rotation}deg) scale(${item.scale})">` +
              `${url ? `<img src="${esc(url)}" alt="">` : esc(preset?.glyph ?? '★')}</span>`;
          })
          .join('');

      return `
        <div class="beauty-prev">
          <div class="beauty-prev__title">
            <span>实时预览</span><span>${subject === 'user' ? '我的设置' : '角色设置'}</span>
          </div>
          <div class="beauty-prev__row">
            ${avatar('wuli', '角')}
            <span class="beauty-prev__bubble" style="${previewBubbleStyle(scheme, 'wuli', assetUrl)}">
              今天想换什么风格？${bubbleStickers('wuli')}
            </span>
          </div>
          <div class="beauty-prev__row beauty-prev__row--me">
            <span class="beauty-prev__bubble" style="${previewBubbleStyle(scheme, 'user', assetUrl)}">
              帮我试试这个方案${bubbleStickers('user')}
            </span>
            ${avatar('user', '我')}
          </div>
        </div>`;
    };

    /** 分段控件 */
    /**
     * 这个作用域下能看到哪些板块。
     *
     * room（聊天室）：头像挂件 / 气泡 / 聊天背景 / 字体 / 方案
     *   「界面」和「聊天APP」不属于单个聊天室，所以不出现。
     * me（我）：全部 + 一个「聊天APP」板块。
     */
    const visibleTabs = (): Array<{ id: string; label: string }> => {
      if (config.scope === 'room') {
        return BEAUTY_TABS.filter((item) => item.id !== 'interface');
      }
      return [...BEAUTY_TABS, { id: 'app', label: '聊天APP' }];
    };

    /**
     * 板块分发。
     *
     * 每个板块的 HTML 都在 tab-*.ts 里，这里只负责按当前 tab 转过去。
     * 拆开的好处：想改「气泡圆角」直接开 tab-bubble.ts，不用在一千行里找。
     */
    const schemeHTML = (scheme: BeautyScheme): string => {
      if (tab === 'app') return appTabHTML();

      if (tab === 'interface') {
        return `<h2 class="beauty-h2">这个聊天室的界面配色</h2>
          <p class="beauty-note">用于聊天列表、通讯录、朋友圈和「我」页面。</p>
          ${APP_FIELDS.map((field) => colorRow(`app.${field.key}`, field.label, scheme.app[field.key])).join('')}`;
      }

      if (tab === 'avatar') {
        return avatarTabHTML(scheme, {
          subject,
          avatarTab,
          category,
          selectedSticker: selectedAvatarSticker,
        });
      }

      if (tab === 'bubble') {
        return bubbleTabHTML(scheme, { subject, selectedSticker: selectedBubbleSticker });
      }

      if (tab === 'background') return backgroundTabHTML(scheme);
      if (tab === 'font') return fontTabHTML(scheme);

      return schemeTabHTML(scheme, { editing: editingScheme, renaming: renamingScheme, name: schemeName });
    };

    /* ---------- 代码模式 ---------- */

    const codeHTML = (scheme: BeautyScheme): string => `
      <p class="beauty-note">
        自定义 CSS 会自动限定在聊天页内，叠加在生成样式之后。
        这里写的是你自己的样式，不是配置的反解。
      </p>
      <label class="beauty-code">
        <span class="beauty-field__label">自定义 CSS</span>
        <textarea class="input textarea beauty-code__input" id="bp-custom-css" rows="10"
                  spellcheck="false" placeholder=".msg-bubble { letter-spacing: 0; }">${esc(customDraft || scheme.customCss.source)}</textarea>
      </label>
      <div class="beauty-actions">
        <button class="btn btn--primary" type="button" data-code-save>保存</button>
        <button class="btn beauty-btn" type="button" data-code-restore>恢复当前代码</button>
      </div>`;

    /* ---------- 整页绘制 ---------- */

    const paint = (): void => {
      const scheme = activeScheme();
      sub.textContent = `界面与聊天 · ${scheme.name}`;
      root.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => {
        const on = button.dataset.mode === mode;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-selected', String(on));
      });

      if (mode === 'code') {
        body.innerHTML = codeHTML(scheme);
        return;
      }

      body.innerHTML =
        previewHTML(scheme) +
        `<div class="beauty-tabs" role="tablist">${visibleTabs().map(
          (item) =>
            `<button class="beauty-tabs__item${item.id === tab ? ' is-on' : ''}" type="button" role="tab" ` +
            `data-tab="${esc(item.id)}" aria-selected="${item.id === tab}">${esc(item.label)}</button>`,
        ).join('')}</div>` +
        `<div class="beauty-editor">${schemeHTML(scheme)}</div>` +
        (message ? `<p class="beauty-msg" role="status">${esc(message)}</p>` : '');
    };

    /** 改完立刻重画 + 通知聊天页重挂变量 */
    const apply = async (mutator: (scheme: BeautyScheme) => void): Promise<void> => {
      try {
        await editActive(mutator);
        message = '';
        paint();
        config.onChange();
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
        paint();
      }
    };

    /* ---------- 事件 ---------- */

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      if (target.closest('[data-close]')) {
        finish();
        return;
      }

      const modeBtn = target.closest<HTMLElement>('[data-mode]');
      if (modeBtn) {
        mode = modeBtn.dataset.mode === 'code' ? 'code' : 'preview';
        message = '';
        paint();
        return;
      }

      const tabBtn = target.closest<HTMLElement>('[data-tab]');
      if (tabBtn?.dataset.tab) {
        tab = tabBtn.dataset.tab;
        message = '';
        paint();
        return;
      }

      const segBtn = target.closest<HTMLElement>('[data-seg]');
      if (segBtn) {
        const name = segBtn.dataset.seg;
        const value = segBtn.dataset.segValue ?? '';
        if (name === 'subject') subject = value === 'wuli' ? 'wuli' : 'user';
        else if (name === 'avatarTab') avatarTab = value === 'sticker' ? 'sticker' : 'frame';
        paint();
        return;
      }

      const catBtn = target.closest<HTMLElement>('[data-cat]');
      if (catBtn?.dataset.cat) {
        category = catBtn.dataset.cat;
        paint();
        return;
      }

      /* 选边框 / 贴纸 */
      const pendantBtn = target.closest<HTMLElement>('[data-pendant]');
      if (pendantBtn) {
        const id = pendantBtn.dataset.pendant ?? '';
        const type = pendantBtn.dataset.pendantType;
        if (type === 'frame' && avatarTab === 'frame') {
          void apply((scheme) => {
            scheme.participants[subject].avatar.frameId = id;
          });
        } else if (tab === 'bubble') {
          toggleBubbleStickerHere(id);
        } else {
          toggleAvatarStickerHere(id);
        }
        return;
      }

      /* 气泡模版 */
      const bubbleBtn = target.closest<HTMLElement>('[data-bubble]');
      if (bubbleBtn?.dataset.bubble) {
        const preset = BUBBLE_PRESETS.find((item) => item.id === bubbleBtn.dataset.bubble);
        if (!preset) return;
        void apply((scheme) => {
          const bubble = scheme.participants[subject].bubble;
          bubble.templateId = preset.id;
          bubble.fill = preset.fill;
          bubble.border = preset.border;
          bubble.radius = preset.radius;
          bubble.shadow = preset.shadow;
        });
        return;
      }

      /* 自定义气泡（9-slice）。
         空字符串 = 回到圆角矩形，所以要判 `!== undefined` 而不是真值。 */
      const shapeBtn = target.closest<HTMLElement>('[data-shape]');
      if (shapeBtn && shapeBtn.dataset.shape !== undefined) {
        const id = shapeBtn.dataset.shape;
        if (!id) {
          void apply((scheme) => {
            scheme.participants[subject].bubble.bubbleShape = {
              ...NO_SHAPE,
              slice: [...NO_SHAPE.slice] as BubbleShape['slice'],
              width: [...NO_SHAPE.width] as BubbleShape['width'],
            };
          });
          return;
        }
        const asset = beautyData().customAssets.find((item) => item.id === id && item.type === 'bubble');
        if (!asset) return;
        const s = asset.bubbleShape;
        void apply((scheme) => {
          scheme.participants[subject].bubble.bubbleShape = {
            shapeId: asset.id,
            slice: s ? ([...s.slice] as BubbleShape['slice']) : [12, 16, 12, 16],
            width: s ? ([...s.width] as BubbleShape['width']) : [10, 12, 10, 12],
            fillMode: s?.fillMode ?? 'stretch',
            ...(s?.ink ? { ink: s.ink } : {}),
          };
        });
        return;
      }

      const delCustomBubbleBtn = target.closest<HTMLElement>('[data-delete-custom-bubble]');
      if (delCustomBubbleBtn?.dataset.deleteCustomBubble) {
        const id = delCustomBubbleBtn.dataset.deleteCustomBubble;
        void (async () => {
          await removeCustomAsset(id);
          message = '已删除自定义气泡';
          paint();
          config.onChange();
        })();
        return;
      }

      if (target.closest('[data-flip-bubble]')) {
        const shape = activeScheme().participants[subject].bubble.bubbleShape;
        if (!shape?.shapeId) return;
        void (async () => {
          await ensureFlippedBubbleAsset(shape.shapeId);
          await apply((scheme) => {
            const cur = scheme.participants[subject].bubble.bubbleShape;
            if (!cur?.shapeId) return;
            const nextFlipped = !cur.flipped;
            const [st, sr, sb, sl] = cur.slice;
            const [wt, wr, wb, wl] = cur.width;
            cur.slice = [st, sl, sb, sr];
            cur.width = [wt, wl, wb, wr];
            if (nextFlipped) cur.flipped = true;
            else delete cur.flipped;
          });
        })();
        return;
      }

      if (target.closest('[data-import-custom-bubble]')) {
        void (async () => {
          const cropped = await pickCustomBubble();
          if (!cropped) return;
          try {
            const id = await importCustomBubble(cropped.dataUrl, cropped.bubbleShape, cropped.name);
            await apply((scheme) => {
              scheme.participants[subject].bubble.bubbleShape = {
                shapeId: id,
                slice: [...cropped.bubbleShape.slice] as BubbleShape['slice'],
                width: [...cropped.bubbleShape.width] as BubbleShape['width'],
                fillMode: cropped.bubbleShape.fillMode,
                ...(cropped.bubbleShape.ink ? { ink: cropped.bubbleShape.ink } : {}),
              };
            });
            message = `已导入「${cropped.name}」并应用`;
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
        })();
        return;
      }

      /* 贴纸微调 */
      const pickAvatar = target.closest<HTMLElement>('[data-pick-avatar-sticker]');
      if (pickAvatar?.dataset.pickAvatarSticker) {
        selectedAvatarSticker = pickAvatar.dataset.pickAvatarSticker;
        paint();
        return;
      }
      const pickBubble = target.closest<HTMLElement>('[data-pick-bubble-sticker]');
      if (pickBubble?.dataset.pickBubbleSticker) {
        selectedBubbleSticker = pickBubble.dataset.pickBubbleSticker;
        paint();
        return;
      }

      const cornerBtn = target.closest<HTMLElement>('[data-bubble-corner]');
      if (cornerBtn?.dataset.bubbleCorner) {
        const corner = cornerBtn.dataset.bubbleCorner as StickerCorner;
        void apply((scheme) => {
          const item = pickSticker(scheme.participants[subject].bubble.stickers, selectedBubbleSticker);
          if (item) item.corner = corner;
        });
        return;
      }

      if (target.closest('[data-remove-avatar-sticker]')) {
        void apply((scheme) => {
          const avatar = scheme.participants[subject].avatar;
          avatar.stickers = avatar.stickers.filter((item) => item.assetId !== pickId(avatar.stickers, selectedAvatarSticker));
        });
        selectedAvatarSticker = '';
        return;
      }

      if (target.closest('[data-remove-bubble-sticker]')) {
        void apply((scheme) => {
          const bubble = scheme.participants[subject].bubble;
          bubble.stickers = bubble.stickers.filter((item) => item.assetId !== pickId(bubble.stickers, selectedBubbleSticker));
        });
        selectedBubbleSticker = '';
        return;
      }

      if (target.closest('[data-clear-frame]')) {
        void apply((scheme) => {
          scheme.participants[subject].avatar.frameId = '';
        });
        return;
      }

      if (target.closest('[data-clear-bg]')) {
        void apply((scheme) => {
          scheme.background.assetId = '';
        });
        return;
      }

      /* 导入 */
      if (target.closest('[data-import-avatar]')) {
        void (async () => {
          const photo = await pickPhoto();
          if (!photo) return;
          try {
            const id = await importAssetFromDataUrl(photo.dataUrl, avatarTab === 'frame' ? 'frame' : 'sticker');
            await apply((scheme) => {
              const avatar = scheme.participants[subject].avatar;
              if (avatarTab === 'frame') avatar.frameId = id;
              else
                avatar.stickers.push({
                  assetId: id,
                  x: 48,
                  y: -48,
                  scale: 1,
                  rotation: 0,
                  zIndex: avatar.stickers.length + 1,
                  corner: 'top-right',
                });
            });
            selectedAvatarSticker = id;
            message = '图片已导入并应用，可调节大小和位置';
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
        })();
        return;
      }
      if (target.closest('[data-import-bubble]')) {
        void (async () => {
          const photo = await pickPhoto();
          if (!photo) return;
          try {
            const id = await importAssetFromDataUrl(photo.dataUrl, 'sticker');
            await apply((scheme) => {
              const stickers = scheme.participants[subject].bubble.stickers;
              stickers.push({
                assetId: id,
                corner: 'top-right',
                x: 0,
                y: 0,
                scale: 1,
                rotation: 0,
                zIndex: stickers.length + 1,
              });
            });
            selectedBubbleSticker = id;
            message = '图片已导入并应用，可调节大小和位置';
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
        })();
        return;
      }
      if (target.closest('[data-import-bg]')) {
        void (async () => {
          const photo = await pickPhoto();
          if (!photo) return;
          try {
            const id = await importAssetFromDataUrl(photo.dataUrl, 'background');
            await apply((scheme) => {
              scheme.background.assetId = id;
            });
            message = '聊天背景已应用';
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
        })();
        return;
      }

      /* 方案 */
      const schemeBtn = target.closest<HTMLElement>('[data-scheme]');
      if (schemeBtn?.dataset.scheme) {
        void (async () => {
          await selectScheme(schemeBtn.dataset.scheme!);
          paint();
          config.onChange();
        })();
        return;
      }
      if (target.closest('[data-scheme-add]')) {
        editingScheme = true;
        renamingScheme = false;
        schemeName = '';
        paint();
        return;
      }
      if (target.closest('[data-scheme-rename]')) {
        renamingScheme = true;
        editingScheme = false;
        schemeName = activeScheme().name;
        paint();
        return;
      }
      if (target.closest('[data-scheme-save]')) {
        const input = root.querySelector<HTMLInputElement>('#bp-scheme-name');
        const name = input?.value ?? '';
        void (async () => {
          try {
            if (renamingScheme) await renameScheme(activeScheme().id, name);
            else await saveScheme(name);
            message = renamingScheme ? '方案已重命名' : '方案已保存';
            editingScheme = false;
            renamingScheme = false;
            schemeName = '';
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
        })();
        return;
      }
      if (target.closest('[data-scheme-remove]')) {
        void (async () => {
          try {
            await removeScheme(activeScheme().id);
            message = '方案已删除';
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          paint();
          config.onChange();
        })();
        return;
      }

      /* 代码模式 */
      if (target.closest('[data-app-reset]')) {
        void (async () => {
          await resetAppAppearance();
          message = '聊天APP外观已恢复默认';
          config.onAppChange?.();
          paint();
        })();
        return;
      }

      if (target.closest('[data-code-save]')) {
        const area = root.querySelector<HTMLTextAreaElement>('#bp-custom-css');
        customDraft = area?.value ?? '';
        void (async () => {
          await apply((scheme) => {
            scheme.customCss = { source: customDraft, enabled: !!customDraft.trim() };
          });
          message = '代码已保存';
          paint();
        })();
        return;
      }
      if (target.closest('[data-code-restore]')) {
        customDraft = activeScheme().customCss.source;
        message = '已恢复为当前代码';
        paint();
        return;
      }
    });

    /** 头像贴纸开关：点一下加、再点一下删。每处最多 8 张 */
    function toggleAvatarStickerHere(id: string): void {
      const list = activeScheme().participants[subject].avatar.stickers;
      if (!list.some((item) => item.assetId === id) && list.length >= 8) {
        messageSetter('每处最多添加 8 张贴纸，请先删除一张。');
        return;
      }
      void apply((scheme) => {
        const stickers = scheme.participants[subject].avatar.stickers;
        const index = stickers.findIndex((item) => item.assetId === id);
        if (index >= 0) stickers.splice(index, 1);
        else
          stickers.push({
            assetId: id,
            x: 48,
            y: -48,
            scale: 1,
            rotation: 0,
            zIndex: stickers.length + 1,
            corner: 'top-right',
          });
      });
      selectedAvatarSticker = id;
    }

    /** 气泡贴纸开关 */
    function toggleBubbleStickerHere(id: string): void {
      const list = activeScheme().participants[subject].bubble.stickers;
      if (!list.some((item) => item.assetId === id) && list.length >= 8) {
        messageSetter('每处最多添加 8 张贴纸，请先删除一张。');
        return;
      }
      void apply((scheme) => {
        const stickers = scheme.participants[subject].bubble.stickers;
        const index = stickers.findIndex((item) => item.assetId === id);
        if (index >= 0) stickers.splice(index, 1);
        else
          stickers.push({
            assetId: id,
            corner: 'top-right',
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            zIndex: stickers.length + 1,
          });
      });
      selectedBubbleSticker = id;
    }

    /** 让导入函数能改 message 并重画 */
    const messageSetter = (text: string): void => {
      message = text;
      paint();
    };

    root.querySelector('#bp-reset')?.addEventListener('click', () => {
      void (async () => {
        await resetActive();
        message = '当前方案已恢复默认';
        paint();
        config.onChange();
      })();
    });

    /* 滑杆：input 事件边走边改，但只在 pointerup / change 时落库 ——
       否则拖一次滑杆会写几十遍库 */
    root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;

      // 聊天APP 全局颜色：实时改，但不落库（拖动取色器会连发几十次）
      const appKey = input.dataset.appColor;
      if (appKey) {
        sheet.style.setProperty(`--beauty-app-${appKey}`, input.value);
        config.onAppChange?.();
        return;
      }

      const colorPath = input.dataset.color;
      if (colorPath) {
        applyPath(colorPath, input.value);
        return;
      }

      const rangePath = input.dataset.range;
      if (rangePath) {
        const raw = Number(input.value);
        const value = rangePath.endsWith('opacity') || rangePath === 'background.overlay' ? raw / 100 : raw;
        const out = input.parentElement?.querySelector<HTMLOutputElement>('.beauty-field__out');
        if (out) {
          out.textContent = rangePath.includes('opacity') || rangePath === 'background.overlay'
            ? `${raw}%`
            : rangePath.endsWith('Angle') || rangePath.endsWith('rotation')
              ? `${raw}°`
              : rangePath.endsWith('Width')
                ? `${raw}px`
                : rangePath === 'font.size'
                  ? `${raw}px`
                  : String(raw);
        }
        applyPath(rangePath, value, true);
      }
    });

    // 松手才落库
    root.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.range) {
        const raw = Number(input.value);
        const path = input.dataset.range;
        const value = path.endsWith('opacity') || path === 'background.overlay' ? raw / 100 : raw;
        applyPath(path, value);
        return;
      }
      // 松手才落库
      const appKey = input.dataset.appColor;
      if (appKey) {
        void (async () => {
          await setAppAppearance({ [appKey]: input.value } as Partial<AppAppearance>);
          config.onAppChange?.();
          paint();
        })();
        return;
      }

      const switchName = input.dataset.switch;
      if (switchName === 'gradient') {
        void apply((scheme) => {
          scheme.participants[subject].bubble.gradientColor = input.checked ? '#FFFFFF' : '';
        });
      }
    });

    /** 把点分路径写到当前方案的对应字段 */
    const applyPath = (path: string, value: string | number, previewOnly = false): void => {
      const write = (scheme: BeautyScheme): void => {
        const participant = scheme.participants[subject];
        switch (path) {
          case 'bubble.opacity':
            participant.bubble.opacity = Number(value);
            break;
          case 'bubble.fill':
            participant.bubble.fill = String(value).toUpperCase();
            break;
          case 'bubble.gradientColor':
            participant.bubble.gradientColor = String(value).toUpperCase();
            break;
          case 'bubble.gradientAngle':
            participant.bubble.gradientAngle = Number(value);
            break;
          case 'bubble.radius':
            participant.bubble.radius = Number(value);
            break;
          case 'bubble.border':
            participant.bubble.border = String(value).toUpperCase();
            break;
          case 'bubble.borderWidth':
            participant.bubble.borderWidth = Number(value);
            break;
          case 'bubble.shadow':
            participant.bubble.shadow = Number(value);
            break;
          case 'avatarSticker.x':
          case 'avatarSticker.y':
          case 'avatarSticker.scale':
          case 'avatarSticker.rotation': {
            const key = path.split('.')[1] as 'x' | 'y' | 'scale' | 'rotation';
            const item = pickSticker(participant.avatar.stickers, selectedAvatarSticker);
            if (item) item[key] = Number(value);
            break;
          }
          case 'bubbleSticker.x':
          case 'bubbleSticker.y':
          case 'bubbleSticker.scale':
          case 'bubbleSticker.rotation': {
            const key = path.split('.')[1] as 'x' | 'y' | 'scale' | 'rotation';
            const item = pickSticker(participant.bubble.stickers, selectedBubbleSticker);
            if (item) item[key] = Number(value);
            break;
          }
          case 'background.color':
            scheme.background.color = String(value).toUpperCase();
            break;
          case 'background.blur':
            scheme.background.blur = Number(value);
            break;
          case 'background.overlay':
            scheme.background.overlay = Number(value);
            break;
          case 'font.size':
            scheme.font.size = Number(value);
            break;
          case 'font.color':
            scheme.font.color = String(value).toUpperCase();
            break;
          default: {
            if (path.startsWith('app.')) {
              const key = path.slice(4) as keyof BeautyScheme['app'];
              scheme.app[key] = String(value).toUpperCase();
            }
          }
        }
      };

      if (previewOnly) {
        // 拖动中只改内存，不写库；视觉上通过重画预览体现
        const scheme = structuredClone(activeScheme());
        write(scheme);
        const bubbleRow = root.querySelector<HTMLElement>('.beauty-prev__row--me .beauty-prev__bubble');
        if (bubbleRow && scheme.participants.user) {
          bubbleRow.setAttribute('style', previewBubbleStyle(scheme, 'user', assetUrl));
        }
        const theirRow = root.querySelector<HTMLElement>('.beauty-prev__row:not(.beauty-prev__row--me) .beauty-prev__bubble');
        if (theirRow) theirRow.setAttribute('style', previewBubbleStyle(scheme, 'wuli', assetUrl));
        if (path.startsWith('app.')) {
          sheet.style.setProperty('--beauty-panel-ink', scheme.app.ink);
        }
        config.onChange();
        return;
      }

      void apply(write);
    };

    const finish = (): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      window.setTimeout(() => {
        root.remove();
        resolve();
      }, 220);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish();
    };

    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    paint();
    requestAnimationFrame(() => root.classList.add('is-open'));

    /** 贴纸操作：先找选中的，没有再退到最后一张 —— 和原项目一致 */
    function pickSticker(list: Sticker[], id: string): Sticker | undefined {
      return list.find((item) => item.assetId === id) ?? list.at(-1);
    }
    function pickId(list: Sticker[], id: string): string {
      return pickSticker(list, id)?.assetId ?? '';
    }
  });
}
