/**
 * 日程的单元用例（见 learn/schedule）。
 *
 * 钉的是这个功能里最容易悄悄坏掉的几条：
 * 1. 时间口径是**本地墙上时间**，不跟学习日（凌晨 4 点为界）走；
 * 2. 提醒只响一次、只响一条，晚到太久的不再响；
 * 3. 「稍后提醒」只推 remindAt，不动完成状态；
 * 4. 坏数据逐条丢，不连坐整张表；
 * 5. agent 那一组 api 的时间默认值（省略 date = 今天，已过则顺延到明天）与回执口径。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { emptyLearnStore } from '../src/learn/store/empty'
import { buildState } from '../src/learn/files/state'
import { normalizeLearnStore } from '../src/learn/store/normalize'
import {
  SCHEDULE_DUE_GRACE_MS,
  SCHEDULE_TITLE_MAX,
  addScheduleItem,
  atDayTime,
  completeScheduleItem,
  createScheduleOps,
  dayKeyOf,
  dayStartOf,
  dueItem,
  emptySchedule,
  isDayKey,
  isMissed,
  itemsOnDay,
  normalizeSchedule,
  parseTimeText,
  removeScheduleItem,
  scheduleItemView,
  setScheduleSound,
  shiftDay,
  snoozeScheduleItem,
  timeTextOf,
  todayItems,
  updateScheduleItem,
  type ScheduleItem,
} from '../src/learn/schedule'
import type { LearnStore } from '../src/learn/types'

const MIN = 60_000
/** 2026-10-19 20:00（本地时间）：与运行测试的那台机器的时区无关的「现在」 */
const NOW = new Date(2026, 9, 19, 20, 0, 0, 0).getTime()

const store = (): LearnStore => emptyLearnStore()

/** 往空库里塞一条，返回新 store 与那条（失败直接抛，测试里不该静默） */
function seed(
  at = NOW + 60 * MIN,
  over: { title?: string; remindAt?: number; note?: string; goalId?: string } = {},
): { store: LearnStore; item: ScheduleItem } {
  const out = addScheduleItem(
    store(),
    {
      title: over.title ?? '复习夹逼定理',
      startAt: at,
      remindAt: over.remindAt,
      note: over.note,
      goalId: over.goalId,
    },
    NOW,
  )
  if ('error' in out) throw new Error(out.error)
  return out
}

