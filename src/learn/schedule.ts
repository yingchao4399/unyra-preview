/**
 * 日程（schedule）：用户「某天某时间做什么」的提醒清单。
 *
 * 与专注模式的分工（两者都出现在顶栏，但回答的是两件事）：
 * - 专注模式是**守卫**：用户按下开始，它只管这一场学习有没有人盯着；
 * - 日程是**约定**：用户（或导师）先把它写下来，到点由宿主叫他。
 *
 * 四条定死的规则，改这个文件之前先读一遍：
 *
 * 1. **日程是用户级数据**（不挂目标）：今天几点做什么，与「在学哪门课」无关。
 *    整块存在 `state.json` 里（与专注记录同一套：没有磁盘镜像），目标删掉也不该带走它。
 * 2. **时间就是墙上时间**：不做「学习日」（凌晨 4 点为界）那一套折算——日程上的
 *    「23:30」就该在 23:30 响，而不是被算进第二天的学习日。日界一律按本地日历日。
 * 3. **提醒只响一次**：`remindAt` 到点之后进入「响铃中」，用户确认（完成）或
 *    稍后提醒（把 remindAt 往后推）才算收场。晚到太久的不再响——应用关了一整天，
 *    回来不该被十几条陈年日程轮番轰炸（见 `SCHEDULE_DUE_GRACE_MS`）。
 * 4. **agent 可以排日程**（api.schedule.*）：这是「帮用户安排」而不是「替用户执行」。
 *    到点提醒、确认、稍后提醒都在用户手里；agent 只负责把事项写进这张表。
 *
 * 一个刻意的取舍：日程**不进任何提示词**。系统提示词一字不变是前缀缓存命中的前提
 * （与 memory 同一条纪律），日程该由 agent 需要时自己 `api.schedule.list()` 取。
 */

import type { LearnStore } from './types'
import type { ScheduleOps } from '../agent/sandbox/types'

/* ---------- 上限与默认值 ---------- */

/** 标题上限：一行话说清「做什么」 */
export const SCHEDULE_TITLE_MAX = 200
/** 备注上限：日程表里的第二条信息，够写「在哪儿、带什么」即可 */
export const SCHEDULE_NOTE_MAX = 2_000
/** 总条数上限：日程是约定，不是日志；超过时挤掉最久以前的已完成项 */
export const SCHEDULE_MAX_ITEMS = 1_000
/**
 * 晚到多久还值得响。
 *
 * 应用关了一整天再打开时，昨天那几条不该轮番轰炸；而窗口藏在后台、机器睡了一觉
 * 醒来的十几分钟延迟必须照响。30 分钟是这两件事之间的分界。
 */
export const SCHEDULE_DUE_GRACE_MS = 30 * 60_000
/** 稍后提醒的几档（分钟）：界面上三颗按钮，agent 也可以照这三档说 */
export const SCHEDULE_SNOOZE_CHOICES = [5, 10, 30] as const
/** 「提前多久提醒」的可选档位（分钟）：0 = 准点 */
export const SCHEDULE_REMIND_CHOICES = [0, 5, 10, 15, 30, 60] as const

/* ---------- 铃声 ---------- */

/**
 * 铃声预设：全部由 WebAudio 现场合成，不带音频文件。
 *
 * 为什么不用 mp3：一个几百 KB 的音频文件要进安装包、要处理路径与编解码，而日程提醒
 * 需要的只是「几声不刺耳、听得见」的音——合成器几行代码就够，还能随时调音量。
 * 新增一档就是往这张表里加一个名字（播放实现在 lib/scheduleSound）。
 */
export const SCHEDULE_SOUND_PRESETS = ['chime', 'bell', 'pulse', 'soft'] as const
export type ScheduleSoundPreset = (typeof SCHEDULE_SOUND_PRESETS)[number]

export interface ScheduleSound {
  preset: ScheduleSoundPreset
  /** 音量 0~1（0 = 静音，只留视觉提醒） */
  volume: number
}

