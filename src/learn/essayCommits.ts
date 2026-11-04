/**
 * 随笔提交：把**这个目标的全部随笔**封成一份快照，交给 Agent 统一整理进知识树，
 * 再把整理结果记回来。
 *
 * 为什么要提交，而不是每次写完就让 Agent 整理：
 * - 随笔是**随手写**的，半句话、错别字、临时念头都有；一提交才算「这批可以归档了」；
 * - 提交要有一份**当时的原样**（snapshot）——之后随笔改了、删了，回看这次整理时
 *   仍然知道它当时读到了什么；
 * - 每次提交都带**全部随笔**（需求定的）：模型看到的是完整语料，而不是「这一批补丁」，
 *   归类与合并才有全局观；本次真正要动手的部分由**与上一次快照的差异**给出
 *   （新增全文 / 修改差异 / 删除清单 / 未变化只列标题），避免把整理过的内容再写一遍；
 * - 整理动了哪几份笔记**由宿主自己对比 store 得出**（noteFingerprint / diffNoteChanges），
 *   不靠模型自报：模型说改了 A、实际改的是 B 时，记录仍然可信。
 *
 * 落盘跟着随笔一起进 `{目标}/essay.json`（`{ version: 2, essays, commits }`）：
 * 提交与它封存的那批随笔必须同生共死，分两个文件只会在一次写盘失败时对不上。
 */

import { t } from '../i18n'
import { essaysOf, ESSAY_TITLE_MAX } from './essays'
import type {
  EssayCommit,
  EssayCommitChange,
  EssayCommitStore,
  EssayEntry,
  KnowledgeNode,
  LearnStore,
} from './types'

/** 提交说明的上限：够写一句话，防手滑把整段随笔粘进来 */
export const ESSAY_COMMIT_MESSAGE_MAX = 200
/** 一条快照里保留的正文上限：与随笔本身的单条上限一致（见 essays 的 ESSAY_TEXT_MAX） */
const SNAPSHOT_TEXT_MAX = 20_000
/** 提交评论的上限：评论是「这次整理的几句话」，不是第二份笔记 */
const ESSAY_COMMENT_MAX = 2_000

/**
 * 提交评论在回复里的标记（见 workflows 的 essay-commit 指令）：
 * Agent 把评论写在这一对 HTML 注释之间——它同时是 Markdown 里的注释，
 * 误解析失败时那段文字也不会在对话气泡里碍事。
 */
export const ESSAY_COMMENT_BEGIN = '<!-- essay-commit-comment'
export const ESSAY_COMMENT_END = '-->'

/**
 * 从回复全文里抠出提交评论：**最后一对**标记之间的 Markdown（首行应是标题）。
 * 解析不到 / 中间是空的返回 null——评论是锦上添花，绝不能因为它挡住整理结果本身。
 */
export function parseEssayComment(reply: string): string | null {
  if (!reply) return null
  const begin = reply.lastIndexOf(ESSAY_COMMENT_BEGIN)
  if (begin < 0) return null
  const rest = reply.slice(begin + ESSAY_COMMENT_BEGIN.length)
  const end = rest.indexOf(ESSAY_COMMENT_END)
  const body = (end >= 0 ? rest.slice(0, end) : rest).trim().slice(0, ESSAY_COMMENT_MAX)
  return body || null
}

