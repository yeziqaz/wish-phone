import { getSetting, setSetting } from './db';

/**
 * 全局偏好 —— 那些「一行开关」就能表达的东西。
 *
 * 为什么单独一个文件：设置页要**写**它、桌面要**读**它，
 * 而 features 之间不许互相 import（AGENTS.md 铁律 3）。放 core/ 两边都能用。
 *
 * 另外这里刻意不使用 DOM 的 addEventListener / CustomEvent ——
 * core/ 要能在没有 DOM 的环境里跑（铁律 1），所以自己写了个极简订阅。
 */

/** 桌面顶部状态栏（时间 / 信号 / 电量）的开关 */
export const SHOW_STATUS_BAR_KEY = 'showStatusBar';

/** 聊天里把角色的动作 / 心理描写单独剥出来显示 */
export const SHOW_ACTION_NOTE_KEY = 'showActionNote';

/**
 * 「我」的身份 —— 用户在聊天里叫什么、长什么样。
 *
 * 存成 settings 表里的两个 key，不新建表：
 *   这个数据只有一份、永远只有一份（用户就是用户），
 *   为它建一张表要走 schema 迁移，不划算。
 */
export const USER_NAME_KEY = 'userName';
export const USER_AVATAR_KEY = 'userAvatar';
export const USER_SIGNATURE_KEY = 'userSignature';
export const USER_AVATAR_FRAME_KEY = 'userAvatarFrame';

type Listener = () => void;

const listeners = new Set<Listener>();

/** 订阅「偏好变了」。返回取消订阅的函数 */
export function onPrefsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** 内存里的一份，给同步渲染用。null = 还没加载 */
let statusBar: boolean | null = null;
let actionNote: boolean | null = null;

/** 用户身份。空字符串 = 没设过，界面用「我」兜底 */
let userName = '';
let userAvatar = '';
let userSignature = '';
let avatarFrameId = '';

/** 启动时读一次。没存过就是开 —— 用户没表态时不该「悄悄关掉」 */
export async function loadPrefs(): Promise<void> {
  const [barValue, noteValue, nameValue, avatarValue, signatureValue, frameValue] = await Promise.all([
    getSetting<boolean>(SHOW_STATUS_BAR_KEY),
    getSetting<boolean>(SHOW_ACTION_NOTE_KEY),
    getSetting<string>(USER_NAME_KEY),
    getSetting<string>(USER_AVATAR_KEY),
    getSetting<string>(USER_SIGNATURE_KEY),
    getSetting<string>(USER_AVATAR_FRAME_KEY),
  ]);
  // 顶栏：没表态时开（没存过不该「悄悄关掉」）
  statusBar = barValue !== false;
  // 动作描写：没表态时关。这是附加功能，默认不打扰对话
  actionNote = noteValue === true;
  userName = typeof nameValue === 'string' ? nameValue : '';
  userAvatar = typeof avatarValue === 'string' ? avatarValue : '';
  userSignature = typeof signatureValue === 'string' ? signatureValue : '';
  avatarFrameId = typeof frameValue === 'string' ? frameValue : '';
  emit();
}

/** 桌面顶栏该不该显示。还没加载完时默认显示 */
export function statusBarVisible(): boolean {
  return statusBar !== false;
}

export function setStatusBarVisible(on: boolean): void {
  statusBar = on;
  void setSetting(SHOW_STATUS_BAR_KEY, on);
  emit();
}

/**
 * 聊天里要不要把角色的动作 / 心理单独剥出来显示。
 *
 * 默认关：一进来就是干净的纯对话气泡。
 * 想看的用户自己去「设置 → 聊天」打开。
 */
export function actionNoteVisible(): boolean {
  return actionNote === true;
}

export function setActionNoteVisible(on: boolean): void {
  actionNote = on;
  void setSetting(SHOW_ACTION_NOTE_KEY, on);
  emit();
}


/* ---------- 「我」的身份 ---------- */

/** 用户在聊天里叫什么。没设过就是「我」 */
export function displayUserName(): string {
  const trimmed = userName.trim();
  return trimmed || '我';
}

/** 用户头像的 key（data URL 或空） */
export function userAvatarKey(): string {
  return userAvatar;
}

/** 个性签名，没设就是空 */
export function userSignatureText(): string {
  return userSignature.trim();
}

export function setUserName(name: string): void {
  userName = name;
  void setSetting(USER_NAME_KEY, name);
  emit();
}

export function setUserAvatar(key: string): void {
  userAvatar = key;
  void setSetting(USER_AVATAR_KEY, key);
  emit();
}

export function setUserSignature(text: string): void {
  userSignature = text;
  void setSetting(USER_SIGNATURE_KEY, text);
  emit();
}

/** 用户头像框的内置 id（空 = 无框） */
export function userAvatarFrame(): string {
  return avatarFrameId;
}

export function setUserAvatarFrame(id: string): void {
  avatarFrameId = id;
  void setSetting(USER_AVATAR_FRAME_KEY, id);
  emit();
}
