/* ==========================================================================
   聊天美化 · 状态与持久化

   ⚠️ 移植自用户自己的项目 store/chat-beauty.js（Vue + Pinia → 原生模块）。
      行为逐条对应：editActive 自动派生副本、方案只读保护、undo 栈深 10、
      资源导入的类型/体积/尺寸校验，全部保留。

   存储位置变了：原项目用 localStorage + 一个独立 IndexedDB 放图片；
   本项目统一走 settings 表（和「我」的身份、气泡样式同一处），
   图片用 data URL 直接存 —— 理由见 importAsset 的注释。
   ========================================================================== */

import { getSetting, setSetting } from '../../../core/db';
import {
  APP_BEAUTY_KEY,
  BEAUTY_KEY,
  CHAT_ROOM_BEAUTY_PREFIX,
  NO_SHAPE,
  cloneBeauty,
  defaultBeautyData,
  defaultScheme,
  validateBeauty,
  type BeautyData,
  type BeautyScheme,
  type BubbleShape,
} from './model';

/** 默认方案的配色：全部取自设计令牌的实际值，不新增色相 */
const DEFAULT_BG = {
  background: '#f4f4f5',
  panel: '#ffffff',
  navigation: '#f4f4f5',
  accent: '#111114',
  ink: '#111114',
  muted: '#6f6f79',
  // 我 = 反色深底；角色 = 浅底。黑白灰基调下的「反色块红线」
  userFill: '#111114',
  charFill: '#ffffff',
} as const;

/**
 * 当前作用域。
 *
 * 空串 = 全局那套（聊天APP外壳）；角色 id = 这个角色的聊天室。
 * 面板打开时由调用方传进来，之后所有读写都跟着它走 ——
 * 这样「聊天室美化」和「我界面的美化」共用同一套代码，只是作用域不同。
 */
let scope = '';
let data: BeautyData = defaultBeautyData(DEFAULT_BG);
const undoStack: BeautyData[] = [];
let ready = false;

/** 当前作用域存储用的 key */
function storageKey(): string {
  return scope ? `${CHAT_ROOM_BEAUTY_PREFIX}${scope}` : BEAUTY_KEY;
}
/** 自定义资源（导入的 PNG / 背景图）→ data URL */
const assetUrls: Record<string, string> = {};

export function beautyData(): BeautyData {
  return data;
}

export function activeScheme(): BeautyScheme {
  return data.schemes.find((item) => item.id === data.activeSchemeId) ?? data.schemes[0]!;
}

export function beautyReady(): boolean {
  return ready;
}

export function assetUrl(id: string, flipped = false): string {
  if (flipped) return assetUrls[`${id}:flip`] ?? assetUrls[id] ?? '';
  return assetUrls[id] ?? '';
}

/** 启动时读一次。读到脏数据不抛错，回退默认并继续 —— 美化坏了不该让整个 App 打不开 */
/** 切到某个作用域并读出那套配置 */
export async function loadBeauty(nextScope = ''): Promise<void> {
  scope = nextScope;
  ready = false;
  undoStack.length = 0;
  try {
    const saved = await getSetting<unknown>(storageKey());
    if (saved) {
      data = validateBeauty(saved, DEFAULT_BG);
    } else if (scope) {
      /**
       * 聊天室没有自己的配置时，**继承全局那套**。
       *
       * 为什么不直接给默认值：用户在「我 → 聊天美化」里调好了气泡和头像挂件，
       * 打开一个新聊天室却看到一片默认灰 —— 那等于白调了。
       * 继承之后，房间里的修改只覆盖这一个房间。
       */
      const global = await getSetting<unknown>(BEAUTY_KEY);
      // 深拷贝一份，避免后面的 editActive 改到全局那份对象上
      data = global
        ? structuredClone(validateBeauty(global, DEFAULT_BG))
        : defaultBeautyData(DEFAULT_BG);
    } else {
      data = defaultBeautyData(DEFAULT_BG);
      await persist(data);
    }
  } catch {
    data = defaultBeautyData(DEFAULT_BG);
  }
  ready = true;
}

async function persist(next: BeautyData): Promise<BeautyData> {
  const clean = validateBeauty(next, DEFAULT_BG);
  await setSetting(storageKey(), clean);
  data = clean;
  return clean;
}

