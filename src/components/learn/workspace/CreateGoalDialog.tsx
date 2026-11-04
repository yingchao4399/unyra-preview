import { useState, useRef, useEffect, memo } from 'react'
import { Target, X } from 'lucide-react'
import { t } from '../../../i18n'

export interface CreateGoalDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (title: string) => void
}

export const CreateGoalDialog = memo(function CreateGoalDialog({
  open,
  onClose,
  onCreate,
}: CreateGoalDialogProps) {
  const [title, setTitle] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const trimmed = title.trim()

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!trimmed) return
    onCreate(trimmed)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[420px] rounded-2xl border border-line bg-card p-6 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1 text-ink-faint transition hover:bg-line/60 hover:text-ink"
          title={t('关闭（Esc）')}
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-seal/10 text-seal">
            <Target size={20} />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold text-ink-strong">{t('新建学习目标')}</h2>
            <p className="text-[12px] text-ink-soft">{t('为目标起一个清晰的名字，随后在节点宇宙中自由规划')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('例如：Rust 异步编程、计算机网络...')}
              className="w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-seal focus:outline-none focus:ring-1 focus:ring-seal"
              maxLength={80}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-[13px] font-medium text-ink-soft transition hover:bg-line/40 hover:text-ink"
            >
              {t('取消')}
            </button>
            <button
              type="submit"
              disabled={!trimmed}
              className="rounded-xl bg-seal px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('创建目标')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
})
