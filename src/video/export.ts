/**
 * 选集字幕的批量导出：把**当前视频全部分 P** 的转录拼成单个 Markdown 文本。
 *
 * 层级是 合集 > 视频 > 选集，导出的单位是「视频」：H1 是视频，每 P 一节。
 * 版式（用户定的三行结构，合集版沿用过来的）：
 *   # 视频标题 @{元信息}
 *   ## p1: 分P标题 @{元信息}
 *   - 00:00 字幕内容
 *
 * 元信息：视频级 = 时长 / 来源链接 / 选集数与导出日期；分 P 级 = 时长与带 ?p=N
 * 的来源链接——文件要能自己说清「这是谁、从哪来、什么时候拿的」。
 * 单 P 失败不炸全局：那一节留一句「字幕缺失：原因」，其余照常。
 */

import { t } from '../i18n'
import { formatClock } from './transcript'
import type { Transcript } from './types'

export interface PagesExportEntry {
  title: string
  /** 分 P 号（标题里的 p{n} 用它） */
  page: number
  durationMs?: number
  /** 带 ?p=N 的来源串（原样写进元信息） */
  source: string
  transcript?: Transcript
  /** 这一条没拿到字幕的原因 */
  error?: string
}

export function buildPagesMarkdown(
  video: { title: string; durationMs?: number; source: string },
  entries: PagesExportEntry[],
): string {
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const videoMeta = [
    video.durationMs ? formatClock(video.durationMs) : null,
    t('{0} 个选集', String(entries.length)),
    video.source,
    t('导出于 {0}', date),
  ]
    .filter(Boolean)
    .join(' · ')

  const parts: string[] = [`# ${video.title} @{${videoMeta}}`, '']

  entries.forEach((entry) => {
    const meta = [entry.durationMs ? formatClock(entry.durationMs) : null, entry.source]
      .filter(Boolean)
      .join(' · ')
    parts.push(`## p${entry.page}: ${entry.title} @{${meta}}`, '')
    if (entry.transcript) {
      for (const seg of entry.transcript.segments) parts.push(`- ${formatClock(seg.startMs)} ${seg.text}`)
    } else {
      parts.push(`> ${t('字幕缺失：{0}', entry.error ?? t('这条来源没有可用字幕'))}`)
    }
    parts.push('')
  })

  return parts.join('\n')
}
