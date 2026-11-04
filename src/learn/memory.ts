/**
 * 记忆（沙箱里的 memory.*）：导师跨对话留下来的东西，分**工作**与**长期**两类。
 *
 * 边界写在最前面（需求明确的约束）：记忆**绝不**被拼进系统提示词或任何消息。
 * 系统提示词一字不变是前缀缓存命中的前提（见 learn/ai 的说明），把一份会增长的
 * 记忆塞进去，等于让上下文每一轮都漂移；更根本的是，记忆该由 agent 自己决定
 * 何时取用——它得先想起「我有记忆」这件事，教学才有连续性。
 *
 * 因此这里只提供读写，并把「什么时候该看一眼记忆」写进提示词（learn/ai 的
 * EXECUTE_GUIDE），数据本身永远不出现在 agent 没有主动请求的上下文里。
 *
 * 两类记忆的作用域不同，这决定了它们存在哪儿、能不能随手删：
 *
 * | | 工作（work） | 长期（long） |
 * | --- | --- | --- |
 * | 作用域 | 目标级：只有这个目标的会话读得到 | 跨目标：任何会话都读得到 |
 * | 记什么 | 发生了什么 / 要做什么 / 怎么做 / 过程 / 结果 | 对用户的印象、作息、重要约定 |
 * | 存哪儿 | `docs/{目标}/mind.json` | `state.json`（跟用户走，不属于任何目标） |
 * | 删除 | agent 觉得是信息负担就可以删 | **必须显式确认**（`{ confirm: true }`） |
 *
 * 表格最后一行是这次重构唯一一条「业务上不让步」的规矩：长期记忆是跨目标的共同底账，
 * 某一次对话顺手删掉，别的目标就跟着失忆了。
 */
import type { LearnStore, MemoryItem, MemoryStore, MemoryType } from './types'
import type { MemoryOps } from '../agent/sandbox/types'

/* ---------- 上限 ---------- */

/** 单条正文上限：一条记忆说一件事，写不下的拆成几条 */
export const MEMORY_CONTENT_MAX = 4_000
/** 标题上限：一行话，够认出这条是什么 */
export const MEMORY_TITLE_MAX = 120
/** 关键词条数与单条长度：关键词是检索用的，不是正文 */
export const MEMORY_KEYS_MAX = 12
export const MEMORY_KEY_MAX = 32
/** 一个目标的工作记忆上限：超过时挤掉最旧的——记忆是判断，不是日志 */
export const MEMORY_WORK_MAX = 200
/** 长期记忆上限（跨目标，所以给得比单个目标宽一点） */
export const MEMORY_LONG_MAX = 300

/* ---------- 读 ---------- */

/** 空记忆库（旧数据没有 memory 字段，读侧一律走它兜底） */
export const emptyMemoryStore = (): MemoryStore => ({ long: [], work: {} })

export const memoryStoreOf = (store: LearnStore): MemoryStore => store.memory ?? emptyMemoryStore()

export const longMemories = (store: LearnStore): MemoryItem[] => memoryStoreOf(store).long

export const workMemories = (store: LearnStore, goalId: string): MemoryItem[] =>
  memoryStoreOf(store).work[goalId] ?? []

/** 某个作用域的全部条目（列表页与 api.list 共用） */
export function memoriesOf(store: LearnStore, type: MemoryType, goalId?: string | null): MemoryItem[] {
  return type === 'long' ? longMemories(store) : goalId ? workMemories(store, goalId) : []
}

/**
 * 按 uuid 找一条，连同它属于哪个作用域（工作记忆要回它的目标 id）。
 *
 * 跨目标查是**故意**的：长期记忆本来就没有目标，工作记忆的 uuid 也只在
 * 「这轮会话能不能看见它」那一层被拦（见 createMemoryOps 的 visible）。
 */
