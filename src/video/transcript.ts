/**
 * 转录段的规范格式（canonical format）工具：校验、归一与两个消费端的常用运算。
 *
 * 为什么「归一」放在应用侧而不是各插件自己写：插件生态的质量下限由这里托底——
 * 插件只要交出「大致对」的段（毫秒数、纯文本、大致有序），这里统一收口成
 * **绝对合格**的 Transcript（升序、互不重叠、整数毫秒、剔除空文本），不合格整体拒绝。
 * 宽容解析会让脏数据漏进缓存、之后每次分组都遭殃；严格校验 + 这里把容易做对的
 * 部分包掉，两手一起上。
 */

import { t } from '../i18n'
import type { Transcript, TranscriptSegment } from './types'

/** 两条段的间隔小于这个值视为重叠（亚毫秒毛刺不算） */
const OVERLAP_EPS_MS = 1

/**
 * 归一并校验一份插件交上来的转录。**插件侧的格式险些都算有救**：
 * 浮点/字符串时间、乱序、轻微重叠、空行都归掉；文本里还带着标签/换行的算
 * 插件失职——原样保留会污染下游，直接抛错把话说明白（库抛什么界面显示什么）。
 */
export function normalizeTranscript(raw: Transcript): Transcript {
  if (!raw || typeof raw !== 'object') throw new Error(t('转录稿不是合法对象'))
  if (raw.version !== 1) throw new Error(t('转录稿版本不支持：{0}', String(raw.version)))
  if (raw.origin !== 'stt' && raw.origin !== 'subtitle') throw new Error(t('转录稿来源未知：{0}', String(raw.origin)))
  if (!Array.isArray(raw.segments)) throw new Error(t('转录稿缺少段列表'))

  const segments: TranscriptSegment[] = raw.segments
    .map((s, i) => {
      if (!s || typeof s !== 'object') throw new Error(t('第 {0} 条转录段不是合法对象', String(i + 1)))
      const startMs = toMs(s.startMs)
      const endMs = toMs(s.endMs)
      if (endMs <= startMs) throw new Error(t('第 {0} 条转录段时间倒挂：{1} → {2}', String(i + 1), String(s.startMs), String(s.endMs)))
      const text = typeof s.text === 'string' ? s.text : ''
      if (/[<>]|&#?\w+;|\r?\n|\r/.test(text)) {
        throw new Error(t('第 {0} 条转录段带着标签或换行：插件必须交纯文本', String(i + 1)))
      }
      const clean = text.trim()
      if (!clean) return null
      const seg: TranscriptSegment = { startMs, endMs, text: clean }
      if (typeof s.speaker === 'string' && s.speaker.trim()) seg.speaker = s.speaker.trim()
      return seg
    })
    .filter((s): s is TranscriptSegment => s !== null)
    .sort((a, b) => a.startMs - b.startMs)

  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startMs < segments[i - 1].endMs - OVERLAP_EPS_MS) {
      throw new Error(t('转录段互相重叠（{0} 与 {1}）：插件必须自己合并或选主语言', String(i), String(i + 1)))
    }
  }

  const out: Transcript = { version: 1, origin: raw.origin, segments }
  if (typeof raw.language === 'string' && raw.language.trim()) out.language = raw.language.trim()
  return out
}

/** 时间字段收整数毫秒：浮点秒（1.23）与毫秒数都收，其余形状拒绝 */
function toMs(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) throw new Error(t('转录段时间不是合法毫秒数：{0}', String(v)))
  return Math.round(n)
}

/** 二分找「这一刻正在读的段」：没有转录、在段间空隙或时间之外时返回 -1 */
export function segmentIndexAt(segments: TranscriptSegment[], ms: number): number {
  let lo = 0
  let hi = segments.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = segments[mid]
    if (ms < s.startMs) hi = mid - 1
    else if (ms >= s.endMs) lo = mid + 1
    else return mid
  }
  return -1
}

/** 毫秒 → `mm:ss`（满一小时进位成 `h:mm:ss`）：面板的时间码与默认只有这一种写法 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}
