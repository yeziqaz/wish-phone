import {
  deleteMessage,
  getCharacter,
  getWorld,
  getWorldbooks,
  listConversations,
  listMessages,
  newId,
  putConversation,
  putMessage,
} from '../../../core/db';
import { collectLore, renderLore } from '../../../core/lore';
import type { Character, Conversation, Message } from '../../../core/types';
import { esc, must } from '../../../core/dom';
import { navigate } from '../../../core/router';
import { avatarHTML } from '../../../ui/avatar';
import { line } from '../../../ui/icons';
import {
  callText,
  getProfile,
  assign,
  SetupError as AiSetupError,
} from '../../../ai/call';
import { openModelPicker } from '../../../settings/api/model-picker';
import { parseCharacterAction } from './action';
import { shouldShowTime, sleep } from './time';
import { watchViewport } from './viewport';
import { installLongPress } from './long-press';
import { drawImage, speakLast, type MediaDeps } from './media';
import {
  actionNoteHTML,
  bubbleRowHTML,
  timeHTML,
} from './bubbles';
import { splitIntoBubbles, splitOptionsFor } from './split';
import { openChatSettings } from './settings';
import { openRoomMenu } from './room-menu';
import { syncThemeColorFromTop } from '../../../ui/theme-color';
import { avatarDecorOf } from '../beauty/render';
import { beautyVariables } from '../beauty/css';
import { activeScheme, adoptLegacyFrame, loadAssets, loadBeauty } from '../beauty/store';
import { openBeautyPanel } from '../beauty/editor/panel';
import { actionNoteVisible, displayUserName, userAvatarFrame } from '../../../core/prefs';
import { fillPlaceholders } from '../../../core/placeholders';
import { ApiError } from '../../../ai/errors';
import './room.css';
import '../beauty/beauty.css';

/* ==========================================================================
   聊天（微信 + QQ 结合体）

   设计亮点：
     - 顶部：返回 + 居中角色名 + 下方在线状态点/世界标签 + 右侧「···」直达角色档案
     - 气泡：微信/QQ 左右分立排布，圆角微尖角尾巴，用户反色、AI 白底描边
     - 交互：点击气泡弹出快捷操作条（复制、重新生成、删除）
     - 底部：自动伸缩输入框、发送按钮、QQ 风格「+」扩展面板（重新生成、清除消息等）
   ========================================================================== */

const HISTORY_LIMIT = 20;
/* 屏幕上最多同时画多少条消息。
   以前是「有多少画多少」：一个聊了半年的会话，一进聊天室就把几千个气泡
   全塞进 DOM，手机上要卡一两秒，往下滑也发涩。
   只画最后 60 条，往上看再点「看更早的」继续放 —— 60 条已经够划三四屏了。 */
const RENDER_LIMIT = 60;
/* 两条气泡之间的停顿：真人在微信上连发，中间大约就是这个节奏。
   太短像机器一次性吐出来，太长会让人等得烦。 */
const BUBBLE_GAP_MS = 260;

const TYPING_INTERVAL = 20;
const TYPING_FRAMES = 90;

/** 配置缺失 / 协议不支持时用它，界面上会带一个「去设置」按钮 */
// 统一入口抛出的 SetupError（还没配置）在这里翻译成界面提示，
// 其余 Error 走 ApiError 的人话，再不行原样说
function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.info.title} —— ${error.info.detail}`;
  if (error instanceof AiSetupError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * 聊天风格规则 —— 分两层。
 *
 * 第一层【说话方式】：**所有角色通用**。这是「在手机上聊天」这件事本身的规矩，
 *   和角色是助手还是恋人无关。用户 2026-11-10 指定要写进来。
 *
 * 第二层：按角色定位分开 ——
 *   内置的 wuli 是「管家」，负责处理具体事情：写代码、改界面、做角色卡。
 *   这种活儿需要完整地说清楚，硬拆成 8 个短气泡反而难用。
 *   其他角色是「角色扮演」，要有真人连发消息的节奏感。
 *
 * 这些规则写在代码里，不写进世界书：
 *   世界书是用户数据，用户能改能删；这段规则是产品设定，不该让人动。
 *   而且它只服务聊天这一屏，放代码里最直接。
 */
function chatStyleRules(character: Character): string[] {
  // ---- 第一层：通用说话方式 ----
  const common = [
    '【说话方式】口语化，像给很熟的朋友发消息，不是在写文章或回复工单。'
      + '以短句为主，不必每次都说完整的句子。',

    '【标点】很少用句号。可以用「~」「！」「……」或者干脆不加标点。'
      + '偶尔可以用颜文字，但别每句话都带。',

    '【不许客服腔】绝对不要说「您好」「有什么可以帮您」「希望对您有帮助」'
      + '「如果还有其他问题」「很高兴为您服务」这类话。也不要自称「我这边」。',

    '【不许解释癖】不要每句话后面都跟一段解释，不要替自己的话做总结，'
      + '不要在结尾重新复述一遍刚才说过的内容。说完就说完。',
  ];

  // ---- 第二层：按角色定位 ----
  if (character.builtin) {
    return [
      ...common,
      '【表达方式】你是助手，和其他角色扮演的 AI 不同：对方要你做事（写代码、改设计、做角色卡、查东西）时，把事讲清楚讲完整。可以分行，但一句话不要被切断。',
      '【正经的时候】真正在解决问题时，条理清晰、认真专业，把事情讲明白。做完之后再回到平时的语气，不用一直端着。',
      '【代码与命令】代码、命令、表格必须完整地放在一对 ``` 围栏里，整块贴出来。绝不要把这些内容拆到多条消息里，也不要只贴一半。',
      '【闲聊时】如果只是普通聊天，就像正常人一样回一两句，可以分行，也可以不分。',
    ];
  }

  return [
    ...common,
    '【分条】一次回复拆成 2~8 条短消息，每条之间用换行隔开。每条只讲一件事，不要超过 60 个字。像在手机上连发几条消息那样，别一次说一大段。',
    '【代码与命令】万一需要贴代码、命令或表格，完整地放进一对 ``` 围栏里，整块给出，不要拆开。',
  ];
}