/**
 * 改当前方案。
 *
 * 默认方案是只读的基线：一旦改它，自动派生一个副本并切过去。
 * 这样「恢复默认」永远可用，用户也不会莫名其妙改掉基线却回不去。
 */
export async function editActive(mutator: (scheme: BeautyScheme) => void): Promise<void> {
  const next = cloneBeauty(data);
  let scheme = next.schemes.find((item) => item.id === next.activeSchemeId);
  if (scheme?.readonly) {
    scheme = {
      ...structuredClone(scheme),
      id: `scheme-${Date.now().toString(36)}`,
      name: '默认方案副本',
      readonly: false,
    };
    next.schemes.push(scheme);
    next.activeSchemeId = scheme.id;
  }
  if (!scheme) return;
  mutator(scheme);
  await persist(next);
}

/** 带回滚的修改：和 editActive 一样，但会把改之前的状态压进 undo 栈 */
export async function editActiveWithUndo(mutator: (scheme: BeautyScheme) => void): Promise<void> {
  const before = cloneBeauty(data);
  await editActive(mutator);
  undoStack.push(before);
  // 栈深 10，和原项目 `${undoStack.slice(-9)}, previous` 一致
  while (undoStack.length > 10) undoStack.shift();
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export async function undoBeauty(): Promise<void> {
  const previous = undoStack.pop();
  if (!previous) return;
  await persist(previous);
}

export async function selectScheme(id: string): Promise<void> {
  const next = cloneBeauty(data);
  if (!next.schemes.some((item) => item.id === id)) return;
  next.activeSchemeId = id;
  await persist(next);
}

export async function saveScheme(name: string): Promise<void> {
  const value = String(name ?? '').trim().slice(0, 40);
  if (!value) throw new Error('方案名称不能为空。');
  const next = cloneBeauty(data);
  const scheme: BeautyScheme = {
    ...structuredClone(activeScheme()),
    id: `scheme-${Date.now().toString(36)}`,
    name: value,
    readonly: false,
  };
  next.schemes.push(scheme);
  next.activeSchemeId = scheme.id;
  await persist(next);
}

export async function renameScheme(id: string, name: string): Promise<void> {
  const value = String(name ?? '').trim().slice(0, 40);
  if (!value) throw new Error('方案名称不能为空。');
  const next = cloneBeauty(data);
  const item = next.schemes.find((scheme) => scheme.id === id);
  if (!item || item.readonly) throw new Error('默认方案不能重命名。');
  item.name = value;
  await persist(next);
}

export async function removeScheme(id: string): Promise<void> {
  const next = cloneBeauty(data);
  const item = next.schemes.find((scheme) => scheme.id === id);
  if (!item || item.readonly) throw new Error('默认方案不能删除。');
  next.schemes = next.schemes.filter((scheme) => scheme.id !== id);
  next.activeSchemeId = next.schemes[0]!.id;
  await persist(next);
}

/** 把当前方案恢复成默认值，但保留 id / 名字 / 只读标记 */
export async function resetActive(): Promise<void> {
  const next = cloneBeauty(data);
  const index = next.schemes.findIndex((item) => item.id === next.activeSchemeId);
  if (index < 0) return;
  const reset = structuredClone(defaultScheme(DEFAULT_BG));
  next.schemes[index] = {
    ...reset,
    id: next.schemes[index]!.id,
    name: next.schemes[index]!.name,
    readonly: next.schemes[index]!.readonly,
  };
  await persist(next);
}

/* ==========================================================================
   资源导入
   ========================================================================== */

/** 限制与原项目一致 */
const LIMITS = {
  background: { types: ['image/png', 'image/webp', 'image/jpeg'], maxBytes: 8 * 1024 * 1024, maxPixels: 20_000_000 },
  pendant: { types: ['image/png', 'image/webp'], maxBytes: 3 * 1024 * 1024, maxPixels: 9_000_000 },
} as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
}

function decodeSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('图片已损坏或无法读取。'));
    image.src = dataUrl;
  });
}

