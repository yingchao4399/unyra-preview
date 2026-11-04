/**
 * 上下文对比调试器（重做版）：**不录制**每次请求的上下文——那份流水账只会制造噪音。
 *
 * 它只做一件事：盯住前后两次请求的**缓存命中字数**。每个会话滚动保留最近**两份**
 * 实发上下文（不落盘、不累积、往后一挤就扔），命中一旦跌了（见 learn/useAgent 的
 * 哨兵与 agent/prefixGate 的纪元账本——设计内的前缀搬家不触发），当场把这两份
 * 摆出来，并算好「后一次在哪断开」：逐条标出 原文 / 消息职责 / 消息角色。
 * 没有骤降，就什么都不留。
 *
 * 断开的判定与 agent/prefixGate 的门禁同一套形状语言：
 * - 逐字节**只增**（前缀 + 追加）→ 载荷没有分叉，命中骤降是服务商侧行为（逐出/记账）；
 * - **从最旧一头裁掉一段**（withinBudget 的形状）→ 前缀搬家，命中只余搬家点之后的账；
 * - 中途**改写** → 断在第几条消息，逐条摆出新旧两份；
 * - **工具声明 / 系统提示词**变了 → 断在第 0 位之前/第 0 条。
 */
import type { ChatMessage } from '../ai/types'

/** runtime 在发送前交来的上下文快照（messages[0] 就是系统提示词，见 agent/runtime） */
export interface ContextSnapshot {
  system: string
  messages: ChatMessage[]
  tools?: unknown[]
  /** 请求身份（runtime 递来）：骤降自证用——模型/档位翻面不在字节比对里，却可能换引擎换缓存 */
  model?: string
  reasoningEffort?: string
}

/** 合并视图里的一条：两边按断点对齐后摆在一起 */
export interface DebugMessage {
  /** 这条在**后一次**请求里的下标（被裁掉的条目只存在于上一次，给上一次的下标） */
  index: number
  role: string
  /** 消息职责（由 wire 形状推）：系统提示词 / 工作流指令 / 工具回执 / 用户消息 … */
  duty: string
  chars: number
  /** 原文（序列化含 tool_calls 结构；这就是发往模型的字节） */
  text: string
  status: 'same' | 'changed' | 'added' | 'removed'
  /** 仅 changed：上一次的那一份原文 + 第一处差异的字符位置与两侧摘录 */
  oldText?: string
  firstDiff?: { at: number; old: string; new: string }
}

export type DropKind = 'rewrite' | 'trim' | 'tools' | 'system' | 'append'

export interface ContextDropReport {
  /** 会话（prefixGate 账本同键） */
  key: string
  at: number
  prevRead: number
  currRead: number
  kind: DropKind
  /** 定格时的前后两份实发上下文（原样字节；下载包的内容） */
  prev: ContextSnapshot
  curr: ContextSnapshot
  /** 两次请求的身份差异（模型/档位翻面）：不在字节比对里，却可能整体换掉服务商缓存 */
  identity?: string
  /** 一句话结论：后一次这份在哪断开 */
  headline: string
  /** 合并摆出的消息序列（被裁掉的来自上一次，新增的来自这一次；一致的头也在，由界面折叠） */
  messages: DebugMessage[]
  /** 断开点落在合并视图里的下标；只增（服务商侧）与纯工具声明变化时为 null */
  breakAt: number | null
  /** 仅 trim：上一次开头被裁掉多少条 */
  droppedCount?: number
  /** 仅 tools：工具声明的指纹（断点不在任何一条消息上） */
  toolsChanged?: boolean
}

/* ---------- 滚动账本：每会话只留最近两份请求 + 最近一次定格的报告 ---------- */

const pairs = new Map<string, { prev: ContextSnapshot; curr: ContextSnapshot }>()
const reports = new Map<string, ContextDropReport>()
let last: ContextDropReport | null = null
const listeners = new Set<() => void>()

