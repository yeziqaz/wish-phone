/**
 * 数据模型。
 *
 * 字段命名尽量对齐 Character Card V3（MIT 许可）：
 *   - 导入现成角色卡时几乎不用转换
 *   - 导出时也不容易丢东西
 * 字段语义与全部踩坑细节见 docs/research/角色卡格式调研.md。
 *
 * ⚠️ 这些结构一旦上线就很难改（用户设备上已经有数据了）。
 *    要加字段可以；要改字段名，必须在 db.ts 里写迁移。
 */

/** 角色卡来源规范 */
export type CardSpec = 'v1' | 'v2' | 'v3' | 'manual' | 'unknown';

/* ---------- 世界书 ---------- */

export interface LorebookEntry {
  /** spec 名。从 ST 独立世界书导入时要和 `key` 做映射 */
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  /** ST 存的是 `disable`（反的），映射时要取反 */
  enabled: boolean;
  /** ST 叫 `order` */
  insertion_order: number;
  case_sensitive?: boolean;
  constant?: boolean;
  selective?: boolean;
  secondary_keys?: string[];
  /** 规范里是 'before_char' | 'after_char'；ST 用的是 0~7 的整数，映射要小心 */
  position?: 'before_char' | 'after_char';
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  use_regex?: boolean;

  // 规范里没有、但实际要用到的 ST 扩展（从 extensions 里提上来做运行时字段）
  _depth?: number; // extensions.depth，默认 4
  _role?: 0 | 1 | 2; // extensions.role
  _probability?: number; // extensions.probability，默认 100
  _matchWholeWords?: boolean;
  _selectiveLogic?: 0 | 1 | 2 | 3;
}

export interface Lorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: LorebookEntry[];
}

/* ---------- 世界书（愿望机自己写的） ---------- */

/**
 * 我们自己的一个条目。
 *
 * ⚠️ 和上面 `LorebookEntry`（ST / Character Card V3 的字段名）**不是一回事**：
 *    - `LorebookEntry` 只在「导入别人的卡」时原样保留，别动它
 *    - `WorldbookEntry` 是用户在我们界面里自己写、挂到角色身上的
 *    混用会让界面代码到处出现 `keys` / `insertion_order` 这种名字，也会把
 *    导出的卡写脏。以后「把卡里的书导成我们的书」是单独一步。
 */
export interface WorldbookEntry {
  id: string;
  /** 条目名，列表上显示；可以不填 */
  name: string;
  /** 真正要进提示词的那段字 */
  content: string;
  /** true = 常驻，每轮都进；false = 关键词命中才进 */
  constant: boolean;
  /** 关键词。判断方式是「包含」，默认不区分大小写 */
  keywords: string[];
  enabled: boolean;
}

/** 一本世界书。条目直接存在书里（ST 也是这么存的，量很小） */
export interface Worldbook {
  id: string;
  name: string;
  /** 一句话说明这本书管什么。只给人看，不进提示词 */
  note: string;
  entries: WorldbookEntry[];
  createdAt: number;
  updatedAt: number;
}

/* ---------- 角色 ---------- */

/** 照片裁切比例。放在 core 里，角色数据和界面都用它 */
export type PhotoRatio = '1:1' | '3:4' | '4:3' | '9:16';

/**
 * 一张「人物形象参考」。
 * 可以是头像，也可以是给生图/视频用的参考图。
 */
export interface CharacterPhoto {
  id: string;
  /** data URL，或内置图标记（'builtin:wuli'） */
  src: string;
  ratio: PhotoRatio;
  /** 给生图用的提示词，可空 */
  prompt: string;
}

export interface Character {
  id: string;
  createdAt: number;
  updatedAt: number;
  spec: CardSpec;
  source: 'json' | 'png' | 'manual';

  name: string;
  description: string;
  personality: string;
  scenario: string;
  /** 开场白。建会话时作为角色的第一条消息写入 */
  firstMes: string;
  alternateGreetings: string[];
  /** 示例对话，用 <START> 分块 */
  mesExample: string;

  /**
   * 原始卡 JSON 全文。
   * ⚠️ 导出时以它为基础回写（deepMerge），绝不能直接用我们的字段重建 ——
   *    规范明文要求 MUST NOT destroy unknown keys，
   *    直接重建会把别人卡里的 extensions 和未知字段全抹掉。
   */
  raw: unknown;

