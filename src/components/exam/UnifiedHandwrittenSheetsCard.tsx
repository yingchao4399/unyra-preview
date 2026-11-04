import { forwardRef, useState } from 'react'
import {
  Camera,
  FileImage,
  ImagePlus,
  Loader2,
  RotateCw,
  Smartphone,
  Trash2,
  ZoomIn,
} from 'lucide-react'
import { requestDeviceFile } from '../../lib/lanSync'
import { readLocalImage } from '../../lib/localFiles'
import HandwrittenImagePreview from './HandwrittenImagePreview'
import { t } from '../../i18n'

interface Props {
  images: string[]
  onAddImage: (img: string) => void
  onUpdateImage: (index: number, newImg: string) => void
  onRemoveImage: (index: number) => void
  onPreviewImage: (src: string) => void
  onOpenLan?: () => void
}

/**
 * 将图片顺时针旋转 90 度并返回新 data URL
 */
async function rotateImage90(src: string): Promise<string> {
  let targetSrc = src
  if (!src.startsWith('data:')) {
    const loaded = await readLocalImage(src).catch(() => null)
    if (loaded) targetSrc = loaded
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.height
      canvas.height = img.width
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(src)
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((90 * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => resolve(src)
    img.src = targetSrc
  })
}

/**
 * 统一手写答卷上传卡片：
 * 位于卷面首部，支持手机扫码拍照与本地选择多张答题卷/答题卡照片，
 * 支持顺时针旋转修正方向，交卷后由 AI 导师亲自审阅与裁切贴题。
 */
const UnifiedHandwrittenSheetsCard = forwardRef<HTMLDivElement, Props>(function UnifiedHandwrittenSheetsCard(
  { images, onAddImage, onUpdateImage, onRemoveImage, onPreviewImage, onOpenLan: _onOpenLan },
  ref,
) {
  const [snapping, setSnapping] = useState(false)
  const [rotatingIndex, setRotatingIndex] = useState<number | null>(null)

  const handleMobileSnap = async () => {
    setSnapping(true)
    try {
      const res = await requestDeviceFile({
        prompt: t('请拍摄第 {0} 页手写答卷/答题卡', images.length + 1),
        accept: 'image/*',
      })
      if (res.ok && res.file) {
        onAddImage(res.file.path)
      }
    } finally {
      setSnapping(false)
    }
  }

  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onAddImage(reader.result)
        }
      }
      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }

  const handleRotate = async (idx: number) => {
    if (rotatingIndex !== null) return
    setRotatingIndex(idx)
    try {
      const rotated = await rotateImage90(images[idx])
      onUpdateImage(idx, rotated)
    } finally {
      setRotatingIndex(null)
    }
  }

  return (
    <div
      ref={ref}
      className="rounded-lg border border-line-strong/80 bg-card p-3.5 shadow-2xs transition-colors scroll-mt-14"
    >
      {/* 头部标题与说明 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/40 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-seal/10 text-seal">
            <FileImage size={14} />
          </div>
          <div>
            <h3 className="text-[13px] font-bold text-ink-strong">{t('手写答卷统一上传')}</h3>
            <p className="text-[11px] text-ink-faint">
              {t('纸笔作答请在此上传答卷照片（可上传多份答题纸，如第 1 页、第 2 页）')}
            </p>
          </div>
        </div>

        {/* 右侧动作按钮组 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMobileSnap}
            disabled={snapping}
            className="flex items-center gap-1.5 rounded-md border border-seal/40 bg-seal/10 hover:bg-seal/15 px-2.5 py-1 text-[11.5px] font-semibold text-seal-deep transition cursor-pointer disabled:opacity-50"
          >
            {snapping ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>{t('等待手机拍照上传…')}</span>
              </>
            ) : (
              <>
                <Camera size={12} />
                <span>{t('手机扫码拍照')}</span>
              </>
            )}
          </button>

          <label className="flex items-center gap-1 rounded-md border border-line bg-paper/60 hover:bg-line/50 px-2.5 py-1 text-[11.5px] font-medium text-ink-soft hover:text-ink transition cursor-pointer">
            <ImagePlus size={12} />
            <span>{t('本地上传照片')}</span>
            <input
              type="file"
              multiple
              accept="image/*"
              className="sr-only"
              onChange={handleLocalFiles}
            />
          </label>
        </div>
      </div>

      {/* 答卷缩略图展示列表 */}
      {images.length > 0 ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2.5">
            {images.map((img, idx) => (
              <div
                key={idx}
                className="group relative flex w-36 flex-col overflow-hidden rounded-md border border-line/70 bg-paper/40 p-1.5 transition hover:border-seal/50 hover:shadow-2xs"
              >
                <div
                  className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded bg-paper cursor-zoom-in"
                  onClick={() => onPreviewImage(img)}
                >
                  <HandwrittenImagePreview
                    src={img}
                    alt={t('答卷第 {0} 页', idx + 1)}
                    showZoomIcon={false}
                    className="h-full w-full object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition text-white">
                    <ZoomIn size={14} />
                  </div>
                </div>

                <div className="mt-1.5 flex items-center justify-between px-0.5 text-[11px]">
                  <span className="font-medium text-ink-soft">{t('答卷 {0}', idx + 1)}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={rotatingIndex === idx}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRotate(idx)
                      }}
                      title={t('顺时针旋转 90°')}
                      className="rounded p-0.5 text-ink-faint hover:text-seal transition cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw size={12} className={rotatingIndex === idx ? 'animate-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveImage(idx)
                      }}
                      title={t('移除这张答卷')}
                      className="rounded p-0.5 text-ink-faint hover:text-rose-600 transition cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
            <Smartphone size={11} className="text-seal" />
            <span>
              {t(
                '已上传 {0} 份答卷照片。若照片角度倾斜可点 ↻ 旋转；交卷后 AI 导师将亲自审卷判分并裁切贴题，请在交卷前自行检查确认作答完整。',
                images.length,
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 rounded border border-dashed border-line/60 bg-paper/20 px-3 py-2 text-[11px] text-ink-faint">
          <span>
            {t(
              '💡 提示：纯电脑端打字或选择作答无需上传照片；若你使用草稿纸/答题卡手写，可随时在此拍摄上传，交卷后 AI 导师会亲自审卷。',
            )}
          </span>
        </div>
      )}
    </div>
  )
})

export default UnifiedHandwrittenSheetsCard
