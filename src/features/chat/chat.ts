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
} from '../../core/db';
import { collectLore, renderLore } from '../../core/lore';
import type { Character, Conversation, Message } from '../../core/types';
import { esc, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import {
  callImage,
  callSpeech,
  callText,
  getProfile,
  assign,
  SetupError as AiSetupError,
} from '../../ai/call';
import { openModelPicker } from '../api/model-picker';
import { ApiError } from '../../ai/errors';
import './chat.css';

/* ==========================================================================
   聊天（微信 + QQ 结合体）

   设计亮点：
     - 顶部：返回 + 居中角色名 + 下方在线状态点/世界标签 + 右侧「···」直达角色档案
     - 气泡：微信/QQ 左右分立排布，圆角微尖角尾巴，用户反色、AI 白底描边
     - 交互：点击气泡弹出快捷操作条（复制、重新生成、删除）
     - 底部：自动伸缩输入框、发送按钮、QQ 风格「+」扩展面板（重新生成、清除消息等）
   ========================================================================== */

const HISTORY_LIMIT = 20;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function shouldShowTime(previous: Message | undefined, current: Message): boolean {
  if (!previous) return true;
  const a = new Date(previous.createdAt).getTime();
  const b = new Date(current.createdAt).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? b - a > 5 * 60 * 1000 : false;
}

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
    '【规则】用第一人称，保持角色口吻和情绪；不要替对方说话；不要解释自己是 AI；像在手机上聊天一样自然，别长篇大论。',
  ];
  return blocks.filter(Boolean).join('\n\n');
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
          <button class="topbar__action jelly" type="button" data-go="/character/${esc(character.id)}" aria-label="角色档案">
            ${line('more', 20)}
          </button>
        </div>
      </header>

      <main class="chat-list" id="chat-list"></main>

      <footer class="chat-bottom">
        <div class="chat-compose">
          <button class="chat-icon-btn jelly" type="button" id="chat-plus" aria-label="扩展菜单">
            ${line('plus', 22)}
          </button>
          <textarea class="chat-input" id="chat-text" rows="1" placeholder="发送消息…" spellcheck="false"></textarea>
          <button class="chat-send jelly" type="button" id="chat-send" aria-label="发送">
            ${line('send', 20)}
          </button>
        </div>

        <div class="chat-drawer" id="chat-drawer" hidden>
          <button class="drawer-item" type="button" id="drawer-retry">
            <span class="drawer-item__icon">${line('refresh', 22)}</span>
            <span class="drawer-item__label">重新回答</span>
          </button>
          <button class="drawer-item" type="button" data-go="/character/${esc(character.id)}">
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
        </div>
      </footer>
    </div>`;

  const list = must<HTMLElement>(root, '#chat-list');
  const chatPage = must<HTMLElement>(root, '.chat-page');
  const input = must<HTMLTextAreaElement>(root, '#chat-text');
  const sendButton = must<HTMLButtonElement>(root, '#chat-send');
  const plusButton = must<HTMLButtonElement>(root, '#chat-plus');
  const drawer = must<HTMLElement>(root, '#chat-drawer');
  const retryBtn = must<HTMLButtonElement>(root, '#drawer-retry');
  const imageBtn = must<HTMLButtonElement>(root, '#drawer-image');
  const speakBtn = must<HTMLButtonElement>(root, '#drawer-speak');
  const modelBtn = must<HTMLButtonElement>(root, '#drawer-model');
  const modelLabel = must<HTMLElement>(root, '#drawer-model-label');

  let busy = false;

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
  const viewportHeight = (): number => {
    const list = [window.innerHeight, document.documentElement.clientHeight];
    const visual = window.visualViewport?.height;
    if (typeof visual === 'number' && visual > 0) list.push(visual);
    const usable = list.filter((value) => value > 0);
    return usable.length > 0 ? Math.min(...usable) : window.innerHeight;
  };
  const viewportOffset = (): number => window.visualViewport?.offsetTop ?? 0;

  /** 首次量到的完整高度，用来判断键盘有没有起来 */
  let tallest = 0;
  /** 最近一次软键盘占用的高度；加号面板复用它，保证切换时底栏高度不跳。 */
  let keyboardHeight = 0;

  const syncViewport = (): void => {
    const height = viewportHeight();
    const offset = viewportOffset();
    if (tallest === 0) tallest = height;
    else if (height > tallest) tallest = height;

    chatPage.style.height = `${Math.round(height)}px`;
    chatPage.style.top = `${Math.round(offset)}px`;

    const keyboardOpen = tallest - height > 120;
    if (keyboardOpen && document.activeElement === input && drawer.hidden) {
      keyboardHeight = tallest - height;
      chatPage.style.setProperty('--chat-keyboard-height', `${Math.round(keyboardHeight)}px`);
    }
    // 键盘收起动画期间只补足剩余高度，避免键盘和面板重复占位。
    chatPage.style.setProperty('--chat-keyboard-overlap', `${Math.max(0, Math.round(tallest - height))}px`);
    if (chatPage.classList.contains('is-keyboard') !== keyboardOpen) {
      chatPage.classList.toggle('is-keyboard', keyboardOpen);
    }

    scrollToBottom();
  };

  /* 键盘高度是「动画着长出来」的，只接一次 resize 会停在中间态；
     而第 3 种浏览器**一次都不通知**，所以聚焦期间定时对一次表，失焦就停。 */
  let watchTimer = 0;
  const startWatching = (): void => {
    window.clearInterval(watchTimer);
    watchTimer = window.setInterval(syncViewport, 150);
  };
  const stopWatching = (): void => {
    window.clearInterval(watchTimer);
    watchTimer = 0;
  };

  const onViewportChange = (): void => {
    syncViewport();
  };

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  window.visualViewport?.addEventListener('resize', onViewportChange);
  window.visualViewport?.addEventListener('scroll', onViewportChange);
  syncViewport();

  const timeHTML = (iso: string): string =>
    `<div class="chat-time">${esc(timeLabel(iso))}</div>`;

  const bubbleRowHTML = (message: Message, isLastAssistant: boolean): string => {
    const isUser = message.role === 'user';
    const avatar = isUser ? '' : avatarHTML(character.name || '未命名', 36, character.avatarKey);
    // 生图消息：正文是提示词，图在 extra.imageUrl
    const imageUrl = typeof message.extra?.imageUrl === 'string' ? message.extra.imageUrl : '';
    const body = imageUrl
      ? `<div class="msg-image"><img src="${esc(imageUrl)}" alt="${esc(message.content)}" loading="lazy" /></div>`
      : `<div class="msg-bubble" data-bubble>${esc(message.content)}</div>`;
    return `
      <div class="msg-row ${isUser ? 'msg-row--user' : 'msg-row--assistant'}" data-msg-id="${esc(message.id)}">
        ${isUser ? '' : `<div class="msg-avatar">${avatar}</div>`}
        <div class="msg-content">
          ${body}
          <div class="msg-actions">
            <button class="msg-action-btn" type="button" data-act="copy">复制</button>
            ${isLastAssistant ? '<button class="msg-action-btn" type="button" data-act="retry">重新生成</button>' : ''}
            <button class="msg-action-btn" type="button" data-act="del">删除</button>
          </div>
        </div>
      </div>`;
  };

  const renderAllMessages = (): void => {
    list.innerHTML = '';
    if (messages.length === 0) {
      list.innerHTML = '<p class="chat-empty">还没有对话。<br>说点什么开始。</p>';
      return;
    }
    const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf('assistant');
    messages.forEach((message, index) => {
      if (shouldShowTime(messages[index - 1], message)) {
        list.insertAdjacentHTML('beforeend', timeHTML(message.createdAt));
      }
      list.insertAdjacentHTML('beforeend', bubbleRowHTML(message, index === lastAssistantIdx));
    });
    scrollToBottom();
  };

  renderAllMessages();

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
      <div class="msg-avatar">${avatarHTML(character.name || '未命名', 36, character.avatarKey)}</div>
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
          ${withSetupLink ? '<button class="btn btn--sm chat-error__link" type="button" data-go="/settings/api">去设置模型</button>' : ''}
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
      conversation.updatedAt = Date.now();
      await putConversation(conversation);

      const prev = messages[messages.length - 2];
      if (shouldShowTime(prev, assistant)) {
        list.insertAdjacentHTML('beforeend', timeHTML(assistant.createdAt));
      }
      list.insertAdjacentHTML(
        'beforeend',
        `
        <div class="msg-row msg-row--assistant" data-msg-id="${esc(assistant.id)}">
          <div class="msg-avatar">${avatarHTML(character.name || '未命名', 36, character.avatarKey)}</div>
          <div class="msg-content">
            <div class="msg-bubble" data-bubble></div>
            <div class="msg-actions">
              <button class="msg-action-btn" type="button" data-act="copy">复制</button>
              <button class="msg-action-btn" type="button" data-act="retry">重新生成</button>
              <button class="msg-action-btn" type="button" data-act="del">删除</button>
            </div>
          </div>
        </div>`,
      );
      const bubble = list.lastElementChild?.querySelector<HTMLElement>('[data-bubble]');
      if (bubble) await playText(bubble, assistant.content);
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

    input.value = '';
    input.style.height = 'auto';
    drawer.hidden = true;

    const userMessage: Message = {
      id: newId(),
      conversationId: conversation.id,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    messages.push(userMessage);
    await putMessage(userMessage);

    const prev = messages[messages.length - 2];
    list.querySelector('.chat-empty')?.remove();
    if (shouldShowTime(prev, userMessage)) {
      list.insertAdjacentHTML('beforeend', timeHTML(userMessage.createdAt));
    }
    list.insertAdjacentHTML('beforeend', bubbleRowHTML(userMessage, false));
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

  /* ---------- 画一张（设计文档 §15 步骤 11） ----------

     拿最后一条用户消息当提示词。生图慢，所以先占一个「正在画」的占位气泡，
     拿到地址再换成真图，失败就把占位删掉并说明原因。 */
  const drawImage = async (): Promise<void> => {
    if (busy) return;
    const prompt = [...messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? '';
    if (!prompt) {
      showError('先说一句话，我照它画。', false);
      return;
    }

    drawer.hidden = true;
    busy = true;
    sendButton.disabled = true;
    showTyping();

    // 占位气泡，先给个「画布」
    const holder = document.createElement('div');
    holder.className = 'msg-row msg-row--assistant';
    holder.innerHTML = `
      <div class="msg-avatar">${avatarHTML(character.name || '未命名', 36, character.avatarKey)}</div>
      <div class="msg-content">
        <div class="msg-image is-loading" data-image-slot>正在画…</div>
      </div>`;
    list.append(holder);
    scrollToBottom();

    try {
      const result = await callImage({ prompt }, context);
      const slot = holder.querySelector<HTMLElement>('[data-image-slot]');
      if (slot) {
        slot.classList.remove('is-loading');
        slot.innerHTML = `<img src="${esc(result.url)}" alt="${esc(result.prompt)}" loading="lazy" />`;
      }

      const message: Message = {
        id: newId(),
        conversationId: conversation.id,
        role: 'assistant',
        content: result.prompt,
        createdAt: new Date().toISOString(),
        extra: { imageUrl: result.url, rewritten: result.rewritten },
      };
      messages.push(message);
      await putMessage(message);
      conversation.updatedAt = Date.now();
      await putConversation(conversation);

      if (result.rewritten) {
        const note = document.createElement('p');
        note.className = 'msg-image__note';
        note.textContent = '这幅画按改写后的描述画的。';
        holder.querySelector('.msg-content')?.append(note);
      }
      scrollToBottom();
    } catch (error) {
      holder.remove();
      showError(describe(error), error instanceof AiSetupError);
    } finally {
      hideTyping();
      busy = false;
      sendButton.disabled = false;
    }
  };

  /* ---------- 读出来（设计文档 §15 步骤 12） ----------

     读最后一条 AI 回复。拿回 Blob 就播，播放按钮留在气泡上一次就够。 */
  const speakLast = async (): Promise<void> => {
    if (busy) return;
    const last = [...messages].reverse().find((item) => item.role === 'assistant');
    if (!last?.content?.trim()) {
      showError('还没有可以读的回复。', false);
      return;
    }

    drawer.hidden = true;
    busy = true;
    showTyping();

    try {
      const blob = await callSpeech({ text: last.content }, context);
      hideTyping();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.onerror = () => URL.revokeObjectURL(audioUrl);
      await audio.play();
    } catch (error) {
      hideTyping();
      showError(describe(error), error instanceof AiSetupError);
    } finally {
      busy = false;
    }
  };

  retryBtn.addEventListener('click', () => void retryLast());
  imageBtn.addEventListener('click', () => void drawImage());
  speakBtn.addEventListener('click', () => void speakLast());

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

  /* ---------- 气泡快捷点击 / 操作栏 ---------- */
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const act = target.dataset.act;
    const row = target.closest<HTMLElement>('.msg-row');
    if (!row) return;

    const msgId = row.dataset.msgId;
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;

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
        messages = messages.filter((m) => m.id !== msg.id);
        renderAllMessages();
      })();
      return;
    }

    if (act === 'retry') {
      void retryLast();
      return;
    }

    // 点击气泡：切换展示操作条
    if (target.dataset.bubble !== undefined) {
      const wasSelected = row.classList.contains('is-selected');
      list.querySelectorAll('.msg-row.is-selected').forEach((el) => el.classList.remove('is-selected'));
      if (!wasSelected) row.classList.add('is-selected');
    }
  });

  /* ---------- 事件绑定 ---------- */
  sendButton.addEventListener('click', () => {
    void send();
  });

  plusButton.addEventListener('click', () => {
    drawer.hidden = !drawer.hidden;
    chatPage.classList.toggle('is-drawer', !drawer.hidden);
    if (!drawer.hidden) {
      input.blur();
      syncViewport();
      // 键盘尚未出现过时给一个与手机软键盘接近的保守高度；测到后自动替换。
      if (!keyboardHeight) {
        chatPage.style.setProperty('--chat-keyboard-height', '300px');
      }
      window.setTimeout(scrollToBottom, 50);
    }
  });

  input.addEventListener('focus', () => {
    drawer.hidden = true;
    chatPage.classList.remove('is-drawer');
    // 不调 scrollIntoView：整页已经钉在视觉视口上，再让浏览器去滚会把它顶歪。
    // 靠定时对表跟上键盘长出来的过程；对不上的浏览器也能靠它拿到实时数字。
    syncViewport();
    startWatching();
  });

  input.addEventListener('blur', () => {
    stopWatching();
    syncViewport();
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
      <button class="btn btn--sm" type="button" data-go="/settings/api">去设置</button>`;
    list.prepend(banner);
  });

  return () => {
    stopWatching();
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
    window.visualViewport?.removeEventListener('resize', onViewportChange);
    window.visualViewport?.removeEventListener('scroll', onViewportChange);
  };
}