/**
 * 导入一张自定义资源。
 *
 * @returns 资源 id，调用方拿它去设 frameId / assetId
 *
 * ⚠️ 为什么用 data URL 而不是原项目那样的独立 IndexedDB + Blob：
 *   Blob 要用 `URL.createObjectURL`，每次刷新都得重新创建、旧的要 revoke，
 *   一旦漏了就泄漏内存；而且多一个数据库就多一套打开/关闭/异常处理。
 *   统一存 data URL 后，读出来直接能塞进 <img src>，没有生命周期问题。
 *   代价是记录变大 —— 所以体积上限卡死（挂件 3MB / 背景 8MB），
 *   并且在高压缩的 PNG / WebP 上要求透明背景，实际文件通常只有几十 KB。
 */
export async function importAsset(file: File, kind: 'frame' | 'sticker' | 'background'): Promise<string> {
  const limit = kind === 'background' ? LIMITS.background : LIMITS.pendant;
  const label = kind === 'background' ? '聊天背景' : '挂件';

  if (!limit.types.includes(file.type as never)) {
    throw new Error(
      kind === 'background' ? '聊天背景只支持 PNG、WebP 或 JPEG 图片。' : '挂件只支持透明 PNG 或 WebP 图片。',
    );
  }
  if (!file.size || file.size > limit.maxBytes) {
    throw new Error(`${label}不能为空或超过 ${Math.round(limit.maxBytes / 1024 / 1024)} MB。`);
  }

  const dataUrl = await readFileAsDataUrl(file);
  const size = await decodeSize(dataUrl);
  if (!size.width || !size.height || size.width * size.height > limit.maxPixels) {
    throw new Error(`${label}尺寸过大。`);
  }

  const id = `beauty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  assetUrls[id] = dataUrl;

  // 资源本体也存进 settings —— 一个 key 存一张，避免把整个资源表塞进主配置
  await setSetting(`beautyAsset:${id}`, dataUrl);

  const next = cloneBeauty(data);
  next.customAssets.push({
    id,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 50) || (kind === 'background' ? '聊天背景' : '我的挂件'),
    type: kind === 'background' ? 'background' : kind === 'sticker' ? 'sticker' : 'frame',
    category: kind === 'background' ? '我的背景' : '我的挂件',
  });
  await persist(next);
  return id;
}

/**
 * 从 data URL 导入（面板里用的是 pickPhoto，它已经把图裁剪并编码成 data URL）。
 *
 * 和 importAsset(File) 同一套校验，只是绕过读文件那一步。
 * 两个入口都存在是有意的：File 版给「选原图」，dataUrl 版给「先裁剪再导入」。
 */
export async function importAssetFromDataUrl(
  dataUrl: string,
  kind: 'frame' | 'sticker' | 'background',
  name = '',
): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) throw new Error('图片格式不正确。');
  const limit = kind === 'background' ? LIMITS.background : LIMITS.pendant;
  const label = kind === 'background' ? '聊天背景' : '挂件';

  // data URL 的字节数 ≈ 长度 × 3/4，用来粗略挡住超大文件
  const bytes = Math.floor((dataUrl.length * 3) / 4);
  if (bytes > limit.maxBytes) {
    throw new Error(`${label}超过 ${Math.round(limit.maxBytes / 1024 / 1024)} MB。`);
  }

  const size = await decodeSize(dataUrl);
  if (!size.width || !size.height || size.width * size.height > limit.maxPixels) {
    throw new Error(`${label}尺寸过大。`);
  }

  const id = `beauty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  assetUrls[id] = dataUrl;
  await setSetting(`beautyAsset:${id}`, dataUrl);

  const next = cloneBeauty(data);
  next.customAssets.push({
    id,
    name: (name || (kind === 'background' ? '聊天背景' : '我的挂件')).slice(0, 50),
    type: kind === 'background' ? 'background' : kind === 'sticker' ? 'sticker' : 'frame',
    category: kind === 'background' ? '我的背景' : '我的挂件',
  });
  await persist(next);
  return id;
}

async function flipDataUrl(dataUrl: string): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

/** 确保指定自定义气泡已有左右镜像图缓存（老数据懒生成） */
export async function ensureFlippedBubbleAsset(id: string): Promise<void> {
  if (assetUrls[`${id}:flip`]) return;
  const orig = assetUrls[id] ?? (await getSetting<string>(`beautyAsset:${id}`));
  if (typeof orig !== 'string' || !orig) return;
  assetUrls[id] = orig;
  const flipped = await flipDataUrl(orig).catch(() => '');
  if (!flipped) return;
  assetUrls[`${id}:flip`] = flipped;
  await setSetting(`beautyAsset:${id}:flip`, flipped).catch(() => undefined);
}

