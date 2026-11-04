/**
 * 随笔：**目标级**的随手记——挂一条标题的短文本，想开几条就开几条。
 *
 * 与笔记的区别（见 learn/notes）：笔记是**某个节点的文档**，有名字、进文档树、要保存；
 * 随笔是「学着学着脑子里冒出来的一句话」，随手写、随手翻，不占文档区的页签。
 * 因此它不挂在任何节点上，只挂在目标上——「这门课我随手记过什么」。
 *
 * 身份靠 id，名字靠 title：**日期不再是随笔的唯一标识**（老机制是「一天一条」，
 * 开窗口自动接今天那条）。标题默认取创建那天的日期（见 defaultEssayTitle），随时可改；
 * 条数不设上限。没有随笔时窗口一开就**自动备好一条新的**（标题已填好今天的日期，
 * 写下第一个字才真正落一条——空文本仍然不落盘，见 components/learn/essay 的说明）。
 *
 * 落盘：`{目标}/essay.json`（与 method.json / workflow.json / reading.json 同一层、
 * 同一条纪律——这个目标一条都没有就不写这个文件）。目标是它的生命周期：
 * 删掉目标，随笔跟着一起没。
 */

import { t } from '../i18n'
import type { EssayDockRect, EssayEntry, EssayStore, LearnStore } from './types'

/** 单条随笔的字符上限：随笔是「一句话/一小段」，不是文档。超了按上限截断而不是拒绝 */
export const ESSAY_TEXT_MAX = 20_000
/** 标题的上限：标题是一行名字，不是第二篇正文 */
export const ESSAY_TITLE_MAX = 120

/** 这个目标的随笔：**新的在前**（列表与「最近一条」都靠这个顺序） */
export function essaysOf(store: LearnStore, goalId: string): EssayEntry[] {
  return store.essays?.[goalId] ?? []
}

/**
 * 默认标题：创建那天的日期（同年「10 月 19 日」，跨年带年份）。
 * 标题不是唯一标识——同一天开几条就出几个同名默认标题，改不改随用户。
 */
export function defaultEssayTitle(at: number): string {
  const d = new Date(at)
  const y = String(d.getFullYear())
  const m = String(d.getMonth() + 1)
  const day = String(d.getDate())
  return y === String(new Date().getFullYear())
    ? t('{0} 月 {1} 日', m, day)
    : t('{0} 年 {1} 月 {2} 日', y, m, day)
}

/** 标题落库前的清理：抹空白、截上限；空了退回日期默认（标题永远有值可显示） */
function cleanTitle(raw: unknown, at: number): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, ESSAY_TITLE_MAX) : ''
  return s || defaultEssayTitle(at)
}

