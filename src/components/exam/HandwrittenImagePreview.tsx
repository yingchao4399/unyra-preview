import { useEffect, useState } from 'react'
import { FileWarning, Loader2, ZoomIn } from 'lucide-react'
import { readLocalImage } from '../../lib/localFiles'
import { t } from '../../i18n'

interface Props {
  src: string
  alt?: string
  className?: string
  onClick?: () => void
  showZoomIcon?: boolean
}

/**
 * 手写作答图片预览组件：
 * 自动识别 base64 data URL 与本地绝对文件路径（通过 readLocalImage 转换为可在 CSP 下安全渲染的 data URL）。
 */
export default function HandwrittenImagePreview({
  src,
  alt = '手写答案图片',
  className = '',
  onClick,
  showZoomIcon = true,
}: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(() => (src.startsWith('data:') ? src : null))
  const [loading, setLoading] = useState<boolean>(() => !src.startsWith('data:'))
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!src) {
      setDataUrl(null)
      setLoading(false)
      return
    }

    if (src.startsWith('data:')) {
      setDataUrl(src)
      setLoading(false)
      setLoadError(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(false)

    readLocalImage(src)
      .then((url) => {
        if (cancelled) return
        if (url) {
          setDataUrl(url)
          setLoading(false)
        } else {
          // 在非 Electron 环境测试或未读到时尝试原路径
          setDataUrl(src.startsWith('file://') ? src : `file:///${src.replace(/\\/g, '/')}`)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [src])

  if (loading) {
    return (
      <div className="flex min-h-[90px] w-full items-center justify-center rounded border border-line/60 bg-paper/40 text-[11px] text-ink-faint">
        <Loader2 size={13} className="mr-1.5 animate-spin text-seal" />
        <span>{t('正在载入图片…')}</span>
      </div>
    )
  }

  if (loadError || !dataUrl) {
    return (
      <div className="flex min-h-[70px] w-full items-center justify-center gap-1.5 rounded border border-red-500/20 bg-red-500/[0.04] p-2 text-[11px] text-red-600 dark:text-red-400">
        <FileWarning size={14} className="shrink-0" />
        <span className="truncate" title={src}>{t('无法读取手写图片')}</span>
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      className={`group relative inline-flex max-w-full items-center justify-center overflow-hidden ${
        onClick ? 'cursor-zoom-in' : ''
      }`}
    >
      <img
        src={dataUrl}
        alt={alt}
        className={className}
        onError={() => setLoadError(true)}
      />
      {onClick && showZoomIcon && (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 shadow backdrop-blur-xs transition group-hover:opacity-100">
          <ZoomIn size={12} />
        </span>
      )}
    </div>
  )
}
