/**
 * 顶栏的公告入口。
 *
 * 与 UpdateButton 同一套路：**自己订阅公告状态**（useNotice），而不是让顶栏把
 * 「有几条未读」当 props 传下来。顶栏（workspace/chrome）那一片是纯展示组件
 * （见该文件顶部「数据与回调全部由 props 传入」），把一份会随轮询变化的派生值
 * 塞进去，等于让整条 props 链跟着每 5 分钟重渲染一次。
 *
 * **红点**表示「还有没读过的公告」：
 * - 启动时取到的、以及**轮询期间新到的**，都算未读（后者正是轮询的意义）；
 * - 公告在弹窗里显示出来、或用户关掉弹窗之后，就记成已读，红点随之熄灭。
 *
 * 红点只在**有未读**时出现，不做数字角标：公告不是消息流，条数本身没有意义，
 * 用户要的只是「有新东西」这一个信号。
 */

import { Megaphone } from 'lucide-react'
import { unreadNotices, useNotice } from '../../lib/notice'
import { t } from '../../i18n'

interface Props {
  /** 打开公告弹窗（弹窗由 App 渲染，理由见 components/notice/NoticeDialog） */
  onOpen: () => void
}

export default function NoticeButton({ onOpen }: Props) {
  const { notices, store } = useNotice()
  const unread = unreadNotices(notices, store).length

  return (
    <button
      type="button"
      title={unread > 0 ? t('公告：有 {0} 条没看过', unread) : t('公告')}
      onClick={onOpen}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-all hover:bg-line/60 hover:text-ink"
    >
      <Megaphone size={15} />
      {unread > 0 && (
        // 红点：右上角一颗小圆点。带一圈与顶栏同色的描边，压在图标上也不糊
        <span className="pointer-events-none absolute right-1 top-1 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-seal ring-2 ring-card" />
        </span>
      )}
    </button>
  )
}