export function findMemory(store: LearnStore, uuid: string): { item: MemoryItem; goalId: string | null } | null {
  const m = memoryStoreOf(store)
  const long = m.long.find((x) => x.uuid === uuid)
  if (long) return { item: long, goalId: null }
  for (const [goalId, list] of Object.entries(m.work)) {
    const hit = list.find((x) => x.uuid === uuid)
    if (hit) return { item: hit, goalId }
  }
  return null
}

/* ---------- 规整 ---------- */

/** 关键词：去空、去重、截断；顺序保持用户写的那个顺序 */
export function normalizeKeys(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,，、;；\n]/) : []
  const out: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const key = item.trim().slice(0, MEMORY_KEY_MAX)
    if (!key || out.includes(key)) continue
    out.push(key)
    if (out.length >= MEMORY_KEYS_MAX) break
  }
  return out
}

/** 标题：抹平空白、截断；空标题退回正文首行（记忆总要有个名字） */
export function normalizeTitle(raw: unknown, content: string): string {
  const title = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MEMORY_TITLE_MAX) : ''
  if (title) return title
  const firstLine = content.split('\n').find((line) => line.trim()) ?? ''
  return firstLine.trim().slice(0, MEMORY_TITLE_MAX) || '未命名记忆'
}

/** 正文：去首尾空白 + 截断 */
export const normalizeContent = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().slice(0, MEMORY_CONTENT_MAX) : ''

/**
 * 一条记忆的归一化（读盘与写入共用）。
 *
 * 读盘时它要宽容：磁盘上的东西可能被人手改过，也可能来自上一版（那时叫 MindEntry：
 * `{ id, key?, text, createdAt, updatedAt }`）——这里把老形状折成新形状，
 * 迁移就发生在读的这一遍里，不需要单独的迁移脚本。
 */
export function normalizeMemoryItem(raw: unknown, fallbackType: MemoryType): MemoryItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const legacy = typeof r.text === 'string'
  const content = normalizeContent(legacy ? r.text : r.content)
  if (!content) return null
  const uuid = typeof r.uuid === 'string' && r.uuid ? r.uuid : typeof r.id === 'string' && r.id ? r.id : ''
  if (!uuid) return null
  const type = r.type === 'long' || r.type === 'work' ? r.type : fallbackType
  const keys = normalizeKeys(legacy && typeof r.key === 'string' ? [r.key] : r.keys)
  const createAt =
    typeof r.createAt === 'number' ? r.createAt : typeof r.createdAt === 'number' ? r.createdAt : Date.now()
  const updateAt =
    typeof r.updateAt === 'number' ? r.updateAt : typeof r.updatedAt === 'number' ? r.updatedAt : createAt
  return {
    uuid,
    keys,
    title: normalizeTitle(legacy ? r.key : r.title, content),
    content,
    createAt,
    updateAt,
    type,
  }
}

/** 一个作用域的清单归一化：去重（uuid）、按更新时间倒序、裁剪到上限 */
export function normalizeMemoryList(raw: unknown, fallbackType: MemoryType, limit: number): MemoryItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MemoryItem[] = []
  for (const item of raw) {
    const one = normalizeMemoryItem(item, fallbackType)
    if (!one || seen.has(one.uuid)) continue
    seen.add(one.uuid)
    out.push(one)
  }
  out.sort((a, b) => b.updateAt - a.updateAt)
  return out.slice(0, limit)
}

/**
 * 整库归一化：目标没了的工作记忆跟着丢（与 resources / methods 同一条纪律）。
 *
 * `raw` 既认新形状（`{ long, work }`），也认上一版的 `minds`（目标 id → MindEntry[]）——
 * 老用户的记忆因此原样变成「这个目标的工作记忆」，一条都不丢。
 */
