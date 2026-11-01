import {
  getCharacter,
  getProvider,
  getWorld,
  listConversations,
  listMessages,
  newId,
  putConversation,
  putMessage,
} from '../../core/db';
import { getBindings } from '../../core/model-bindings';
import type { Character, Conversation, Message } from '../../core/types';
import { esc, must } from '../../core/dom';
import { avatarHTML } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { chat as requestChat } from '../../ai/client';
import { ApiError } from '../../ai/errors';
import './chat.css';

/* ==========================================================================
   聊天（T6 基础版）

   一版只有：
     - 每个角色一条会话
     - 消息列表、发送、逐字回放、失败提示
     - 文本模型：角色专属 > 全局

   还没有：
     - 多会话、重生成、编辑消息
     - 世界书注入、记忆、朋友圈
     - 流式（现在是非流式 + 本地逐字）
   ========================================================================== */

const HISTORY_LIMIT = 20;
const TYPING_INTERVAL = 24;
const TYPING_FRAMES = 90;

/** 配置缺失 / 协议不支持时用它，界面上会带一个「去设置」按钮 */
class SetupError extends Error {}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.info.title} —— ${error.info.detail}`;
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
  return Number.isFinite(a) && Number.isFinite(b) ? b - a > 10 * 60 * 1000 : false;
}

function buildSystem(character: Character, worldDescription: string): string {
  const blocks = [
    `你正在扮演「${character.name}」。`,
    character.description.trim() ? `【人设】\n${character.description}` : '',
    character.personality.trim() ? `【性格】\n${character.personality}` : '',
    character.scenario.trim() ? `【场景】\n${character.scenario}` : '',
    character.relationToUser?.trim() ? `【和对方的关系】${character.relationToUser}` : '',
    character.systemPrompt.trim() ? `【额外设定】\n${character.systemPrompt}` : '',
    worldDescription.trim() ? `【世界】\n${worldDescription}` : '',
    character.mesExample.trim() ? `【说话示范】\n${character.mesExample}` : '',
    '【规则】用第一人称，保持角色口吻和情绪；不要替对方说话；不要解释自己是 AI；像在手机上聊天一样自然，别长篇大论。',
  ];
  return blocks.filter(Boolean).join('\n\n');
}

function greetingOf(character: Character): string {
  return character.firstMes.trim() || character.alternateGreetings.find((text) => text.trim())?.trim() || '';
}

export async function mountChat(root: HTMLElement, characterId: string): Promise<void> {
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
  const system = buildSystem(character, world?.description ?? '');

  /* ---------- 会话：一版一个角色一条 ---------- */
  const conversations = await listConversations(character.id);
  let conversation: Conversation = conversations[0] ?? {
    id: newId(),
    characterId: character.id,
    title: character.name || '未命名',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userName: '对方',
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

  root.innerHTML = `
    <div class="chat-page">
      <header class="chat-top">
        <button class="topbar__back jelly" type="button" data-go="/chat" aria-label="返回">${line('back', 22)}</button>
        ${avatarHTML(character.name || '未命名', 36, character.avatarKey)}
        <div class="chat-top__text">
          <p class="chat-top__name">${esc(character.name || '未命名')}</p>
          <p class="chat-top__sub">${esc(character.relationToUser?.trim() || world?.name || '在聊天')}</p>
        </div>
        <button class="topbar__action jelly" type="button" data-go="/character/${esc(character.id)}"
                aria-label="角色档案">${line('pencil', 20)}</button>
      </header>

      <main class="chat-list" id="chat-list"></main>

      <footer class="chat-compose">
        <textarea class="chat-input" id="chat-text" rows="1"
                  placeholder="说点什么…" spellcheck="false"></textarea>
        <button class="chat-send" type="button" id="chat-send" aria-label="发送">${line('send', 20)}</button>
      </footer>
    </div>`;

  const list = must<HTMLElement>(root, '#chat-list');
  const input = must<HTMLTextAreaElement>(root, '#chat-text');
  const sendButton = must<HTMLButtonElement>(root, '#chat-send');

  let busy = false;

  const scrollToBottom = (): void => {
    list.scrollTop = list.scrollHeight;
  };

  const timeHTML = (iso: string): string =>
    `<div class="chat-time">${esc(timeLabel(iso))}</div>`;

  const bubbleHTML = (message: Message): string => {
    const mine = message.role === 'user';
    return `<div class="msg ${mine ? 'msg--user' : 'msg--assistant'}">
      <div class="msg__bubble">${esc(message.content)}</div>
    </div>`;
  };

  const appendMessage = (message: Message, previous: Message | undefined): void => {
    list.querySelector('.chat-empty')?.remove();
    if (shouldShowTime(previous, message)) {
      list.insertAdjacentHTML('beforeend', timeHTML(message.createdAt));
    }
    list.insertAdjacentHTML('beforeend', bubbleHTML(message));
    scrollToBottom();
  };

  const showError = (message: string, withSetupLink = false): void => {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg msg--error';
    wrapper.innerHTML = `
      <div class="msg__bubble">
        ${esc(message)}
        ${withSetupLink ? '<button class="btn btn--sm chat-error__link" type="button" data-go="/settings/providers">去设置模型</button>' : ''}
      </div>`;
    list.appendChild(wrapper);
    scrollToBottom();
  };

  /* ---------- 初次渲染 ---------- */
  if (messages.length === 0) {
    list.innerHTML = '<p class="chat-empty">还没有对话。<br>说点什么开始。</p>';
  } else {
    messages.forEach((message, index) => {
      if (shouldShowTime(messages[index - 1], message)) {
        list.insertAdjacentHTML('beforeend', timeHTML(message.createdAt));
      }
      list.insertAdjacentHTML('beforeend', bubbleHTML(message));
    });
    scrollToBottom();
  }

  /* ---------- 配置 ---------- */
  const resolveConfig = async (): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    path: string;
  }> => {
    const bindings = await getBindings();
    const ref = bindings.characters[character.id]?.text ?? bindings.byKind.text;
    if (!ref) throw new SetupError('还没有设置文本模型。先去「API 与模型」里选一个。');

    const provider = await getProvider(ref.providerId);
    if (!provider) throw new SetupError('这个文本模型所属的服务商已经被删了。');
    if (provider.protocol !== 'openai') {
      throw new SetupError(`「${provider.name}」用的协议还没适配，暂时不能聊天。`);
    }

    const model = provider.models.find(
      (item) => item.id === ref.modelId && (item.kind ?? 'text') === 'text' && item.enabled,
    );
    if (!model) throw new SetupError('选中的文本模型已经不在这个服务商里了。');

    const key =
      provider.keys.find((item) => item.enabled && item.value)?.value ??
      provider.keys[0]?.value ??
      '';
    if (!key) throw new SetupError(`「${provider.name}」还没填 API Key。`);

    return {
      baseUrl: provider.baseUrl,
      apiKey: key,
      model: ref.modelId,
      temperature: provider.generation.temperature,
      path: provider.apiPath || '/chat/completions',
    };
  };

  /* ---------- 打字指示 ---------- */
  let typing: HTMLElement | null = null;

  const showTyping = (): void => {
    typing?.remove();
    typing = document.createElement('div');
    typing.className = 'chat-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    list.appendChild(typing);
    scrollToBottom();
  };

  const hideTyping = (): void => {
    typing?.remove();
    typing = null;
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

  const appendAssistant = async (message: Message): Promise<void> => {
    const previous = messages[messages.length - 2];
    list.querySelector('.chat-empty')?.remove();
    if (shouldShowTime(previous, message)) {
      list.insertAdjacentHTML('beforeend', timeHTML(message.createdAt));
    }
    list.insertAdjacentHTML(
      'beforeend',
      `<div class="msg msg--assistant"><div class="msg__bubble"></div></div>`,
    );
    const bubble = list.lastElementChild?.querySelector<HTMLElement>('.msg__bubble');
    if (bubble) await playText(bubble, message.content);
  };

  /* ---------- 发送 ---------- */
  const send = async (): Promise<void> => {
    if (busy) return;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';

    const userMessage: Message = {
      id: newId(),
      conversationId: conversation.id,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    messages.push(userMessage);
    await putMessage(userMessage);
    appendMessage(userMessage, messages[messages.length - 2]);

    conversation.updatedAt = Date.now();
    await putConversation(conversation);

    busy = true;
    sendButton.disabled = true;
    showTyping();

    try {
      const config = await resolveConfig();
      const history = messages.slice(-HISTORY_LIMIT).map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const result = await requestChat(
        [{ role: 'system', content: system }, ...history],
        config,
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

      await appendAssistant(assistant);
    } catch (error) {
      hideTyping();
      showError(describe(error), error instanceof SetupError);
    } finally {
      busy = false;
      sendButton.disabled = false;
    }
  };

  sendButton.addEventListener('click', () => {
    void send();
  });

  input.addEventListener('focus', () => {
    window.setTimeout(scrollToBottom, 250);
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

  /* 没配文本模型时，先在顶部说清楚，别等用户打完字才报错 */
  void resolveConfig().catch((error: unknown) => {
    if (!(error instanceof SetupError)) return;
    const banner = document.createElement('div');
    banner.className = 'chat-setup';
    banner.innerHTML = `
      <span>${esc(error.message)}</span>
      <button class="btn btn--sm" type="button" data-go="/settings/providers">去设置</button>`;
    list.prepend(banner);
  });
}
