/* ==========================================================================
   聊天美化 · 数据模型与预设目录

   ⚠️ 这份数据模型**原样移植自用户自己的项目**（yeziqaz/test，MIT 许可，作者本人授权：
      「那本来就是我自己做的东西，直接照抄过来」）。除了把 ESLint 风格的 JS 翻成 TS、
      把 Vue 的 props 换成普通参数之外，**字段名、预设名、颜色、数值范围一个字没改**。

     原文件：frontend/src/store/chat-beauty-data.js
             frontend/src/store/chat-beauty.js
             frontend/src/apps/chat/chat-beauty-css.js

   为什么不能直接拷 .vue：本项目宪法 §1 禁止引入 Vue。所以只能移植设计，
   但把 6 个板块、全部预设、全部数值范围都完整搬过来 —— 不删功能、不简化。
   ========================================================================== */

export const BEAUTY_KEY = 'chatBeauty';
export const BEAUTY_VERSION = 2;

/* ---------- 面板的六个板块（原 CHAT_BEAUTY_TABS） ---------- */

export interface BeautyTab {
  id: string;
  label: string;
}

export const BEAUTY_TABS: BeautyTab[] = [
  { id: 'interface', label: '界面' },
  { id: 'avatar', label: '头像挂件' },
  { id: 'bubble', label: '气泡' },
  { id: 'background', label: '聊天背景' },
  { id: 'font', label: '字体' },
  { id: 'schemes', label: '方案' },
];

/* ---------- 挂件预设（原 PENDANT_PRESETS，8 个，分类/颜色/glyph 原样） ---------- */

export type PendantType = 'frame' | 'sticker';

export interface PendantPreset {
  id: string;
  type: PendantType;
  category: string;
  name: string;
  glyph: string;
  color: string;
}

export const PENDANT_PRESETS: PendantPreset[] = [
  { id: 'frame-blossom', type: 'frame', category: '软萌可爱', name: '樱花枝', glyph: '✿', color: '#e6a6ba' },
  { id: 'frame-lace', type: 'frame', category: '软萌可爱', name: '甜心蕾丝', glyph: '✦', color: '#d891bd' },
  { id: 'frame-orbit', type: 'frame', category: '梦幻', name: '星球环', glyph: '◌', color: '#9f9be8' },
  { id: 'frame-cat', type: 'frame', category: '萌宠', name: '猫耳朵', glyph: '⌃', color: '#e99aa8' },
  { id: 'sticker-star', type: 'sticker', category: '梦幻', name: '小星星', glyph: '★', color: '#f1c85c' },
  { id: 'sticker-heart', type: 'sticker', category: '软萌可爱', name: '爱心', glyph: '♥', color: '#e88aa4' },
  { id: 'sticker-paw', type: 'sticker', category: '萌宠', name: '肉垫', glyph: '●', color: '#c995c9' },
  { id: 'sticker-label', type: 'sticker', category: '马卡龙', name: '小牌子', glyph: '▱', color: '#7fa8cf' },
];

/* ---------- 气泡预设（原 BUBBLE_PRESETS，4 个，原样） ---------- */

export interface BubblePreset {
  id: string;
  name: string;
  fill: string;
  border: string;
  radius: number;
  shadow: number;
}

export const BUBBLE_PRESETS: BubblePreset[] = [
  { id: 'soft', name: '柔和填充', fill: '#ffffff', border: '#e8dfe6', radius: 16, shadow: 0 },
  { id: 'pink', name: '浅粉心情', fill: '#f7d7e3', border: '#efbfd2', radius: 22, shadow: 8 },
  { id: 'mint', name: '薄荷泡泡', fill: '#dcefe7', border: '#c4e0d4', radius: 18, shadow: 5 },
  { id: 'glass', name: '轻透玻璃', fill: '#ffffff99', border: '#ffffffaa', radius: 20, shadow: 14 },
];

/* ---------- 数据结构 ---------- */