/**
 * 拆分尺子按角色定位给。
 *
 * 角色扮演的角色：一条一口气，60 字，最多 8 条 —— 像真人连发。
 * wuli（助手）：单条放宽到 120 字，最多 6 条 —— 它常要把步骤说完整，
 *   60 字会把「第一步：打开设置」这种话和下一句硬粘在一起。
 *
 * 代码块在两种情况下都整块保留（见 chat-split.ts 的 PASSTHROUGH_PATTERNS）。
 */
function buildSystem(character: Character, worldDescription: string, lore: string): string {
  const blocks = [
    `你正在扮演「${character.name}」。`,
    character.description.trim() ? `【人设】\n${character.description}` : '',
    character.personality.trim() ? `【性格】\n${character.personality}` : '',
    character.scenario.trim() ? `【场景】\n${character.scenario}` : '',
    character.relationToUser?.trim() ? `【和对方的关系】${character.relationToUser}` : '',
    character.systemPrompt.trim() ? `【额外设定】\n${character.systemPrompt}` : '',
    worldDescription.trim() ? `【世界】\n${worldDescription}` : '',
    // 世界书：常驻的全进，关键词命中的才进
    lore,
    character.mesExample.trim() ? `【说话示范】\n${character.mesExample}` : '',
    // 线上聊天不要把动作塞进句子里 —— 动作统一写在最前面的圆括号里，
    // 界面会把它剥出来单独放，气泡里只留说出口的话。
    '【动作描写】需要动作、神态、环境时，写在整条回复的最前面，用一对圆括号包住，例如「（我把杯子放下，抬眼看你）」。不要写在句子中间，也不要用星号。',
    // 分条规则按角色定位分开（见下方 CHAT_STYLE）：
    // 角色扮演的写短、连发；管家处理问题时一个长气泡说清楚。
    ...chatStyleRules(character),
    '【规则】用第一人称，保持角色口吻和情绪；不要替对方说话；不要解释自己是 AI；语气自然，别长篇大论。',
  ];
  const userName = displayUserName();
  const charName = character.name || '角色';
  return fillPlaceholders(blocks.filter(Boolean).join('\n\n'), userName, charName);
}

function greetingOf(character: Character): string {
  return character.firstMes.trim() || character.alternateGreetings.find((text) => text.trim())?.trim() || '';
}

