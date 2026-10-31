# 模型与 API 分组（已落地版）

> 2026-10-31 · 按用户截图里的红框改的
> 结论：**不按站子分，按用途分。** 生图 / 语音 / 生视频各有一个入口和一张「当前模型」。

---

## 0. 已经做成什么样

### API 服务商页

```
[← API 服务商]                       [+]

[智能添加]

文字 API（原来的服务商列表）
  奶酪      OpenAI 兼容 · 12 个模型      [开关] >
  织云      ...

其他 API
  ┌──────────────┐  ┌──────────────┐
  │ 生图 API      │  │ 语音 API      │
  │ OpenAI·dall-e │  │ 未设置        │
  └──────────────┘  └──────────────┘
  ┌──────────────┐
  │ 生视频 API    │
  │ 未设置        │
  └──────────────┘
```

### 点进「生图 API」

```
[← 生图 API]

当前生图模型
OpenAI · dall-e-3          [更换] [清除]

[从已有服务商拉取]
  假生图站   OpenAI 兼容 · 1 个模型   [拉取]
  奶酪       OpenAI 兼容 · 12 个模型  [拉取]

[新建服务商]  ← 收起，点开填名字/URL/Key
  名字 / Base URL / API Key
  [保存并拉取]
```

- 「拉取」只留下生图模型，选择抽屉是**单选**，选完直接成为当前模型
- 「新建服务商」保存后会**立刻拉取**，不用再回服务商列表
- 语音、生视频两个页面结构完全一样，只是过滤的类型不同

---

## 1. 数据上加了什么

```
ProviderModel.kind = 'text' | 'image' | 'voice' | 'video'   // 老数据默认 text

Bindings（存在 settings 表里）
  byKind: {
    text?:  { providerId, modelId }   // 聊天主模型，暂时还是走原来的角色/全局绑定
    image?: { providerId, modelId }
    voice?: { providerId, modelId }
    video?: { providerId, modelId }
  }
  characters: { [角色id]: { ... } }   // 预留：角色专属覆盖，还没做界面
```

---

## 2. 类型是怎么猜的

拉取时拿 `/models` 的 ID 猜，猜错可以换服务商试（目前没有「点标签改」的界面了，
因为类型页面已经按类型过滤，改标签的场景主要留在文字服务商详情里）。

| 关键词 | 猜成 |
|---|---|
| sora / veo / kling / runway / pika / hailuo / seedance / luma / video / wan2 | 视频 |
| tts / speech / whisper / audio / voice / eleven / cosyvoice / sovits / fish | 语音 |
| dall-e / dalle / gpt-image / flux / stable-diffusion / sdxl / sd / midjourney / seedream / kolors / wanx / imagen / ideogram / recraft / image | 生图 |
| 其他 | 文字 |

⚠️ 这是推断，不是实测。猜不出来就筛掉，不会硬塞进列表。

---

## 3. 还没做的

| 事项 | 说明 |
|---|---|
| **NovelAI 原生接口** | 没有 `/models`，模型是固定几个；鉴权和生图端点是另一套，要单独适配 |
| **ElevenLabs / MiniMax / FishAudio** | 三家都不是 OpenAI 兼容，各自的鉴权和模型列表格式不同 |
| **Sora / Veo / Kling 等视频原生接口** | 同上 |
| **角色专属模型** | 数据留了口子（`bindings.characters`），界面还没做 |
| **真正生图 / 生语音 / 生视频** | 现在只是「选模型」，还没有调用生成 |

> 现在能拉取的只有 **OpenAI 兼容接口**（大多数中转站、以及各家提供的兼容端点）。
> 三家语音和 NovelAI 要一个一个接，不能靠猜。

---

## 4. 下一步建议

1. 先接 **NovelAI**（生图只有它最特别，其他中转站基本兼容）
2. 再接 **ElevenLabs**（语音最常用）
3. 然后 MiniMax / FishAudio
4. 角色专属模型界面：角色档案 → 更多设置
5. 最后才是真正调用生成