/** 角标位置（气泡贴纸用） */
export type StickerCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/* ---------- 异形气泡（9-slice） ----------

   来历：用户 2026-11-12 给了一份《聊天异形气泡制作教程》，
   详见 docs/research/异形气泡技术调研.md。

   为什么气泡形状要单独一组数据，而不是塞进 Sticker：
     贴纸是「贴在气泡上的东西」，形状是「气泡本身长什么样」。
     前者可以有很多张、随便挪；后者只能有一个，且决定了边框怎么画。

   为什么用 9-slice 而不是一张整图：
     消息长度不定 —— 「嗯」和一大段话要用同一个样式。
     9-slice 的四个角固定、中心跟着文字拉伸，这是唯一能同时满足两者的做法。
     换成整图就会被拉变形。

   ---------- 字段 ----------

   shapeId   空 = 不用异形（走原来的圆角矩形）。
             否则是 BUBBLE_SHAPES 里的预设 id，或用户导入素材的 id。
   slice     「切成九块」的切线，单位是**图片像素**，顺序 上 右 下 左。
             这是 9-slice 的核心参数，量错了角会变形。
   width     渲染时 border 实际占多少 CSS 像素，顺序 上 右 下 左。
             可以比 slice 小 —— 那是「把装饰缩小」的手段。
   fillMode  边条怎么填：stretch 拉伸 / round 重复 / space 均分。
             规律纹理（条纹）用 round 不会拉糊。

   ⚠️ 图片必须是真透明背景的 PNG。JPG 或白底 PNG 会让四角出现白方块。
      我们自己的预设用内联 SVG（data URI），天然透明，且不违反
      「不许远程资源 CDN」这条铁律。 */
export interface BubbleShape {
  /** '' = 纯圆角矩形 */
  shapeId: string;
  /** 切线：上 右 下 左（图片像素） */
  slice: [number, number, number, number];
  /** 边框占位：上 右 下 左（CSS px） */
  width: [number, number, number, number];
  fillMode: 'stretch' | 'round' | 'space';
  /** 自定义截图气泡的文字颜色（空 = 按 bubble.fill 自动算） */
  ink?: string;
  /** 是否左右镜像翻转（同一张气泡图可一键适配左/右两测） */
  flipped?: boolean;
}

/** 不启用异形时的值 */
export const NO_SHAPE: BubbleShape = {
  shapeId: '',
  slice: [0, 0, 0, 0],
  width: [0, 0, 0, 0],
  fillMode: 'stretch',
};

export interface Sticker {
  /** 预设 id 或自定义资源 id */
  assetId: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
  corner: StickerCorner;
}

export interface Participant {
  avatar: {
    frameId: string;
    stickers: Sticker[];
  };
  bubble: {
    templateId: string;
    fill: string;
    gradientColor: string;
    gradientAngle: number;
    opacity: number;
    radius: number;
    shadow: number;
    border: string;
    borderWidth: number;
    stickers: Sticker[];
    bubbleShape: BubbleShape;
  };
}

/** 'user' = 我，'wuli' = 角色。原项目写死这两个键，这里保持同名 */
export type BeautyRole = 'user' | 'wuli';

export interface BeautyScheme {
  id: string;
  name: string;
  readonly: boolean;
  app: {
    background: string;
    panel: string;
    navigation: string;
    accent: string;
    ink: string;
    muted: string;
  };
  background: {
    assetId: string;
    color: string;
    blur: number;
    overlay: number;
  };
  font: {
    familyId: string;
    size: number;
    color: string;
  };
  participants: Record<BeautyRole, Participant>;
  customCss: {
    source: string;
    enabled: boolean;
  };
}

export interface CustomAsset {
  id: string;
  name: string;
  type: 'sticker' | 'background' | 'frame' | 'bubble';
  category: string;
  /** 自定义气泡导入时保存的默认九宫格参数 */
  bubbleShape?: Omit<BubbleShape, 'shapeId'>;
}

export interface BeautyData {
  version: number;
  activeSchemeId: string;
  customAssets: CustomAsset[];
  schemes: BeautyScheme[];
}

/* ---------- 默认方案的取值 ---------- */

