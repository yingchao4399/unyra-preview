/**
 * 顶栏局域网互联传输入口按钮。
 * 自己订阅 useLanServer() 状态，展示服务运行与手机设备连接情况。
 */

import { Smartphone } from 'lucide-react'
import { useLanServer } from '../../lib/lanSync'
import { t } from '../../i18n'

interface Props {
  onOpen: () => void
}

export default function LanButton({ onOpen }: Props) {
  const { status } = useLanServer()
  const onlineCount = status.devices.length

  const title = !status.running
    ? t('局域网互联（服务未开启）')
    : onlineCount > 0
    ? t('局域网互联：已连接 {0} 台设备', String(onlineCount))
    : t('局域网互联：扫码连接手机')

  return (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-all hover:bg-line/60 hover:text-ink"
    >
      <Smartphone size={15} className={status.running && onlineCount > 0 ? 'text-sky-500' : ''} />

      {/* 在线指示点 */}
      {status.running && (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-2 w-2">
          {onlineCount > 0 && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ring-2 ring-card ${
              onlineCount > 0 ? 'bg-emerald-500' : 'bg-sky-400'
            }`}
          />
        </span>
      )}
    </button>
  )
}