export function normalizeMemoryStore(
  raw: unknown,
  legacyMinds: unknown,
  goalIds: Set<string>,
): MemoryStore {
  const out: MemoryStore = emptyMemoryStore()
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  out.long = normalizeMemoryList(src.long, 'long', MEMORY_LONG_MAX)
  const rawWork = (src.work && typeof src.work === 'object' ? src.work : {}) as Record<string, unknown>
  for (const [goalId, list] of Object.entries(rawWork)) {
    if (!goalIds.has(goalId)) continue
    const items = normalizeMemoryList(list, 'work', MEMORY_WORK_MAX)
    if (items.length) out.work[goalId] = items
  }
  // 上一版：minds（按目标的长期记忆）→ 这个目标的工作记忆
  const legacy = (legacyMinds && typeof legacyMinds === 'object' ? legacyMinds : {}) as Record<string, unknown>
  for (const [goalId, list] of Object.entries(legacy)) {
    if (!goalIds.has(goalId) || out.work[goalId]) continue
    const items = normalizeMemoryList(list, 'work', MEMORY_WORK_MAX)
    if (items.length) out.work[goalId] = items
  }
  return out
}

/* ---------- 写 ---------- */

export interface MemoryInput {
  type: MemoryType
  /** 工作记忆的归属目标；长期记忆忽略它 */
  goalId?: string | null
  title?: string
  keys?: unknown
  content: string
}

export interface MemoryPatch {
  type?: MemoryType
  /** 改成工作记忆时的归属目标 */
  goalId?: string | null
  title?: string
  keys?: unknown
  content?: string
}

/** 写入后的 store 里那份清单（内部用：把一条放到它该在的地方） */
function withItem(store: LearnStore, item: MemoryItem, goalId: string | null): LearnStore {
  const m = memoryStoreOf(store)
  if (item.type === 'long') {
    const next = [item, ...m.long.filter((x) => x.uuid !== item.uuid)].slice(0, MEMORY_LONG_MAX)
    return { ...store, memory: { ...m, long: next } }
  }
  const gid = goalId ?? ''
  if (!gid) return store
  const list = [item, ...(m.work[gid] ?? []).filter((x) => x.uuid !== item.uuid)].slice(0, MEMORY_WORK_MAX)
  return { ...store, memory: { ...m, work: { ...m.work, [gid]: list } } }
}

/** 把一条从它原来待的地方摘掉（改类型 / 改归属时用） */
function withoutItem(store: LearnStore, uuid: string): LearnStore {
  const m = memoryStoreOf(store)
  const long = m.long.filter((x) => x.uuid !== uuid)
  const work: Record<string, MemoryItem[]> = {}
  for (const [goalId, list] of Object.entries(m.work)) {
    const kept = list.filter((x) => x.uuid !== uuid)
    if (kept.length) work[goalId] = kept
  }
  return { ...store, memory: { long, work } }
}

/**
 * 新建一条记忆。
 *
 * uuid 由宿主生成（`crypto.randomUUID`）：模型不该也不能指定身份，否则
 * 「update 哪一条」就变成了靠猜。正文为空直接返回原 store（不写空记忆）。
 */
export function createMemory(store: LearnStore, input: MemoryInput, uuid?: string): LearnStore {
  const content = normalizeContent(input.content)
  if (!content) return store
  const goalId = input.goalId ?? null
  if (input.type === 'work' && !goalId) return store
  const now = Date.now()
  const item: MemoryItem = {
    uuid: uuid || crypto.randomUUID(),
    keys: normalizeKeys(input.keys),
    title: normalizeTitle(input.title, content),
    content,
    createAt: now,
    updateAt: now,
    type: input.type,
  }
  return withItem(store, item, goalId)
}

/**
 * 更新一条：只改给了的字段，身份（uuid / createAt）不动。
 *
 * 改 `type` 是**搬家**：工作 → 长期会让所有目标都看到它，长期 → 工作则要落到
 * `goalId` 指定的目标（没给就落回它原来那个目标，再没有就拒绝）。
 */
