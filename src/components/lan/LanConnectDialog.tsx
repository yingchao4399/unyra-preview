import { useEffect, useState, useRef } from 'react'
import {
  Check,
  Copy,
  Loader2,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react'
import ModalScrim from '../ModalScrim'
import { useEscapeKey } from '../../lib/useEscape'
import { t } from '../../i18n'
import QRCode from 'qrcode'
import {
  useLanServer,
  closeLanQrModal,
} from '../../lib/lanSync'

interface Props {
  open: boolean
  onClose: () => void
  onToast?: (msg: string) => void
}

export default function LanConnectDialog({ open, onClose, onToast }: Props) {
  const { status, loading, start, selectIp } = useLanServer()

  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 处理关闭弹窗
  const handleUserClose = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current)
      autoCloseTimerRef.current = null
    }
    closeLanQrModal(true)
    onClose()
  }

  // Esc 键关闭
  useEscapeKey(() => {
    if (open) handleUserClose()
  })

  // 默认打开弹窗且服务未启动时，自动尝试启动局域网服务
  useEffect(() => {
    if (open && !status.running && !loading) {
      void start()
    }
  }, [open, status.running, loading, start])

  // 生成二维码
  useEffect(() => {
    let active = true
    if (!open || !status.running || !status.qrUrl) {
      return () => {
        active = false
      }
    }

    void QRCode.toDataURL(status.qrUrl, {
      margin: 2,
      width: 240,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrCodeDataUrl(url)
      })
      .catch((err) => {
        console.error('QR code generation failed:', err)
      })

    return () => {
      active = false
    }
  }, [open, status.running, status.qrUrl])

  // 检测到设备连接时，给用户短暂的视觉反馈（显示已连接），随后自动关闭窗口
  useEffect(() => {
    if (open && status.devices.length > 0) {
      if (!autoCloseTimerRef.current) {
        autoCloseTimerRef.current = setTimeout(() => {
          autoCloseTimerRef.current = null
          closeLanQrModal(false)
          onClose()
        }, 450)
      }
    } else {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
        autoCloseTimerRef.current = null
      }
    }

    return () => {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current)
        autoCloseTimerRef.current = null
      }
    }
  }, [open, status.devices.length, onClose])

  // 复制直连地址
  const handleCopyUrl = async () => {
    if (!status.qrUrl) return
    try {
      await navigator.clipboard.writeText(status.qrUrl)
      setCopied(true)
      onToast?.(t('已复制局域网直连地址到剪贴板'))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      onToast?.(t('复制失败，请手动选择复制'))
    }
  }

  if (!open) return null

  const isConnected = status.devices.length > 0
  const firstDevice = status.devices[0]

  return (
    <ModalScrim z="z-[60]" onClose={handleUserClose}>
      <div
        role="dialog"
        aria-label={t('手机扫码连接')}
        className="moji-dialog-in flex w-full max-w-[370px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper p-5 shadow-[0_20px_50px_rgba(0,0,0,0.32)]"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/12 text-sky-500">
              <Smartphone size={16} />
            </span>
            <h2 className="text-[15px] font-semibold text-ink-strong">{t('手机扫码连接')}</h2>
          </div>

          <button
            type="button"
            title={t('关闭')}
            onClick={handleUserClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/70 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* 二维码卡片与扫描提醒 */}
        <div className="flex flex-col items-center py-2 text-center">
          {status.running ? (
            <>
              {/* 二维码展示区 */}
              <div className="relative flex h-[216px] w-[216px] items-center justify-center rounded-2xl bg-white p-3 shadow-sm border border-line/60">
                {qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt="局域网直连二维码"
                    className="h-[192px] w-[192px] object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-zinc-400">
                    <Loader2 className="animate-spin text-sky-500" size={24} />
                    <span className="text-[11px]">{t('正在生成二维码...')}</span>
                  </div>
                )}
              </div>

              {/* 扫码与网络提示 */}
              <div className="mt-4 space-y-1">
                <p className="text-[13px] font-semibold text-ink-strong">
                  {t('请使用手机系统相机、微信或浏览器扫码')}
                </p>
                <p className="text-[11px] text-ink-soft">
                  {t('手机与电脑需保持在同一 WiFi 局域网下')}
                </p>
              </div>

              {/* 连接状态反馈 */}
              <div className="mt-4 w-full">
                {isConnected ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/12 py-2.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400 animate-in fade-in zoom-in-95 duration-200">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check size={11} className="stroke-[3]" />
                    </span>
                    <span>
                      {t('已连接 {0}，即将开始传输', firstDevice.name || t('设备'))}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-layer-1/50 py-2 text-[12px] text-ink-soft">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                    </span>
                    <span>{t('等待扫码连接中...')}</span>
                  </div>
                )}
              </div>

              {/* 辅助操作：多网卡与直连链接复制 */}
              <div className="mt-4 flex w-full flex-col gap-1.5 border-t border-line/60 pt-3 text-[11px] text-ink-soft">
                {status.ipList.length > 1 && (
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex items-center gap-1">
                      <Wifi size={11} />
                      {t('IP 网卡:')}
                    </span>
                    <select
                      value={status.selectedIp}
                      onChange={(e) => void selectIp(e.target.value)}
                      className="rounded border border-line bg-paper px-1.5 py-0.5 text-[11px] text-ink outline-none"
                    >
                      {status.ipList.map((ip) => (
                        <option key={ip} value={ip}>
                          {ip}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center justify-between rounded-md bg-layer-1/40 px-2 py-1">
                  <span className="truncate font-mono text-[10px] text-ink-soft/80" title={status.qrUrl}>
                    {status.qrUrl}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="ml-2 flex shrink-0 items-center gap-1 text-[11px] font-medium text-sky-500 hover:text-sky-600"
                  >
                    {copied ? <Check size={11} /> : <Copy size={11} />}
                    {copied ? t('已复制') : t('复制链接')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-ink-soft">
              {loading ? (
                <>
                  <Loader2 size={28} className="animate-spin text-sky-500" />
                  <p className="text-[12px]">{t('正在启动局域网服务...')}</p>
                </>
              ) : (
                <>
                  <p className="text-[12px]">{t('服务未启动')}</p>
                  <button
                    type="button"
                    onClick={() => void start()}
                    className="mt-1 rounded-lg bg-sky-500 px-4 py-1.5 text-[12px] font-medium text-white shadow hover:bg-sky-600"
                  >
                    {t('一键启动')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalScrim>
  )
}
