import { useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import ModalScrim from '../ModalScrim'
import { useEscapeKey } from '../../lib/useEscape'
import HandwrittenImagePreview from './HandwrittenImagePreview'
import { t } from '../../i18n'

interface Props {
  src: string | null
  title?: string
  onClose: () => void
}

export default function ImageLightboxModal({ src, title = t('手写答案预览'), onClose }: Props) {
  const [rotation, setRotation] = useState(0)

  useEscapeKey(() => {
    if (src) onClose()
  })

  if (!src) return null

  return (
    <ModalScrim z="z-[70]" onClose={onClose}>
      <div
        className="relative flex max-h-[92vh] max-w-[94vw] flex-col rounded-xl border border-line-strong bg-card p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/60 pb-2 mb-2">
          <span className="text-[12.5px] font-semibold text-ink-strong">{title}</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title={t('顺时针旋转 90°')}
              className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
            >
              <RotateCw size={13} />
              <span>{rotation !== 0 ? `${rotation}°` : t('旋转')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 bg-paper/50 rounded-lg">
          <div
            style={{
              transform: rotation ? `rotate(${rotation}deg)` : undefined,
              transition: 'transform 0.2s ease',
            }}
            className="flex items-center justify-center"
          >
            <HandwrittenImagePreview
              src={src}
              alt={title}
              showZoomIcon={false}
              className="max-h-[75vh] max-w-full rounded object-contain shadow-sm"
            />
          </div>
        </div>
      </div>
    </ModalScrim>
  )
}