export function updateMemory(store: LearnStore, uuid: string, patch: MemoryPatch): LearnStore {
  const hit = findMemory(store, uuid)
  if (!hit) return store
  const prev = hit.item
  const type = patch.type ?? prev.type
  const content = patch.content === undefined ? prev.content : normalizeContent(patch.content)
  if (!content) return store
  const goalId = type === 'work' ? (patch.goalId ?? hit.goalId) : null
  if (type === 'work' && !goalId) return store
  const next: MemoryItem = {
    ...prev,
    type,
    title: patch.title === undefined ? (content === prev.content ? prev.title : normalizeTitle(prev.title, content)) : normalizeTitle(patch.title, content),
    keys: patch.keys === undefined ? prev.keys : normalizeKeys(patch.keys),
    content,
    updateAt: Date.now(),
  }
  return withItem(withoutItem(store, uuid), next, goalId)
}

/** 删除一条。业务上的「长期记忆不能随手删」由 api 层拦（见 createMemoryOps），这里是纯删除 */
export function deleteMemory(store: LearnStore, uuid: string): LearnStore {
  if (!findMemory(store, uuid)) return store
  return withoutItem(store, uuid)
}

/** 清空一个目标的工作记忆（记忆管理页的「清空」；长期记忆不在此列） */
export function clearWorkMemories(store: LearnStore, goalId: string): LearnStore {
  const m = memoryStoreOf(store)
  if (!(m.work[goalId] ?? []).length) return store
  const work = { ...m.work }
  delete work[goalId]
  return { ...store, memory: { ...m, work } }
}

/* ---------- 给模型看的形状 ---------- */

/** 给模型看的时间：到分钟为止，够认出先后即可 */
const stamp = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

/** 摘要长度：列表里一条一行，够认出是哪件事 */
const EXCERPT = 120

/**
 * 一条记忆翻成回执。`full` 时带全文（get 用），否则只带摘要（list 用）。
 *
 * 字段名与数据模型一致（uuid / keys / title / content / type…）：模型看到的名字
 * 与它调 api 时写的名字必须是同一个，少一层翻译就少一类「它记错了参数名」。
 */
export function memoryView(m: MemoryItem, full: boolean): Record<string, unknown> {
  return {
    uuid: m.uuid,
    type: m.type,
    title: m.title,
    ...(m.keys.length ? { keys: m.keys } : {}),
    ...(full
      ? { content: m.content }
      : { excerpt: m.content.length > EXCERPT ? m.content.slice(0, EXCERPT) + '…' : m.content }),
    chars: m.content.length,
    createAt: stamp(m.createAt),
    updateAt: stamp(m.updateAt),
  }
}

/* ---------- 沙箱那一组 ---------- */

export interface MemoryDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  /** 这一轮会话的目标：工作记忆的读写都按它划界 */
  goalId: () => string
}

/**
 * 装配出沙箱要的 `api.memory`（见 SandboxOptions.memory）。
 *
 * 可见性是这里唯一的硬约束：
 * - 长期记忆任何目标都能读写；
 * - 工作记忆只有**当前目标**那一份能读，别的一律当「没有这条」——
 *   不是报「无权访问」，那会让模型以为换个写法就能绕过去；
 * - 长期记忆的删除要 `{ confirm: true }`，没有就回一句说明为什么。
 *
 * 失败一律回 `{ error }`（与 res.* 同一约定），成功回普通对象。
 */
