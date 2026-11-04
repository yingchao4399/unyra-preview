# 学习数据模型 v3 重构计划（单文件节点 + 类型登记表 + 拓扑归一）

> **状态**：讨论定稿，**未执行**
> **日期**：2026-10-22
> **执行者**：未来的 agent 会话（这份文档就是交接说明，不要凭记忆改）
> **交付纪律**：每阶段结束 commit 一次；**不 push、不开 PR、不 merge**，除非用户显式要求。

---

## 0. 怎么用这份文档

1. **一次只做一个阶段**。阶段之间必须 `npm run typecheck` + `npm test` 全绿才能进下一个。
2. 每阶段末尾有「验收标准」，**验收不过就不算完成**，不要靠"看起来对了"。
3. 第 7 节「已知坑」是这份文档最贵的部分——里面每一条都对应一处会静默坏掉的地方。
4. 遇到与本文件冲突的现状代码：**以本文件为准，但先把冲突记到第 10 节**，不要自行发挥。

---

## 1. 背景与目标

用户诉求（2026-10-22 两次讨论的原话归纳）：

| # | 目标 | 判断标准 |
|---|---|---|
| G1 | **泛化** | 教学文档节点以后会挂各种挂件（闪卡、习题、代码沙箱、视频片段…），加一种不能散落改 9 处 |
| G2 | **可扩展** | 一种新挂件 = 一个登记文件；agent 侧零 api 改动 |
| G3 | **降维护** | 节点内容落点从「每种内容一个文件/目录」收敛到「一个节点一个文件」 |
| G4 | **降 agent 成本** | 拓扑规则归代码，模型只表达意图；读写内容的 api 收敛成一套 |

现状量化（本次调研实测）：

- 加一种挂件要动 **9 处、跨 4 层**：领域 3（`structure.ts` 的类型表/规则表/卡片高度、`structureSeed.ts` 的 leaves 装配）、落盘 2（`files/build.ts`、`files/parse.ts`）、画布 2（`StructureCanvas.tsx`、`structureView.ts`）、API 2（`sandbox/api.ts`、`apiRegistry.ts`）。
- 一个挂了 2 笔记 + 1 试卷 + 1 超管的节点落 **7 个文件**，其中试卷与超管**双写**（独立文件 + `meta.json` 里一整份），读回时还要按 id 去重。
- `files/meta.ts` 第 47 行注释写超级文档「不落独立文件」，而 `build.ts` 确实写了独立文件、`parse.ts` 也确实去读它 —— **注释与实现已经矛盾**，这是"同一份东西两个落点"的必然结果。

---

## 2. 非目标（明确不做，别顺手做）

- 不做云同步 / 多用户 / 实时协作。
- 不引入数据库、ORM、事件总线。
- 不改目标级账本（`chat.json` / `reading.json` / `essay.json` / `mind.json` / `method.json` / `workflow.json`）的**语义与文件名**。
- 不做"外部编辑器实时监听"（现在也没有，读盘只在启动）。
- 不动 `static/`（目标级资源库）与 `images/`（只读遗留）。

---

## 3. 已定决策

| # | 决策 | 理由 / 代价 |
|---|---|---|
| **D1** | 节点内容**全内联**到一个文件：正文、大纲、笔记、试卷、超级文档、学习状态、注解、坐标 | 用户明确选"彻底一点"；可读性由 md 导出兜底 |
| **D2** | 一个节点 = `nodes/{uuid}.json` + **可选的** `files/{uuid}/` | 图片/代码/PDF 进不了 JSON，目录不会真的消失 |
| **D3** | 目标目录用 uuid：`docs/{goalUuid}/`；人可读靠生成的 `index.md` | 目录名不再承担身份，改名不搬目录 |
| **D4** | 目标级账本**保持独立文件**，不并进 `goal.json` | `chat.json` 流式写入高频且体积大，合并会让每条消息重写整份账本 |
| **D5** | 画布卡 = 数据节点的 **facet**（面）；一个节点可以有多个 facet | 保住 2026-10-21 定的「文档 → 大纲 → 子文档」拓扑与两张卡的视觉，不动产品 |
| **D6** | 拓扑归**中央边表**；节点不存父子指针 | 单真相、移动=删一条+加一条、环检测集中 |
| **D7** | 类型用**抽象基类 + 登记表**；store 里存 plain record，实例只在读取边界构造 | class 实例进 store 会破坏 memo 比较、undo 快照、JSON 往返、缓存 |
| **D8** | api 三分：`graph.*` 管结构 / `content.*` 管内容 / `state.*` 管状态；`exam.*` 只留出卷判卷 | 新挂件零 api 改动 |
| **D9** | 磁盘路径不再承担身份；`key` 降级为显示别名 | 去掉"标题唯一"这条硬不变量 |
| **D10** | 目标本身就是一个节点：`goal.json`（`type: 'goal'`），`goalId` 就是它自己的 uuid | 消掉 `goal.id` 与 `rootNodeId` 两个 uuid 指一件事 |
| **D11** | **单写，不做双写过渡**。迁移由「第 3 次迁移」（`step: 3`）一次性完成（用户 2026-10-22 定） | 不产生运行时数据冗余；代价是迁移必须一次成功，所以要有校验与降落伞（见 5.1.4） |
| **D12** | 目标 uuid **沿用根节点的 uuid**（`rootNodeId`），丢弃 `goal.id`，把按目标归档的键一次性重写 | 根节点 uuid 被页签/收藏/reading/tmp/exams/structure 引用得更多；只重写"目标级账本"的键更省（清单见 5.1.3） |
| **D13** | 迁移系统改成**序号制**（已完成）：脚本只有 `step`，`schema.json` 记 `schemaStep`，发版不涨序号 | 用户 2026-10-22：线上才 0.6.7，迁移却把版本号推到 0.8；序号制还能在上线前合并未发布的迁移（见 `scripts.ts` 顶部） |