export const DEFAULT_SCHEDULE_SOUND: ScheduleSound = { preset: 'chime', volume: 0.7 }

export const isScheduleSoundPreset = (v: unknown): v is ScheduleSoundPreset =>
  typeof v === 'string' && (SCHEDULE_SOUND_PRESETS as readonly string[]).includes(v)

/* ---------- 数据模型 ---------- */

export interface ScheduleItem {
  id: string
  title: string
  /** 备注（可选）：地点、要带的东西、为什么约这一场 */
  note?: string
  /** 开始时刻（epoch ms，本地墙上时间） */
  startAt: number
  /** 结束时刻（可选，只用于展示时长；没有就只显示开始时间） */
  endAt?: number
  /** 提醒时刻（epoch ms）；默认等于 startAt */
  remindAt: number
  /** 完成（确认）时刻；null/缺省 = 还没完成 */
  doneAt?: number
  /** 稍后提醒过几次（展示用，不参与任何判定） */
  snoozeCount?: number
  /** 排这条日程时属于哪个目标（可选，纯标记，不影响可见性） */
  goalId?: string
  createAt: number
  updateAt: number
}

export interface ScheduleStore {
  version: number
  items: ScheduleItem[]
  sound: ScheduleSound
}

export function emptySchedule(): ScheduleStore {
  return { version: 1, items: [], sound: { ...DEFAULT_SCHEDULE_SOUND } }
}

/** 读侧兜底：旧数据没有 schedule 字段时一律走空库（与 memory / focus 同一口径） */
export const scheduleOf = (store: Pick<LearnStore, 'schedule'>): ScheduleStore => store.schedule ?? emptySchedule()

export const scheduleSoundOf = (store: Pick<LearnStore, 'schedule'>): ScheduleSound => scheduleOf(store).sound

