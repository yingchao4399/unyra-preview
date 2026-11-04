import { useEffect, useState } from 'react'
import { Download, Eraser, GitCompareArrows, X } from 'lucide-react'
import {
  clearDropReports,
  dropBundleOf,
  lastDropReport,
  subscribeDrops,
  type ContextDropReport,
  type DebugMessage,
} from '../../agent/contextDebug'
import { t } from '../../i18n'

/**
 * 上下文对比调试器（重做版）：**只看命中骤降**。
 *
 * 平时它什么都没有——没有录制、没有流水。只有当某次请求的缓存命中字数低于上一次
 * （learn/useAgent 的哨兵），contextDebug 才把前后两份实发上下文定格成报告：断点在哪、
 * 从哪条消息起与上一次不一致，每条消息带 原文 / 消息职责 / 消息角色。一致的头折叠成
 * 一行（它们不是嫌疑人），断点之后默认逐条展开。
 *
 * 挂在 FloatWindow（可拖动的悬浮窗）里：调试时常常要一边看文档、一边看断点。
 */

interface Props {
  onClose: () => void
}

export default function ContextDebugger({ onClose }: Props) {
  const [report, setReport] = useState<ContextDropReport | null>(() => lastDropReport())
  useEffect(() => subscribeDrops(() => setReport(lastDropReport())), [])

  /** 行展开状态：断点之后默认展开（嫌疑人），一致的头默认折叠 */
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const toggle = (i: number) => setOpen((prev) => ({ ...prev, [i]: !prev[i] }))

  /** 下载定格的那两份实发上下文：一个 gzip 压缩的 JSON（.json.gz），原样字节 */
  const [saving, setSaving] = useState(false)
  const downloadBundle = async (): Promise<void> => {
    if (!report || saving) return
    setSaving(true)
    try {
      const text = JSON.stringify(dropBundleOf(report))
      const gz = typeof CompressionStream === 'function'
      const blob = gz
        ? await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
        : new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        'context-drop-' + new Date(report.at).toISOString().replace(/[-:T]/g, '').slice(0, 14) + (gz ? '.json.gz' : '.json')
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-2.5">
        <GitCompareArrows size={14} className="shrink-0 text-seal" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink-strong">{t('上下文对比调试器')}</div>
          <div className="text-[10.5px] leading-snug text-ink-faint">
            {t('只盯一件事：缓存命中字数跌了，就把前后两份上下文摆出来，标出断在哪。')}
          </div>
        </div>
        <button
          type="button"
          title={t('下载这两份实发上下文（.json.gz）')}
          disabled={!report || saving}
          onClick={() => void downloadBundle()}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink disabled:opacity-40"
        >
          <Download size={13} />
        </button>
        <button
          type="button"
          title={t('清空报告')}
          onClick={() => {
            clearDropReports()
            setOpen({})
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          <Eraser size={13} />
        </button>
        <button
          type="button"
          title={t('关闭')}
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/70 hover:text-ink"
        >
          <X size={14} />
        </button>
      </header>

      {!report ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-8 text-center">
          <p className="text-[12.5px] text-ink-soft">{t('还没有捕获到命中骤降')}</p>
          <p className="text-[11.5px] leading-relaxed text-ink-faint">
            {t('这是它安静的原因：平时不录制任何上下文。只有某次请求的缓存命中字数低于上一次，前后两份才会被摆到这里。')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3">
          {/* 身份横幅：模型/档位翻面——不在字节比对里，却可能整体换掉服务商缓存 */}
          {report.identity && (
            <div className="shrink-0 rounded-lg border border-red-500/50 bg-red-500/[0.06] px-3 py-2.5">
              <p className="text-[12px] font-medium leading-relaxed text-red-600 dark:text-red-400">
                {t('请求身份变了：{0}——不在字节比对里，但换模型/换档位可能整体换掉服务商的缓存。', report.identity)}
              </p>
            </div>
          )}

          {/* 结论行：命中数字与一句话断点结论 */}
          <div className="shrink-0 rounded-lg border border-warn/40 bg-warn/[0.05] px-3 py-2.5">
            <div className="flex items-baseline gap-2 text-[11.5px]">
              <span className="font-mono tabular-nums text-warn-deep">
                {report.prevRead.toLocaleString()} → {report.currRead.toLocaleString()}
              </span>
              <span className="text-ink-faint">（-{(report.prevRead - report.currRead).toLocaleString()}）</span>
              <span className="ml-auto text-[10px] text-ink-faint">
                {new Date(report.at).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
            </div>
            <p className="mt-1 text-[12px] font-medium leading-relaxed text-ink-strong">{report.headline}</p>
            {report.kind === 'trim' && report.droppedCount ? (
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                {t('搬家是设计内的（超预算从最旧一头裁掉），服务商缓存因此真丢——这不是分叉。')}
              </p>
            ) : null}
            {report.kind === 'append' ? (
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                {t('这也解释了「为什么总是每轮的首个 loop」：轮与轮之间隔着空闲（缓存过了保质期）或中间跑了别的会话（同配方的会话共享工具+系统提示词这段前缀，共享头常刷常新，各自的独有后段被挤出缓存）——所以每次都只跌一块，剩下的正好是共享的头。')}
              </p>
            ) : null}
          </div>

          {/* 合并视图：被裁掉的头 / 一致的头 / 断点与之后 */}
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-line">
            {report.messages.map((m, i) => (
              <MessageRow
                key={i}
                message={m}
                atBreak={report.breakAt === i}
                expanded={open[i] ?? m.status !== 'same'}
                onToggle={() => toggle(i)}
              />
            ))}
            {report.messages.length === 0 && (
              <p className="px-3 py-2.5 text-[11.5px] text-ink-soft">{t('断点不在消息上（见结论）。')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const statusLabel = (s: DebugMessage['status']): string =>
  s === 'same'
    ? t('一致')
    : s === 'changed'
      ? t('变化')
      : s === 'added'
        ? t('新增')
        : t('被裁掉')

const statusTone = (s: DebugMessage['status']): string =>
  s === 'same'
    ? 'text-ink-faint'
    : s === 'changed'
      ? 'text-warn-deep'
      : s === 'added'
        ? 'text-ok-deep'
        : 'text-seal-deep'

const roleLabel = (role: string): string =>
  role === 'system'
    ? t('系统')
    : role === 'user'
      ? t('用户')
      : role === 'assistant'
        ? t('助手')
        : role === 'tool'
          ? t('工具')
          : role

function MessageRow({
  message,
  atBreak,
  expanded,
  onToggle,
}: {
  message: DebugMessage
  atBreak: boolean
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={
        'border-b border-line last:border-b-0 ' +
        (message.status !== 'same' ? 'bg-warn/[0.04] ' : '') +
        (atBreak ? 'ring-1 ring-inset ring-seal/50 ' : '')
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition hover:bg-line/40"
      >
        {atBreak && (
          <span className="shrink-0 rounded bg-seal px-1 py-px text-[9.5px] font-semibold text-white">
            {t('断点')}
          </span>
        )}
        <span className="w-9 shrink-0 tabular-nums text-ink-faint">#{message.index}</span>
        <span className="w-10 shrink-0 text-ink-soft">{roleLabel(message.role)}</span>
        <span className="min-w-0 flex-1 truncate text-ink-soft" title={message.duty}>
          {message.duty}
        </span>
        <span className="shrink-0 tabular-nums text-ink-faint">{message.chars.toLocaleString()} 字</span>
        <span className={'shrink-0 font-medium ' + statusTone(message.status)}>{statusLabel(message.status)}</span>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-line/60 px-2.5 py-2">
          {message.firstDiff && (
            <div className="space-y-1 pb-1">
              <p className="break-all font-mono text-[10.5px] leading-relaxed text-ink-faint">
                <span className="mr-1 rounded bg-warn/10 px-1 py-px text-warn-deep">{t('旧')}</span>
                {message.firstDiff.old}
              </p>
              <p className="break-all font-mono text-[10.5px] leading-relaxed text-ink-faint">
                <span className="mr-1 rounded bg-ok/10 px-1 py-px text-ok-deep">{t('新')}</span>
                {message.firstDiff.new}
              </p>
            </div>
          )}
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-ink-soft">
            {message.text}
          </pre>
          {message.oldText !== undefined && (
            <>
              <p className="pt-1 text-[10px] text-ink-faint">{t('上一次的同一位置：')}</p>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-ink-faint">
                {message.oldText}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
