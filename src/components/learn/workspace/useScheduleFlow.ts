/*
 * 这个文件负责：日程的**动作**与**到点提醒**。
 *
 * 分成两半：
 * - `useScheduleFlow`：增删改、完成、稍后提醒、改铃声——都是「用户（或 agent）动了一下」；
 * - `useScheduleReminder`：每秒看一眼「现在该不该响」，响的那一条交给顶栏。
 *
 * 为什么到点判定不放在渲染里、也不放进 store：日程的到点是一个**时间事件**，
 * 而 store 只在有人写它的时候才变。这里用一个不进渲染快照的 interval 盯着墙上时钟，
 * 只在「该响的那条换了」时 setState——顶栏因此不会每秒重渲染（与专注模式同一条纪律，
 * 见 lib/clock 的说明）。
 *
 * 响铃的边界：**只响一条**。多条同时到点时先响最早的那条，用户确认掉它，下一条自然浮上来；
 * 一次弹三个提醒只会让人把整块关掉。
 */

import { useCallback, useEffect, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import {
  addScheduleItem,
  completeScheduleItem,
  dueItem,
  removeScheduleItem,
  scheduleSoundOf,
  setScheduleSound,
  snoozeScheduleItem,
  updateScheduleItem,
  type ScheduleInput,
  type ScheduleItem,
  type SchedulePatch,
  type ScheduleSound,
} from '../../../learn/schedule'
import { startScheduleRing, stopScheduleRing } from '../../../lib/scheduleSound'

export interface ScheduleFlowDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
}

/**
 * 日程的写操作。全部当场落库（state.json）：日程是用户与自己的约定，
 * 不该等某个「保存」动作——关掉窗口前那一条就不该丢。
 *
 * 每个动作都先比对象身份：`schedule.ts` 里没改成功时会原样返回同一个 store，
 * 这时一个字节都不写（与专注会话同一条纪律）。
 */
export function useScheduleFlow({ getLatest, set }: ScheduleFlowDeps) {
  const create = useCallback(
    (input: ScheduleInput): boolean => {
      const s = getLatest()
      const out = addScheduleItem(s, input)
      if ('error' in out) return false
      set(out.store)
      return true
    },
    [getLatest, set],
  )

  const update = useCallback(
    (id: string, patch: SchedulePatch) => {
      const s = getLatest()
      const next = updateScheduleItem(s, id, patch)
      if (next !== s) set(next)
    },
    [getLatest, set],
  )

  const remove = useCallback(
    (id: string) => {
      const s = getLatest()
      const next = removeScheduleItem(s, id)
      if (next !== s) set(next)
    },
    [getLatest, set],
  )

  const complete = useCallback(
    (id: string) => {
      const s = getLatest()
      const next = completeScheduleItem(s, id)
      if (next !== s) set(next)
    },
    [getLatest, set],
  )

  const snooze = useCallback(
    (id: string, minutes: number) => {
      const s = getLatest()
      const next = snoozeScheduleItem(s, id, minutes)
      if (next !== s) set(next)
    },
    [getLatest, set],
  )

  const setSound = useCallback(
    (patch: Partial<ScheduleSound>) => {
      const s = getLatest()
      const next = setScheduleSound(s, patch)
      if (next !== s) set(next)
    },
    [getLatest, set],
  )

  return { create, update, remove, complete, snooze, setSound }
}

/**
 * 到点提醒：返回「此刻正在响的那一条」与两个收场动作。
 *
 * - `complete`：用户确认（知道了）→ 标记完成，这一条不再提醒；
 * - `snooze`：隔一阵再提醒 → 把提醒时刻推到 now + minutes，铃声停、顶栏恢复。
 *
 * 组件卸载（换用户、退出工作区）时停铃：不留一个「关掉界面还在响」的定时器。
 */
export function useScheduleReminder({ getLatest, set }: ScheduleFlowDeps) {
  const [ringing, setRinging] = useState<ScheduleItem | null>(null)

  useEffect(() => {
    const tick = (): void => {
      const item = dueItem(getLatest())
      // 同一条就保持同一个对象引用：React 因此不会每秒重渲染一次顶栏
      setRinging((prev) => (prev?.id === item?.id ? prev : item))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      window.clearInterval(timer)
      stopScheduleRing()
    }
  }, [getLatest])

  // 响的那一条换了（含「响完了」）就重放 / 停掉；铃声设置现取，改完下一轮就生效
  const ringId = ringing?.id ?? ''
  useEffect(() => {
    if (!ringId) {
      stopScheduleRing()
      return
    }
    startScheduleRing(scheduleSoundOf(getLatest()))
    return () => stopScheduleRing()
  }, [ringId, getLatest])

  const complete = useCallback(
    (id: string) => {
      const s = getLatest()
      const next = completeScheduleItem(s, id)
      if (next !== s) set(next)
      setRinging(null)
    },
    [getLatest, set],
  )

  const snooze = useCallback(
    (id: string, minutes: number) => {
      const s = getLatest()
      const next = snoozeScheduleItem(s, id, minutes)
      if (next !== s) set(next)
      setRinging(null)
    },
    [getLatest, set],
  )

  return { ringing, complete, snooze }
}