const fire = (): void => {
  for (const fn of [...listeners]) fn()
}

/** 每次请求发出前记账（learn/useAgent 的 onContext，与实发完全一致的那一份） */
export function noteRequest(key: string, snapshot: ContextSnapshot): void {
  // 定格即深拷贝：runtime 递来的是活引用（messages 在本轮内还会被逐跳 push），不拷贝的话
  // 同一轮的 prev/curr 就是同一个数组——「前后对比」是同义反复，下载包里的证据也跟着作废
  const frozen = JSON.parse(JSON.stringify(snapshot)) as ContextSnapshot
  const pair = pairs.get(key)
  pairs.set(key, { prev: pair?.curr ?? frozen, curr: frozen })
}

/**
 * 命中骤降时定格：把滚动的那两份算出断点、冻结成报告。返回 false = 没有两份可摆
 * （比如第一跳就跌——那本来就是无缓存可谈的请求）。
 */
export function captureDrop(key: string, prevRead: number, currRead: number): boolean {
  const pair = pairs.get(key)
  if (!pair) return false
  const report = analyze(key, pair.prev, pair.curr, prevRead, currRead)
  reports.set(key, report)
  last = report
  fire()
  return true
}

/** 最新一次定格的报告（调试器窗口看的就是它；跨会话也认最新） */
export function lastDropReport(): ContextDropReport | null {
  return last
}

export function clearDropReports(): void {
  reports.clear()
  last = null
  fire()
}

