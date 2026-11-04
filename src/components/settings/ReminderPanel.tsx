/**
 * 设置 → 提醒：日程到点时**怎么叫人**。
 *
 * 目前只有一件可调的事——铃声（音色 + 音量）。提醒的方式本身（持续响铃 + 顶栏渐变呼吸 +
 * 弹出事项）是定死的：那是「一定会被看见」的保证，做成可关的开关只会让人某天错过一场考试。
 * 音量拉到 0 是唯一的「静音」入口，此时视觉提醒照常。
 *
 * 数据只有一份（store.schedule.sound，见 learn/schedule）：日程页底部那条紧凑版改的是
 * 同一个字段，两处永远同步。
 */

import { BellRing, Check, Info } from 'lucide-react'
import type { ScheduleSound } from '../../learn/schedule'
import { ScheduleSoundSettings } from '../schedule/ScheduleSoundSettings'
import { pane } from '../Pane'
import { t } from '../../i18n'

export function ReminderPanel({
  sound,
  onChange,
}: {
  sound: ScheduleSound
  onChange: (patch: Partial<ScheduleSound>) => void
}) {
  return (
    <div className={pane(4, true)}>
      <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BellRing size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('日程提醒')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('日程到点时用哪一档铃声叫你。提醒本身不会静默跳过——除非把音量拉到 0。')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-line bg-paper/70 px-2.5 py-1 text-[11px] text-ink-soft">
          <Check size={11} className="text-ok" />
          <span>{t('跟随当前用户')}</span>
        </div>
      </div>

      <section id="settings-section-sound" className="rounded-xl border border-line/70 bg-card/50 p-3.5">
        <ScheduleSoundSettings sound={sound} onChange={onChange} variant="panel" />
      </section>

      <section className="rounded-xl border border-line/60 bg-paper/50 p-3.5 text-[11.5px] leading-relaxed text-ink-soft dark:bg-paper/20">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-strong">
          <Info size={12} className="text-seal" />
          {t('提醒发生时会怎样')}
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>{t('顶栏整体渐变呼吸，日程按钮上出现脉动小点——即使在别的页签上也看得见。')}</li>
          <li>{t('顶栏弹出这条日程的标题与备注，两颗按钮：知道了（标记完成）或稍后提醒。')}</li>
          <li>{t('铃声持续循环，直到你确认或让它隔一阵再提醒；关掉应用不会留下后台响铃。')}</li>
          <li>{t('晚到超过 30 分钟的日程不再响铃（避免开机被一堆旧提醒轰炸），但仍会留在日程表里标为已错过。')}</li>
        </ul>
      </section>
    </div>
  )
}