---

## 4. 目标数据模型

### 4.1 磁盘布局

```
{root}/users/{uid}/
├─ state.json                      不变
├─ schema.json                     迁移序号标记：{ schemaStep: 3 }（不记版本号）
└─ docs/
   ├─ index.md                     生成物：全部目标清单（标题 → uuid）
   └─ {goalUuid}/
      ├─ goal.json                 目标节点（type: 'goal'），parts 里含根教学文档
      ├─ index.md                  生成物：本目标节点清单（缩进树 + uuid）
      ├─ edges.json                拓扑：{ version, edges: [{from,to,rel,slot?}] }
      ├─ structure.json            只剩 { version, edgeStyle, viewport? }
      ├─ chat.json                 不变（目标级对话）
      ├─ reading.json              不变
      ├─ essay.json                不变
      ├─ mind.json                 不变
      ├─ method.json               不变
      ├─ workflow.json             不变
      ├─ nodes/{nodeUuid}.json     节点全量
      ├─ files/{nodeUuid}/...      该节点的真实文件（原 workspace/ 的内容）
      └─ static/                   目标级资源库（不变，manifest.json 也在里面）
```

**注意**：`goal.json` 就是目标节点的文件，**不**再在 `nodes/` 下放一份，避免两个落点。

### 4.2 节点文件形状

```jsonc
{
  "version": 3,
  "uuid": "9f1c…",
  "type": "doc",                    // 登记表主键（判别字段）
  "title": "极限",
  "goal": "3a77…",                  // 归属目标（= 目标节点的 uuid）
  "createdAt": 1729500000000,
  "updatedAt": 1729500000000,
  "status": "learning",             // learning | mastered
  "origin": "ai",
  "learning": { /* 原样，见 learn/learning.ts */ },
  "annotations": [ /* 原样 */ ],
  "layout": {                       // facet key → 画布坐标；没有就不在画布上
    "doc":     { "x": 0,   "y": 0 },
    "outline": { "x": 320, "y": 0 },
    "note:错题本": { "x": 640, "y": 0 }
  },
  "parts": [                        // ← 所有内容都在这，新增挂件 = 加一条
    { "kind": "teaching", "format": "markdown", "body": "# 极限\n…" },
    { "kind": "outline",  "format": "json",     "body": { "intro": "", "children": [] } },
    { "kind": "note",     "name": "错题本", "format": "markdown", "body": "…",
      "createdAt": 0, "updatedAt": 0 },
    { "kind": "exam",     "name": "8f2e…", "format": "json", "body": { /* Exam */ } },
    { "kind": "superdoc", "name": "讲义", "format": "html", "body": "<html>…" }
  ]
}
```

**parts 用数组而不是对象**：名字里可能有 `:`、`/`、空格，做 key 要转义；数组无冲突、顺序稳定。part 数量很少（个位数），线性查找无所谓。

**唯一性规则**：`singleton: true` 的 kind（`teaching` / `outline`）每节点最多一条；其余 `name` 在同一 kind 内唯一（与现在笔记名、超管名的规则一致）。

### 4.3 facet：数据节点 ↔ 画布卡

这是本次重构**唯一一处概念增加**，必须理解对：

| 概念 | 是什么 | 数量关系 |
|---|---|---|
| 数据节点 | 一个 uuid、一个文件 | N 个 |
| facet | 节点的一个"面"，画布上的一张卡 | 每节点 ≥1 个 |
| facet key | `${uuid}:${kind}` 或 `${uuid}:${kind}:${name}` | 例：`9f1c:doc`、`9f1c:outline`、`9f1c:note:错题本` |

- 画布卡**仍然是"文档卡 + 大纲卡"两张**，`GRAPH_EDGE_RULES` 的语义一字不改。
- 坐标存节点文件的 `layout`，按 facet key 分键 → 一个文件装下所有卡的坐标。
- 边表的端点写 **facet key**；解析时按 `:` 切第一段拿 uuid。
- facet 由登记表声明（`facets: [{ kind, label, cardHeight }]`）；**不上画布的挂件不声明 facet**。

**为什么不做成"一个节点一张卡"**：那会推翻 2026-10-21 用户亲自定的「文档 → 大纲 → 子文档」拓扑与两张卡的可读性，属于产品变更，不在本次范围。

### 4.4 边表

```jsonc
// docs/{goalUuid}/edges.json
{ "version": 1, "edges": [
  { "from": "9f1c:doc",     "to": "9f1c:outline", "rel": "expand" },
  { "from": "9f1c:outline", "to": "77ab:doc",     "rel": "slot", "slot": "极限" },
  { "from": "9f1c:doc",     "to": "9f1c:note:错题本", "rel": "attach" }
]}
```

`rel` 取值：`expand`（文档→自己的大纲）、`slot`（大纲→子文档，带接入点）、`attach`（文档→叶子）。
`canConnect` 由登记表的 `targets` 决定，**规则跟着类型走**，不再集中一张表。

内存里维护邻接索引：