/** 一条提交的评论标题：Markdown 的第一行抹掉记号（`## `）就是标题；没写评论退回提交说明 */
export function essayCommentTitle(commit: EssayCommit): string {
  const first = commit.comment?.replace(/\r\n?/g, '\n').split('\n', 1)[0] ?? ''
  const title = first.replace(/^\s{0,3}#{1,6}\s*/, '').trim()
  return title || commit.message
}

/** 这个目标的提交记录（新的在前） */
export function commitsOf(store: LearnStore, goalId: string): EssayCommit[] {
  return store.essayCommits?.[goalId] ?? []
}

/** 一次提交相对上一份快照的差异：新增全文、修改差异、删除清单、未变化只列标题 */
export interface EssayDiff {
  /** 上次快照里没有的（新材料里给全文） */
  added: EssayEntry[]
  /** 正文改过的（新材料里只给改动处） */
  edited: EssayEntry[]
  /** 上次快照里有、这次已经没有的（只剩标题与创建时间） */
  removed: Array<{ id: string; title: string; createdAt: number }>
  /** 正文没变的（只列标题，提醒模型不要重做） */
  unchanged: EssayEntry[]
  /** 有增 / 删 / 改：界面据此决定提交按钮能不能点 */
  changed: boolean
}

/**
 * 全部随笔 vs 上一份快照的差异。
 *
 * 为什么按**正文**比而不是按 updatedAt：改名不该触发一轮整理（笔记里不记标题），
 * 而「正文有没有变」才是模型要不要动手的唯一判据。快照为 null（从没提交过）时
 * 所有随笔都算新增。
 */
export function diffEssaysAgainst(
  essays: EssayEntry[],
  snapshot: EssayCommit['snapshot'] | null | undefined,
): EssayDiff {
  const prev = new Map((snapshot ?? []).map((s) => [s.id, s]))
  const out: EssayDiff = { added: [], edited: [], removed: [], unchanged: [], changed: false }
  const seen = new Set<string>()
  for (const essay of essays) {
    seen.add(essay.id)
    const before = prev.get(essay.id)
    if (!before) out.added.push(essay)
    else if (before.text !== essay.text) out.edited.push(essay)
    else out.unchanged.push(essay)
  }
  for (const s of snapshot ?? []) {
    if (!seen.has(s.id)) out.removed.push({ id: s.id, title: s.title || '', createdAt: s.createdAt })
  }
  out.changed = out.added.length > 0 || out.edited.length > 0 || out.removed.length > 0
  return out
}


/** 换一份提交清单（保持「新的在前」） */
function withCommits(store: LearnStore, goalId: string, list: EssayCommit[]): LearnStore {
  const next: EssayCommitStore = { ...(store.essayCommits ?? {}) }
  if (list.length) next[goalId] = list
  else delete next[goalId]
  return { ...store, essayCommits: next }
}

/**
 * 提交一次：把**当前的全部随笔**封成快照，插到最前面。
 * 一条随笔都没有时返回 null（空提交没有意义，也不该在历史里留一条空记录）。
 *
 * 注意：这里不判断「有没有变化」——那是界面的门禁（见 diffEssaysAgainst 的 changed）。
 * 数据层允许在没变化时再提交一次（等价于「按当前全部内容重新整理」）。
 */
export function createEssayCommit(
  store: LearnStore,
  goalId: string,
  message: string,
  at: number,
): { store: LearnStore; commit: EssayCommit } | null {
  const all = essaysOf(store, goalId)
  if (!all.length) return null
  const commit: EssayCommit = {
    id: crypto.randomUUID(),
    at,
    message: (message.trim() || t('随笔整理')).slice(0, ESSAY_COMMIT_MESSAGE_MAX),
    snapshot: all.map((e) => ({
      id: e.id,
      // 标题一并封存：提交之后随笔改了名、删了，回看仍是当时的原样
      title: e.title.slice(0, ESSAY_TITLE_MAX),
      createdAt: e.createdAt,
      text: e.text.slice(0, SNAPSHOT_TEXT_MAX),
    })),
    status: 'running',
    changes: [],
  }
  return {
    store: withCommits(store, goalId, [commit, ...commitsOf(store, goalId)]),
    commit,
  }
}

/** 改一条提交记录（整理完成 / 失败 / 重试 / 写入评论） */
export function updateEssayCommit(
  store: LearnStore,
  goalId: string,
  id: string,
  patch: Partial<Pick<EssayCommit, 'status' | 'changes' | 'error' | 'comment'>>,
): LearnStore {
  const list = commitsOf(store, goalId)
  if (!list.some((c) => c.id === id)) return store
  return withCommits(
    store,
    goalId,
    list.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  )
}

/** 快照文本的上限：提交是「这一批随笔」，但一轮对话放不下几万字——超出部分只留在快照里 */
const SNAPSHOT_FEED_MAX = 24_000
/** 增量喂法里，单条随笔正文的上限（一条随笔本身就已经到 20k 时会截断） */
const PER_ESSAY_FEED_MAX = 6_000
/** 历史里最多列最近几次提交：再往前的整理记录对「这次放哪儿」没有帮助 */
const HISTORY_MAX = 6

const pad2 = (n: number): string => String(n).padStart(2, '0')
const dayOfTs = (ts: number): string => {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
const stampOfTs = (ts: number): string => {
  const d = new Date(ts)
  return dayOfTs(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/**
 * 一条「修改过的随笔」只给出改动处：取公共前后缀，中间那段就是新增 / 改写的内容。
 *
 * 为什么不做逐行 diff：随笔常常是一整段话，按行切只有一行，等于没切；
 * 而「接着往下写」是最常见的修改，公共前缀极长，取前后缀正好逮住新加的那几句。
 */
function deltaOf(prev: string, next: string): string {
  const max = Math.min(prev.length, next.length)
  let head = 0
  while (head < max && prev[head] === next[head]) head++
  let tail = 0
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++
  const before = prev.slice(Math.max(0, head - 40), head)
  const changed = next.slice(head, next.length - tail)
  const after = next.slice(next.length - tail, next.length - tail + 40)
  const body = changed.length > PER_ESSAY_FEED_MAX ? changed.slice(0, PER_ESSAY_FEED_MAX) + '…（改动过长，已截断）' : changed
  return (
    '…' + before + '\n' +
    '>>> 新增 / 改动：\n' + body + '\n' +
    '<<< ' + after + '…'
  )
}

/**
 * 交给 Agent 的整理材料：**提交历史 + 全部随笔相对上次的差异**。
 *
 * 快照是全部随笔（需求定的），但材料只把「要动手的部分」讲清楚：
 * 新增给全文、修改给改动处、删除给标题、没变化只列标题。这样才能既看到完整语料，
 * 又不会把上次已经整理过的内容再写一遍（笔记越整理越重复的那口坑）。
 */
export function commitFeed(commits: EssayCommit[], current: EssayCommit): string {
  const older = commits.filter((c) => c.id !== current.id && c.at <= current.at).sort((a, b) => a.at - b.at)
  const prev = older.length ? older[older.length - 1] : null
  const diff = diffEssaysAgainst(
    current.snapshot.map((s) => ({
      id: s.id,
      title: s.title ?? '',
      text: s.text,
      createdAt: s.createdAt,
      updatedAt: current.at,
    })),
    prev?.snapshot,
  )

  const lines: string[] = []
  lines.push(
    '这是随笔的第 ' + (older.length + 1) + ' 次提交（提交说明：' + current.message + '）。',
    '本次快照包含**全部 ' + current.snapshot.length + ' 条随笔**；与上次相比：新增 ' + diff.added.length +
      ' 条、修改 ' + diff.edited.length + ' 条、删除 ' + diff.removed.length + ' 条、未变化 ' + diff.unchanged.length + ' 条。',
  )
  if (older.length) {
    lines.push('', '【已有整理记录】（这些内容已经整理进笔记，不要重复写入）')
    for (const c of older.slice(-HISTORY_MAX)) {
      const touched = c.changes.length
        ? c.changes
            .slice(0, 8)
            .map(
              (x) =>
                (x.kind === 'created' ? '新建' : '更新') +
                '「' + (x.nodeTitle || x.nodeId) + '」/ 笔记「' + x.noteName + '」',
            )
            .join('；') + (c.changes.length > 8 ? '；等 ' + c.changes.length + ' 份笔记' : '')
        : '没有改动任何笔记'
      lines.push('- ' + stampOfTs(c.at) + '「' + c.message + '」→ ' + touched)
    }
  }

  let budget = SNAPSHOT_FEED_MAX
  const take = (text: string): string => {
    if (budget <= 0) return '…（本次材料过长，后面的内容已省略；完整快照在提交记录里）'
    const body = text.slice(0, Math.min(text.length, budget))
    budget -= body.length
    return body
  }

  lines.push('', diff.added.length ? '【本次新增的随笔】' : '【本次没有新增随笔】')
  for (const s of diff.added) {
    lines.push('【' + dayOfTs(s.createdAt) + '】', take(s.text.slice(0, PER_ESSAY_FEED_MAX)))
  }

  // 修改只给改动处：prev 里那一条的全文与当前对比（取公共前后缀）
  const prevById = new Map((prev?.snapshot ?? []).map((s) => [s.id, s]))
  lines.push('', diff.edited.length ? '【本次修改的随笔（只给改动处）】' : '【本次没有修改随笔】')
  for (const e of diff.edited) {
    const before = prevById.get(e.id)?.text ?? ''
    lines.push('【' + dayOfTs(e.createdAt) + '】', take(deltaOf(before, e.text)))
  }

  lines.push('', diff.removed.length ? '【本次删除的随笔（只剩标题）】' : '【本次没有删除随笔】')
  for (const r of diff.removed) {
    lines.push('- 「' + (r.title || stampOfTs(r.createdAt)) + '」（' + dayOfTs(r.createdAt) + '）')
  }

  lines.push('', '【本次未变化的随笔（只列标题，不要重写）】')
  if (!diff.unchanged.length) lines.push('（没有）')
  for (const u of diff.unchanged) {
    lines.push('- 「' + (u.title || stampOfTs(u.createdAt)) + '」（' + dayOfTs(u.createdAt) + '）')
  }
  return lines.join('\n')
}

/* ---------- 整理前后：笔记指纹与差异 ---------- */

interface NoteMark {
  nodeId: string
  nodeTitle: string
  noteName: string
  content: string
}

/**
 * 这个目标下所有笔记的「指纹」：节点 + 笔记名 → 正文。
 *
 * 只认**笔记**（node.notes），不认教学文档：随笔整理要落的地方是笔记，
 * 教学文档由「开讲」那一套工作流负责，混进来会把整理结果记到不相干的改动上。
 */
export function noteFingerprint(store: LearnStore, goalId: string): Map<string, NoteMark> {
  const out = new Map<string, NoteMark>()
  for (const node of store.nodes) {
    if (node.goalId !== goalId) continue
    for (const note of node.notes ?? []) {
      out.set(node.id + '\u0000' + note.name, {
        nodeId: node.id,
        nodeTitle: node.title,
        noteName: note.name,
        content: note.content,
      })
    }
  }
  return out
}

/** 对比两次指纹：新建 / 正文变了的笔记，就是这次整理动过的地方 */
export function diffNoteChanges(before: Map<string, NoteMark>, after: Map<string, NoteMark>): EssayCommitChange[] {
  const out: EssayCommitChange[] = []
  for (const [key, mark] of after) {
    const prev = before.get(key)
    if (!prev) {
      out.push({ nodeId: mark.nodeId, nodeTitle: mark.nodeTitle, noteName: mark.noteName, kind: 'created' })
    } else if (prev.content !== mark.content) {
      out.push({ nodeId: mark.nodeId, nodeTitle: mark.nodeTitle, noteName: mark.noteName, kind: 'updated' })
    }
  }
  return out.sort((a, b) => a.nodeTitle.localeCompare(b.nodeTitle) || a.noteName.localeCompare(b.noteName))
}

/** 给界面看的一句总结：「新建 2 份、更新 1 份笔记」 */
export function changesSummary(changes: EssayCommitChange[]): string {
  const created = changes.filter((c) => c.kind === 'created').length
  const updated = changes.length - created
  if (!changes.length) return t('没有改动任何笔记')
  if (!created) return t('更新了 {0} 份笔记', String(updated))
  if (!updated) return t('新建了 {0} 份笔记', String(created))
  return t('新建 {0} 份、更新 {1} 份笔记', String(created), String(updated))
}

/* ---------- 读盘归一化 ---------- */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * essay.json 里 commits 的归一化。
 *
 * 认不出的丢掉；**`running` 一律降成 `error`**：整理是渲染层发起的一轮对话，
 * 应用关掉 / 刷新之后那一轮已经不存在了，留一个「整理中」在界面上永远转圈才是骗人。
 * 用户点「重试」就能再跑一次。
 */
export function normalizeEssayCommits(raw: unknown, aliveGoals: Set<string>): EssayCommitStore {
  const out: EssayCommitStore = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const items: EssayCommit[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID()
      if (seen.has(id)) continue
      seen.add(id)
      const at = isNum(r.at) ? r.at : Date.now()
      const snapshot: EssayCommit['snapshot'] = []
      if (Array.isArray(r.snapshot)) {
        for (const s of r.snapshot) {
          if (!s || typeof s !== 'object') continue
          const e = s as Record<string, unknown>
          const text = typeof e.text === 'string' ? e.text.slice(0, SNAPSHOT_TEXT_MAX) : ''
          if (!text.trim()) continue
          snapshot.push({
            id: typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID(),
            // 旧提交没有 title：不硬补，界面按提交日期回退显示
            ...(typeof e.title === 'string' && e.title.trim()
              ? { title: e.title.trim().slice(0, ESSAY_TITLE_MAX) }
              : {}),
            createdAt: isNum(e.createdAt) ? e.createdAt : at,
            text,
          })
        }
      }
      if (!snapshot.length) continue
      const changes: EssayCommitChange[] = []
      if (Array.isArray(r.changes)) {
        for (const c of r.changes) {
          if (!c || typeof c !== 'object') continue
          const v = c as Record<string, unknown>
          if (typeof v.nodeId !== 'string' || !v.nodeId) continue
          if (typeof v.noteName !== 'string' || !v.noteName) continue
          changes.push({
            nodeId: v.nodeId,
            nodeTitle: typeof v.nodeTitle === 'string' ? v.nodeTitle : '',
            noteName: v.noteName,
            kind: v.kind === 'created' ? 'created' : 'updated',
          })
        }
      }
      const status = r.status === 'done' || r.status === 'error' ? r.status : 'error'
      // 评论可选：认不出的（不是字符串 / 空白）就不给，界面按「没有评论」渲染
      const comment =
        typeof r.comment === 'string' && r.comment.trim()
          ? r.comment.trim().slice(0, ESSAY_COMMENT_MAX)
          : undefined
      items.push({
        id,
        at,
        message: typeof r.message === 'string' ? r.message.slice(0, ESSAY_COMMIT_MESSAGE_MAX) : t('随笔整理'),
        snapshot,
        status,
        changes,
        ...(comment ? { comment } : {}),
        ...(status === 'error'
          ? {
              error:
                typeof r.error === 'string' && r.error
                  ? r.error
                  : r.status === 'running'
                    ? t('上次整理没有跑完（应用关闭或中断），可以重试')
                    : t('整理失败，可以重试'),
            }
          : {}),
      })
    }
    if (!items.length) continue
    items.sort((a, b) => b.at - a.at)
    out[goalId] = items
  }
  return out
}

/** 一条提交里动过的节点 id（界面按它高亮 / 统计用） */
export function committedNodeIds(commit: EssayCommit): string[] {
  return [...new Set(commit.changes.map((c) => c.nodeId))]
}

/** 节点 id → 节点（当前 store 里还活着的）；找不到时返回 null，界面按「已删除」显示 */
export function liveNode(store: LearnStore, nodeId: string): KnowledgeNode | null {
  return store.nodes.find((n) => n.id === nodeId) ?? null
}
