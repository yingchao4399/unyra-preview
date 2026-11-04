/**
 * 「插件开发文档」页签：把契约（lib/pluginDocContent 的 markdown）渲染成可读的一页，
 * 并允许导出成 .md 文件。
 *
 * 为什么单独一个页签而不是塞在设置页里：这份文档是给**插件作者**看的，
 * 要能开着它写代码、随手复制片段；设置页那一栏只留一条入口。
 * 渲染走文档区同一条管线（renderNote = marked + DOMPurify），样式复用 .note-preview，
 * 与正文排版一致（标题、代码块、表格都不用另写一套）。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Puzzle } from 'lucide-react'
import { t } from '../../i18n'
import { native } from '../../lib/native'
import { renderNote } from '../../lib/markdown'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import { PLUGIN_DOC_MD, PLUGIN_DOC_NAME, PLUGIN_DOC_TITLE } from '../../lib/pluginDocContent'

export default function PluginDoc() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const edges = useScrollEdges(scrollRef)
  const html = useMemo(() => renderNote(PLUGIN_DOC_MD), [])
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const exportDoc = useCallback(() => {
    if (saving) return
    setSaving(true)
    void native()
      .saveText({ suggestedName: PLUGIN_DOC_NAME, content: PLUGIN_DOC_MD, title: t('导出插件文档') })
      .then((res) => {
        setSaving(false)
        if (res.ok) setNote(t('已导出'))
        else if (!res.canceled) setNote(res.error ?? t('导出失败'))
        if (res.ok) window.setTimeout(() => setNote(null), 1600)
      })
  }, [saving])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      {/* 页头：标题 + 导出。与正文同宽对齐，不画成大按钮 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/60 px-4 py-2">
        <Puzzle size={15} className="shrink-0 text-seal" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-strong">
          {t(PLUGIN_DOC_TITLE)}
        </span>
        {note && <span className="shrink-0 text-[11px] text-ink-faint">{note}</span>}
        <button
          type="button"
          onClick={exportDoc}
          disabled={saving}
          title={t('导出插件文档（Markdown）')}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11.5px] text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-40"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {t('导出')}
        </button>
      </div>

      {/* 正文：mask 挂外层、滚动留内层（见 scrollFade 的说明） */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ maskImage: fadeMask(edges), WebkitMaskImage: fadeMask(edges) }}
      >
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="doc-measure mx-auto flex min-h-full flex-col px-[28px] py-6">
            <div className="note-preview" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </div>
  )
}