/** 空气泡（没有选模板时的基线） */
function blankBubble(fill: string): Participant['bubble'] {
  return {
    templateId: '',
    fill,
    gradientColor: '',
    gradientAngle: 135,
    opacity: 1,
    radius: 4,
    shadow: 0,
    border: fill,
    borderWidth: 0,
    stickers: [],
    bubbleShape: { ...NO_SHAPE, slice: [...NO_SHAPE.slice], width: [...NO_SHAPE.width] },
  };
}

export function blankParticipant(bubbleFill: string): Participant {
  return {
    avatar: { frameId: '', stickers: [] },
    bubble: blankBubble(bubbleFill),
  };
}

/**
 * 默认方案。
 *
 * ⚠️ 唯一一处有意偏离原项目：原默认让「我」的气泡是 `#A6E976`（薄荷绿），
 *    角色是白色。本项目基调是**黑白灰描边**（design/STYLE.md §4「反色块红线」），
 *    所以这里改成「我 = 反色深底、角色 = 浅底描边」，视觉关系完全一致，
 *    只是不引入新色相。其余所有字段名、数值、范围都与原项目相同。
 */
export function defaultScheme(bg: {
  background: string;
  panel: string;
  navigation: string;
  accent: string;
  ink: string;
  muted: string;
  userFill: string;
  charFill: string;
}): BeautyScheme {
  return {
    id: 'default',
    name: '默认方案',
    readonly: true,
    app: {
      background: bg.background,
      panel: bg.panel,
      navigation: bg.navigation,
      accent: bg.accent,
      ink: bg.ink,
      muted: bg.muted,
    },
    background: { assetId: '', color: bg.background, blur: 0, overlay: 0 },
    font: { familyId: '', size: 16, color: bg.ink },
    participants: {
      user: blankParticipant(bg.userFill),
      wuli: blankParticipant(bg.charFill),
    },
    customCss: { source: '', enabled: false },
  };
}

export function defaultBeautyData(bg: Parameters<typeof defaultScheme>[0]): BeautyData {
  return {
    version: BEAUTY_VERSION,
    activeSchemeId: 'default',
    customAssets: [],
    schemes: [defaultScheme(bg)],
  };
}

/* ---------- 校验（原 validateChatBeauty，逐条对应） ---------- */

function hex(value: unknown, fallback: string): string {
  // 回退值也统一大写 —— 否则库里会同时出现 #ffffff 和 #FFFFFF 两种写法，
  // 用 === 比较颜色时就会莫名其妙不相等
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : fallback.toUpperCase();
}

