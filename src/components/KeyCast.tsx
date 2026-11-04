/**
 * 教学演示按键浮层（教学模式）：
 * 优化后的逻辑：不再键盘输入什么就显示什么，
 * 而是只在触发了已注册的快捷键时才在左下角展示，并清晰显示快捷键键帽及功能名称。
 */

import { useEffect, useRef, useState } from 'react'
import { useAppearance } from '../lib/appearance'
import { subscribeShortcutTrigger, type ShortcutTriggerInfo } from '../lib/shortcuts'
import { Command } from 'lucide-react'

/** 快捷键触发后在屏幕上展示的时长（毫秒） */
const KEEP_MS = 2200
/** 最多保留几条历史记录 */
const MAX_ROWS = 3

interface CastItem {
  key: string
  keys: string[]
  label: string
  time: number
}

export default function KeyCast() {
  const enabled = useAppearance().teachingMode
  return enabled ? <KeyCastBody /> : null
}

function KeyCastBody() {
  const [items, setItems] = useState<CastItem[]>([])
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const unsub = subscribeShortcutTrigger((info: ShortcutTriggerInfo) => {
      const parts = info.combo.split('+').map((s) => s.trim()).filter(Boolean)
      const newItem: CastItem = {
        key: `${info.combo}-${info.label}-${Date.now()}`,
        keys: parts.length > 0 ? parts : [info.combo],
        label: info.label,
        time: Date.now(),
      }

      setItems((prev) => [...prev, newItem].slice(-MAX_ROWS))

      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        setItems([])
      }, KEEP_MS)
    })

    return () => {
      unsub()
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  if (items.length === 0) return null

  return (
    <div
      aria-hidden
      className="no-print pointer-events-none fixed bottom-5 left-5 z-50 flex flex-col items-start gap-2 select-none"
    >
      {items.map((item, idx) => {
        const isLatest = idx === items.length - 1
        const opacityCls = isLatest ? 'opacity-100 scale-100' : idx === items.length - 2 ? 'opacity-70 scale-95' : 'opacity-40 scale-90'

        return (
          <div
            key={item.key}
            className={`flex items-center gap-2.5 rounded-xl border border-neutral-700/60 bg-neutral-900/90 px-3 py-2 text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition-all duration-200 ${opacityCls}`}
          >
            {/* 键帽组合 */}
            <div className="flex items-center gap-1.5">
              {item.keys.map((k, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-[11px] font-bold text-neutral-400">+</span>}
                  <kbd className="inline-flex min-w-[26px] items-center justify-center rounded border border-neutral-600/80 border-b-2 border-b-neutral-950 bg-gradient-to-b from-neutral-700 to-neutral-800 px-2 py-0.5 font-mono text-[11.5px] font-bold tracking-tight text-neutral-100 shadow-inner">
                    {k}
                  </kbd>
                </span>
              ))}
            </div>

            {/* 分割线 */}
            <div className="h-3.5 w-px bg-neutral-700" />

            {/* 快捷键功能名标签 */}
            <div className="flex items-center gap-1.5">
              <Command size={11} className="text-seal" />
              <span className="text-[12px] font-semibold text-neutral-200">
                {item.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