  /* 一版只存、不做逻辑，但字段先占好位 */
  systemPrompt: string;
  postHistoryInstructions: string;
  /** MUST NOT 进 prompt；只展示 */
  creatorNotes: string;
  tags: string[];
  creator: string;
  characterVersion: string;
  extensions: Record<string, unknown>;
  lorebook?: Lorebook;

  /* V3 字段，一版只透传 */
  nickname?: string;
  assets?: unknown[];
  sourceUrls?: string[];

  /**
   * 头像 / 照片。
   * 内置角色存 'builtin:wuli'；用户选的照片存 data URL。
   */
  avatarKey?: string;

  /**
   * 头像框的内置 id（见 ui/avatar-frame.ts）。
   * 纯装饰，可空。新增于 2026-11-10，可选字段，老数据没有时就是无框。
   */
  avatarFrame?: string;

  /** 第一张照片的比例（列表头像用，兼容老数据） */
  photoRatio?: PhotoRatio;

  /** 人物形象参考图，可多张。第一张自动当头像 */
  photos?: CharacterPhoto[];

  /**
   * 这个角色属于哪个世界 / 哪条时间线。
   * 老数据没有这两项时，启动时会自动归到「默认世界 · 主线」（见 core/worlds.ts）。
   */
  worldId?: string;
  branchId?: string;

  /**
   * 和「我」（user）的关系，比如「男朋友」「哥哥」「闺蜜」「同事」。
   * 用来自动生成关系图；不是在所有故事里都成立，但先留着。
   */
  relationToUser?: string;

  /**
   * 联系人分组（如「我的好友」「家人」「同事」）。
   * 为空时在通讯录里归入默认的「我的好友」。
   */
  group?: string;

  /** 内置角色（wuli）。内置角色不能被当成普通卡删掉 */
  builtin?: boolean;

  /**
   * 挂在这个角色身上的世界书 id。
   * 铁律：**谁挂谁生效**，没挂就不注入（见 docs/概念梳理-世界书-身份-好友.md §2）。
   * 新建角色默认是空的，不自动挂任何书。
   */
  worldbookIds?: string[];
}

/* ---------- 世界（世界观 / 卷宗） ---------- */

/**
 * 一个小世界。用户 2026-10-31 把它从「世界观」改名成「小世界」。
 *
 * 两种模式，建的时候选：
 *   independent 角色独立：每张角色卡自己跑一条线，别的卡默认不出现、
 *               也不产生任何关系。只有卡里「人物关系」写了的人才能当 NPC 出场。
 *   linked      角色可关联：同一个时空，多个角色可以互相认识，
 *               记忆和关系按关系图同步（见 docs/世界观与记忆设计.md）。
 *
 * 一个世界可以有多条「时间线」（平行时空），每条时间线里的角色是各存一份的。
 * 独立模式下时间线没有意义（每个角色天然就是平行线），界面会把它收起来。
 */
export interface World {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  /** 世界观设定：年代、地点、规则。写给人看，也进提示词 */
  description: string;
  /** 当前正在看的时间线。删分支时记得改这里 */
  activeBranchId: string;
  /**
   * 角色独立 / 角色可关联。
   * 老数据没有这个字段时按 linked 处理（和改名前一样）。
   */
  mode?: 'independent' | 'linked';
}

/** 一条时间线（平行时空）。默认每个世界有一条「主线」 */
export interface Branch {
  id: string;
  worldId: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  /** 这条线和其他线哪里不一样，比如「这一条里男朋友是陈默」 */
  note: string;
}

/* ---------- 会话与消息 ---------- */

export interface Conversation {
  id: string;
  characterId: string;
  /** 列表里显示的名字，默认用角色名 */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 用户在这个会话里叫什么（{{user}} 的替换值） */
  userName: string;
  /** 对应 ST 的 chat_metadata，透传 */
  metadata: Record<string, unknown>;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** ISO 字符串，和 ST 的 send_date 对齐（也保证按字符串排序就是按时间排序） */
  createdAt: string;
  /** 对应 ST swipes：可重生成的多个版本，含当前这条 */
  swipes?: string[];
  swipeId?: number;
  extra?: Record<string, unknown>;
}

/* ---------- 朋友圈 ---------- */

/**
 * 朋友圈的一条动态。
 *
 * authorId 用 'me' 表示用户自己，否则是角色 id ——
 * 这样不用给「我」单独造一个角色记录，也不需要额外的类型判断。
 */