```ts
// 用数组引用当版本号：store 不可变，引用变了就是内容变了
const adjacencyCache = new WeakMap<readonly Edge[], Adjacency>()
```

### 4.5 类型登记表

目录：`src/learn/nodeKinds/`，一种类型一个文件。

```ts
// base.ts
export interface NodeKindSpec {
  type: string                          // 落盘判别值
  label: string                         // 中文名（卡片标题、api 说明共用）
  format: 'markdown' | 'json' | 'html'  // part 的默认格式
  singleton?: boolean                   // 每节点最多一份
  targets: readonly string[]            // 能连到哪些类型（取代 GRAPH_EDGE_RULES）
  facets?: readonly FacetSpec[]         // 上画布时声明；不声明 = 不上画布
  cardHeight?: (node: NodeRecord, part?: PartRecord) => number
  agent?: { readable?: boolean; writable?: boolean; createHint?: string }
}

// index.ts
export const NODE_KINDS = {
  goal: goalKind, teaching: teachingKind, outline: outlineKind,
  note: noteKind, exam: examKind, superdoc: superdocKind,
} satisfies Record<string, NodeKindSpec>   // ← 漏一个类型编译期就报错
```

**新增一种挂件的完整动作**：新建 `src/learn/nodeKinds/flashcard.ts` 实现 `NodeKindSpec` → 在 `index.ts` 加一行。**别的地方一律不改。**

### 4.6 索引

| 索引 | 用途 | 缓存键 |
|---|---|---|
| `Map<uuid, NodeRecord>` | 取代 167 处 `nodeById` 的线性查找 | store.nodes 数组引用 |
| `Adjacency`（out/in） | 取代 `prereqIds` / `parentIds` 的全表 filter | edges 数组引用 |
| `Map<goalUuid, Map<normalizeKey, uuid[]>>` | agent 的 path 寻址（允许重名，所以是数组） | nodes 数组引用 |
| `nodeFileCache: Map<uuid, {node, edges, exams, goals, text}>` | **保存时只序列化变了的节点**（见第 6 节性能） | 引用相等 |

---

## 5. 分阶段任务

> 每个阶段都是"可独立交付、可独立回滚"的。**不要跨阶段混做。**

### P0 · 地基（行为零变化）—— **已完成**