function optionalHex(value: unknown, fallback = ''): string {
  return value === '' || value == null ? fallback : hex(value, fallback);
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanStickers(value: unknown): Sticker[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .filter((item): item is Record<string, unknown> => !!item && typeof item.assetId === 'string')
    .map((item) => ({
      assetId: String(item.assetId).slice(0, 100),
      x: bounded(item.x, -80, 80, 0),
      y: bounded(item.y, -80, 80, 0),
      scale: bounded(item.scale, 0.3, 3, 1),
      rotation: bounded(item.rotation, -180, 180, 0),
      zIndex: Math.round(bounded(item.zIndex, 0, 20, 1)),
      corner: (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).includes(
        item.corner as StickerCorner,
      )
        ? (item.corner as StickerCorner)
        : 'top-right',
    }));
}

/**
 * 校验异形气泡数据。
 *
 * 字符段全部按上限夹住 —— 这些数字会直接进 CSS，超范围的切线会让整个气泡消失。
 * 切线最大 400：再大就超过任何合理图片的尺寸了，说明数据坏了。
 */
function cleanShape(value: unknown): BubbleShape {
  const raw = (value ?? {}) as Record<string, unknown>;

  const shapeId = typeof raw.shapeId === 'string' ? raw.shapeId.slice(0, 100) : '';

  const pair = (input: unknown): [number, number, number, number] => {
    const list = Array.isArray(input) ? input : [];
    const num = (item: unknown): number => {
      const n = Number(item);
      return Number.isFinite(n) ? Math.max(0, Math.min(400, Math.round(n))) : 0;
    };
    return [num(list[0]), num(list[1]), num(list[2]), num(list[3])];
  };

  const mode = raw.fillMode;
  const fillMode: BubbleShape['fillMode'] =
    mode === 'round' || mode === 'space' ? mode : 'stretch';

  const ink = optionalHex(raw.ink, '');
  const flipped = raw.flipped === true;

  return {
    shapeId,
    slice: pair(raw.slice),
    width: pair(raw.width),
    fillMode,
    ...(ink ? { ink } : {}),
    ...(flipped ? { flipped: true } : {}),
  };
}

function cleanParticipant(value: unknown, fallback: Participant): Participant {
  const source = (value ?? {}) as Record<string, unknown>;
  const avatar = (source.avatar ?? {}) as Record<string, unknown>;
  const bubble = (source.bubble ?? {}) as Record<string, unknown>;
  return {
    avatar: {
      frameId: typeof avatar.frameId === 'string' ? avatar.frameId.slice(0, 100) : fallback.avatar.frameId,
      stickers: cleanStickers(avatar.stickers),
    },
    bubble: {
      templateId:
        typeof bubble.templateId === 'string' ? bubble.templateId.slice(0, 100) : fallback.bubble.templateId,
      fill: hex(bubble.fill, fallback.bubble.fill),
      opacity: bounded(bubble.opacity, 0, 1, fallback.bubble.opacity),
      radius: bounded(bubble.radius, 0, 36, fallback.bubble.radius),
      shadow: bounded(bubble.shadow, 0, 30, fallback.bubble.shadow),
      gradientColor: optionalHex(bubble.gradientColor, fallback.bubble.gradientColor),
      gradientAngle: bounded(bubble.gradientAngle, 0, 360, fallback.bubble.gradientAngle),
      border: hex(bubble.border, fallback.bubble.border),
      borderWidth: bounded(bubble.borderWidth, 0, 6, fallback.bubble.borderWidth),
      stickers: cleanStickers(bubble.stickers),
      bubbleShape: cleanShape(bubble.bubbleShape),
    },
  };
}

/**
 * 读回来的东西一律过一遍这里。
 * 所有越界值都被夹回合法区间，坏掉的颜色回退到默认 —— 绝不因为一条脏数据让整页崩。
 */
export function validateBeauty(value: unknown, bg: Parameters<typeof defaultScheme>[0]): BeautyData {
  const fallback = defaultBeautyData(bg);
  const source = value as Partial<BeautyData> | null;
  if (!source || !Array.isArray(source.schemes)) return fallback;

  const base = fallback.schemes[0]!;
  const schemes: BeautyScheme[] = source.schemes.slice(0, 30).map((item, index) => {
    const raw = (item ?? {}) as Partial<BeautyScheme> & Record<string, unknown>;
    // 默认方案永远是只读的基线，不信任库里存的那份
    if (raw.id === 'default' && raw.readonly) return base;
    const app = (raw.app ?? {}) as Record<string, unknown>;
    const background = (raw.background ?? {}) as Record<string, unknown>;
    const font = (raw.font ?? {}) as Record<string, unknown>;
    const customCss = (raw.customCss ?? {}) as Record<string, unknown>;
    const participants = (raw.participants ?? {}) as Record<string, unknown>;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : `scheme-${index}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : `方案 ${index + 1}`,
      readonly: !!raw.readonly,
      app: {
        background: hex(app.background, base.app.background),
        panel: hex(app.panel, base.app.panel),
        navigation: hex(app.navigation, base.app.navigation),
        accent: hex(app.accent, base.app.accent),
        ink: hex(app.ink, base.app.ink),
        muted: hex(app.muted, base.app.muted),
      },
      background: {
        assetId: typeof background.assetId === 'string' ? background.assetId.slice(0, 100) : '',
        color: hex(background.color, base.background.color),
        blur: bounded(background.blur, 0, 20, 0),
        overlay: bounded(background.overlay, 0, 1, 0),
      },
      font: {
        familyId: typeof font.familyId === 'string' ? font.familyId.slice(0, 100) : '',
        size: bounded(font.size, 12, 24, 16),
        color: hex(font.color, base.font.color),
      },
      participants: {
        user: cleanParticipant(participants.user, base.participants.user),
        wuli: cleanParticipant(participants.wuli, base.participants.wuli),
      },
      customCss: {
        source: typeof customCss.source === 'string' ? customCss.source.slice(0, 60000) : '',
        enabled: !!customCss.enabled,
      },
    };
  });

  if (!schemes.length) schemes.push(base);

  const activeSheetId =
    typeof source.activeSchemeId === 'string' && schemes.some((item) => item.id === source.activeSchemeId)
      ? source.activeSchemeId
      : schemes[0]!.id;

  const customAssets: CustomAsset[] = Array.isArray(source.customAssets)
    ? source.customAssets
        .slice(0, 120)
        .filter((item): item is CustomAsset => !!item && /^beauty-[a-zA-Z0-9-]+$/.test(item.id ?? ''))
        .map((item) => {
          const type: CustomAsset['type'] = (['sticker', 'background', 'bubble'] as const).includes(
            item.type as 'sticker' | 'background' | 'bubble',
          )
            ? (item.type as CustomAsset['type'])
            : 'frame';
          const defaultName =
            type === 'background' ? '聊天背景' : type === 'bubble' ? '自定义气泡' : '我的挂件';
          const category =
            type === 'background' ? '我的背景' : type === 'bubble' ? '我的气泡' : '我的挂件';
          const baseAsset: CustomAsset = {
            id: item.id,
            name: String(item.name ?? defaultName).slice(0, 50),
            type,
            category,
          };
          if (type === 'bubble' && item.bubbleShape) {
            const cleaned = cleanShape({ ...item.bubbleShape, shapeId: item.id });
            const { shapeId: _, ...rest } = cleaned;
            baseAsset.bubbleShape = rest;
          }
          return baseAsset;
        })
    : [];

  return { version: BEAUTY_VERSION, activeSchemeId: activeSheetId, customAssets, schemes };
}

export function cloneBeauty(value: BeautyData): BeautyData {
  return structuredClone(value);
}

/** 全部可选挂件 = 内置预设 + 自定义资源（不含聊天背景和自定义气泡） */
export function allPendants(data: BeautyData): PendantPreset[] {
  const custom: PendantPreset[] = data.customAssets
    .filter((item) => item.type !== 'background' && item.type !== 'bubble')
    .map((item) => ({
      id: item.id,
      type: item.type === 'sticker' ? 'sticker' : 'frame',
      category: item.category,
      name: item.name,
      glyph: '★',
      color: 'currentColor',
    }));
  return [...PENDANT_PRESETS, ...custom];
}

/** 用户导入的自定义气泡列表 */
export function customBubbles(data: BeautyData): CustomAsset[] {
  return data.customAssets.filter((item) => item.type === 'bubble');
}

export function pendantOf(id: string, data: BeautyData): PendantPreset | undefined {
  return allPendants(data).find((item) => item.id === id);
}

/* ==========================================================================
   两个作用域

   用户要的是两个入口、两套配置：
     1. 聊天室（从聊天室左上角进）—— 只作用于这一个聊天室
     2. 我界面（从「我」进）—— 包含聊天室那部分，**再加上**聊天 APP 全局

   为什么要分成两张独立的配置而不是一张带继承：
     聊天室美化要能「每个角色不同」。如果只有一张全局配置，
     换个角色聊天室还是同一套气泡颜色，那就不是「这个角色的聊天室」了。

   全局那套影响的是聊天 APP 的外壳：列表、通讯录、朋友圈、「我」这些页面。
   ========================================================================== */

/** 聊天室内的美化（一个角色一份） */
export interface ChatRoomBeauty {
  /** 气泡、头像挂件、聊天背景、字体 —— 六个板块里作用于聊天室内的那些 */
  data: BeautyData;
}

/** 聊天 APP 全局的美化（只有界面配色这一层，作用于外壳） */
export interface AppBeauty {
  /** 界面板块的 6 个色位，作用在 .chatapp 上 */
  app: BeautyScheme['app'];
}

export const APP_BEAUTY_KEY = 'chatAppBeauty';
export const CHAT_ROOM_BEAUTY_PREFIX = 'chatRoomBeauty:';