export interface Moment {
  id: string;
  /** 'me' = 用户自己；其他值 = 角色 id */
  authorId: string;
  /** 正文，可以空着（只发图） */
  text: string;
  /** 配图 data URL。最多 4 张（见 moments-view.ts 的 MAX_IMAGES） */
  images: string[];
  createdAt: number;
  /** 点过赞的人：'me' 或角色 id */
  likes: string[];
  comments: MomentComment[];
}

export interface MomentComment {
  id: string;
  authorId: string;
  text: string;
  createdAt: number;
}

/* ---------- 设置 ---------- */

/** settings 表是一个简单的键值表，具体形状由使用方决定 */
export interface SettingRecord {
  key: string;
  value: unknown;
}

/* ============================ API 服务商 ============================ */

/**
 * 接口协议。
 * 第一版只有 openai 真正实现（含自定义路径）；gemini / claude 的原生格式
 * 是两套完全不同的请求与响应结构，排在后面的批次。
 */
export type ApiProtocol =
  | 'openai'
  | 'gemini'
  | 'claude'
  | 'novelai'
  | 'elevenlabs'
  | 'minimax'
  | 'fishaudio'
  | 'custom';

/**
 * 一个 Key。
 * 支持多条是为了「多 Key 轮询」——第一版先把结构和 UI 做好，
 * 调用统计与自动轮询在后面的批次里接上。
 */
export interface ProviderKey {
  id: string;
  value: string;
  /** 备注名，多 Key 时用来区分（如「大号」「Claude 专用」） */
  label: string;
  enabled: boolean;
  /** 轮询权重，数字越大被选中越多 */
  weight: number;
  callCount: number;
  failCount: number;
}

export interface ProviderModel {
  /** 真实模型 ID，发请求时用它 */
  id: string;
  /** 这个模型是干什么的。老数据没有就按「文字」处理 */
  kind?: ModelKind;
  /** 显示名称 / 备注（例如真实是 gpt-5-mini，显示成「小助手」） */
  displayName: string;
  /** 上下文长度，拿不到就是 null */
  contextLength: number | null;
  /** 单次最多输出多少 token，null = 用接口默认 */
  maxOutput: number | null;
  enabled: boolean;
  /** 来自自动拉取还是手动添加 */
  source: 'fetched' | 'manual';
  /** 分组模式下属于哪个 Key；不填 = 所有 Key 共用 */
  keyId?: string;
  /** 这个模型能干什么。测试时按模型名推断，不是实测出来的 */
  caps?: string[];
}

export interface ProviderGeneration {
  temperature: number;
  /** null = 不发送这个参数，用服务端默认 */
  maxTokens: number | null;
  topP: number | null;
}

export interface ProviderAdvanced {
  stream: boolean;
  rateLimit: { enabled: boolean; perMinute: number };
  breaker: { enabled: boolean; failCount: number; cooldownSec: number };
}

export interface Provider {
  id: string;
  name: string;
  protocol: ApiProtocol;
  /**
   * 这个服务商属于哪个模块：文本 / 生图 / 语音 / 视频。
   * 老数据没有就按文本处理。
   */
  kind?: ModelKind;
  baseUrl: string;
  /** 默认 '/chat/completions'，非标准接口可以改 */
  apiPath: string;
  /** 关着时只用第一个 Key；绝大多数站一个 Key 就够 */
  multiKey: boolean;
  /** 多 Key 时：rotate = 同一账号轮流用；group = 每个 Key 管自己的模型 */
  keyMode: 'rotate' | 'group';
  keys: ProviderKey[];
  models: ProviderModel[];
  generation: ProviderGeneration;
  advanced: ProviderAdvanced;

  /* 低频管理项，放在详情页最后 */
  vendor: string;
  group: string;
  enabled: boolean;

  createdAt: number;
  updatedAt: number;
}

/** 模型按用途分四类。别按站子分，站子只是地址和 Key。 */
export type ModelKind = 'text' | 'image' | 'voice' | 'video';

export const MODEL_KIND_LABEL: Record<ModelKind, string> = {
  text: '文字',
  image: '生图',
  voice: '语音',
  video: '视频',
};

/** 指向某个服务商里的某个模型 */
export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** 全局主模型 + 角色专属覆盖（没填就跟随全局） */
export interface Bindings {
  byKind: Partial<Record<ModelKind, ModelRef>>;
  characters: Record<string, Partial<Record<ModelKind, ModelRef>>>;
}
