import { listCharacters, listConversations, listMessages, listMoments } from '../../../core/db';
import { esc } from '../../../core/dom';
import { navigate } from '../../../core/router';
import type { Character, Conversation, Moment } from '../../../core/types';
import { avatarHTML } from '../../../ui/avatar';
import { line } from '../../../ui/icons';
import { appAppearanceOf, loadAppAppearance, loadAssets, loadBeauty } from '../beauty/store';
import { syncThemeColorFromTop } from '../../../ui/theme-color';
import {
  loadContactGroups,
  openGroupManager,
  renderGroupedContactsHTML,
  toggleGroupCollapsed,
} from './contact-groups';
import { meViewHTML, mountMeView } from './me-view';
import { momentsViewHTML, mountMomentsView, openMomentComposer } from './moments-view';
import './chat-home.css';

/* ==========================================================================
   聊天 App 的首页

   结构照微信：底部四个板块，顶部栏跟着板块换标题。
   风格照 QQ：圆角更大、留白更松、列表行互相独立。

   为什么不做 QQ 那种侧边栏：那套是给自己手机做的二级导航，
   在 390 宽的屏上会占掉近 1/4，把内容挤扁。微信的底部栏更适合窄屏。

   四个板块：消息 / 联系人 / 朋友圈 / 我
   ========================================================================== */

type Tab = 'chats' | 'contacts' | 'moments' | 'me';

const TABS: Array<{ id: Tab; label: string; icon: 'chat' | 'contacts' | 'moments' | 'character' }> = [
  { id: 'chats', label: '消息', icon: 'chat' },
  { id: 'contacts', label: '联系人', icon: 'contacts' },
  { id: 'moments', label: '朋友圈', icon: 'moments' },
  { id: 'me', label: '我', icon: 'character' },
];

/** 顶部栏文案随板块变 —— 这是微信的做法：标题不是固定的 App 名 */
const TITLES: Record<Tab, string> = {
  chats: '消息',
  contacts: '联系人',
  moments: '朋友圈',
  me: '我',
};

interface ChatRow {
  conversation: Conversation;
  character: Character;
  preview: string;
  time: string;
}