export function createMemoryOps(deps: MemoryDeps): MemoryOps {
  const goal = (): string => deps.goalId()

  /** 这条记忆在当前会话里看不看得见 */
  const visible = (uuid: string): MemoryItem | null => {
    const hit = findMemory(deps.getLatest(), uuid)
    if (!hit) return null
    if (hit.item.type === 'long') return hit.item
    return hit.goalId === goal() ? hit.item : null
  }

  return {
    list: (query) => {
      const q = (query ?? {}) as Record<string, unknown>
      const type = q.type === 'long' || q.type === 'work' ? q.type : undefined
      const store = deps.getLatest()
      const long = type === 'work' ? [] : longMemories(store)
      const work = type === 'long' ? [] : workMemories(store, goal())
      const items = [...long, ...work].sort((a, b) => b.updateAt - a.updateAt)
      return {
        count: items.length,
        long: long.length,
        work: work.length,
        note:
          items.length === 0
            ? '还没有记忆。值得跨对话记住的东西（用户的印象与作息 → type:"long"；这个目标发生了什么、要做什么 → type:"work"）用 api.memory.create 存下来。'
            : '记忆不会自动出现在上下文里：需要时用 api.memory.get(uuid) 读全文。',
        items: items.map((m) => memoryView(m, false)),
      }
    },

    get: (uuid) => {
      if (!uuid) return { error: '要给出 uuid；先用 api.memory.list() 看有哪些记忆' }
      const m = visible(uuid)
      if (!m) return { error: '没有这条记忆（uuid 对不上，或者它属于别的目标）：' + uuid + '。用 api.memory.list() 核对。' }
      return memoryView(m, true)
    },

    create: (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>
      const content = normalizeContent(p.content)
      if (!content) {
        return {
          error:
            'api.memory.create 需要 content（要记住的内容）。写成 api.memory.create({ type, title, keys?, content })。' +
            'type 只能是 "work"（本目标的工作记忆）或 "long"（跨目标的长期记忆）。',
        }
      }
      const type: MemoryType = p.type === 'long' ? 'long' : 'work'
      const goalId = goal()
      if (type === 'work' && !goalId) return { error: '当前会话没有所属目标，工作记忆无处可放；要跨目标记住请用 type:"long"' }
      const store = createMemory(
        deps.getLatest(),
        { type, goalId, title: typeof p.title === 'string' ? p.title : undefined, keys: p.keys, content },
        typeof p.uuid === 'string' && p.uuid ? p.uuid : undefined,
      )
      deps.set(store)
      const hit = deps.getLatest().memory
      const count = type === 'long' ? (hit?.long.length ?? 0) : (hit?.work[goalId]?.length ?? 0)
      return {
        ok: true,
        type,
        count,
        note:
          type === 'long'
            ? '已记为长期记忆（跨目标可见，删除要显式确认）。共 ' + count + ' 条。'
            : '已记为这个目标的工作记忆（只有本目标读得到）。共 ' + count + ' 条。',
      }
    },

    update: (uuid, patch) => {
      if (!uuid) return { error: '要给出要更新的 uuid' }
      if (!visible(uuid)) return { error: '没有这条记忆：' + uuid + '。用 api.memory.list() 核对。' }
      const p = (patch ?? {}) as Record<string, unknown>
      const type = p.type === 'long' || p.type === 'work' ? p.type : undefined
      const next = updateMemory(deps.getLatest(), uuid, {
        ...(type ? { type } : {}),
        ...(typeof p.title === 'string' ? { title: p.title } : {}),
        ...(p.keys !== undefined ? { keys: p.keys } : {}),
        ...(typeof p.content === 'string' ? { content: p.content } : {}),
        goalId: goal(),
      })
      if (next === deps.getLatest()) return { error: '没有可更新的内容（正文不能为空）' }
      deps.set(next)
      return { ok: true, uuid, note: '已更新。' }
    },

    remove: (uuid, opts) => {
      if (!uuid) return { error: '要给出要删除的 uuid' }
      const hit = findMemory(deps.getLatest(), uuid)
      if (!hit || (hit.item.type === 'work' && hit.goalId !== goal())) {
        return { error: '没有这条记忆：' + uuid + '。用 api.memory.list() 核对。' }
      }
      if (hit.item.type === 'long' && !(opts && opts.confirm === true)) {
        return {
          error:
            '长期记忆是跨目标的共同底账，不能随手删。确认要删就再调一次：' +
            'api.memory.delete(' + JSON.stringify(uuid) + ', { confirm: true })',
        }
      }
      deps.set(deleteMemory(deps.getLatest(), uuid))
      return { ok: true, deleted: uuid, type: hit.item.type }
    },
  }
}