**目标**：把查找索引与类型登记表建起来，但**不改变任何行为与磁盘格式**。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/graph/lookup.ts` | `nodeById` 改走 `Map`；索引用 `WeakMap<nodes[], Map>`（数组引用当版本号） |
| `src/learn/graph/edges.ts` | `prereqIds` / `parentIds` 改走邻接索引（`WeakMap<edges[], Adjacency>`） |
| `src/learn/nodeKinds/*` | 新建；一种类型一个文件（`outline/doc/note/exam/superdoc`），`index.ts` 汇总 |
| `src/learn/structure.ts` | `GRAPH_KINDS` / `GRAPH_KIND_LABEL` / `GRAPH_EDGE_RULES` / `KIND_RANK` 全部改为从登记表派生；`isKind` 改走 `isGraphKind` |
| `tests/graphIndex.test.ts` | 新增 11 条：索引与线性查找逐项一致、重复 id 取第一个、数组换了索引跟着换、登记表派生关系、连线拓扑没被改动 |

**验收（已过）**
- `npm test` 全绿（133 文件 / 1573 用例），`structure.test.ts` 里关于连线规则的用例**一条没改**就过。
- 登记表自洽：`satisfies Record<string, NodeKindSpec>` 保证漏字段编译期报错；加一种类型 = 一个文件 + 一行注册。

**遗留说明**
- 只登记了画布上的**五种**类型。`goal`（目标本身作为节点）等 P1 真正引入时再登记——
  P0 必须行为零变化，提前把它塞进 `GRAPH_KINDS` 会让读盘时多接受一种原本会被丢掉的类型。
- 索引返回的是**缓存数组本身**，调用方只读、不要原地 `sort`/`push`（已在 `edges.ts` 注明）。

**风险**：低。**回滚**：直接 revert。

---

### P1 · 持久化合并（磁盘格式变更）

**已完成（2026-10-22）。** 实际落地与下面原计划有几处**刻意的偏差**，理由都在这：

| 项 | 原计划 | 实际 | 为什么改 |
|---|---|---|---|
| 节点文件 | `nodes/{uuid}.json` | `{目录名}.node.json`（目录仍是标题树） | 目录 uuid 化只解决「改名搬目录」，与泛化/扩展无关，却会把迁移面放大到 vfs、chip、资源路径。落点数量已经不再随挂件类型增长，G3 达成 |
| 后缀 | `.json` | `.node.json` | 目标目录里已有 `chat.json` / `reading.json` / `structure.json`，一个叫「chat」的目标会与 `chat.json` 撞车 |
| goalId | D12：合并 `goal.id` 与 `rootNodeId` | **未做** | 要重写 12 处按目标归档的键，收益只是去掉一个冗余 uuid，风险与收益不匹配 |
| workspace | `files/{uuid}/` | 仍叫 `workspace/` | 目录名没变，所有引用（chip、资源路径、工作区 api）零改动 |
| vfs | 未提 | **未改** | 它的实体模式是「一个内容一个文件」，合并后一个物理文件对应多个实体。目前只经 agent 的 `files.*` 触达，而那条路对 `docs/` 下的应用数据本来就拒绝——留作后续 |

**实际落地**：`files/nodeFile.ts`（形状 + parts 编解码）、`files/build.ts`（写盘，`nodeFileCache` 只序列化变了的节点）、
`files/parse.ts`（`parseDocsV3` 优先、`parseDocsV2` 作降落伞）、`files/diff.ts`（资源搬迁改读 `.node.json`）、
`learn/layout.ts`（撞名规避集合）、`chipRef.ts`（有 nodeId 就信 nodeId）、`sandbox/dataPaths.ts`（`.node.json` 归应用数据）、
第 3 次迁移 `lib/migration/v3Nodes.ts`、`docs/data-and-privacy.md` 重写。

**验收**：`tsc -b` 通过；134 文件 / 1579 用例全绿；新增 `tests/nodeFile.test.ts`（往返逐项一致、空笔记留名、
新布局优先、迁移写新删旧且不动二进制、幂等、空目录不报错）。


**目标**：一个节点一个文件；旧的七种落点全部消失。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/types.ts` | 新增 `NodeRecord` / `PartRecord` / `FacetKey`；`KnowledgeNode` 逐步退役（P1 期间两个都保留） |
| `src/learn/files/build.ts` | 新增 `buildDocsV3(store)`（迁移脚本也调它，保证与运行时同源）；`buildDocs` 改为输出新布局；保留 `nodeFileCache` |
| `src/learn/files/parse.ts` | 新增 `parseNodeFile`；**保留旧解析器**（降落伞，见 5.1.5） |
| `src/learn/layout.ts` | `nodeLayout` 删除；新增 `goalDir(uuid)` / `nodeFile(uuid)` / `nodeFilesDir(uuid)` |
| `src/learn/files/names.ts` | 只留 `sanitizeSegment`（笔记/超管不再有独立文件名） |
| `src/lib/migration/types.ts` | `MigrationContext.storage` 加 `movePath(from, to)` |
| `src/lib/migration/engine.ts` | 注入 `movePath`（底层已有 `lib/storage.movePath`） |
| `src/lib/migration/v3Nodes.ts` | 新增第 3 次迁移（`step: 3`，规格见 5.1） |
| `src/lib/migration/scripts.ts` | 把脚本接进 `MIGRATION_SCRIPTS`（`step: 3`）；`LATEST_SCHEMA_STEP` 自动变成 3，不用改常量 |
| `src/components/settings/*` | 设置 → 存储里加一行"上次迁移的备份 · 占用 X MB · 删除" |

### 5.1 迁移脚本规格（P1 的主体，第 3 次迁移）

> **单写，不做双写过渡**（D11）。迁移一次跑完，跑完之后磁盘上只有新格式。
> 所以这个脚本是 P1 的**主体**，不是收尾工作。**先写脚本、先用真实数据演练，再改业务代码。**

#### 5.1.1 落地位置与契约

| 项 | 值 |
|---|---|
| 文件 | `src/lib/migration/v3Nodes.ts` |
| step | `3`（序号，见 `scripts.ts` 顶部的序号制说明） |
| id | `m3-node-single-file` |
| 注册 | `src/lib/migration/scripts.ts` 的 `MIGRATION_SCRIPTS`；`LATEST_SCHEMA_STEP` 由清单自动算出，**不要手改** |
| 新增能力 | `MigrationContext.storage.movePath(from, to)` —— 契约加一行（`types.ts`），engine 注入一行（`engine.ts`），底层已有 `lib/storage.movePath`（`storage:move` → `electron/storage/files.ts` 的 `movePath`，同卷 rename、不删源） |
| 可复用的业务代码 | `files/parse.ts` 的 `parseDocs`、`files/build.ts` 的新 `buildDocsV3`（迁移脚本可以 import `learn/` 领域层——`outlineStructure.ts` 已经这么做了） |

**为什么不自己再写一套读盘逻辑**：v2 的读盘有 7 种落点、3 种命名规则、双写去重、老 `.笔记.md` 兼容——重写一遍必然漏。**复用 `parseDocs` 读成内存 store，再复用 `buildDocsV3` 写出去**，两条路径与运行时完全同源。

#### 5.1.2 步骤（每步的失败处理写死了，别自己发挥）

| # | 动作 | 失败时 |
|---|---|---|
| 1 | 列出 `users/{uid}/docs` 下的目标目录；**一个都不是目标目录形状（顶层无 `*.meta.json`）就整体跳过** | 返回 ok，记 `details: '没有可迁移的数据'` |
| 2 | 读全量文本文件进 `Map<rel, text>`（跳过 `static/`、`images/`、`workspace/` 里的二进制，判据用现成的 `isAssetBinary`） | 返回 ok:false，**一个文件都不动** |
| 3 | `parseDocs(files, state)` → 内存 store（v2） | 返回 ok:false，不动盘 |
| 4 | 把 store 里的 `goalId` 从 `goal.id` 重写成 `goal.rootNodeId`（见 5.1.3 清单） | — |
| 5 | `buildDocsV3(store)` → 新布局的 `Map<rel, text>`，逐个 `writeText`（每写一个就释放一个） | 返回 ok:false，已写的新文件保留（它们是新目录，旧数据未动，下次重跑覆盖） |
| 6 | 搬二进制：`docs/{目标标题}/static` → `docs/{目标uuid}/static`；每个节点 `docs/…/{节点}/workspace` → `docs/{目标uuid}/files/{节点uuid}/` | 返回 ok:false，已搬的留在新位置（`movePath` 是 rename，不删源，可重跑） |
| 7 | **校验**（见 5.1.4），不通过就中止 | 返回 ok:false，`schema.json` 不升版本 |
| 8 | `movePath(docs/{目标标题}, docs.legacy-{ts})` —— 旧目录整体挪走（此时里面只剩空壳文本文件） | 返回 ok:false；新数据已完整，旧目录还在，用户可手动处理 |
| 9 | 返回 `modifiedFiles`（**只记新增/改名的路径**，别把每个节点文件都塞进去，几万个字符串会撑爆 schema.json） | — |

**幂等**：第 1 步判据是"顶层有没有 `*.meta.json`"——迁移完成后旧目录已改名，重跑自然跳过。若第 5 步中途失败，重跑会覆盖新目录（`writeText` 幂等），不会重复追加。

#### 5.1.3 `goalId` 重写清单（漏一个就是"账本找不到目标"）

`goal.id` → `rootNodeId`，需要改的键（迁移脚本在内存里改完再写）：

| 位置 | 键 |
|---|---|
| `store.nodes[].goalId` | 每个节点 |
| `store.exams[].goalId` | 每份试卷 |
| `store.conversations[].goalId` | 每个会话 |
| `store.reading.byGoal` | 字典键 |
| `store.memory.work` | 字典键 |
| `store.methods` | 字典键 |
| `store.workflows.byGoal` | 字典键 |
| `store.essays` / `store.essayCommits` | 字典键 |
| `store.structure` | 字典键（P3 之后这张表会消失，迁移期仍要改） |
| `store.resources` | 字典键 |
| `state.json` 的 `activeGoalId` | 单值 |
| `state.json` 的 `agentTabs` | **逐项确认**：`goal` 类型的页签存的是 goalId |

**不改**：`store.tmp`（键是 nodeId）、`docArea` 页签（键是 nodeId / tabId）、`favorites`（存 TabRef）、`docScroll`（键是 tabId）。

#### 5.1.4 校验清单（不通过就不许升版本）

迁移脚本内部自己比对，任一条不满足就 `ok: false`：

- 目标数一致；每个目标的节点数一致。
- 每份教学文档 `trim().length` 一致（**不 trim 比长度**：空白差异也算内容差异，但尾随换行不算）。
- 笔记：名字集合一致、每份正文逐字一致、顺序一致（meta 里登记的次序）。
- 试卷：id 集合一致、`attempts.length` 一致。
- 超级文档：名字集合一致、html 逐字一致。
- 大纲：`intro` 一致、`children` 的 `key` 序列一致。
- 二进制：`static/` 的文件数与总字节一致；`workspace/` 的文件数与总字节一致。
- 边：条数一致；每条边的 `(from,to)` 语义映射后能对上。
- 坐标：每个画布 facet 的 `(x,y)` 与旧 `structure.json` 一致。

**跑两遍结果相同**（幂等）也属于校验：演练时手动跑两次，第二次必须 `details: '没有可迁移的数据'`。

#### 5.1.5 降落伞（迁移失败时用户还能用）

D11 是单写，所以**没有双写可以退回**。失败时的退路只有两条，脚本必须都保住：

1. **旧目录在迁移成功之前一个字节都不动**（第 8 步之前只读旧树）。所以失败 = 数据回到迁移前的状态，只是多了半份新目录。
2. **保留 v2 只读解析器一个版本**（`files/parse.ts` 的旧函数不删）。判据：启动时若 `docs/` 下找不到任何 `goal.json`，走 v2 解析并提示"数据迁移未完成"。

**这条路几乎不花成本，理由已核实**：

- `autoMigrateIfNeeded`（`lib/migration/autoMigrate.ts`）在 `hydrateLearnStore` **之前**跑，失败只记日志、返回 `migrated: false`，**应用继续启动**。
- v2 的 `parseDocs` 只认 `docs/{顶层目录}/*.meta.json`；新目录里是 `goal.json` + `nodes/`，**没有 `meta.json`，会被它直接跳过**。所以新旧目录可以无害共存。
- `saveLearnStore` 的 `diffDocs` 只删「上次快照里有、这次没有」的文件；快照是从**读到的旧树**摊出来的，新目录不在快照里，**不会被删**。

也就是说：迁移失败 → 旧目录原样 → v2 解析器照常读 → 用户照常用，只是没升级。**这 300 行只读代码换的是"一次迁移 bug 不会让用户打不开应用"，值得留到 P4 再删。**

若用户坚持连这份代码也不留：迁移失败就阻断启动并提示从 `docs.legacy-{ts}` 恢复——**这条需要用户确认**（见第 10 节第 4 条）。

#### 5.1.6 迁移脚本骨架

```ts
// src/lib/migration/v3Nodes.ts
export async function migrateToV3Nodes(ctx: MigrationContext): Promise<MigrationStepResult> {
  const fail = (error: string): MigrationStepResult => ({
    ok: false, step: 3, modifiedFiles: [], error,
  })
  const docsRoot = `${ctx.userDir}/docs`
  const goals = (await ctx.storage.listDir(docsRoot)).filter((e) => e.dir)
  ctx.log(`发现 ${goals.length} 个目标目录`)

  // 1. 旧树形状判定（顶层有 *.meta.json 才是 v2）
  // 2. 读全量文本 → files: Map<rel, text>
  // 3. parseDocs(files, await ctx.storage.readJson(`${ctx.userDir}/state.json`))
  // 4. 重写 goalId（5.1.3 清单）
  // 5. buildDocsV3(store) → 逐个 writeText，边写边释放
  // 6. 搬二进制（movePath，目标已存在就跳过）
  // 7. 校验（5.1.4）
  // 8. movePath(旧目标目录, `${docsRoot}.legacy-${Date.now()}`)
  return { ok: true, step: 3, modifiedFiles, details }
}

export const toV3Nodes: MigrationScript = {
  step: 3,
  id: 'm3-node-single-file',
  title: '节点数据合并为单文件',
  summary: '……（照 outlineStructure.ts 的写法：讲清"为什么是迁移脚本而不是兼容分支"）',
  changes: ['每个目标改为 docs/{目标uuid}/', '一个节点一个 nodes/{uuid}.json', '……'],
  migrate: migrateToV3Nodes,
}
```

#### 5.1.7 旧目录的处置

- 迁移成功后：`docs.legacy-{ts}/` 保留，**在设置 → 存储里加一行**"上次迁移的备份 · 占用 X MB · 删除"。用户点删除才删。
- 这样既不产生长期冗余（用户可一键清），又保住"迁移搞坏了还能捞回来"。
- **不要**在迁移脚本里自动删 `docs.legacy-*`：删了就没有退路了。

**验收（逐项对账，缺一不可）**
- 节点数一致；每份教学文档字数一致（±0）。
- 笔记：名字、顺序、正文逐字一致；空笔记仍然不落盘（= 迁移后没有这条 part）。
- 试卷：份数、id、attempts 数一致；超管：名字、html 逐字一致。
- 大纲：`intro` + `children` 的 `key` 顺序一致。
- 画布：节点数、边数、每条边的 from/to 语义、每张卡的坐标一致。
- 老 `.笔记.md`、`images/` 这类遗留数据不报错、不丢失。
- 迁移跑两遍结果相同（幂等）。

**风险**：**最高**。**回滚**：把 `docs.legacy-{ts}` 改回 `docs`，schema 版本改回 `0.7.1`。

---

### P2 · api 收敛（破坏性）—— **已完成**

**落地方式比原计划保守，但目标达成：**

- 新增 `content.read / find / write / append` 一组，位置由 `part` 表达
  （省略 = 正文、`note:错题本`、`outline`、`superdoc:讲义`）。
- `doc.*` / `outline.*` / `sdoc.*` **保留为兼容写法**（计划里本来就是「保留一个版本的薄别名」），
  `doc` 组的说明改成「优先用 content.*」。没有硬删——删了之后模型手上的旧写法会直接失败。
- 试卷不进 `content.*`：它是「出卷 / 作答 / 判分」的业务对象，留在 `exam.*`。
- 底层复用原有的 `docOps` / `outline` / `superdocs` 能力，没有重写一套读写逻辑——
  收敛的是「模型看到的入口」，不是又造一层实现。

**没做**：`graph.tree()` 与 `graph.expand()`。`graph.list()` 已经能给全表、
`graph.relations()` 已经能给单个节点的上下级，先用这两条；真要一步建「目标项 + 子节点 + 连线」
时再加，届时必须先把「部分成功怎么回滚」定清楚。

### P2 原计划（留档）

**目标**：agent 的 api 从 6 组变 3 组；新挂件零 api 改动。

| 现在 | 以后 |
|---|---|
| `graph.*`（list/read/title/paths/create/createTree/rename/update/annotate/move/relations/link/delete） | `graph.list / tree / read / create / move / link / unlink / delete` |
| `doc.*`、`outline.*`、`sdoc.*`、`exam.*` 的读写 | `content.read / write / append / find`（按 `part` 区分） |
| `state.*` | 不变 |
| `exam.*` 出卷/判卷 | 只留 `exam.create / start / submit / grade / read`（业务动作，不碰存储） |

`content.*` 的 target 写法（保持人类可读，内部转 uuid）：

```
content.read('极限')                 // 主内容（teaching）
content.read('极限/笔记/错题本')      // 指定 part
content.write('极限/大纲', {...})     // 大纲
content.read('#9f1c…/exam:8f2e…')    // facet/uuid 直指
```

改动：

| 文件 | 做什么 |
|---|---|
| `src/agent/sandbox/apiRegistry.ts` | 删 4 组、加 1 组、重写用法文本（这份是唯一真相，`__help()`、系统提示词索引、设置页目录全从它派生） |
| `src/agent/sandbox/api.ts` | 实现 `content.*`；`doc.*` / `outline.*` / `sdoc.*` 保留**薄别名**一个版本（只转发，不实现逻辑） |
| `src/agent/sandbox/types.ts` | 同步类型 |
| `tests/apiRegistry.test.ts` | 同步名单（登记表与测试是互相钉住的） |

**验收**
- `apiRegistry.test.ts` 全绿；`__help()` 输出里没有已删除的组。
- 一条断言：`content.read` 能读到 teaching / outline / note / exam / superdoc **五种**内容，写法只有一种。
- 系统提示词里的 api 索引重新生成，长度**不超过**改动前（这是收敛的硬指标）。

**风险**：中（破坏性但可灰度：别名兜住老写法）。**回滚**：恢复 `apiRegistry.ts` 与 `api.ts`。

---

### P3 · 拓扑归一 —— **已完成（派生视图）**

**实际做法**（比原计划小，但把「两份真相」这个病根拔了）：

- 新增 `structureSeed.ts` 的 `structureViewOf(store, goalId, saved)`：**图的唯一来源**，
  纯函数——每次渲染从头算。
- 删除 `reconcileStructure`（约 110 行）与画布里的两个补偿 effect（「首帧铺一张」+
  「store 变了就对账」）。副作用从三条路（首帧 / store 变化 / 用户拖拽）收敛成一条。
- 三条规矩写进函数注释：卡片 = 派生的 + 存过的自由卡；坐标以存过的为准，新卡落在父卡右边；
  **派生边只给「这次才出现的卡片」补**（两张卡都在存过的图里时，那条线用户可能删过，
  再补回来就是以前那个"删不掉的线"的 bug）。
- 手画连线**保留**：存过的那份图里的边原样接上，派生只负责"新卡片自己那条"。

**没做**：把坐标从 `structure.json` 挪进节点文件的 `layout`。它只影响「一个节点一个文件」
的整齐程度，不影响正确性；而它要动 build/parse/normalize 三处 + 一次迁移，收益不匹配。
`structure.json` 现在实质上退化成「坐标 + 用户额外边的缓存」，真值在 store。

**验收**：`tsc -b` 通过；135 文件 / 1588 用例全绿；`structureView.test.ts` 的对账 5 条
与 `structurePipeline.test.ts` 的 9 条行为断言全部通过（后者就是为这次改实现写的）。

### P3 原计划（留档）

**目标**：数据边与画布边合成一张；删掉"对账"与"用户删过的名单"。

改动：

| 文件 | 做什么 |
|---|---|
| `src/learn/structure.ts` | 删 `StructureNode` / `GraphEdge` / `canAddEdge` / `normalizeStructure` 里的节点部分；只留几何（`CARD_W`、`fitZoom`、`centerPan`）与 `edgeStyle` |
| `src/learn/structureSeed.ts` | 删 `reconcileStructure`；`structureFromStore` 改成"首次打开时建一次边" |
| `src/learn/graph/*` | 新增 `GraphStore` 服务：`link / unlink / move / remove`，内部保证不重复、不成环、级联 |
| `src/components/learn/structure/StructureCanvas.tsx` | 节点/边从 store 派生，不再写 `structure.json` 的 nodes/edges |
| `src/learn/files/build.ts` | `structure.json` 只写 `edgeStyle` + `viewport` |

**验收**
- agent 新建的任何内容（文档/笔记/试卷/超管）**立刻**出现在画布上，无需对账。
- 用户删掉的连线**不会**在下次打开时自己长回来。
- `structure.json` 里不再有 `nodes` / `edges` / `hidden`。

**风险**：中高（画布手势、撤销、持久化全在这条线上）。**回滚**：保留旧 `structure.json` 不删，代码 revert。

---

### P4 · 清理

- 删 `key` 的唯一性约束（`addNode` 的同名复用、`titleTaken`、`rename` 的重名拦截）。
- 删 `*Gid` 合成 id、`nodeLayout` 的 BFS、`resolveNode` 的四级模糊兜底。
- 删 `assetMoves` / `ASSET_DIRS` 的搬迁逻辑（目录不再随标题改名）。
- 删旧解析器（v2 兼容读保留一个版本后）。
- 重写 `docs/data-and-privacy.md`（见第 7 节第 5 条）。

**验收**：`npm run typecheck` + `npm test` 全绿；`grep` 不到 `GRAPH_KIND_LABEL` / `noteGid` / `nodeLayout`。

---

## 6. 性能：必须保留的缓存

合并后没有独立的 `meta.json` 可以缓存，**但 `buildDocs` 仍然必须只序列化"变了的节点"**，否则每次保存要 `stringify` 全量：

- 现在：`metaCache` 用 `cached.node === node && cached.edges === store.edges && …` 判断。
- 以后：`nodeFileCache` 用同样的凭据，命中时**直接复用上次的整份文件文本**。
- 依赖前提：store 不可变、节点对象引用稳定。**任何 `{...node}` 的无谓重建都会让该节点全量重写**，P1 时要审计一遍。

实测参考（本机，Node 22）：`stringify` 4MB 内容 8.4ms、编码 1.2ms。**CPU 不是瓶颈**，瓶颈是每次保存把 1~4MB 字符串过 IPC。若单节点超过 4MB，把 `superdoc` 的 html 外置到 `files/{uuid}/`（这是唯一预留的例外，写进 `NodeKindSpec` 的 `external?: boolean`）。

---

## 7. 已知坑（每条都对应一处会静默坏掉的地方）

1. **chip 里存了物理路径** — `src/learn/chipRef.ts` 的 `matches()` 要求 chip 的 `path` 与 `nodeDocPath` 结果一致；布局一变，**老会话里的引用点不开**。
   处理：改为「带 `nodeId` 就信 `nodeId`，`path` 只做兜底」，并给 `tabRefFromChip` 补一条"路径已过时但仍能按 id 命中"的测试。
2. **`graph.paths` 的 8 个字段全失效** — `dir / doc / notesDir / outline / meta / superdocsDir / examsDir / workspaceDir` 收敛成 `{ file, filesDir }`。模型可能已把旧字段写进笔记，需在 api 变更说明里点名。
3. **`nodeDocPath` 的"在资源管理器中打开"** — 以后点开是 JSON。改成"打开所在文件夹"，或在 `files/{uuid}/` 下生成一份导出副本（**默认不生成**，只在用户点"在文件夹中显示"时导出）。
4. **`wsChipUserRel` 里 `p.startsWith(DOCS_DIR + '/')` 直通** — 老 workspace 路径会直接透传成不存在的路径。改成"透传前先确认文件存在，否则按新规则重算"。
5. **产品承诺变更** — `docs/data-and-privacy.md` 现在明写「`.md` 是干净的正文，可以脱离应用直接读、改、备份」。**必须同步改写**，并说明"导出 md"这条替代路径（`useExportFlow` 已有 md / html / pdf 三条路）。
6. **`exam.nodeId` / 笔记名唯一性** — 合并后 exam 是 part，`store.exams` 变成派生索引；`exam.nodeId` 保留（指向宿主 uuid），不要删字段，否则 `chipRef` 的 exam 分支要重写。
7. **`slot` 的语义** — 它是「大纲的哪条目标项被哪个子文档落地」，属于**边**不属于节点。P3 必须把它从节点搬到边上，否则一个文档只能占一个接入点。
8. **StrictMode 双跑** — `main.tsx` 无条件包了 StrictMode，dev 下 effect 跑两遍。任何"取一次就没"的迁移/初始化逻辑要配 done 哨兵（见 `lib/docReveal` 的旧坑）。
9. **CRLF** — 工作区是 CRLF、blob 是 LF。用脚本改多行文本前先归一成 `\n`，写回时还原，否则匹配必然失败。
10. **写盘排队** — `electron/storage/files.ts` 对**同一目标文件**串行排队。单文件变大后，一次保存占用队列更久，`state.json` 这类高频小写入可能被拖慢。P1 后要复测"边打字边看阅读计时"是否卡顿。

---

## 8. 测试影响面

预计要改的测试（约 22 个）：

`buildDocsChunked` · `chatPersist` · `chipOps` · `dataPaths` · `docReveal` · `examMigration` · `explorerReveal` · `migration` · `migrationStructure` · `notes` · `outline` · `outlineMindmap` · `perGoal` · `persistCommit` · `readingPersist` · `structure` · `structureView` · `superdocHtml` · `superdocs` · `teachDocGroup` · `workspace` · `wsTabs` · `apiRegistry`

**新增测试（必须写）**
- `nodeFile`：一个节点的所有内容能 round-trip（build → parse → 深度相等）。
- `nodeFileCache`：没变的节点不重新序列化（用 spy 数 `stringify` 调用次数）。
- `migrationV3`：迁移幂等 + 逐项对账（第 5 节 P1 的验收清单逐条断言）。
- `facet`：一个节点的 doc 与 outline 是两张卡、坐标互不影响、边端点能解析回 uuid。
- `contentApi`：五种 part 读写各一条，写法只有一种。

---

## 9. 术语表

| 词 | 意思 |
|---|---|
| 数据节点 | 一个 uuid、一个 `nodes/{uuid}.json` |
| part | 节点里的一段内容（正文/大纲/笔记/试卷/超管/未来的闪卡） |
| facet | 节点在画布上的一个"面"（一张卡），key = `${uuid}:${kind}[:${name}]` |
| 登记表 | `NodeKindSpec` 的集合，一种类型一个文件 |
| 落点 | 一份内容在磁盘上的存放位置（本次重构就是把落点从 7 个收敛到 1 个） |
| 目标级账本 | 挂在目标上、不挂节点的数据（对话、阅读、随笔、记忆、函数、工作流） |

---

## 10. 未决问题（执行到这里必须先问用户）

**已定**：
- ~~P1 是否拆成"双写一个版本"~~ → **不拆，直接单写**（D11，用户 2026-10-22 定）。

**待定**：
1. **`index.md` 要不要进版本比对**：它是生成物，内容不变时 diff 不会重写，但如果节点标题变了它会变——可接受。**默认：写，且不参与用户编辑**。
2. **旧 api 别名保留几个版本**：默认保留一个版本（`doc.*` / `outline.*` / `sdoc.*` 转发到 `content.*`），下个版本删。
3. **`files/{uuid}/` 里要不要保留"导出 md"的副本**：默认**不保留**（按需导出）。
4. **迁移失败时，v2 只读解析器留不留**（5.1.5 的降落伞）：
   - A（默认）：留一个版本，启动时能读旧格式并提示"迁移未完成"——多 300 行只读代码，但迁移失败用户还能用。
   - B：不留，迁移失败就阻断启动、提示从 `docs.legacy-*` 恢复——代码最干净，但失败即不可用。
   - 用户既然要"不过多冗余"，可能倾向 B；但 B 的代价是**一次迁移 bug 就让用户打不开应用**。建议 A。

---

## 11. 执行前检查清单

- [ ] 用户确认 D1–D12（尤其 D5 facet、D3 uuid 目录、D11 单写、D12 目标 uuid 沿用根节点）。
- [ ] 用户确认第 10 节的四个未决问题（尤其第 4 条降落伞）。
- [ ] `git status` 干净（本项目常驻别人未提交的改动，动手前必须确认）。
- [ ] 跑一次 `npm test` 记录基线（哪些本来就是红的）。
- [ ] **复制一份真实数据目录做迁移演练**（`%APPDATA%\unyra\users\{uid}` 整个拷走，**不要拿唯一的一份当试验品**）。
- [ ] 演练顺序：① 只跑迁移脚本不接业务代码 → ② 用新代码打开演练副本，逐项对账（5.1.4）→ ③ 再跑第二遍验幂等 → ④ 确认没问题才改业务代码。
- [ ] 确认 `useExportFlow` 的 md 导出覆盖正文（用户选择 D1 的前提）。
- [ ] 迁移脚本先在**没有数据**和**只有一个空目标**两种极端情况上跑通，再上真实数据。
