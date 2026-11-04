/**
 * 日程提醒的铃声设置：**一份实现，两处外壳**。
 *
 * - 设置 → 提醒（`variant="panel"`）：完整的四档试听 + 音量；
 * - 日程安排页底部（`variant="inline"`）：一行放得下的紧凑版，边看日程边调。
 *
 * 数据只有一份（`store.schedule.sound`，见 learn/schedule），两边改的是同一个字段，
 * 所以不存在「这里调完那里没变」——它们甚至可能在同一个页面上同时存在。
 *
 * 组件是纯展示的：声音由 props 传入，改动经 onChange 交出去，试听走 lib/scheduleSound。
 * 音量 0 是一个**有意义的档位**（只留视觉提醒），所以滑块从 0 开始，并在 0 时明说。
 */

import { BellRing, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { ScheduleSound, ScheduleSoundPreset } from '../../learn/schedule'
import { SCHEDULE_SOUND_PRESETS } from '../../learn/schedule'
import { previewScheduleSound } from '../../lib/scheduleSound'
import { t } from '../../i18n'

const PRESET_LABEL: Record<ScheduleSoundPreset, string> = {
  chime: '风铃',
  bell: '钟声',
  pulse: '提示音',
  soft: '柔和',
}

const PRESET_HINT: Record<ScheduleSoundPreset, string> = {
  chime: '清亮双音，最不容易漏听',
  bell: '悠长有尾音，像老式座钟',
  pulse: '三连短促，隔着房间也听得见',
  soft: '低音慢起，安静环境不惊扰',
}

export function ScheduleSoundSettings({
  sound,
  onChange,
  variant = 'panel',
}: {
  sound: ScheduleSound
  onChange: (patch: Partial<ScheduleSound>) => void
  variant?: 'panel' | 'inline'
}) {
  const muted = sound.volume <= 0
  const VolumeIcon = muted ? VolumeX : sound.volume < 0.5 ? Volume1 : Volume2
  const pct = Math.round(sound.volume * 100)

  if (variant === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
          <BellRing size={12} className="text-seal" />
          {t('提醒铃声')}
        </span>
        <select
          value={sound.preset}
          onChange={(e) => onChange({ preset: e.target.value as ScheduleSoundPreset })}
          aria-label={t('提醒铃声')}
          className="h-7 rounded-md border border-line bg-paper px-2 text-[11.5px] text-ink outline-none transition hover:border-line-strong focus:border-seal/60"
        >
          {SCHEDULE_SOUND_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(PRESET_LABEL[p])}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => previewScheduleSound(sound)}
          className="flex h-7 items-center gap-1 rounded-md border border-line px-2 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
        >
          <Play size={10} className="fill-current" />
          {t('试听')}
        </button>
        <label className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <VolumeIcon size={12} />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
            aria-label={t('铃声音量')}
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-line/70 accent-[var(--color-seal)]"
          />
          <span className="w-8 tabular-nums">{muted ? t('静音') : pct + '%'}</span>
        </label>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-strong">
            <BellRing size={13} className="text-seal" />
            {t('提醒铃声')}
          </h4>
          <button
            type="button"
            onClick={() => previewScheduleSound(sound)}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            <Play size={10} className="fill-current" />
            {t('试听当前铃声')}
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
          {t('日程到点时响铃，同时顶栏会渐变呼吸并弹出事项。铃声由应用现场合成，不需要额外的音频文件。')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SCHEDULE_SOUND_PRESETS.map((p) => {
          const on = sound.preset === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                onChange({ preset: p })
                // 选完当场听一下：四档的区别靠文字说不清
                previewScheduleSound({ ...sound, preset: p })
              }}
              className={
                'rounded-xl border px-3 py-2.5 text-left transition ' +
                (on
                  ? 'border-seal/50 bg-seal/10 shadow-2xs'
                  : 'border-line/70 bg-card/50 hover:border-line-strong hover:bg-card')
              }
            >
              <span className={'block text-[12px] font-medium ' + (on ? 'text-seal-deep' : 'text-ink')}>
                {t(PRESET_LABEL[p])}
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-faint">{t(PRESET_HINT[p])}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-line/60 bg-paper/50 px-3 py-2.5 dark:bg-paper/20">
        <div className="flex items-center justify-between text-[12px]">
          <span className="flex items-center gap-1.5 font-medium text-ink-strong">
            <VolumeIcon size={13} />
            {t('铃声音量')}
          </span>
          <span className="tabular-nums text-ink-faint">{muted ? t('静音（只保留视觉提醒）') : pct + '%'}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          onChange={(e) => onChange({ volume: Number(e.target.value) / 100 })}
          className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line/70 accent-[var(--color-seal)]"
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          <span>{t('静音')}</span>
          <span>{t('100%')}</span>
        </div>
      </div>
    </div>
  )
}