export function subscribeDrops(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 下载包的形状：报告的结论 + 前后两份实发上下文的**原样字节**（不多不少）。
 * 调试器把它序列化后 gzip 成 .json.gz 供下载——交给别的眼睛看，或贴进 bug 报告。
 */
export function dropBundleOf(report: ContextDropReport): Record<string, unknown> {
  return {
    app: 'unyra',
    type: 'context-drop',
    key: report.key,
    at: report.at,
    prevRead: report.prevRead,
    currRead: report.currRead,
    kind: report.kind,
    headline: report.headline,
    ...(report.identity ? { identity: report.identity } : {}),
    prev: report.prev,
    curr: report.curr,
  }
}

/* ---------- 断点分析 ---------- */

/**
 * 消息的指纹与原文：发往模型的字段全摆出来——含思考原文 reasoning_content（思考模式
 * 的回传契约就落在这个字段上，比对时不能瞎）与 tool_calls / tool_call_id（结构变了也算断）。
 */
const messageText = (m: ChatMessage): string =>
  JSON.stringify({
    role: m.role,
    content: m.content,
    reasoning_content: m.reasoning_content ?? null,
    tool_calls: m.tool_calls ?? null,
    id: m.tool_call_id ?? null,
  })

/**
 * 消息职责：从 wire 形状推（这里拿不到会话原数据，只看发出去的字节）。
 * 认得出的是几类显眼标记：工作流指令的标准标题、压缩摘要的抬头、模块注入的抬头、
 * 工具回执与工具图片；其余按角色落回「用户消息 / 助手回复」。
 */
export function dutyOf(m: ChatMessage): string {
  if (m.role === 'system') return '系统提示词'
  if (m.role === 'tool') return '工具回执'
  if (m.role === 'assistant') {
    if (m.tool_calls?.length) {
      return '助手 · 发起工具调用（' + m.tool_calls.map((c) => c.function.name).join('、') + '）'
    }
    const text = typeof m.content === 'string' ? m.content : ''
    if (text.startsWith('【提示词模块')) return '助手 · 提示词模块注入'
    return '助手回复'
  }
  if (Array.isArray(m.content)) return '工具图片'
  const text = typeof m.content === 'string' ? m.content : ''
  if (text.startsWith('## 使用「')) return '工作流指令'
  if (text.startsWith('【先前对话的压缩摘要】')) return '上下文压缩摘要'
  return '用户消息'
}

/** 两段文本的第一处差异：位置 + 两侧摘录（各 ±40 字）；完全相同返回 null */
function firstCharDiff(oldText: string, newText: string): { at: number; old: string; new: string } | null {
  const n = Math.min(oldText.length, newText.length)
  let i = 0
  while (i < n && oldText[i] === newText[i]) i++
  if (i === n && oldText.length === newText.length) return null
  const excerpt = (t: string): string => t.slice(Math.max(0, i - 40), i + 60)
  return { at: i, old: excerpt(oldText), new: excerpt(newText) }
}

const row = (m: ChatMessage, index: number, status: DebugMessage['status'], old?: ChatMessage): DebugMessage => {
  const text = messageText(m)
  const base: DebugMessage = {
    index,
    role: m.role,
    duty: dutyOf(m),
    chars: text.length,
    text,
    status,
  }
  if (old) {
    const oldText = messageText(old)
    base.oldText = oldText
    const d = firstCharDiff(oldText, text)
    if (d) base.firstDiff = d
  }
  return base
}

/** 裁剪形状：curr 的消息体（从第 1 位起）是否与 prev 的第 s 位起逐条对齐。对上了返回 s。 */
function trimOffset(prev: ChatMessage[], curr: ChatMessage[]): number | null {
  if (curr.length < 2 || prev.length < 2) return null
  for (let s = 1; s < prev.length; s++) {
    const overlap = Math.min(curr.length - 1, prev.length - s)
    if (overlap <= 0) break
    let ok = true
    for (let j = 0; j < overlap; j++) {
      if (messageText(prev[s + j]) !== messageText(curr[1 + j])) {
        ok = false
        break
      }
    }
    if (ok) return s
  }
  return null
}

function analyze(
  key: string,
  prev: ContextSnapshot,
  curr: ContextSnapshot,
  prevRead: number,
  currRead: number,
): ContextDropReport {
  const p = prev.messages
  const c = curr.messages
  /*
   * 请求身份对账：模型与思考档位不进前缀比对的字节（前缀纪律只管 messages+tools），
   * 但它们翻面可能整体换掉服务商的缓存（换模型必然全 miss；DeepSeek V4 这类混合引擎
   * 思考开/关可能路由到不同引擎）。deepseek-reasoner+none 还会在 bodyFor 里静默换成
   * deepseek-chat——门禁与哨兵都看不见，这里必须自己喊出来。
   */
  const identityParts: string[] = []
  if (prev.model !== curr.model && (prev.model !== undefined || curr.model !== undefined))
    identityParts.push(`模型 ${prev.model ?? '（无）'} → ${curr.model ?? '（无）'}`)
  if (
    prev.reasoningEffort !== curr.reasoningEffort &&
    (prev.reasoningEffort !== undefined || curr.reasoningEffort !== undefined)
  )
    identityParts.push(`档位 ${prev.reasoningEffort ?? '（无）'} → ${curr.reasoningEffort ?? '（无）'}`)
  const identity = identityParts.length ? identityParts.join('，') : undefined
  const toolsChanged =
    JSON.stringify(prev.tools ?? []) !== JSON.stringify(curr.tools ?? [])
  const systemChanged = !p.length || !c.length || messageText(p[0]) !== messageText(c[0])
  const base = { key, at: Date.now(), prevRead, currRead, prev, curr, ...(identity ? { identity } : {}) }

  if (toolsChanged) {
    // 工具声明也在缓存前缀里（第 0 位之前）：断点不在任何一条消息上
    return {
      ...base,
      kind: 'tools',
      headline: '工具声明在两次请求之间变了——缓存从第 0 位之前就断开，与消息无关。',
      messages: [],
      breakAt: null,
      toolsChanged: true,
    }
  }
  if (systemChanged) {
    return {
      ...base,
      kind: 'system',
      headline: '系统提示词（第 0 条）变了——缓存从第 0 条断开，后面的消息全部无效。',
      messages: p.length && c.length ? [row(c[0], 0, 'changed', p[0])] : [],
      breakAt: 0,
    }
  }

  // 逐条找第一处分叉（系统提示词之后的第 1 位起）
  let diverged = -1
  const n = Math.min(p.length, c.length)
  for (let i = 1; i < n; i++) {
    if (messageText(p[i]) !== messageText(c[i])) {
      diverged = i
      break
    }
  }

  if (diverged < 0) {
    if (c.length > p.length) {
      // 逐字节只增：载荷没有分叉，命中骤降是服务商侧的事
      return {
        ...base,
        kind: 'append',
        headline:
          '两份上下文逐字节只增未改——命中骤降发生在服务商侧（缓存逐出/记账），不是载荷分叉。',
        messages: [],
        breakAt: null,
      }
    }
    if (c.length === p.length) {
      // 完全一致（同一跳的重复读数）：同样不是分叉
      return {
        ...base,
        kind: 'append',
        headline: '两份上下文逐字节一致——命中骤降发生在服务商侧（缓存逐出/记账）。',
        messages: [],
        breakAt: null,
      }
    }
    // 后一次比前一次还短且无分叉：尾巴被删（门禁会拦，理论上到不了这）
    return {
      ...base,
      kind: 'rewrite',
      headline: `后一次比前一次少了 ${p.length - c.length} 条消息（尾部被删）。`,
      messages: p.slice(c.length).map((m, i) => row(m, c.length + i, 'removed')),
      breakAt: c.length,
    }
  }

  // 有分叉：先看是不是「从最旧一头裁掉一段」的形状（withinBudget）
  const s = trimOffset(p, c)
  if (s !== null && s > 1) {
    const messages: DebugMessage[] = []
    // 被裁掉的头（只存在于上一次）
    for (let i = 1; i < s; i++) messages.push(row(p[i], i, 'removed'))
    // 对齐段：curr[j] ↔ prev[s + j - 1]
    const overlap = Math.min(c.length - 1, p.length - s)
    let breakAt: number | null = null
    for (let j = 1; j <= overlap; j++) {
      const same = messageText(p[s + j - 1]) === messageText(c[j])
      if (!same && breakAt === null) breakAt = messages.length
      messages.push(row(c[j], j, same ? 'same' : 'changed', same ? undefined : p[s + j - 1]))
    }
    for (let j = overlap + 1; j < c.length; j++) {
      if (breakAt === null) breakAt = messages.length
      messages.push(row(c[j], j, 'added'))
    }
    return {
      ...base,
      kind: 'trim',
      headline: `前缀搬家：上一次开头的 ${s - 1} 条被裁掉（超预算从最旧一头丢弃，设计内行为）——缓存只余搬家点之后的账。`,
      messages,
      breakAt,
      droppedCount: s - 1,
    }
  }

  // 真改写：断在第 diverged 条，逐条摆出
  const messages: DebugMessage[] = []
  for (let i = 1; i < diverged; i++) messages.push(row(c[i], i, 'same'))
  let breakAt: number | null = null
  const total = Math.max(p.length, c.length)
  for (let i = diverged; i < total; i++) {
    const oldMsg = p[i]
    const newMsg = c[i]
    if (oldMsg && newMsg) {
      const same = messageText(oldMsg) === messageText(newMsg)
      if (!same && breakAt === null) breakAt = messages.length
      messages.push(row(newMsg, i, same ? 'same' : 'changed', same ? undefined : oldMsg))
    } else if (newMsg) {
      if (breakAt === null) breakAt = messages.length
      messages.push(row(newMsg, i, 'added'))
    } else {
      if (breakAt === null) breakAt = messages.length
      messages.push(row(oldMsg, i, 'removed'))
    }
  }
  return {
    ...base,
    kind: 'rewrite',
    headline: `前缀被改写：后一次的第 ${diverged} 条与上一次实发不一致——缓存从这里整段断开。`,
    messages,
    breakAt,
  }
}