/** 导入一张截图裁剪后的自定义气泡（带九宫格参数） */
export async function importCustomBubble(
  dataUrl: string,
  bubbleShape: Omit<BubbleShape, 'shapeId'>,
  name = '',
): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) throw new Error('图片格式不正确。');
  const bytes = Math.floor((dataUrl.length * 3) / 4);
  if (bytes > LIMITS.pendant.maxBytes) {
    throw new Error(`气泡图片超过 ${Math.round(LIMITS.pendant.maxBytes / 1024 / 1024)} MB。`);
  }

  const size = await decodeSize(dataUrl);
  if (!size.width || !size.height || size.width * size.height > LIMITS.pendant.maxPixels) {
    throw new Error('气泡图片尺寸过大。');
  }

  const id = `beauty-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  assetUrls[id] = dataUrl;
  await setSetting(`beautyAsset:${id}`, dataUrl);

  const flippedUrl = await flipDataUrl(dataUrl).catch(() => '');
  if (flippedUrl) {
    assetUrls[`${id}:flip`] = flippedUrl;
    await setSetting(`beautyAsset:${id}:flip`, flippedUrl).catch(() => undefined);
  }

  const next = cloneBeauty(data);
  next.customAssets.push({
    id,
    name: (name.trim() || '自定义气泡').slice(0, 50),
    type: 'bubble',
    category: '我的气泡',
    bubbleShape,
  });
  await persist(next);
  return id;
}

/** 删除一个自定义资源（并从当前方案中解绑引用） */
export async function removeCustomAsset(id: string): Promise<void> {
  const next = cloneBeauty(data);
  next.customAssets = next.customAssets.filter((item) => item.id !== id);
  for (const scheme of next.schemes) {
    if (scheme.readonly) continue;
    for (const role of ['user', 'wuli'] as const) {
      const p = scheme.participants[role];
      if (p.avatar.frameId === id) p.avatar.frameId = '';
      p.avatar.stickers = p.avatar.stickers.filter((s) => s.assetId !== id);
      p.bubble.stickers = p.bubble.stickers.filter((s) => s.assetId !== id);
      if (p.bubble.bubbleShape.shapeId === id) {
        p.bubble.bubbleShape = {
          ...NO_SHAPE,
          slice: [...NO_SHAPE.slice] as BubbleShape['slice'],
          width: [...NO_SHAPE.width] as BubbleShape['width'],
        };
      }
    }
    if (scheme.background.assetId === id) scheme.background.assetId = '';
  }
  delete assetUrls[id];
  delete assetUrls[`${id}:flip`];
  await persist(next);
}

/** 启动时把所有自定义资源读进内存，供 <img src> 直接用 */
export async function loadAssets(): Promise<void> {
  for (const asset of data.customAssets) {
    try {
      if (!assetUrls[asset.id]) {
        const url = await getSetting<string>(`beautyAsset:${asset.id}`);
        if (typeof url === 'string' && url) assetUrls[asset.id] = url;
      }
      if (asset.type === 'bubble' && !assetUrls[`${asset.id}:flip`]) {
        const flipUrl = await getSetting<string>(`beautyAsset:${asset.id}:flip`);
        if (typeof flipUrl === 'string' && flipUrl) {
          assetUrls[`${asset.id}:flip`] = flipUrl;
        } else if (assetUrls[asset.id]) {
          await ensureFlippedBubbleAsset(asset.id);
        }
      }
    } catch {
      // 单张资源读不出来不该让整个美化失效
    }
  }
}

/* ==========================================================================
   我自己的头像框：统一入口

   以前「我」页面把框存进 core/prefs 的 userAvatarFrame，
   而聊天里渲染的是美化的 participants.user.avatar.frameId —— 两套数据，
   点了框聊天里不显示。

   现在统一到美化系统。prefs 里那个字段只作为老数据兼容（见 adoptLegacyFrame）。
   ========================================================================== */

/** 我自己的头像框现在存在美化里 */
export function myAvatarFrame(): string {
  return activeScheme().participants.user.avatar.frameId;
}

export async function setMyAvatarFrame(frameId: string): Promise<void> {
  await editActive((scheme) => {
    scheme.participants.user.avatar.frameId = frameId;
  });
}

/**
 * 老数据迁移：如果 prefs 里存过框，而美化里还没有，就搬过来。
 *
 * 只在「美化里是空的」且「prefs 里有值」时搬一次，
 * 搬完之后 prefs 那个字段就不再被读 —— 不删，避免破坏别的东西。
 */
export async function adoptLegacyFrame(legacy: string): Promise<boolean> {
  if (!legacy) return false;
  if (activeScheme().participants.user.avatar.frameId) return false;
  await setMyAvatarFrame(legacy);
  return true;
}

/* ==========================================================================
   聊天 APP 全局外观

   只有「界面」那 6 个色位。它作用在 .chatapp 上（列表 / 通讯录 / 朋友圈 / 我），
   不碰聊天室里的气泡和背景 —— 那些属于每个角色自己的配置。
   ========================================================================== */

export interface AppAppearance {
  background: string;
  panel: string;
  navigation: string;
  accent: string;
  ink: string;
  muted: string;
}

/**
 * 聊天APP 的默认外观：黑白灰调，与项目主体（design/tokens.css）一致。
 *
 * 六个字段的分工：
 *   background  页面底（列表行之间的缝）
 *   panel       卡片/行（白）
 *   navigation  顶栏与底栏
 *   accent      选中态（底栏当前项、开关）
 *   ink         主文字
 *   muted       次要文字（预览、时间）
 *
 * ⚠️ 这里只是「默认值」。用户在面板里改过就以用户的为准，
 * 「恢复默认外观」回到的就是这一组。
 */
const DEFAULT_APP: AppAppearance = {
  background: '#F4F4F5',
  panel: '#FFFFFF',
  navigation: '#FAFAFA',
  accent: '#111114',
  ink: '#111114',
  muted: '#6F6F79',
};

/** 历史蓝白默认配色（用于无感迁移：从未自定义过的老设备自动切到新默认） */
const LEGACY_SKY_DEFAULT_APP: AppAppearance = {
  background: '#FAFBFF',
  panel: '#FFFFFF',
  navigation: '#F0F4FF',
  accent: '#009AFF',
  ink: '#111114',
  muted: '#9A9AA2',
};

let appAppearance: AppAppearance = { ...DEFAULT_APP };

export function appAppearanceOf(): AppAppearance {
  return { ...appAppearance };
}

function sameApp(a: AppAppearance, b: AppAppearance): boolean {
  return (Object.keys(DEFAULT_APP) as Array<keyof AppAppearance>).every((key) => a[key] === b[key]);
}

function cleanApp(value: unknown): AppAppearance {
  const source = (value ?? {}) as Record<string, unknown>;
  const pick = (key: keyof AppAppearance): string => {
    const raw = source[key];
    return typeof raw === 'string' && /^#[\da-f]{6}$/i.test(raw)
      ? raw.toUpperCase()
      : DEFAULT_APP[key];
  };
  return {
    background: pick('background'),
    panel: pick('panel'),
    navigation: pick('navigation'),
    accent: pick('accent'),
    ink: pick('ink'),
    muted: pick('muted'),
  };
}

export async function loadAppAppearance(): Promise<void> {
  try {
    const loaded = cleanApp(await getSetting<unknown>(APP_BEAUTY_KEY));
    if (sameApp(loaded, LEGACY_SKY_DEFAULT_APP)) {
      appAppearance = { ...DEFAULT_APP };
      await setSetting(APP_BEAUTY_KEY, appAppearance);
      return;
    }
    appAppearance = loaded;
  } catch {
    appAppearance = { ...DEFAULT_APP };
  }
}

export async function setAppAppearance(patch: Partial<AppAppearance>): Promise<void> {
  appAppearance = cleanApp({ ...appAppearance, ...patch });
  await setSetting(APP_BEAUTY_KEY, appAppearance);
}

export function appAppearanceIsDefault(): boolean {
  return (Object.keys(DEFAULT_APP) as Array<keyof AppAppearance>).every(
    (key) => appAppearance[key] === DEFAULT_APP[key],
  );
}

export async function resetAppAppearance(): Promise<void> {
  appAppearance = { ...DEFAULT_APP };
  await setSetting(APP_BEAUTY_KEY, appAppearance);
}