export async function mountChat(root: HTMLElement, characterId: string): Promise<(() => void) | void> {
  const character = await getCharacter(characterId);
  if (!character) {
    root.innerHTML = `
      <div class="page">
        <header class="topbar">
          <button class="topbar__back jelly" type="button" data-go="/chat" aria-label="返回">${line('back', 22)}</button>
          <h1 class="topbar__title">找不到</h1>
        </header>
        <p class="field__note">这个角色已经不在了，可能刚被删掉。</p>
      </div>`;
    return;
  }

  const world = character.worldId ? await getWorld(character.worldId) : undefined;
  const books =
    character.worldbookIds && character.worldbookIds.length > 0
      ? await getWorldbooks(character.worldbookIds)
      : [];

  const systemFor = (scanText: string): string =>
    buildSystem(
      character,
      world?.description ?? '',
      renderLore(collectLore(books, scanText)),
    );

  /* ---------- 会话：一版一个角色一条 ---------- */
  const conversations = await listConversations(character.id);
  let conversation: Conversation = conversations[0] ?? {
    id: newId(),
    characterId: character.id,
    title: character.name || '未命名',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userName: '我',
    metadata: {},
  };

  if (!conversations[0]) {
    await putConversation(conversation);
    const greeting = greetingOf(character);
    if (greeting) {
      await putMessage({
        id: newId(),
        conversationId: conversation.id,
        role: 'assistant',
        content: greeting,
        createdAt: new Date().toISOString(),
      });
    }
  }

  let messages = await listMessages(conversation.id);

  // 状态小文本：优先展示关系或场景，否则展示世界名或「手机在线」
  const statusText = character.relationToUser?.trim() || world?.name || '手机在线';

  root.innerHTML = `
    <div class="chat-page">
      <header class="chat-top">
        <div class="chat-top__left">
          <button class="topbar__back jelly" type="button" data-go="/chat" aria-label="返回">${line('back', 22)}</button>
        </div>
        <div class="chat-top__center">
          <h1 class="chat-top__name">${esc(character.name || '未命名')}</h1>
          <span class="chat-top__status"><span class="chat-top__dot"></span>${esc(statusText)}</span>
        </div>
        <div class="chat-top__right">
          <button class="topbar__action jelly" type="button" id="chat-more" aria-label="更多">
            ${line('more', 20)}
          </button>
        </div>
      </header>

      <main class="chat-list" id="chat-list"></main>

      <footer class="chat-bottom">
        <div class="chat-quote-bar" id="chat-quote-bar" hidden>
          <div class="chat-quote-bar__body">
            <span class="chat-quote-bar__label" id="chat-quote-label"></span>
            <span class="chat-quote-bar__text" id="chat-quote-text"></span>
          </div>
          <button class="chat-quote-bar__close" type="button" id="chat-quote-close" aria-label="取消引用">×</button>
        </div>

        <div class="chat-compose">
          <button class="chat-icon-btn jelly" type="button" id="chat-plus" aria-label="扩展菜单">
            ${line('plus', 22)}
          </button>
          <textarea class="chat-input" id="chat-text" rows="1" placeholder="发送消息…" spellcheck="false"></textarea>
          <button class="chat-send jelly" type="button" id="chat-send" aria-label="发送">
            ${line('send', 20)}
          </button>
        </div>

        <div class="chat-multi-bar" id="chat-multi-bar" hidden>
          <span class="chat-multi-bar__count" id="chat-multi-count">已选 0 条</span>
          <div class="chat-multi-bar__actions">
            <button class="chat-multi-btn" type="button" id="multi-copy">复制</button>
            <button class="chat-multi-btn" type="button" id="multi-fav">收藏</button>
            <button class="chat-multi-btn is-danger" type="button" id="multi-del">删除</button>
            <button class="chat-multi-btn" type="button" id="multi-cancel">取消</button>
          </div>
        </div>

        <div class="chat-drawer" id="chat-drawer" hidden>
          <div class="chat-drawer-swiper">
            <div class="chat-drawer-page">
              <button class="drawer-item" type="button" id="drawer-retry">
                <span class="drawer-item__icon">${line('refresh', 22)}</span>
                <span class="drawer-item__label">重新回答</span>
              </button>
              <button class="drawer-item" type="button" data-go="/character/${esc(character.id)}?back=%2Fchat%2F${esc(character.id)}">
                <span class="drawer-item__icon">${line('pencil', 20)}</span>
                <span class="drawer-item__label">角色设定</span>
              </button>
              <button class="drawer-item" type="button" id="drawer-image">
                <span class="drawer-item__icon">${line('image', 20)}</span>
                <span class="drawer-item__label">画一张</span>
              </button>
              <button class="drawer-item" type="button" id="drawer-speak">
                <span class="drawer-item__icon">${line('mic', 20)}</span>
                <span class="drawer-item__label">读出来</span>
              </button>
              <button class="drawer-item" type="button" id="drawer-model">
                <span class="drawer-item__icon">${line('provider', 20)}</span>
                <span class="drawer-item__label" id="drawer-model-label">换模型</span>
              </button>
              <button class="drawer-item" type="button" data-go="/settings/lore">
                <span class="drawer-item__icon">${line('book', 20)}</span>
                <span class="drawer-item__label">世界书</span>
              </button>
              <button class="drawer-item" type="button" id="drawer-settings">
                <span class="drawer-item__icon">${line('sparkle', 20)}</span>
                <span class="drawer-item__label">聊天设置</span>
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>`;

  const list = must<HTMLElement>(root, '#chat-list');
  const chatPage = must<HTMLElement>(root, '.chat-page');

  /**
   * 聊天美化的变量挂在这里。
   *
   * 挂容器、一次 setProperty，不重画消息列表 ——
   * 一条会话几百条消息，逐个改内联样式太重。
   *
   * 以前这里还有一套独立的气泡档位（圆角/宽度/边框/间距四档），
   * 和美化里的气泡设置**改的是同一个东西**，两套并存必然打架。
   * 现在只留美化这一套（它的圆角/边框/阴影/透明度控制得更细）。
   */
  const applyBeauty = (): void => {
    const vars = beautyVariables(activeScheme());
    for (const [key, value] of Object.entries(vars)) {
      chatPage.style.setProperty(key, value);
    }
    /**
     * 自定义 CSS：写进一个 <style>，但每条选择器都加 `.chat-page` 前缀，
     * 保证它只在聊天页里生效，不会污染桌面、设置、角色页。
     *
     * 为什么在这里做前缀而不是直接插入原始文本：
     *   用户可能写 `.msg-bubble { ... }`，直接插进去是全局生效的。
     *   加前缀是最省事又最不容易出错的作用域隔离。
     */
    const custom = activeScheme().customCss;
    const styleId = 'chat-custom-css';
    let styleTag = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }
    if (custom.enabled && custom.source.trim()) {
      styleTag.textContent = scopeCss(custom.source, '.chat-page');
    } else {
      styleTag.textContent = '';
    }
    // 顶栏颜色可能刚被换掉，顶部状态栏那条跟着重算
    requestAnimationFrame(() => syncThemeColorFromTop());
  };
  void (async () => {
    // 读这个角色自己的那套配置（没有就用默认）
    await loadBeauty(character.id);
    await loadAssets();
    // 老版本把头头像框存在 prefs 里，搬一次过来
    if (await adoptLegacyFrame(userAvatarFrame())) {
      // 迁移只在第一次发生
    }
    applyBeauty();
  })();
  const input = must<HTMLTextAreaElement>(root, '#chat-text');
  const sendButton = must<HTMLButtonElement>(root, '#chat-send');
  const plusButton = must<HTMLButtonElement>(root, '#chat-plus');
  const drawer = must<HTMLElement>(root, '#chat-drawer');
  const retryBtn = must<HTMLButtonElement>(root, '#drawer-retry');
  const imageBtn = must<HTMLButtonElement>(root, '#drawer-image');
  const speakBtn = must<HTMLButtonElement>(root, '#drawer-speak');
  const modelBtn = must<HTMLButtonElement>(root, '#drawer-model');
  const modelLabel = must<HTMLElement>(root, '#drawer-model-label');
  const chatSettingsBtn = must<HTMLButtonElement>(root, '#drawer-settings');
  const moreBtn = must<HTMLButtonElement>(root, '#chat-more');
  const quoteBar = must<HTMLElement>(root, '#chat-quote-bar');
  const quoteLabel = must<HTMLElement>(root, '#chat-quote-label');
  const quoteText = must<HTMLElement>(root, '#chat-quote-text');
  const quoteClose = must<HTMLButtonElement>(root, '#chat-quote-close');
  const multiBar = must<HTMLElement>(root, '#chat-multi-bar');
  const multiCount = must<HTMLElement>(root, '#chat-multi-count');
  const multiCopy = must<HTMLButtonElement>(root, '#multi-copy');
  const multiFav = must<HTMLButtonElement>(root, '#multi-fav');
  const multiDel = must<HTMLButtonElement>(root, '#multi-del');
  const multiCancel = must<HTMLButtonElement>(root, '#multi-cancel');

  let busy = false;
  let pendingQuote: Message | null = null;
  let multiMode = false;
  const selectedIds = new Set<string>();

  const clearQuote = (): void => {
    pendingQuote = null;
    quoteBar.hidden = true;
    quoteLabel.textContent = '';
    quoteText.textContent = '';
  };

  const setQuote = (msg: Message): void => {
    pendingQuote = msg;
    const sender = msg.role === 'user' ? displayUserName() : character.name || '未命名';
    quoteLabel.textContent = `引用 ${sender}`;
    quoteText.textContent = msg.content.replace(/\s+/g, ' ').slice(0, 80);
    quoteBar.hidden = false;
    input.focus();
  };

  const updateMultiUI = (): void => {
    multiCount.textContent = `已选 ${selectedIds.size} 条`;
    const empty = selectedIds.size === 0;
    multiCopy.disabled = empty;
    multiFav.disabled = empty;
    multiDel.disabled = empty;
  };

  const exitMultiMode = (): void => {
    multiMode = false;
    selectedIds.clear();
    chatPage.classList.remove('is-multi');
    multiBar.hidden = true;
    list.querySelectorAll('.msg-row.is-multi-selected').forEach((el) => {
      el.classList.remove('is-multi-selected');
    });
    updateMultiUI();
  };

  const enterMultiMode = (initialId?: string): void => {
    multiMode = true;
    selectedIds.clear();
    drawer.hidden = true;
    chatPage.classList.add('is-multi');
    multiBar.hidden = false;
    list.querySelectorAll('.msg-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
    if (initialId) {
      selectedIds.add(initialId);
      const row = list.querySelector<HTMLElement>(`.msg-row[data-msg-id="${CSS.escape(initialId)}"]`);
      row?.classList.add('is-multi-selected');
    }
    updateMultiUI();
  };

  quoteClose.addEventListener('click', clearQuote);
  multiCancel.addEventListener('click', exitMultiMode);

  multiCopy.addEventListener('click', () => {
    const picked = messages.filter((m) => selectedIds.has(m.id));
    if (picked.length === 0) return;
    const text = picked.map((m) => m.content).join('\n\n');
    void navigator.clipboard?.writeText(text);
    exitMultiMode();
  });

  multiFav.addEventListener('click', () => {
    void (async () => {
      const now = new Date().toISOString();
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || !selectedIds.has(m.id)) continue;
        const updated: Message = {
          ...m,
          extra: { ...(m.extra ?? {}), favorited: true, favoritedAt: now },
        };
        await putMessage(updated);
        messages[i] = updated;
        const row = list.querySelector<HTMLElement>(`.msg-row[data-msg-id="${CSS.escape(m.id)}"]`);
        const favBtn = row?.querySelector<HTMLElement>('[data-act="fav"]');
        if (favBtn) favBtn.textContent = '已收藏';
      }
      exitMultiMode();
    })();
  });

  multiDel.addEventListener('click', () => {
    void (async () => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await deleteMessage(id);
      }
      messages = messages.filter((m) => !selectedIds.has(m.id));
      exitMultiMode();
      renderAllMessages();
    })();
  });

  const scrollToBottom = (): void => {
    list.scrollTop = list.scrollHeight;
  };

  /* ---------- 视口与软键盘自适应 ----------

     Android 上键盘弹起时浏览器有三种表现，**必须都吃得下**：
       1) 缩小布局视口（interactive-widget=resizes-content）
       2) 只缩「视觉视口」，布局视口不动
       3) 只把键盘盖上来，什么都不通知 —— 目前遇到的就是这种

     做法：整页钉成 fixed，高度取「所有能问到的可见高度里最小的那个」，
     再按 offsetTop 对齐。取最小值是因为这几个值谁先变不一定：
     只要有一个变小了，我们就跟上；三个都不变，才真的没信号。 */
  /**
   * 视口 / 软键盘自适应全部在 room/viewport.ts。
   *
   * 那里面有三种浏览器行为的完整说明 —— 这块的坑太多，
   * 不适合混在聊天逻辑里，单独一个文件才改得动。
   */
  const viewport = watchViewport({
    page: chatPage,
    input,
    drawer,
    onSettled: scrollToBottom,
  });

  /* ---------- 气泡 ----------

     角色的动作 / 心理描写默认藏起来，气泡旁边只留一枚小圆钮，点开才展开。

     为什么不直接放进气泡：气泡是「对方说出口的话」，动作是旁白。
     两者混在一起，就把线上聊天演成了剧本。

     为什么不做成气泡上方一整条：一段回复常拆成 3~4 个气泡，
     每条都顶一条动作，消息流会被撑得很碎。 */

  /* 当前画了多少条（从末尾往前算）。点「看更早的」会往上加。 */
  let renderCount = RENDER_LIMIT;
  const renderAllMessages = (keepPosition = false): void => {
    /* 记住「离底部有多远」。往上看历史时如果直接重画，画面会跳回顶部，
       用户刚看的那一句就没了。重画完按同样的距离还原，视觉上几乎不动。 */
    const fromBottom = list.scrollHeight - list.scrollTop;
    list.innerHTML = '';
    if (messages.length === 0) {
      list.innerHTML = '<p class="chat-empty">还没有对话。<br>说点什么开始。</p>';
      return;
    }
    /* 只画最后 renderCount 条。更早的那些还在内存里（messages 是完整的），
       点「看更早的」就能放出来，所以不丢东西。 */
    const start = Math.max(0, messages.length - renderCount);
    const visible = messages.slice(start);
    const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant');
    const showActionNote = actionNoteVisible();
    if (start > 0) {
      list.insertAdjacentHTML(
        'beforeend',
        `<button class="chat-more" type="button" id="chat-more-early">看更早的 ${start} 条</button>`,
      );
    }
    visible.forEach((message, offset) => {
      const index = start + offset;
      // 第一条不需要跟「上一条」比 —— 它上面本来就没画东西
      if (offset > 0 && shouldShowTime(messages[index - 1], message)) {
        list.insertAdjacentHTML('beforeend', timeHTML(message.createdAt));
      }
      list.insertAdjacentHTML(
        'beforeend',
        bubbleRowHTML({
          message,
          character,
          isLastAssistant: index === lastAssistantIdx,
          showActionNote,
        }),
      );
    });
    if (keepPosition) list.scrollTop = list.scrollHeight - fromBottom;
    else scrollToBottom();
  };
  renderAllMessages();

  /* 「看更早的」：一次多放 60 条上去。
     用事件委托挂在列表上，因为按钮每次重画都是新的。 */
  list.addEventListener('click', (event) => {
    const more = (event.target as HTMLElement).closest<HTMLElement>('#chat-more-early');
    if (!more) return;
    renderCount += RENDER_LIMIT;
    renderAllMessages(true);
  });

  /* ---------- 配置解析 ---------- */
  // 步骤 6 起不再直接读老的 Provider / Bindings，一律走 ai/call.ts 的统一入口。
  // 它内部会按「角色 > App > 全局」解析分配，聊天只负责说「我是哪个角色」。
  const context = { appId: 'chat', roleId: character.id };

  /* ---------- 打字指示 ---------- */
  let typing: HTMLElement | null = null;

  const showTyping = (): void => {
    typing?.remove();
    typing = document.createElement('div');
    typing.className = 'msg-row msg-row--assistant';
    typing.innerHTML = `
      <div class="msg-avatar">${avatarHTML(character.name || '未命名', 36, character.avatarKey, character.avatarFrame, avatarDecorOf('wuli'))}</div>
      <div class="msg-content">
        <div class="chat-typing"><span></span><span></span><span></span></div>
      </div>`;
    list.appendChild(typing);
    scrollToBottom();
  };

  const hideTyping = (): void => {
    typing?.remove();
    typing = null;
  };

  const showError = (message: string, withSetupLink = false): void => {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-row msg-row--error';
    wrapper.innerHTML = `
      <div class="msg-content" style="max-width: 100%;">
        <div class="msg-bubble">
          ${esc(message)}
          ${withSetupLink ? '<button class="btn btn--sm chat-error__link" type="button" data-go="/settings/api?tab=assign">去设置模型</button>' : ''}
        </div>
      </div>`;
    list.appendChild(wrapper);
    scrollToBottom();
  };

  /* ---------- 逐字回放 ---------- */
  const playText = async (bubble: HTMLElement, text: string): Promise<void> => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduce) {
      bubble.textContent = text;
      scrollToBottom();
      return;
    }

    const step = Math.max(1, Math.ceil(text.length / TYPING_FRAMES));
    bubble.textContent = '';
    for (let index = step; index < text.length; index += step) {
      bubble.textContent = text.slice(0, index);
      scrollToBottom();
      await sleep(TYPING_INTERVAL);
    }
    bubble.textContent = text;
    scrollToBottom();
  };

  /* ---------- 调用 AI 生成并回显 ---------- */
  const requestAssistantResponse = async (): Promise<void> => {
    busy = true;
    sendButton.disabled = true;
    showTyping();

    try {
      const history = messages.slice(-HISTORY_LIMIT).map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const lastUserContent = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const scanContext = [...history.slice(-5).map((m) => m.content), lastUserContent].join('\n');
      const system = systemFor(scanContext);

      const result = await callText(
        { messages: [{ role: 'system', content: system }, ...history] },
        context,
      );

      hideTyping();

      const assistant: Message = {
        id: newId(),
        conversationId: conversation.id,
        role: 'assistant',
        content: result.text,
        createdAt: new Date().toISOString(),
      };
      messages.push(assistant);
      await putMessage(assistant);
      // 下面直接追加气泡、没走重画，所以已画条数要跟着 +1，否则「看更早的 N 条」会算错一条
      renderCount += 1;
      conversation.updatedAt = Date.now();
      await putConversation(conversation);

      const prev = messages[messages.length - 2];
      if (shouldShowTime(prev, assistant)) {
        list.insertAdjacentHTML('beforeend', timeHTML(assistant.createdAt));
      }
      // 动作永远剥离，气泡里只打「说出口的话」；开关打开时在气泡下方显示翻译样式的动作/心理。
      const streamed = parseCharacterAction(assistant.content);
      const streamedNote =
        actionNoteVisible() && streamed.actionText ? actionNoteHTML(streamed.actionText) : '';
      const streamedPieces = splitIntoBubbles(streamed.mainText, splitOptionsFor(character));
      list.insertAdjacentHTML(
        'beforeend',
        `
        <div class="msg-row msg-row--assistant" data-msg-id="${esc(assistant.id)}">
          <div class="msg-avatar">${avatarHTML(character.name || '未命名', 36, character.avatarKey, character.avatarFrame, avatarDecorOf('wuli'))}</div>
          <div class="msg-content">
            ${streamedPieces.map(() => '<div class="msg-bubble" data-bubble></div>').join('')}
            ${streamedNote}
            <div class="msg-actions">
              <button class="msg-action-btn" type="button" data-act="copy">复制</button>
              <button class="msg-action-btn" type="button" data-act="retry">重新生成</button>
              <button class="msg-action-btn" type="button" data-act="quote">引用</button>
              <button class="msg-action-btn" type="button" data-act="fav">收藏</button>
              <button class="msg-action-btn" type="button" data-act="multi">多选</button>
              <button class="msg-action-btn" type="button" data-act="del">删除</button>
            </div>
          </div>
        </div>`,
      );
      // 一条一条地打出来，中间停一下 —— 真人是连着发几条，不是一口气全甩出来
      const bubbles = [...(list.lastElementChild?.querySelectorAll<HTMLElement>('[data-bubble]') ?? [])];
      for (const [index, piece] of streamedPieces.entries()) {
        const target = bubbles[index];
        if (!target) break;
        await playText(target, piece);
        if (index < streamedPieces.length - 1) await sleep(BUBBLE_GAP_MS);
      }
      renderAllMessages();
    } catch (error) {
      hideTyping();
      showError(describe(error), error instanceof AiSetupError);
    } finally {
      busy = false;
      sendButton.disabled = false;
    }
  };

  /* ---------- 发送 ---------- */
  const send = async (): Promise<void> => {
    if (busy) return;
    const text = input.value.trim();
    if (!text) return;

    const quote = pendingQuote;
    input.value = '';
    input.style.height = 'auto';
    drawer.hidden = true;
    clearQuote();

    const userMessage: Message = {
      id: newId(),
      conversationId: conversation.id,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
      ...(quote
        ? {
            extra: {
              quote: {
                id: quote.id,
                role: quote.role,
                content: quote.content,
              },
            },
          }
        : {}),
    };
    messages.push(userMessage);
    await putMessage(userMessage);
    // 同样：这条是直接追加到列表末尾的，没走重画，已画条数要跟着 +1
    renderCount += 1;

    const prev = messages[messages.length - 2];
    list.querySelector('.chat-empty')?.remove();
    if (shouldShowTime(prev, userMessage)) {
      list.insertAdjacentHTML('beforeend', timeHTML(userMessage.createdAt));
    }
    // 用户自己的话不挂动作：括号是他自己的口吻，不拆
    list.insertAdjacentHTML(
      'beforeend',
      bubbleRowHTML({ message: userMessage, character, isLastAssistant: false }),
    );
    scrollToBottom();

    conversation.updatedAt = Date.now();
    await putConversation(conversation);

    await requestAssistantResponse();
  };

  /* ---------- 重新生成最后一条 ---------- */
  const retryLast = async (): Promise<void> => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      await deleteMessage(last.id);
      messages.pop();
      renderAllMessages();
    }
    drawer.hidden = true;
    await requestAssistantResponse();
  };

  /* ---------- 画一张 / 读出来 ----------

     两项媒体能力都在 media.ts。这里只负责把依赖递过去 ——
     它们要动占位气泡、打字指示、发送按钮，那些元素属于本文件。 */
  const mediaDeps = (): MediaDeps => ({
    character,
    conversation,
    messages,
    list,
    drawer,
    sendButton,
    context,
    isBusy: () => busy,
    setBusy: (value) => {
      busy = value;
    },
    showTyping,
    hideTyping,
    showError,
    scrollToBottom,
    describeError: describe,
  });

  retryBtn.addEventListener('click', () => void retryLast());
  imageBtn.addEventListener('click', () => void drawImage(mediaDeps()));
  speakBtn.addEventListener('click', () => void speakLast(mediaDeps()));

  /**
   * 打开聊天美化（聊天室作用域）。
   *
   * 抽屉和聊天设置里都有一个入口 —— 抽成一个函数，
   * 免得两处各写一遍、以后改一处漏一处。
   */
  const openBeauty = (): void => {
    void openBeautyPanel({
      scope: 'room',
      characterId: character.id,
      characterName: character.name,
      onChange: () => {
        applyBeauty();
        renderAllMessages();
      },
    }).then(() => {
      applyBeauty();
      renderAllMessages();
    });
  };

  /* 右上角「···」：先分一层菜单，再决定进角色档案还是聊天室美化。
     以前它是直通角色档案的 —— 用户 2026-11-17 指出这是两件事，要分开。 */
  moreBtn.addEventListener('click', () => {
    void openRoomMenu({ title: character.name || '未命名' }).then((choice) => {
      if (choice === 'beauty') {
        openBeauty();
        return;
      }
      if (choice === 'dossier') {
        // back 参数让档案页的返回键回到这间聊天室，而不是角色卡列表
        navigate(`/character/${character.id}?back=${encodeURIComponent(`/chat/${character.id}`)}`);
      }
    });
  });

  /* 聊天美化：全屏面板。
     它是独立的库里的一份配置，改完直接重画消息流 ——
     头像装饰和气泡样式都是生成 HTML 时算进去的。 */
  root.querySelector('#drawer-beauty')?.addEventListener('click', () => {
    drawer.hidden = true;
    chatPage.classList.remove('is-drawer');
    openBeauty();
  });

  /* 聊天设置：就地弹出面板。
     开关改了要重画消息流（动作栏出现/消失）；头像框改了要存进角色。 */
  chatSettingsBtn.addEventListener('click', () => {
    drawer.hidden = true;
    chatPage.classList.remove('is-drawer');
    void openChatSettings({
      onOpenBeauty: () => openBeauty(),
    }).then((result) => {
      if (result?.actionNoteChanged) renderAllMessages();
    });
  });

  /**
   * 给用户写的每条选择器加前缀。
   *
   * 只处理最简单的规则块（`选择器 { ... }`），@media / @supports 这类
   * 整块原样保留 —— 在里面加前缀太容易出错，不如让用户自己写全。
   * 这是「够用」而不是「完整 CSS 解析器」：真做解析要引一个几十 KB 的库，
   * 为一个可有可无的自定义框不值得。
   */
  const scopeCss = (source: string, scope: string): string =>
    source.replace(/(^|})([^{}@]+)\{/g, (_match, brace: string, selectors: string) => {
      const scoped = selectors
        .split(',')
        .map((selector) => {
          const trimmed = selector.trim();
          if (!trimmed) return '';
          // 已经带了作用域的别加第二遍
          return trimmed.startsWith(scope) ? trimmed : `${scope} ${trimmed}`;
        })
        .filter(Boolean)
        .join(', ');
      return `${brace}${scoped} {`;
    });

  const updateCurrentModelLabel = async (): Promise<void> => {
    try {
      const profile = await getProfile('text', context);
      modelLabel.textContent = profile.model.name || profile.model.id || '换模型';
      modelLabel.title = `当前：${profile.site.name} / ${profile.model.name}`;
    } catch {
      modelLabel.textContent = '换模型';
      modelLabel.title = '尚未配置可用模型';
    }
  };
  void updateCurrentModelLabel();

  modelBtn.addEventListener('click', () => {
    drawer.hidden = true;
    chatPage.classList.remove('is-drawer');
    void (async () => {
      let currentTarget: { siteId: string; modelId: string } | null = null;
      try {
        const profile = await getProfile('text', context);
        currentTarget = { siteId: profile.site.id, modelId: profile.model.id };
      } catch {
        currentTarget = null;
      }
      const picked = await openModelPicker('text', currentTarget, {
        allowNone: true,
        title: `切换「${character.name || '当前角色'}」的文本模型`,
        noneLabel: '跟随上级设置',
      });
      await assign('role', character.id, 'text', picked);
      await updateCurrentModelLabel();
      // 成功切换后刷新页面顶部的设置缺失提示
      const existingSetupBanner = list.querySelector('.chat-setup');
      if (existingSetupBanner) existingSetupBanner.remove();
    })();
  });

  /* ---------- 一条消息的命令集合 ----------
     点击（行内操作条）和长按（浮层工具条）走同一套命令，
     保证两处行为完全一致 —— 这也是 Apple HIG 要求的：
     上下文菜单里的条目，在主界面里也必须能用到。 */

  const runMessageCommand = (act: string, row: HTMLElement, feedback: HTMLElement | null): void => {
    const msgId = row.dataset.msgId;
    const msg = messages.find((item) => item.id === msgId);
    if (!msg) return;

    if (act === 'copy') {
      void navigator.clipboard?.writeText(msg.content);
      if (feedback) {
        feedback.textContent = '已复制';
        window.setTimeout(() => {
          feedback.textContent = '复制';
        }, 1500);
      }
      return;
    }

    if (act === 'del') {
      void (async () => {
        await deleteMessage(msg.id);
        messages = messages.filter((item) => item.id !== msg.id);
        renderAllMessages();
      })();
      return;
    }

    if (act === 'retry') {
      void retryLast();
      return;
    }

    if (act === 'quote') {
      setQuote(msg);
      return;
    }

    if (act === 'fav') {
      void (async () => {
        const already = msg.extra?.favorited === true;
        const nextFav = !already;
        const nextExtra: Record<string, unknown> = { ...(msg.extra ?? {}), favorited: nextFav };
        if (nextFav) {
          nextExtra.favoritedAt = new Date().toISOString();
        } else {
          delete nextExtra.favoritedAt;
        }
        const updated: Message = { ...msg, extra: nextExtra };
        await putMessage(updated);
        const idx = messages.findIndex((item) => item.id === msg.id);
        if (idx >= 0) messages[idx] = updated;
        const favBtn = row.querySelector<HTMLElement>('[data-act="fav"]');
        if (favBtn) favBtn.textContent = nextFav ? '已收藏' : '收藏';
      })();
      return;
    }

    if (act === 'multi') {
      enterMultiMode(msg.id);
    }
  };

  /* ---------- 气泡快捷点击 / 操作栏 ----------

     和长按的浮层工具条是两套入口、同一套命令（见上面 runMessageCommand）：
     轻点气泡展开行内操作条，长按弹浮层。 */
  list.addEventListener('click', (event) => {
    // 长按刚生效，这一次 click 是它的尾巴，吞掉
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const target = event.target as HTMLElement;

    const act = target.dataset.act;
    const row = target.closest<HTMLElement>('.msg-row');
    if (!row) return;

    const msgId = row.dataset.msgId;
    const msg = messages.find((item) => item.id === msgId);
    if (!msg) return;

    if (multiMode) {
      if (selectedIds.has(msg.id)) {
        selectedIds.delete(msg.id);
        row.classList.remove('is-multi-selected');
      } else {
        selectedIds.add(msg.id);
        row.classList.add('is-multi-selected');
      }
      updateMultiUI();
      return;
    }

    if (act === 'copy') {
      void navigator.clipboard?.writeText(msg.content);
      target.textContent = '已复制';
      window.setTimeout(() => {
        target.textContent = '复制';
      }, 1500);
      return;
    }

    if (act === 'del') {
      void (async () => {
        await deleteMessage(msg.id);
        messages = messages.filter((item) => item.id !== msg.id);
        renderAllMessages();
      })();
      return;
    }

    if (act === 'retry') {
      void retryLast();
      return;
    }

    if (act === 'quote' || act === 'fav' || act === 'multi') {
      runMessageCommand(act, row, target);
      return;
    }

    // 点击气泡：切换展示操作条
    if (target.dataset.bubble !== undefined) {
      const wasSelected = row.classList.contains('is-selected');
      list.querySelectorAll('.msg-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
      if (!wasSelected) row.classList.add('is-selected');
    }
  });

  /* ---------- 长按气泡：浮层小工具条 ----------

     实现和阈值说明都在 long-press.ts。这里只把两个回调挂上去。 */

  let suppressClick = false;
  const lastAssistantId = (): string => {
    const last = [...messages].reverse().find((item) => item.role === 'assistant');
    return last?.id ?? '';
  };

  installLongPress({
    list,
    lastAssistantId,
    onSpeak: () => void speakLast(mediaDeps()),
    onCommand: (command, row) => runMessageCommand(command, row, null),
    setSuppressClick: (value) => {
      suppressClick = value;
    },
  });

  sendButton.addEventListener('click', () => {
    void send();
  });

  plusButton.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    chatPage.classList.toggle('is-drawer', !drawer.hidden);
    if (!drawer.hidden) {
      input.blur();
      viewport.sync();
      if (!viewport.keyboardHeight()) {
        chatPage.style.setProperty('--chat-keyboard-height', '300px');
      }
      window.setTimeout(scrollToBottom, 50);
    }
  });

  input.addEventListener('focus', () => {
    drawer.hidden = true;
    chatPage.classList.remove('is-drawer');
    viewport.sync();
  });

  input.addEventListener('blur', () => {
    viewport.sync();
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(120, input.scrollHeight)}px`;
  });

  let composing = false;
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || composing) return;
    event.preventDefault();
    void send();
  });

  /* 进页面先看一眼配没配好：没配就在最上面给一条能直接点的提示 */
  void getProfile('text', context).catch((error: unknown) => {
    if (!(error instanceof AiSetupError)) return;
    const banner = document.createElement('div');
    banner.className = 'chat-setup';
    banner.innerHTML = `
      <span>${esc(error.message)}</span>
      <button class="btn btn--sm" type="button" data-go="/settings/api?tab=assign">去设置</button>`;
    list.prepend(banner);
  });

  // 路由切走时把视口的监听和定时器一起收掉（它们不全在本模块里）
  return () => {
    viewport.dispose();
  };
}