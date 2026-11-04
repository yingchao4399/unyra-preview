/**
 * 日程安排页（文档区的一枚页签，TabRef kind 'schedule'，见 learn/types）。
 *
 * 这一页回答四件事：**哪天**（日期导航）、**几点做什么**（按开始时间排的清单）、
 * **怎么改**（就地展开的编辑卡片，不弹窗）、**怎么提醒**（底部那条铃声设置）。
 *
 * 它是纯展示 + 本地编辑态：数据来自 props.store（唯一真相是 state.json 的 schedule），
 * 写操作全部经 props.actions 交回工作区（见 workspace/useScheduleFlow）。
 * 页面自己不落盘、不碰音频——试听在 ScheduleSoundSettings 里，响铃在顶栏那一条。
 *
 * 三个刻意的选择：
 * - **编辑不弹窗**：改一条日程是「顺手调一下」，弹窗会把清单遮住，改完还得再找回来；
 * - **删除要二次确认**：删除不可逆，而这一页的按钮密度不低，误触一次就没了；
 * - **已完成的行不隐藏**：一天里「做完了什么」与「还剩什么」一样是日程表要说的。
 */

import { useMemo, useState } from 'react'
import {
  BellRing,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import type { LearnStore } from '../../learn/types'
import {
  SCHEDULE_REMIND_CHOICES,
  atDayTime,
  dayKeyOf,
  dayStartOf,
  isMissed,
  itemsOnDay,
  shiftDay,
  timeTextOf,
  type ScheduleInput,
  type ScheduleItem,
  type SchedulePatch,
  type ScheduleSound,
} from '../../learn/schedule'
import { useClock } from '../../lib/clock'
import { t } from '../../i18n'
import { ScheduleSoundSettings } from './ScheduleSoundSettings'

/** 时长档位（分钟）：0 = 不设结束时间，只显示开始 */
const DURATION_CHOICES = [0, 15, 30, 45, 60, 90, 120]

/** 星期名（0 = 周日） */
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export interface ScheduleActions {
  create: (input: ScheduleInput) => boolean
  update: (id: string, patch: SchedulePatch) => void
  remove: (id: string) => void
  complete: (id: string) => void
  setSound: (patch: Partial<ScheduleSound>) => void
}

interface Draft {
  /** null = 新建 */
  id: string | null
  title: string
  day: string
  time: string
  /** 时长（分钟）；0 = 不设 */
  minutes: number
  /** 提前多少分钟提醒 */
  remindBefore: number
  note: string
}

/** 默认的新建时间：下一个整点（已经 23 点就落到明天 09:00） */
function defaultStart(now: number): { day: string; time: string } {
  const d = new Date(now)
  const nextHour = d.getHours() + 1
  if (nextHour >= 24) return { day: shiftDay(dayKeyOf(now), 1), time: '09:00' }
  return { day: dayKeyOf(now), time: String(nextHour).padStart(2, '0') + ':00' }
}

function draftOf(item: ScheduleItem): Draft {
  const minutes = item.endAt ? Math.max(1, Math.round((item.endAt - item.startAt) / 60_000)) : 0
  const lead = Math.max(0, Math.round((item.startAt - item.remindAt) / 60_000))
  return {
    id: item.id,
    title: item.title,
    day: dayKeyOf(item.startAt),
    time: timeTextOf(item.startAt),
    minutes,
    remindBefore: lead,
    note: item.note ?? '',
  }
}

export function SchedulePage({
  store,
  actions,
  onToast,
  ringingId,
}: {
  store: LearnStore
  actions: ScheduleActions
  onToast: (msg: string) => void
  /** 此刻正在响的那一条（由顶栏那套提醒引擎算好传进来；只用来高亮一行） */
  ringingId?: string | null
}) {
  const now = useClock(30_000)
  const today = dayKeyOf(now)
  const [day, setDay] = useState(today)
  const [draft, setDraft] = useState<Draft | null>(null)
  /** 正在等二次确认的那一条（点删除先变成「确认删除」） */
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const items = useMemo(() => itemsOnDay(store, day), [store, day])
  const pending = items.filter((it) => !it.doneAt)
  const done = items.length - pending.length
  /*
   * 「下一项」只认**还没开始**的那一条。今天所有待办都过了点时不硬凑一个（把 14:00
   * 叫成「下一项」是错的），改说一句「还有几项没完成」——过没过点，行上的徽标已经说了。
   */
  const next = pending.find((it) => it.startAt >= now) ?? null
  const overdue = pending.filter((it) => it.startAt < now).length

  const startCreate = (atDay = day) => {
    const d = defaultStart(now)
    setConfirmId(null)
    setDraft({
      id: null,
      title: '',
      day: atDay,
      time: atDay === dayKeyOf(now) ? d.time : '09:00',
      minutes: 30,
      remindBefore: 0,
      note: '',
    })
  }

  const startEdit = (item: ScheduleItem) => {
    setConfirmId(null)
    setDraft(draftOf(item))
  }

  const save = () => {
    if (!draft) return
    const title = draft.title.trim()
    if (!title) {
      onToast(t('先写一句「要做什么」'))
      return
    }
    const startAt = atDayTime(draft.day, draft.time)
    if (!Number.isFinite(startAt)) {
      onToast(t('时间格式不对，请写成 09:30 这样'))
      return
    }
    const endAt = draft.minutes > 0 ? startAt + draft.minutes * 60_000 : null
    /*
     * 提醒时刻的两种夹取：
     * - 开始时间还在未来、而提前量比「离开始还有多久」还大 → 夹到此刻（立刻提醒），
     *   否则会算出「55 分钟前该提醒」，一条还没开始的日程当场变成「已错过」；
     * - 开始时间已经过去（补记）→ 就按开始时间，交给「晚到 grace」那一套判。
     */
    const nowAt = Date.now()
    const remindAt = startAt > nowAt ? Math.max(nowAt, startAt - draft.remindBefore * 60_000) : startAt
    if (draft.id) {
      actions.update(draft.id, { title, startAt, endAt, remindAt, note: draft.note })
      onToast(t('日程已更新'))
    } else {
      const ok = actions.create({ title, startAt, endAt, remindAt, note: draft.note })
      if (!ok) {
        onToast(t('没排上：标题或时间不合法'))
        return
      }
      onToast(t('已安排：{0}', timeTextOf(startAt) + ' ' + title))
    }
    setDay(draft.day)
    setDraft(null)
  }

  const dayLabel = (key: string): string => {
    const diff = Math.round((dayStartOf(key) - dayStartOf(today)) / 86_400_000)
    if (diff === 0) return t('今天')
    if (diff === 1) return t('明天')
    if (diff === -1) return t('昨天')
    return t(WEEKDAY[new Date(dayStartOf(key)).getDay()])
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-paper/30">
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* ---------- 顶部：日期导航 + 新建 ---------- */}
        <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line/80 bg-card/75 px-5 py-2.5 shadow-2xs backdrop-blur-md">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <CalendarClock size={15} />
          </span>
          <div className="mr-1 min-w-0 max-w-[11rem]">
            <h2 className="text-[13px] font-semibold leading-tight text-ink-strong">{t('日程安排')}</h2>
            <p className="truncate text-[10.5px] leading-tight text-ink-faint">
              {t('到点响铃提醒，也可以在顶栏悬停查看今天')}
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-line/70 bg-paper/70 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setDay(shiftDay(day, -1))}
              title={t('前一天')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="min-w-[5.5rem] text-center text-[11.5px] font-medium tabular-nums text-ink">
              {dayLabel(day)}
              <span className="ml-1 text-[10.5px] font-normal text-ink-faint">{day}</span>
            </span>
            <button
              type="button"
              onClick={() => setDay(shiftDay(day, 1))}
              title={t('后一天')}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              <ChevronRight size={13} />
            </button>
          </div>
          {day !== today && (
            <button
              type="button"
              onClick={() => setDay(today)}
              className="h-7 rounded-lg border border-line px-2.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              {t('回到今天')}
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[11px] text-ink-faint sm:inline">
              {items.length ? t('待办 {0} · 已完成 {1}', pending.length, done) : ''}
            </span>
            <button
              type="button"
              onClick={() => startCreate()}
              className="flex h-7.5 items-center gap-1.5 rounded-lg bg-seal px-3 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep active:scale-[0.99]"
            >
              <CalendarPlus size={13} />
              {t('手动安排日程')}
            </button>
          </div>
        </header>

        {/* ---------- 清单 ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[820px] px-5 py-4">
            {next ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-seal/25 bg-seal/5 px-3 py-2 text-[11.5px] text-ink">
                <Clock size={12} className="shrink-0 text-seal" />
                <span className="text-ink-faint">{t('下一项')}</span>
                <span className="font-medium tabular-nums text-seal-deep">{timeTextOf(next.startAt)}</span>
                <span className="min-w-0 flex-1 truncate">{next.title}</span>
              </div>
            ) : overdue > 0 ? (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-warn/30 bg-warn/5 px-3 py-2 text-[11.5px] text-ink">
                <Clock size={12} className="shrink-0 text-warn-deep" />
                <span className="min-w-0 flex-1">{t('还有 {0} 项没完成（时间已过）', overdue)}</span>
              </div>
            ) : null}

            {draft && (
              <DraftCard
                draft={draft}
                onChange={setDraft}
                onCancel={() => setDraft(null)}
                onSave={save}
              />
            )}

            {items.length === 0 && !draft ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-card/60 shadow-xs">
                  <CalendarClock size={26} className="text-seal/60" />
                </div>
                <p className="text-[13.5px] font-medium text-ink-strong">{t('这一天还没有安排')}</p>
                <p className="max-w-[420px] text-[11.5px] leading-relaxed text-ink-faint">
                  {t('把要做的写下来，到点应用会响铃提醒你。也可以直接让导师帮你排——它有 api.schedule。')}
                </p>
                <button
                  type="button"
                  onClick={() => startCreate()}
                  className="mt-1 flex h-8 items-center gap-1.5 rounded-lg bg-seal px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
                >
                  <CalendarPlus size={13} />
                  {t('手动安排日程')}
                </button>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <ItemRow
                      item={item}
                      now={now}
                      ringing={ringingId === item.id}
                      confirm={confirmId === item.id}
                      onComplete={() => {
                        actions.complete(item.id)
                        onToast(t('已完成：{0}', item.title))
                      }}
                      onEdit={() => startEdit(item)}
                      onAskDelete={() => setConfirmId(item.id)}
                      onCancelDelete={() => setConfirmId(null)}
                      onDelete={() => {
                        actions.remove(item.id)
                        setConfirmId(null)
                        onToast(t('已删除：{0}', item.title))
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/* ---------- 提醒铃声（紧凑版，完整版在设置 → 提醒） ---------- */}
            <section className="mt-6 rounded-xl border border-line/70 bg-card/50 px-3.5 py-3">
              <ScheduleSoundSettings
                variant="inline"
                sound={store.schedule?.sound ?? { preset: 'chime', volume: 0.7 }}
                onChange={actions.setSound}
              />
              <p className="mt-2 flex items-center gap-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                <BellRing size={10} className="shrink-0" />
                {t('到点时：持续响铃 + 顶栏渐变呼吸，弹出事项让你确认或稍后再提醒。')}
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- 一条日程 ---------- */

function ItemRow({
  item,
  now,
  ringing,
  confirm,
  onComplete,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  item: ScheduleItem
  now: number
  ringing: boolean
  confirm: boolean
  onComplete: () => void
  onEdit: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}) {
  const done = !!item.doneAt
  const missed = isMissed(item, now)
  const late = !done && !missed && item.startAt < now
  const snoozed = (item.snoozeCount ?? 0) > 0

  return (
    <div
      className={
        'group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition ' +
        (ringing
          ? 'border-seal/60 bg-seal/10 shadow-sm shadow-seal/10'
          : done
            ? 'border-line/50 bg-card/30'
            : 'border-line/70 bg-card/60 hover:border-line-strong hover:bg-card')
      }
    >
      {/* 时间列 */}
      <div className={'w-14 shrink-0 pt-0.5 text-right ' + (done ? 'opacity-50' : '')}>
        <div className="text-[13px] font-semibold tabular-nums leading-tight text-ink">{timeTextOf(item.startAt)}</div>
        {item.endAt ? (
          <div className="mt-0.5 text-[10.5px] tabular-nums leading-tight text-ink-faint">{timeTextOf(item.endAt)}</div>
        ) : null}
      </div>

      {/* 正文 */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              'text-[12.5px] leading-snug ' +
              (done ? 'text-ink-faint line-through' : 'font-medium text-ink-strong')
            }
          >
            {item.title}
          </span>
          {ringing && (
            <span className="flex items-center gap-1 rounded-full bg-seal/15 px-1.5 py-px text-[10px] font-medium text-seal-deep">
              <BellRing size={9} />
              {t('提醒中')}
            </span>
          )}
          {done && (
            <span className="flex items-center gap-1 rounded-full bg-ok/15 px-1.5 py-px text-[10px] text-ok-deep">
              <Check size={9} />
              {t('已完成')}
            </span>
          )}
          {!done && missed && (
            <span className="rounded-full bg-warn/15 px-1.5 py-px text-[10px] text-warn-deep">{t('已错过')}</span>
          )}
          {!done && !missed && late && (
            <span className="rounded-full bg-warn/10 px-1.5 py-px text-[10px] text-warn-deep">{t('进行中')}</span>
          )}
          {snoozed && !done && (
            <span className="rounded-full bg-line/60 px-1.5 py-px text-[10px] text-ink-faint">
              {t('稍后提醒过 {0} 次', item.snoozeCount ?? 0)}
            </span>
          )}
        </div>
        {item.note && (
          <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-soft">{item.note}</p>
        )}
        <div className="mt-0.5 text-[10px] text-ink-faint">
          {item.remindAt < item.startAt
            ? t('提前 {0} 分钟提醒', Math.round((item.startAt - item.remindAt) / 60_000))
            : t('准点提醒')}
        </div>
      </div>

      {/* 操作 */}
      <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
        {confirm ? (
          <>
            <button
              type="button"
              onClick={onDelete}
              className="h-6.5 rounded-md bg-warn/15 px-2 text-[11px] font-medium text-warn-deep transition hover:bg-warn/25"
            >
              {t('确认删除')}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
              title={t('取消')}
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <>
            {!done && (
              <button
                type="button"
                onClick={onComplete}
                title={t('标记完成')}
                className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-faint transition hover:bg-ok/15 hover:text-ok-deep"
              >
                <Check size={13} />
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              title={t('编辑')}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              title={t('删除')}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-ink-faint transition hover:bg-warn/15 hover:text-warn-deep"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- 编辑卡片 ---------- */

function DraftCard({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const patch = (p: Partial<Draft>) => onChange({ ...draft, ...p })
  return (
    <div className="mb-3 rounded-xl border border-seal/40 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-seal/10 text-seal">
          {draft.id ? <Pencil size={11} /> : <CalendarPlus size={11} />}
        </span>
        <span className="text-[12px] font-semibold text-ink-strong">
          {draft.id ? t('编辑日程') : t('安排一条日程')}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
          title={t('取消')}
        >
          <X size={12} />
        </button>
      </div>

      <input
        value={draft.title}
        autoFocus
        onChange={(e) => patch({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSave()
          }
        }}
        placeholder={t('要做什么？（例如：复习夹逼定理）')}
        className="mt-2.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60"
      />

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-[10.5px] text-ink-faint">
          {t('日期')}
          <input
            type="date"
            value={draft.day}
            onChange={(e) => patch({ day: e.target.value || draft.day })}
            className="h-7.5 rounded-lg border border-line bg-paper px-2 text-[11.5px] text-ink outline-none focus:border-seal/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10.5px] text-ink-faint">
          {t('开始时间')}
          <input
            type="time"
            value={draft.time}
            onChange={(e) => patch({ time: e.target.value || draft.time })}
            className="h-7.5 rounded-lg border border-line bg-paper px-2 text-[11.5px] tabular-nums text-ink outline-none focus:border-seal/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10.5px] text-ink-faint">
          {t('时长')}
          <select
            value={draft.minutes}
            onChange={(e) => patch({ minutes: Number(e.target.value) })}
            className="h-7.5 rounded-lg border border-line bg-paper px-2 text-[11.5px] text-ink outline-none focus:border-seal/60"
          >
            {DURATION_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('不设') : t('{0} 分钟', m)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10.5px] text-ink-faint">
          {t('提前提醒')}
          <select
            value={draft.remindBefore}
            onChange={(e) => patch({ remindBefore: Number(e.target.value) })}
            className="h-7.5 rounded-lg border border-line bg-paper px-2 text-[11.5px] text-ink outline-none focus:border-seal/60"
          >
            {SCHEDULE_REMIND_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('准点') : t('提前 {0} 分钟', m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        value={draft.note}
        onChange={(e) => patch({ note: e.target.value })}
        rows={2}
        placeholder={t('备注（可选）：在哪儿、带什么、为什么约这一场')}
        className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60"
      />

      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-7.5 rounded-lg border border-line px-3 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          {t('取消')}
        </button>
        <button
          type="button"
          onClick={onSave}
          className="flex h-7.5 items-center gap-1.5 rounded-lg bg-seal px-3.5 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep active:scale-[0.99]"
        >
          <Check size={12} />
          {draft.id ? t('保存修改') : t('排进日程')}
        </button>
      </div>
    </div>
  )
}