/** 按日期归堆用的一天：本地日历日（`2026-10-18`） */
export function dayOfEssay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 一天的钟点（`09:12`）：列表里每一条前面那枚小字 */
export function timeOfEssay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 列表预览：把 Markdown 抹成一行纯文字。
 *
 * 列表里要的是「这条讲什么」，不是渲染结果——`## 标题`、`**重点**`、``` 围栏
 * 原样摆进去只会占地方。抹完压成一行，太长由界面截断。
 */
export function essayPreview(text: string, max = 80): string {
  const flat = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ') // 代码块整段不要（预览里它只剩噪声）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接留文字
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]*/gm, '') // 标题/引用/列表记号
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

/** 按日期分组：日期倒序，组内也是新的在前（入参已经是新的在前，这里只负责切段） */
export function groupEssaysByDay(list: EssayEntry[]): Array<{ day: string; items: EssayEntry[] }> {
  const out: Array<{ day: string; items: EssayEntry[] }> = []
  for (const e of list) {
    const day = dayOfEssay(e.createdAt)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(e)
    else out.push({ day, items: [e] })
  }
  return out
}

/** 换一份随笔清单（保持「新的在前」：新增的插到最前面） */
function withList(store: LearnStore, goalId: string, list: EssayEntry[]): LearnStore {
  const next: EssayStore = { ...(store.essays ?? {}) }
  if (list.length) next[goalId] = list
  else delete next[goalId]
  return { ...store, essays: next }
}

/**
 * 写一条新的。文本为空时**什么都不做**（返回 null）——空随笔不是一条随笔，
 * 它只是「编辑器还空着」（见文件头的说明）。
 * title 缺省 / 空白时取创建那天的日期（见 defaultEssayTitle）。
 */
export function createEssay(
  store: LearnStore,
  goalId: string,
  text: string,
  at: number,
  title?: string,
): { store: LearnStore; entry: EssayEntry } | null {
  const body = text.slice(0, ESSAY_TEXT_MAX)
  if (!body.trim()) return null
  const entry: EssayEntry = {
    id: crypto.randomUUID(),
    title: cleanTitle(title, at),
    text: body,
    createdAt: at,
    updatedAt: at,
  }
  /*
   * 按 createdAt 插到该在的位置（平时就是最前面）。
   * 不无脑 unshift：时钟往回跳、或某条是从别处导入的旧时间戳时，
   * 「新的在前」这个顺序得靠时间排，而不是靠「谁后写进来」。
   */
  const list = essaysOf(store, goalId)
  const spot = list.findIndex((e) => e.createdAt < entry.createdAt)
  const next = spot < 0 ? [...list, entry] : [...list.slice(0, spot), entry, ...list.slice(spot)]
  return { store: withList(store, goalId, next), entry }
}

/**
 * 改一条：patch 里给了谁就动谁（正文 / 标题），updatedAt 跟着变；
 * createdAt 不动——它仍是这条随笔「哪天写的」的唯一凭证（排序与详情回退都用它）。
 * 标题改空了退回日期默认，永远不给一条无名的随笔。
 */
export function updateEssay(
  store: LearnStore,
  goalId: string,
  id: string,
  patch: { text?: string; title?: string },
  at: number,
): LearnStore {
  const list = essaysOf(store, goalId)
  if (!list.some((e) => e.id === id)) return store
  const text = typeof patch.text === 'string' ? patch.text.slice(0, ESSAY_TEXT_MAX) : undefined
  const title = typeof patch.title === 'string' ? cleanTitle(patch.title, at) : undefined
  return withList(
    store,
    goalId,
    list.map((e) =>
      e.id === id
        ? {
            ...e,
            ...(text !== undefined ? { text } : {}),
            ...(title !== undefined ? { title } : {}),
            updatedAt: at,
          }
        : e,
    ),
  )
}

/** 删一条；没有就原样返回 store（调用方不必先查） */
export function deleteEssay(store: LearnStore, goalId: string, id: string): LearnStore {
  const list = essaysOf(store, goalId)
  if (!list.some((e) => e.id === id)) return store
  return withList(
    store,
    goalId,
    list.filter((e) => e.id !== id),
  )
}

/* ---------- 读盘归一化 ---------- */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** 随笔窗口的最小尺寸（与 components/learn/essay 里的拖拽下限同一组数） */
export const ESSAY_DOCK_MIN_W = 380
export const ESSAY_DOCK_MIN_H = 300

/**
 * 随笔窗口几何的归一化。
 *
 * 只做「是不是数」的校验：**夹进视口是打开那一刻的事**——上次关应用时窗口是 1440 宽，
 * 这次可能只有 900，存下来的坐标必须当场重新夹一遍（见 EssayDock），而不是在数据层
 * 按当时的屏幕裁死。所以这里只丢掉认不出的、把宽高抬到下限。
 */
export function normalizeEssayDock(raw: unknown): EssayDockRect | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const x = typeof r.x === 'number' && Number.isFinite(r.x) ? Math.round(r.x) : null
  const y = typeof r.y === 'number' && Number.isFinite(r.y) ? Math.round(r.y) : null
  const w = typeof r.w === 'number' && Number.isFinite(r.w) ? Math.round(r.w) : null
  const h = typeof r.h === 'number' && Number.isFinite(r.h) ? Math.round(r.h) : null
  if (x === null || y === null || w === null || h === null) return undefined

  const activeTab = r.activeTab === 'note' || r.activeTab === 'essay' ? r.activeTab : undefined
  const essayEditingId =
    typeof r.essayEditingId === 'string' || r.essayEditingId === null ? r.essayEditingId : undefined

  let noteTarget: EssayDockRect['noteTarget'] = undefined
  if (r.noteTarget && typeof r.noteTarget === 'object') {
    const nt = r.noteTarget as Record<string, unknown>
    if (typeof nt.nodeId === 'string' && typeof nt.noteName === 'string') {
      noteTarget = {
        goalId: typeof nt.goalId === 'string' ? nt.goalId : undefined,
        nodeId: nt.nodeId,
        noteName: nt.noteName,
      }
    }
  } else if (r.noteTarget === null) {
    noteTarget = null
  }

  const noteViewMode = r.noteViewMode === 'preview' || r.noteViewMode === 'edit' ? r.noteViewMode : undefined

  return {
    x,
    y,
    w: Math.max(ESSAY_DOCK_MIN_W, w),
    h: Math.max(ESSAY_DOCK_MIN_H, h),
    ...(activeTab ? { activeTab } : {}),
    ...(essayEditingId !== undefined ? { essayEditingId } : {}),
    ...(noteTarget !== undefined ? { noteTarget } : {}),
    ...(noteViewMode ? { noteViewMode } : {}),
  }
}

/**
 * 磁盘上那份 essay.json 的归一化。
 *
 * 与其它目标级数据同一条口径：**认不出的丢掉，坏数据不该拖垮整库**。
 * 目标已经不在的那些整本丢掉（那是它的随笔，目标没了随笔就该跟着没）；
 * 空文本条目也丢掉——它只可能是手改文件留下的。
 */
export function normalizeEssays(raw: unknown, aliveGoals: Set<string>): EssayStore {
  const out: EssayStore = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const items: EssayEntry[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const text = typeof r.text === 'string' ? r.text : ''
      if (!text.trim()) continue
      const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : crypto.randomUUID()
      seen.add(id)
      const createdAt = isNum(r.createdAt) ? r.createdAt : Date.now()
      items.push({
        id,
        // 标题是后加的字段：旧数据没有就按 createdAt 补一个日期默认
        title: cleanTitle(r.title, createdAt),
        text: text.slice(0, ESSAY_TEXT_MAX),
        createdAt,
        updatedAt: isNum(r.updatedAt) ? r.updatedAt : createdAt,
      })
    }
    if (!items.length) continue
    // 落盘顺序不保证，读回来按时间重排一遍：列表与「最近一条」都靠这个顺序
    items.sort((a, b) => b.createdAt - a.createdAt)
    out[goalId] = items
  }
  return out
}