/* ---------- 日历小工具（本地时区，不做学习日折算） ---------- */

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 某个时刻属于哪一天（本地日历日，YYYY-MM-DD） */
export function dayKeyOf(at: number): string {
  const d = new Date(at)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 某一天的零点（本地时间） */
export function dayStartOf(day: string): number {
  const [y, m, d] = day.split('-').map((x) => Number(x))
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime()
}

/** 某个时刻的「几点几分」（24 小时制，HH:mm） */
export function timeTextOf(at: number): string {
  const d = new Date(at)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 解析 HH:mm（也收 H:mm）；越界回 null */
export function parseTimeText(text: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((text ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, m: min }
}

/** 某天某点（本地时间）；时分非法时回 NaN，由调用方判 */
export function atDayTime(day: string, time: string): number {
  const t = parseTimeText(time)
  if (!t) return NaN
  const base = dayStartOf(day)
  return base + (t.h * 60 + t.m) * 60_000
}

/** 往前/往后挪几天（按日历日算，跨月与夏令时都不会错位） */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map((x) => Number(x))
  const next = new Date(y, (m || 1) - 1, (d || 1) + delta, 12, 0, 0, 0)
  return dayKeyOf(next.getTime())
}

/** 是不是一个合法的 YYYY-MM-DD（形状对、日期真实存在） */
export function isDayKey(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const at = dayStartOf(text)
  return Number.isFinite(at) && dayKeyOf(at) === text
}

/* ---------- 查询 ---------- */

const byStart = (a: ScheduleItem, b: ScheduleItem): number => a.startAt - b.startAt || a.createAt - b.createAt

/** 某一天的全部日程（含已完成的；按开始时间升序） */
export function itemsOnDay(store: Pick<LearnStore, 'schedule'>, day: string): ScheduleItem[] {
  return scheduleOf(store)
    .items.filter((it) => dayKeyOf(it.startAt) === day)
    .sort(byStart)
}

/** 今天的日程 */
export const todayItems = (store: Pick<LearnStore, 'schedule'>, now = Date.now()): ScheduleItem[] =>
  itemsOnDay(store, dayKeyOf(now))

/** 接下来还没完成的那一条（含正在响的那条）；没有就 null */
export function nextItem(store: Pick<LearnStore, 'schedule'>, now = Date.now()): ScheduleItem | null {
  const list = scheduleOf(store)
    .items.filter((it) => !it.doneAt && it.remindAt > now)
    .sort(byStart)
  return list[0] ?? null
}

/**
 * 此刻该响的那一条（没有就 null）。
 *
 * 判据三条：没完成、提醒时刻已到、且没晚过 grace。多条同时到点时按提醒时刻取最早的那条——
 * 一条一条来，用户确认掉一条，下一条自然浮上来。
 */
export function dueItem(
  store: Pick<LearnStore, 'schedule'>,
  now = Date.now(),
  graceMs = SCHEDULE_DUE_GRACE_MS,
): ScheduleItem | null {
  const list = scheduleOf(store)
    .items.filter((it) => !it.doneAt && it.remindAt <= now && now - it.remindAt <= graceMs)
    .sort((a, b) => a.remindAt - b.remindAt)
  return list[0] ?? null
}

/** 这条是不是「已经错过」了（提醒时间过去太久，不会再响） */
export function isMissed(
  item: ScheduleItem,
  now = Date.now(),
  graceMs = SCHEDULE_DUE_GRACE_MS,
): boolean {
  return !item.doneAt && now - item.remindAt > graceMs
}

/* ---------- 写入 ---------- */

export interface ScheduleInput {
  title: string
  startAt: number
  endAt?: number | null
  remindAt?: number | null
  note?: string | null
  goalId?: string | null
}

export interface SchedulePatch {
  title?: string
  startAt?: number
  endAt?: number | null
  remindAt?: number | null
  note?: string | null
  done?: boolean
}

const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'sch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const cleanTitle = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, SCHEDULE_TITLE_MAX) : ''

const cleanNote = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().slice(0, SCHEDULE_NOTE_MAX) : ''

/** 时间戳是否可用（正的有限数） */
const usableAt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * 超出上限时挤掉谁：先丢「最久以前的已完成项」，再丢最久以前的未完成项。
 *
 * 不能简单地按创建时间砍——一张排了半年的日程表里，砍掉的可能是下个月那场考试，
 * 留下的全是三个月前已经做完的事。
 */
function trimItems(items: ScheduleItem[]): ScheduleItem[] {
  if (items.length <= SCHEDULE_MAX_ITEMS) return items
  const keep = [...items]
  const dropOrder = [...keep].sort((a, b) => {
    const ad = a.doneAt ? 0 : 1
    const bd = b.doneAt ? 0 : 1
    return ad - bd || a.startAt - b.startAt
  })
  const doomed = new Set(dropOrder.slice(0, keep.length - SCHEDULE_MAX_ITEMS).map((x) => x.id))
  return keep.filter((x) => !doomed.has(x.id))
}

/** 新建一条；`now` 只用于 createAt/updateAt（提醒时刻由调用方算好传进来） */
export function addScheduleItem(
  store: LearnStore,
  input: ScheduleInput,
  now = Date.now(),
): { store: LearnStore; item: ScheduleItem } | { error: string } {
  const title = cleanTitle(input.title)
  if (!title) return { error: '日程要有标题（做什么）' }
  if (!usableAt(input.startAt)) return { error: '日程要有开始时间' }
  const endAt = usableAt(input.endAt) && input.endAt > input.startAt ? input.endAt : undefined
  const remindAt = usableAt(input.remindAt) ? input.remindAt : input.startAt
  const item: ScheduleItem = {
    id: newId(),
    title,
    startAt: input.startAt,
    remindAt: Math.min(remindAt, input.startAt),
    ...(endAt ? { endAt } : {}),
    ...(cleanNote(input.note) ? { note: cleanNote(input.note) } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    createAt: now,
    updateAt: now,
  }
  const s = scheduleOf(store)
  return { store: { ...store, schedule: { ...s, items: trimItems([...s.items, item]) } }, item }
}

/** 改一条：只改给了的字段；`done` 是真/假两个方向的开关 */
export function updateScheduleItem(
  store: LearnStore,
  id: string,
  patch: SchedulePatch,
  now = Date.now(),
): LearnStore {
  const s = scheduleOf(store)
  const prev = s.items.find((it) => it.id === id)
  if (!prev) return store
  const title = patch.title === undefined ? prev.title : cleanTitle(patch.title)
  if (!title) return store
  const startAt = usableAt(patch.startAt) ? patch.startAt : prev.startAt
  const endAt =
    patch.endAt === undefined
      ? prev.endAt
      : usableAt(patch.endAt) && patch.endAt > startAt
        ? patch.endAt
        : undefined
  // 提醒时刻：显式给了就用它；否则按「开始时间挪了多少」同步挪，保持原来的提前量
  const remindAt =
    patch.remindAt === undefined
      ? prev.remindAt + (startAt - prev.startAt)
      : usableAt(patch.remindAt)
        ? patch.remindAt
        : startAt
  const doneAt = patch.done === undefined ? prev.doneAt : patch.done ? (prev.doneAt ?? now) : undefined
  // 逐字段重造，而不是 `{ ...prev }` 再覆盖：endAt / note / doneAt 都是**可以被清掉**的，
  // 展开旧对象会让「清空」变成「原样保留」（写错过一次，用例钉住了）
  const noteText = patch.note === undefined ? (prev.note ?? '') : cleanNote(patch.note)
  const next: ScheduleItem = {
    id: prev.id,
    title,
    startAt,
    remindAt: Math.min(remindAt, startAt),
    createAt: prev.createAt,
    updateAt: now,
    ...(endAt ? { endAt } : {}),
    ...(noteText ? { note: noteText } : {}),
    ...(doneAt ? { doneAt } : {}),
    ...(prev.snoozeCount ? { snoozeCount: prev.snoozeCount } : {}),
    ...(prev.goalId ? { goalId: prev.goalId } : {}),
  }
  return {
    ...store,
    schedule: { ...s, items: s.items.map((it) => (it.id === id ? next : it)) },
  }
}

/** 删一条 */
export function removeScheduleItem(store: LearnStore, id: string): LearnStore {
  const s = scheduleOf(store)
  if (!s.items.some((it) => it.id === id)) return store
  return { ...store, schedule: { ...s, items: s.items.filter((it) => it.id !== id) } }
}

/** 完成（用户确认「知道了」）：到点提醒就此收场 */
export function completeScheduleItem(store: LearnStore, id: string, now = Date.now()): LearnStore {
  return updateScheduleItem(store, id, { done: true }, now)
}

/** 稍后提醒：把提醒时刻推到 now + minutes，未完成状态不变 */
export function snoozeScheduleItem(
  store: LearnStore,
  id: string,
  minutes: number,
  now = Date.now(),
): LearnStore {
  const s = scheduleOf(store)
  const prev = s.items.find((it) => it.id === id)
  if (!prev) return store
  const mins = Math.max(1, Math.round(minutes))
  const next: ScheduleItem = {
    ...prev,
    remindAt: now + mins * 60_000,
    snoozeCount: (prev.snoozeCount ?? 0) + 1,
    updateAt: now,
  }
  return {
    ...store,
    schedule: { ...s, items: s.items.map((it) => (it.id === id ? next : it)) },
  }
}

/** 改铃声设置（设置页与日程页共用） */
export function setScheduleSound(store: LearnStore, patch: Partial<ScheduleSound>): LearnStore {
  const s = scheduleOf(store)
  const sound = normalizeScheduleSound({ ...s.sound, ...patch })
  return { ...store, schedule: { ...s, sound } }
}

/* ---------- 落盘数据的校验 ---------- */

export function normalizeScheduleSound(raw: unknown): ScheduleSound {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : DEFAULT_SCHEDULE_SOUND.volume
  return { preset: isScheduleSoundPreset(r.preset) ? r.preset : DEFAULT_SCHEDULE_SOUND.preset, volume }
}

/**
 * 从磁盘读回日程。
 *
 * 宽容是这里的全部要求：state.json 会被手改、也会来自旧版本。单条坏数据只丢它自己，
 * 不连坐整张表；id 重复的（手改出来的）只留第一条——页签与按钮都按 id 认，重复了会删错。
 */
export function normalizeSchedule(raw: unknown): ScheduleStore {
  const out = emptySchedule()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  out.sound = normalizeScheduleSound(r.sound)
  if (!Array.isArray(r.items)) return out
  const seen = new Set<string>()
  for (const entry of r.items) {
    const item = normalizeScheduleItem(entry)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    out.items.push(item)
  }
  out.items = trimItems(out.items)
  return out
}

function normalizeScheduleItem(raw: unknown): ScheduleItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.trim() : ''
  const title = cleanTitle(r.title)
  const startAt = r.startAt
  if (!id || !title || !usableAt(startAt)) return null
  const endAt = usableAt(r.endAt) && r.endAt > startAt ? r.endAt : undefined
  const remindAt = usableAt(r.remindAt) ? Math.min(r.remindAt, startAt) : startAt
  const createAt = usableAt(r.createAt) ? r.createAt : startAt
  const updateAt = usableAt(r.updateAt) ? r.updateAt : createAt
  return {
    id,
    title,
    startAt,
    remindAt,
    ...(endAt ? { endAt } : {}),
    ...(cleanNote(r.note) ? { note: cleanNote(r.note) } : {}),
    ...(usableAt(r.doneAt) ? { doneAt: r.doneAt } : {}),
    ...(typeof r.snoozeCount === 'number' && Number.isFinite(r.snoozeCount) && r.snoozeCount > 0
      ? { snoozeCount: Math.round(r.snoozeCount) }
      : {}),
    ...(typeof r.goalId === 'string' && r.goalId ? { goalId: r.goalId } : {}),
    createAt,
    updateAt,
  }
}

/* ---------- 给模型看的形状 ---------- */

/** 回给模型的时间：到分钟为止（日程不需要秒） */
const stamp = (ts: number): string => dayKeyOf(ts) + ' ' + timeTextOf(ts)

/** 提前量（分钟）：提醒时刻与开始时间的差 */
export const remindLeadMinutes = (item: ScheduleItem): number =>
  Math.max(0, Math.round((item.startAt - item.remindAt) / 60_000))

/** 一条日程翻成回执（list / create / update 共用同一套字段名） */
export function scheduleItemView(item: ScheduleItem, now = Date.now()): Record<string, unknown> {
  return {
    id: item.id,
    date: dayKeyOf(item.startAt),
    time: timeTextOf(item.startAt),
    ...(item.endAt ? { endTime: timeTextOf(item.endAt) } : {}),
    title: item.title,
    ...(item.note ? { note: item.note } : {}),
    done: !!item.doneAt,
    remind: remindLeadMinutes(item) ? '提前 ' + remindLeadMinutes(item) + ' 分钟' : '准点',
    ...(item.doneAt ? { doneAt: stamp(item.doneAt) } : {}),
    ...(item.snoozeCount ? { snoozed: item.snoozeCount } : {}),
    ...(isMissed(item, now) ? { missed: true } : {}),
    ...(item.goalId ? { goalId: item.goalId } : {}),
  }
}

/* ---------- 沙箱那一组 ---------- */

export interface ScheduleDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  /** 当前会话的目标（只作为日程上的可选标记，不参与可见性） */
  goalId: () => string
}

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const asInt = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

/**
 * 把 `date` + `time` 解析成一个时刻。
 *
 * 两条默认（都会写进回执，不偷偷改用户的意思）：
 * - 省略 `date` 就是今天；
 * - 省略 `date` 而那个时间已经过去半小时以上，就顺延到明天——「晚上八点提醒我」
 *   在九点说出口，意思显然是明天晚上八点，不是「现在立刻」。
 */
function resolveStart(
  dateRaw: unknown,
  timeRaw: unknown,
  now: number,
): { at: number; rolled: boolean } | { error: string } {
  const time = asText(timeRaw)
  const parsed = parseTimeText(time)
  if (!parsed) return { error: '时间要写成 "HH:mm"（例如 "19:30"）' }
  const explicitDay = isDayKey(dateRaw) ? dateRaw : ''
  if (dateRaw !== undefined && dateRaw !== null && dateRaw !== '' && !explicitDay) {
    return { error: 'date 要写成 "YYYY-MM-DD"（例如 "2026-10-20"）' }
  }
  const day = explicitDay || dayKeyOf(now)
  let at = atDayTime(day, time)
  let rolled = false
  if (!explicitDay && at < now - 30 * 60_000) {
    at = atDayTime(shiftDay(day, 1), time)
    rolled = true
  }
  return { at, rolled }
}

/**
 * 装配出沙箱要的 `api.schedule`（见 SandboxOptions.schedule）。
 *
 * 失败一律回 `{ error }`（与 memory / res 同一约定），成功回普通对象。写操作都走
 * deps.set 落库：日程是**用户的约定**，必须立刻写进 state.json，不能等这一轮结束。
 */
export function createScheduleOps(deps: ScheduleDeps): ScheduleOps {
  const goal = (): string => deps.goalId()

  return {
    list: (query) => {
      const q = (query ?? {}) as Record<string, unknown>
      const now = Date.now()
      const fromDay = isDayKey(q.from) ? q.from : dayKeyOf(now)
      const days = Math.min(60, Math.max(1, asInt(q.days) ?? 7))
      const toDay = isDayKey(q.to) ? q.to : shiftDay(fromDay, days - 1)
      const from = dayStartOf(fromDay)
      const to = dayStartOf(toDay) + 86_400_000 - 1
      const items = scheduleOf(deps.getLatest())
        .items.filter((it) => it.startAt >= from && it.startAt <= to)
        .sort(byStart)
      const pending = items.filter((it) => !it.doneAt)
      return {
        from: fromDay,
        to: toDay,
        count: items.length,
        pending: pending.length,
        today: items.filter((it) => dayKeyOf(it.startAt) === dayKeyOf(now)).map((it) => scheduleItemView(it, now)),
        items: items.map((it) => scheduleItemView(it, now)),
        note: items.length
          ? '按开始时间排序。id 用于 update / complete / remove；到点提醒由宿主负责，你不要自己 sleep 等着。'
          : '这个区间里没有日程。要安排就用 api.schedule.create({ title, date, time, ... })。',
      }
    },

    create: (payload) => {
      const p = (payload ?? {}) as Record<string, unknown>
      const title = cleanTitle(p.title)
      if (!title) {
        return {
          error:
            'api.schedule.create 需要 title（做什么）。写成 api.schedule.create({ title, date, time, minutes?, remindBefore?, note? })，' +
            '时间用 "HH:mm"，date 省略就是今天。',
        }
      }
      const now = Date.now()
      // 也收 ISO 的 startAt（模型手上可能已经有一个完整时刻）
      let startAt: number
      let rolled = false
      if (usableAt(p.startAt)) {
        startAt = p.startAt
      } else {
        const r = resolveStart(p.date, p.time, now)
        if ('error' in r) return { error: r.error }
        startAt = r.at
        rolled = r.rolled
      }
      const minutes = asInt(p.minutes)
      const endAt = minutes && minutes > 0 ? startAt + Math.min(24 * 60, minutes) * 60_000 : null
      const before = Math.min(1440, Math.max(0, asInt(p.remindBefore) ?? 0))
      // 提前量比「离开始还有多久」还大时，提醒时刻已经过去了：夹到此刻，让它立刻响
      const remindAt = Math.max(now, startAt - before * 60_000)
      const out = addScheduleItem(
        deps.getLatest(),
        {
          title,
          startAt,
          endAt,
          remindAt,
          note: typeof p.note === 'string' ? p.note : null,
          goalId: goal(),
        },
        now,
      )
      if ('error' in out) return { error: out.error }
      deps.set(out.store)
      const item = out.item
      return {
        ok: true,
        id: item.id,
        when: stamp(item.startAt),
        ...(item.endAt ? { endTime: timeTextOf(item.endAt) } : {}),
        remindAt: stamp(item.remindAt),
        note:
          (rolled ? '那个时间今天已经过了，已顺延到明天。' : '') +
          (remindAt > startAt - before * 60_000 ? '提前量比离开始的时间还长，提醒时刻已夹到此刻。' : '') +
          '已写进日程，到点会响铃提醒用户。',
      }
    },

    update: (id, patch) => {
      const key = asText(id)
      if (!key) return { error: '要给出要修改的日程 id（先用 api.schedule.list() 看有哪些）' }
      const store = deps.getLatest()
      const prev = scheduleOf(store).items.find((it) => it.id === key)
      if (!prev) return { error: '没有这条日程：' + key + '。用 api.schedule.list() 核对。' }
      const p = (patch ?? {}) as Record<string, unknown>
      const now = Date.now()
      // 时间：date / time / startAt 任一给了就重算；只给 time 时沿用原来那一天
      let startAt = prev.startAt
      if (usableAt(p.startAt)) {
        startAt = p.startAt
      } else if (p.time !== undefined || p.date !== undefined) {
        const date = p.date !== undefined ? p.date : dayKeyOf(prev.startAt)
        const time = p.time !== undefined ? p.time : timeTextOf(prev.startAt)
        const r = resolveStart(date, time, now)
        if ('error' in r) return { error: r.error }
        startAt = r.at
      }
      const minutes = asInt(p.minutes)
      const endAt =
        p.endAt === null
          ? null
          : p.minutes !== undefined
            ? minutes && minutes > 0
              ? startAt + Math.min(24 * 60, minutes) * 60_000
              : null
            : prev.endAt
              ? startAt + (prev.endAt - prev.startAt)
              : null
      const before = p.remindBefore !== undefined ? Math.min(1440, Math.max(0, asInt(p.remindBefore) ?? 0)) : null
      const remindAt = before !== null ? Math.max(now, startAt - before * 60_000) : prev.remindAt + (startAt - prev.startAt)
      const next = updateScheduleItem(
        store,
        key,
        {
          ...(p.title !== undefined ? { title: typeof p.title === 'string' ? p.title : '' } : {}),
          startAt,
          endAt,
          remindAt,
          ...(p.note !== undefined ? { note: typeof p.note === 'string' ? p.note : null } : {}),
          ...(p.done !== undefined ? { done: p.done === true } : {}),
        },
        now,
      )
      if (next === store) return { error: '没有可更新的内容（标题不能为空）' }
      deps.set(next)
      const item = scheduleOf(next).items.find((it) => it.id === key)!
      return { ok: true, id: key, when: stamp(item.startAt), remindAt: stamp(item.remindAt) }
    },

    complete: (id) => {
      const key = asText(id)
      if (!key) return { error: '要给出日程 id' }
      const store = deps.getLatest()
      if (!scheduleOf(store).items.some((it) => it.id === key)) {
        return { error: '没有这条日程：' + key + '。用 api.schedule.list() 核对。' }
      }
      deps.set(completeScheduleItem(store, key))
      return { ok: true, id: key, note: '已标记完成，不会再提醒。' }
    },

    remove: (id) => {
      const key = asText(id)
      if (!key) return { error: '要给出日程 id' }
      const store = deps.getLatest()
      if (!scheduleOf(store).items.some((it) => it.id === key)) {
        return { error: '没有这条日程：' + key + '。用 api.schedule.list() 核对。' }
      }
      deps.set(removeScheduleItem(store, key))
      return { ok: true, id: key, note: '已删除。' }
    },
  }
}