/** 相对时间：今天显示时分，昨天显示「昨天」，更早显示日期 */
function relativeTime(timestamp: number): string {
  const now = new Date();
  const then = new Date(timestamp);
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) {
    return `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate();
  if (isYesterday) return '昨天';
  return `${then.getMonth() + 1}/${then.getDate()}`;
}

export async function mountChatHome(root: HTMLElement): Promise<void> {
  const [characters, conversations] = await Promise.all([listCharacters(), listConversations()]);
  await loadContactGroups(characters);

  // 每个角色对应最近的一条会话，没有会话就当作「还没开始」，仍然列出来
  const byCharacter = new Map<string, Conversation>();
  for (const conversation of conversations) {
    const existing = byCharacter.get(conversation.characterId);
    if (!existing || conversation.updatedAt > existing.updatedAt) {
      byCharacter.set(conversation.characterId, conversation);
    }
  }

  const rows: ChatRow[] = [];
  for (const character of characters) {
    const conversation = byCharacter.get(character.id);
    let preview = '还没聊过';
    if (conversation) {
      // 只要最后一条来做预览。传 limit 是为了不把几千条历史全读进内存
      const last = (await listMessages(conversation.id, { limit: 1 }))[0];
      if (last) preview = last.content.replace(/\s+/g, ' ').slice(0, 40);
    }
    rows.push({
      conversation: conversation ?? {
        id: '',
        characterId: character.id,
        title: character.name,
        createdAt: 0,
        updatedAt: 0,
        userName: '我',
        metadata: {},
      },
      character,
      preview,
      time: conversation ? relativeTime(conversation.updatedAt) : '',
    });
  }

  // 有会话的排在前面，按最后消息时间倒序
  rows.sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt);

  let active: Tab = 'chats';

  root.innerHTML = `
    <div class="chatapp">
      <header class="chatapp__top">
        <button class="chatapp__back jelly" type="button" id="chatapp-back" aria-label="返回">
          ${line('back', 20)}
        </button>
        <h1 class="chatapp__title" id="chatapp-title">${TITLES[active]}</h1>
        <button class="chatapp__action jelly" type="button" id="chatapp-new" aria-label="新建">
          ${line('plus', 22)}
        </button>
      </header>

      <main class="chatapp__body" id="chatapp-body"></main>

      <nav class="chatapp__tabbar" role="tablist">
        ${TABS.map(
          (tab) => `
          <button class="chatapp__tab${tab.id === active ? ' is-on' : ''}" type="button"
                  role="tab" aria-selected="${tab.id === active}" data-tab="${tab.id}">
            <span class="chatapp__tab-icon">${line(tab.icon, 24)}</span>
            <span class="chatapp__tab-label">${tab.label}</span>
          </button>`,
        ).join('')}
      </nav>
    </div>`;

  const chatapp = root.querySelector<HTMLElement>('.chatapp');

  /**
   * 聊天APP 全局外观：挂在 .chatapp 上。
   *
   * 只影响外壳（列表 / 通讯录 / 朋友圈 / 我），
   * 不碰聊天室里的气泡和背景 —— 那些在 beauty-store 的角色作用域里。
   *
   * 每次都重新读一遍：用户可能在「我 → 聊天美化」里刚改完回来。
   */
  const applyAppAppearance = (): void => {
    if (!chatapp) return;
    const app = appAppearanceOf();
    chatapp.style.setProperty('--beauty-app-background', app.background);
    chatapp.style.setProperty('--beauty-app-panel', app.panel);
    chatapp.style.setProperty('--beauty-app-navigation', app.navigation);
    chatapp.style.setProperty('--beauty-app-accent', app.accent);
    chatapp.style.setProperty('--beauty-app-ink', app.ink);
    chatapp.style.setProperty('--beauty-app-muted', app.muted);
    // 顶栏换色了，最上面那条状态栏跟着变成同一个颜色（不再是一条白边）
    requestAnimationFrame(() => syncThemeColorFromTop());
  };

  void loadAppAppearance().then(applyAppAppearance);

  const body = root.querySelector<HTMLElement>('#chatapp-body');
  const title = root.querySelector<HTMLElement>('#chatapp-title');
  const actionBtn = root.querySelector<HTMLButtonElement>('#chatapp-new');

  /** 空白时的统一说法：说清这里是什么 + 给一个下一步 */
  const empty = (titleText: string, hint: string, action?: { label: string; go: string }): string => `
    <div class="chatapp-empty">
      <p class="chatapp-empty__title">${esc(titleText)}</p>
      <p class="chatapp-empty__hint">${esc(hint)}</p>
      ${action ? `<button class="btn btn--primary jelly" type="button" data-go="${esc(action.go)}">${esc(action.label)}</button>` : ''}
    </div>`;

  /**
   * 每次重画换一个 AbortController，上一次挂的监听器自动失效。
   *
   * 不加这个的话，「我」和「朋友圈」每重画一次就往 body 上加一个 click 监听，
   * 点一下会触发好几遍 —— 越用越卡，而且会重复写库。
   */
  let tabController: AbortController | null = null;

  /** 朋友圈是异步读库的，单独一个函数，paint 里只负责发起 */
  const paintMoments = (signal: AbortSignal): void => {
    if (!body) return;
    void (async () => {
      let moments: Moment[] = [];
      try {
        moments = await listMoments();
      } catch {
        // 读失败不该让整页白掉，下面会落到空状态
        moments = [];
      }
      if (signal.aborted || !body) return;

      if (moments.length === 0) {
        // 空状态的按钮直接开面板，不走路由 —— 所以不用 empty() 的 data-go 版本
        body.innerHTML = `
          <div class="chatapp-empty">
            <p class="chatapp-empty__title">还没有动态</p>
            <p class="chatapp-empty__hint">发一条，这里就会热闹起来。</p>
            <button class="btn btn--primary jelly" type="button" data-compose="1">发第一条</button>
          </div>`;
        return;
      }

      const map = new Map(characters.map((item) => [item.id, item]));
      body.innerHTML = `<div class="mo-view">${momentsViewHTML(moments, map)}</div>`;
      mountMomentsView(body, moments, () => paint('moments'), signal);
    })();
  };

  const paint = (tab: Tab): void => {
    if (!body || !title) return;
    title.textContent = TITLES[tab];

    tabController?.abort();
    tabController = new AbortController();
    const signal = tabController.signal;

    // 顶栏那个按钮跟着板块换身份：朋友圈是「发动态」，我 是「隐藏但占位」
    if (actionBtn) {
      const hideAction = tab === 'me';
      actionBtn.style.visibility = hideAction ? 'hidden' : '';
      actionBtn.disabled = hideAction;
      actionBtn.setAttribute('aria-hidden', String(hideAction));
      actionBtn.setAttribute('aria-label', tab === 'moments' ? '发动态' : '新建');
    }

    const renderChatList = (keyword: string): string => {
      const q = keyword.trim().toLowerCase();
      const filtered = q
        ? rows.filter(
            (row) =>
              row.character.name.toLowerCase().includes(q) ||
              row.preview.toLowerCase().includes(q),
          )
        : rows;
      if (filtered.length === 0) {
        return `<div class="chatapp-empty"><p class="chatapp-empty__hint">没有找到匹配的聊天</p></div>`;
      }
      return `<ul class="chatapp__list">${filtered
        .map(
          (row) => `
              <li>
                <button class="chat-row" type="button" data-go="/chat/${esc(row.character.id)}">
                  <span class="chat-row__avatar">
                    ${avatarHTML(row.character.name || '未命名', 48, row.character.avatarKey, row.character.avatarFrame)}
                  </span>
                  <span class="chat-row__main">
                    <span class="chat-row__line">
                      <span class="chat-row__name">${esc(row.character.name || '未命名')}</span>
                      <span class="chat-row__time">${esc(row.time)}</span>
                    </span>
                    <span class="chat-row__preview">${esc(row.preview)}</span>
                  </span>
                </button>
              </li>`,
        )
        .join('')}</ul>`;
    };

    if (tab === 'chats') {
      if (rows.length === 0) {
        body.innerHTML = empty('还没有聊天', '先去建一个角色，回来就能开聊。', {
          label: '去角色页',
          go: '/character',
        });
        return;
      }
      body.innerHTML = `
        <div class="chatapp-search">
          <span class="chatapp-search__icon">${line('search', 18)}</span>
          <input class="chatapp-search__input" id="chatapp-search-input" type="search"
                 placeholder="搜索" autocomplete="off" spellcheck="false" aria-label="搜索聊天">
        </div>
        <div id="chatapp-list-wrap">${renderChatList('')}</div>`;
      const searchInput = body.querySelector<HTMLInputElement>('#chatapp-search-input');
      const listWrap = body.querySelector<HTMLElement>('#chatapp-list-wrap');
      searchInput?.addEventListener(
        'input',
        () => {
          if (listWrap) listWrap.innerHTML = renderChatList(searchInput.value);
        },
        { signal },
      );
      return;
    }

    if (tab === 'contacts') {
      if (characters.length === 0) {
        body.innerHTML = empty('还没有联系人', '建一个角色，他就会出现在这里。', {
          label: '去角色页',
          go: '/character',
        });
        return;
      }
      body.innerHTML = `
        <div class="chatapp-search-row">
          <div class="chatapp-search">
            <span class="chatapp-search__icon">${line('search', 18)}</span>
            <input class="chatapp-search__input" id="contacts-search-input" type="search"
                   placeholder="搜索联系人或分组" autocomplete="off" spellcheck="false" aria-label="搜索联系人">
          </div>
          <button class="cg-manage-btn jelly" type="button" id="contacts-group-manage">分组</button>
        </div>
        <div id="chatapp-contacts-wrap">${renderGroupedContactsHTML(characters, '')}</div>`;

      const searchInput = body.querySelector<HTMLInputElement>('#contacts-search-input');
      const contactsWrap = body.querySelector<HTMLElement>('#chatapp-contacts-wrap');
      const repaintContacts = () => {
        if (contactsWrap) {
          contactsWrap.innerHTML = renderGroupedContactsHTML(characters, searchInput?.value ?? '');
        }
      };

      searchInput?.addEventListener('input', repaintContacts, { signal });

      contactsWrap?.addEventListener(
        'click',
        (event) => {
          const toggleBtn = (event.target as HTMLElement).closest<HTMLElement>('[data-toggle-group]');
          if (!toggleBtn) return;
          const groupName = toggleBtn.dataset.toggleGroup;
          if (!groupName) return;
          toggleGroupCollapsed(groupName);
          repaintContacts();
        },
        { signal },
      );

      body.querySelector<HTMLButtonElement>('#contacts-group-manage')?.addEventListener(
        'click',
        () => {
          openGroupManager(characters, repaintContacts);
        },
        { signal },
      );
      return;
    }

    if (tab === 'moments') {
      body.innerHTML = '';
      paintMoments(signal);
      return;
    }

    // 「我」：身份卡 + 名字 / 签名 / 头像框
    // 「我」页面展示的是「全局那套」的头像装饰 ——
    //   不先切作用域的话会读到上一个聊天室的数据，头像框看起来是错的
    void loadBeauty('').then(() => loadAssets()).then(() => {
      body.innerHTML = meViewHTML();
      mountMeView(body, () => paint('me'), signal);
    });
  };

  const selectTab = (next: Tab): void => {
    if (next === active) return;
    active = next;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => {
      const on = button.dataset.tab === next;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-selected', String(on));
    });
    paint(next);
  };

  paint(active);

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    // 顶栏返回：非「消息」板块先回到「消息」，已在「消息」才返回桌面
    if (target.closest('#chatapp-back')) {
      if (active !== 'chats') {
        selectTab('chats');
      } else {
        navigate('/desktop');
      }
      return;
    }

    // 朋友圈的空状态按钮和顶栏按钮，都走发表面板
    if (target.closest('[data-compose]') || target.closest('#chatapp-new')) {
      if (active === 'moments') {
        void openMomentComposer(() => paint('moments'));
        return;
      }
      if (target.closest('#chatapp-new')) {
        // 消息 / 联系人 板块的「+」= 去建角色
        navigate('/character/new');
        return;
      }
    }

    const tabButton = target.closest<HTMLElement>('[data-tab]');
    if (!tabButton) return;
    const next = tabButton.dataset.tab as Tab | undefined;
    if (!next) return;
    selectTab(next);
  });
}