describe('日历与时间口径', () => {
  it('按本地日历日取键，不按学习日（凌晨 4 点为界）折算', () => {
    // 凌晨 1 点属于「学习日的前一天」，但日程上它就是今天
    expect(dayKeyOf(new Date(2026, 9, 20, 1, 0).getTime())).toBe('2026-10-20')
    expect(dayKeyOf(new Date(2026, 9, 19, 23, 59).getTime())).toBe('2026-10-19')
  })

  it('某天某点按本地时间合成；时分越界一律拒绝', () => {
    expect(atDayTime('2026-10-20', '19:30')).toBe(new Date(2026, 9, 20, 19, 30).getTime())
    expect(parseTimeText('09:05')).toEqual({ h: 9, m: 5 })
    expect(parseTimeText('9:05')).toEqual({ h: 9, m: 5 })
    expect(parseTimeText('24:00')).toBeNull()
    expect(parseTimeText('9:5')).toBeNull()
    expect(parseTimeText('abc')).toBeNull()
    expect(Number.isNaN(atDayTime('2026-10-20', '25:00'))).toBe(true)
  })

  it('往前挪一天按日历算（跨月、跨年都不错位）', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('isDayKey 不认不存在的日期', () => {
    expect(isDayKey('2026-10-20')).toBe(true)
    expect(isDayKey('2026-02-30')).toBe(false)
    expect(isDayKey('2026-1-1')).toBe(false)
    expect(isDayKey(123)).toBe(false)
  })

  it('时间文本补零到 HH:mm', () => {
    expect(timeTextOf(new Date(2026, 9, 20, 9, 5).getTime())).toBe('09:05')
  })
})

describe('增删改：一条日程的一生', () => {
  it('新建：标题抹平空白并截断，提醒时刻默认等于开始时间', () => {
    const { item } = seed(NOW + 30 * MIN, { title: '  复习   夹逼定理  ' })
    expect(item.title).toBe('复习 夹逼定理')
    expect(item.remindAt).toBe(item.startAt)
    expect(item.doneAt).toBeUndefined()
    expect(item.createAt).toBe(NOW)
  })

  it('没有标题或没有开始时间就建不出来', () => {
    expect('error' in addScheduleItem(store(), { title: '  ', startAt: NOW })).toBe(true)
    expect('error' in addScheduleItem(store(), { title: 'x', startAt: Number.NaN })).toBe(true)
  })

  it('标题过长会被截断（不靠界面拦）', () => {
    const { item } = seed(NOW, { title: 'x'.repeat(SCHEDULE_TITLE_MAX + 50) })
    expect(item.title.length).toBe(SCHEDULE_TITLE_MAX)
  })

  it('改开始时间会按原来的提前量同步挪提醒时刻', () => {
    const { store: s1, item } = seed(NOW + 60 * MIN, { remindAt: NOW + 50 * MIN })
    const s2 = updateScheduleItem(s1, item.id, { startAt: NOW + 120 * MIN }, NOW)
    const next = s2.schedule!.items[0]
    expect(next.startAt).toBe(NOW + 120 * MIN)
    // 原来提前 10 分钟，改完仍然提前 10 分钟
    expect(next.remindAt).toBe(NOW + 110 * MIN)
  })

  it('清空结束时间与备注是真的清掉（不是原样保留）', () => {
    const { store: s1, item } = seed(NOW, { note: '带笔记本' })
    const withEnd = updateScheduleItem(
      s1,
      item.id,
      { endAt: NOW + 45 * MIN, note: '带笔记本' },
      NOW,
    )
    expect(withEnd.schedule!.items[0].endAt).toBe(NOW + 45 * MIN)
    const cleared = updateScheduleItem(withEnd, item.id, { endAt: null, note: '' }, NOW)
    expect(cleared.schedule!.items[0].endAt).toBeUndefined()
    expect(cleared.schedule!.items[0].note).toBeUndefined()
  })

  it('完成与取消完成是一个开关', () => {
    const { store: s1, item } = seed()
    const done = completeScheduleItem(s1, item.id, NOW + 5 * MIN)
    expect(done.schedule!.items[0].doneAt).toBe(NOW + 5 * MIN)
    const undone = updateScheduleItem(done, item.id, { done: false }, NOW + 6 * MIN)
    expect(undone.schedule!.items[0].doneAt).toBeUndefined()
  })

  it('稍后提醒只推 remindAt 并记一次，不改完成状态', () => {
    const { store: s1, item } = seed(NOW, { remindAt: NOW })
    const snoozed = snoozeScheduleItem(s1, item.id, 10, NOW + MIN)
    const next = snoozed.schedule!.items[0]
    expect(next.remindAt).toBe(NOW + MIN + 10 * MIN)
    expect(next.snoozeCount).toBe(1)
    expect(next.doneAt).toBeUndefined()
  })

  it('删除与「删不存在的」都是幂等的', () => {
    const { store: s1, item } = seed()
    expect(removeScheduleItem(s1, item.id).schedule!.items).toHaveLength(0)
    expect(removeScheduleItem(s1, 'nope')).toBe(s1)
  })

  it('改不存在的 id 原样返回同一个 store（调用方据此不写盘）', () => {
    const { store: s1 } = seed()
    expect(updateScheduleItem(s1, 'nope', { title: 'x' }, NOW)).toBe(s1)
  })
})

describe('查询：今天、下一条、该不该响', () => {
  it('按天取，按开始时间升序', () => {
    let s = seed(NOW + 120 * MIN).store
    const out = addScheduleItem(s, { title: '早一点', startAt: NOW + 60 * MIN }, NOW)
    if ('error' in out) throw new Error(out.error)
    s = out.store
    const day = dayKeyOf(NOW)
    expect(itemsOnDay(s, day).map((x) => x.title)).toEqual(['早一点', '复习夹逼定理'])
    expect(todayItems(s, NOW).map((x) => x.title)).toEqual(['早一点', '复习夹逼定理'])
  })

  it('到点才响；晚过 grace 不再响；完成的永不响', () => {
    const { store: s1, item } = seed(NOW + 10 * MIN)
    expect(dueItem(s1, NOW)).toBeNull()
    expect(dueItem(s1, NOW + 10 * MIN)?.id).toBe(item.id)
    expect(dueItem(s1, NOW + 10 * MIN + SCHEDULE_DUE_GRACE_MS - 1)?.id).toBe(item.id)
    expect(dueItem(s1, NOW + 10 * MIN + SCHEDULE_DUE_GRACE_MS + 1)).toBeNull()
    expect(isMissed(item, NOW + 10 * MIN + SCHEDULE_DUE_GRACE_MS + 1)).toBe(true)

    const done = completeScheduleItem(s1, item.id, NOW + 11 * MIN)
    expect(dueItem(done, NOW + 12 * MIN)).toBeNull()
  })

  it('多条同时到点只响最早的那条', () => {
    const a = seed(NOW + 5 * MIN)
    const b = addScheduleItem(a.store, { title: '后来的', startAt: NOW + 5 * MIN, remindAt: NOW + 5 * MIN }, NOW)
    if ('error' in b) throw new Error(b.error)
    const first = dueItem(b.store, NOW + 5 * MIN)
    expect(first?.title).toBe('复习夹逼定理')
    // 确认掉第一条，第二条才浮上来
    const after = completeScheduleItem(b.store, first!.id, NOW + 6 * MIN)
    expect(dueItem(after, NOW + 6 * MIN)?.title).toBe('后来的')
  })
})

describe('落盘数据：坏条目逐条丢', () => {
  it('空 / 垃圾输入回默认值', () => {
    const empty = normalizeSchedule(null)
    expect(empty.items).toEqual([])
    expect(empty.sound).toEqual({ preset: 'chime', volume: 0.7 })
    expect(normalizeSchedule('nope').items).toEqual([])
  })

  it('缺 id / 缺标题 / 缺开始时间的条目单独丢掉，其余保留', () => {
    const out = normalizeSchedule({
      items: [
        { id: 'a', title: '好的', startAt: NOW },
        { title: '没有 id', startAt: NOW },
        { id: 'b', startAt: NOW },
        { id: 'c', title: '没有时间' },
        { id: 'd', title: '坏时间', startAt: 'x' },
      ],
    })
    expect(out.items.map((x) => x.id)).toEqual(['a'])
  })

  it('重复 id 只留第一条（页签与按钮都按 id 认，重复会删错）', () => {
    const out = normalizeSchedule({
      items: [
        { id: 'a', title: '第一条', startAt: NOW },
        { id: 'a', title: '第二条', startAt: NOW },
      ],
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].title).toBe('第一条')
  })

  it('音量夹在 0~1，认不出的铃声退回默认', () => {
    expect(normalizeSchedule({ sound: { preset: 'bell', volume: 5 } }).sound).toEqual({ preset: 'bell', volume: 1 })
    expect(normalizeSchedule({ sound: { preset: 'bell', volume: -3 } }).sound.volume).toBe(0)
    expect(normalizeSchedule({ sound: { preset: 'trumpet', volume: 0.3 } }).sound).toEqual({
      preset: 'chime',
      volume: 0.3,
    })
  })

  it('提醒时刻不会晚于开始时间（手改文件也不该造出「开始后才提醒」）', () => {
    const out = normalizeSchedule({ items: [{ id: 'a', title: 'x', startAt: NOW, remindAt: NOW + 60 * MIN }] })
    expect(out.items[0].remindAt).toBe(NOW)
  })

  it('改铃声只动 sound，不动条目', () => {
    const { store: s1 } = seed()
    const s2 = setScheduleSound(s1, { preset: 'pulse', volume: 0.2 })
    expect(s2.schedule!.items).toHaveLength(1)
    expect(s2.schedule!.sound).toEqual({ preset: 'pulse', volume: 0.2 })
  })
})

describe('持久化：整块跟着 state.json 走', () => {
  it('有条目就写进 state.json，读回来还在', () => {
    const { store: s1 } = seed(NOW + 30 * MIN)
    const state = buildState(s1) as { schedule?: unknown }
    expect(state.schedule).toBeTruthy()
    const back = normalizeLearnStore({ ...emptyLearnStore(), ...state, nodes: [] })
    expect(back?.schedule?.items).toHaveLength(1)
    expect(back?.schedule?.items[0].title).toBe('复习夹逼定理')
  })

  it('空表 + 默认铃声不占字段；只改铃声也要记住', () => {
    const empty = buildState(store()) as { schedule?: unknown }
    expect(empty.schedule).toBeUndefined()
    const tuned = setScheduleSound(store(), { preset: 'bell' })
    expect((buildState(tuned) as { schedule?: unknown }).schedule).toBeTruthy()
  })
})

describe('agent 那一组 api（api.schedule.*）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function harness(initial: LearnStore = store()) {
    let s = initial
    const ops = createScheduleOps({ getLatest: () => s, set: (n) => { s = n }, goalId: () => 'g1' })
    return { ops, get: () => s }
  }

  function freeze(at = NOW) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(at))
  }

  it('省略 date = 今天；时间还早就是今天', () => {
    freeze()
    const h = harness()
    const out = h.ops.create({ title: '晚间复习', time: '21:30', minutes: 45, remindBefore: 10 }) as Record<string, unknown>
    expect(out.ok).toBe(true)
    const item = h.get().schedule!.items[0]
    expect(dayKeyOf(item.startAt)).toBe('2026-10-19')
    expect(item.endAt! - item.startAt).toBe(45 * MIN)
    expect(item.startAt - item.remindAt).toBe(10 * MIN)
    expect(item.goalId).toBe('g1')
  })

  it('省略 date 而时间已过 → 顺延到明天，并在回执里说明', () => {
    freeze()
    const h = harness()
    const out = h.ops.create({ title: '早读', time: '08:00' }) as Record<string, unknown>
    expect(dayKeyOf(h.get().schedule!.items[0].startAt)).toBe('2026-10-20')
    expect(String(out.note)).toContain('顺延到明天')
  })

  it('标题或时间不合法时回 error，不写库', () => {
    freeze()
    const h = harness()
    expect(String((h.ops.create({ time: '09:00' }) as { error?: string }).error)).toContain('title')
    expect(String((h.ops.create({ title: 'x', time: '9 点' }) as { error?: string }).error)).toContain('HH:mm')
    expect(h.get().schedule?.items ?? []).toHaveLength(0)
  })

  it('list 默认看今天起 7 天；超出区间的不列', () => {
    freeze()
    const h = harness()
    h.ops.create({ title: '今天', time: '21:00' })
    h.ops.create({ title: '第八天', date: '2026-10-27', time: '10:00' })
    const out = h.ops.list() as { count: number; items: Array<{ title: string }> }
    expect(out.count).toBe(1)
    expect(out.items[0].title).toBe('今天')
    const far = h.ops.list({ days: 30 }) as { count: number }
    expect(far.count).toBe(2)
  })

  it('update 改时间时沿用原来的提前量；complete / remove 都有回执', () => {
    freeze()
    const h = harness()
    h.ops.create({ title: '复习', time: '21:00', remindBefore: 15 })
    const id = h.get().schedule!.items[0].id
    h.ops.update(id, { time: '22:00' })
    const moved = h.get().schedule!.items[0]
    expect(timeTextOf(moved.startAt)).toBe('22:00')
    expect(moved.startAt - moved.remindAt).toBe(15 * MIN)

    expect((h.ops.complete(id) as { ok?: boolean }).ok).toBe(true)
    expect(h.get().schedule!.items[0].doneAt).toBeTruthy()
    expect((h.ops.remove(id) as { ok?: boolean }).ok).toBe(true)
    expect(h.get().schedule!.items).toHaveLength(0)
  })

  it('对不存在的 id 一律回 error，而不是静默成功', () => {
    freeze()
    const h = harness()
    expect((h.ops.update('nope', { time: '10:00' }) as { error?: string }).error).toBeTruthy()
    expect((h.ops.complete('nope') as { error?: string }).error).toBeTruthy()
    expect((h.ops.remove('nope') as { error?: string }).error).toBeTruthy()
  })

  it('视图字段名与数据模型一致，且标出已错过', () => {
    const item = seed(NOW + 10 * MIN).item
    const view = scheduleItemView(item, NOW + 10 * MIN + SCHEDULE_DUE_GRACE_MS + 1)
    expect(view).toMatchObject({ id: item.id, date: '2026-10-19', time: '20:10', done: false, missed: true })
    expect(view.remind).toBe('准点')
  })

  it('空库的 list 给出下一步该怎么做', () => {
    freeze()
    const h = harness()
    const out = h.ops.list() as { count: number; note: string }
    expect(out.count).toBe(0)
    expect(out.note).toContain('api.schedule.create')
  })
})

describe('空库形状', () => {
  it('emptySchedule 的条目为空、铃声是默认档', () => {
    const s = emptySchedule()
    expect(s.items).toEqual([])
    expect(s.sound.preset).toBe('chime')
    expect(dayStartOf(dayKeyOf(NOW))).toBeLessThanOrEqual(NOW)
  })
})
