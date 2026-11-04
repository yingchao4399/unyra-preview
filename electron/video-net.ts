/**
 * 视频学习的网络通道（主进程）：来源插件的 API 请求与媒体流登记。
 *
 * 为什么独立于 web:fetch：web 那条的三条自我约束（只读 GET、不带 cookie、不碰凭据）
 * 是给「agent 写的代码」设的——模型不可信，通道必须收紧。来源插件是**用户自己装的**，
 * 而平台 API 恰恰需要 Referer / Cookie 这类防盗链头才肯回话，所以这里单开一个频道，
 * 允许插件声明这几个头。纪律照旧的部分：只读 GET、体积与时间有硬上限、目标只认
 * http(s)——内网地址的拦截暂不设（插件与用户装的其他软件同级信任；等插件外置成
 * 真正的第三方生态时，这条要升级成 web-core 同款的私网判定）。
 *
 * 媒体流不走这个通道：`<video>` 元素改不了请求头，而平台 CDN 校验 Referer，
 * 所以插件把「流地址 + 请求头」经 video:openStream 登记到这里，换回一条
 * `media-relay://` 中转地址，由 media-relay.ts 的协议处理器带头发请求。
 * **登记是每次播放前的一次性动作**（平台流地址带签名、几小时过期）：
 * URL 只活在这张内存表里，永不落盘；表有容量上限，新的进来最旧的被挤出。
 */

import { ipcMain } from 'electron'
import { t } from './i18n'
import type { VideoApiFetchResult, VideoStreamOpenResult } from '../shared/ipc'

/** 一条已登记的媒体流：目标地址与访问它要带的请求头 */
export interface MediaStreamEntry {
  url: string
  headers: Record<string, string>
}

/**
 * 登记表：id → 流。键由这里生成（随机 hex，只会是小写——自定义协议的 host 会被
 * 统一转小写，键里混进大写就查不回来了）。
 */
const streams = new Map<string, MediaStreamEntry>()

/** 表容量：一个页签同时播一条流，多留几条余量给换视频/重试的场景 */
const STREAM_CAP = 8

/** 登记一条流，挤出最旧的；返回随机 id */
function putStream(entry: MediaStreamEntry): string {
  while (streams.size >= STREAM_CAP) {
    const oldest = streams.keys().next().value
    if (oldest === undefined) break
    streams.delete(oldest)
  }
  const id = crypto.randomUUID().replace(/-/g, '')
  streams.set(id, entry)
  return id
}

/** 协议处理器按 id 取流（只读——`<video>` 会对同一条流发很多次 Range 请求，不能取走即删） */
export const streamEntryOf = (id: string): MediaStreamEntry | undefined => streams.get(id)

/* ---------- video:fetch（插件 API 请求） ---------- */

const FETCH_TIMEOUT_MS = 20_000
const FETCH_MAX_BYTES = 8 * 1024 * 1024

/** 允许插件声明的请求头：防盗链三件套 + 语言协商。其余一律丢弃，不给通道开洞 */
const HEADER_ALLOW = new Set(['user-agent', 'referer', 'cookie', 'accept', 'accept-language'])

/** 插件没声明 UA 时的兜底：与 web:fetch 同一条「正常浏览器」指纹的理由 */
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

function sanitizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.toLowerCase().trim()
    if (!HEADER_ALLOW.has(key) || typeof v !== 'string') continue
    out[key] = v
  }
  if (!out['user-agent']) out['user-agent'] = DEFAULT_UA
  return out
}

async function videoFetch(url: unknown, headers: unknown): Promise<VideoApiFetchResult> {
  const target = typeof url === 'string' ? url.trim() : ''
  // 只认 http(s)：这个通道面前站的是插件代码，协议层面的洞一个都不留
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: t('这不是可请求的地址：只支持 http(s)') }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: sanitizeHeaders(headers),
    })
    // 只收 body 的前上限字节：API 响应都在几百 KB 量级，超限即视为拿错了东西
    const buf = new Uint8Array(await res.arrayBuffer())
    const truncated = buf.byteLength > FETCH_MAX_BYTES
    const body = new TextDecoder('utf-8').decode(truncated ? buf.subarray(0, FETCH_MAX_BYTES) : buf)
    return { ok: true, status: res.status, finalUrl: res.url || target, body }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ac.signal.aborted) return { ok: false, error: t('请求超时（{0} 秒）：{1}', Math.round(FETCH_TIMEOUT_MS / 1000), msg) }
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- video:openStream（媒体流登记） ---------- */

function openStream(url: unknown, headers: unknown): VideoStreamOpenResult {
  const target = typeof url === 'string' ? url.trim() : ''
  if (!/^https?:\/\//i.test(target)) return { ok: false, error: t('这不是可播放的地址：只支持 http(s)') }
  const id = putStream({ url: target, headers: sanitizeHeaders(headers) })
  // host = id（随机小写 hex）；目标地址整体编码进查询串（authority 那一路留不下协议与端口）
  return { ok: true, relayUrl: `media-relay://${id}/stream?u=${encodeURIComponent(target)}` }
}

/** 注册两条 IPC 频道（app ready 之前挂上，与 registerWebIpc 同一条纪律） */
export function registerVideoIpc(): void {
  ipcMain.handle('video:fetch', (_e, url: unknown, headers: unknown) => videoFetch(url, headers))
  ipcMain.handle('video:openStream', (_e, url: unknown, headers: unknown) => openStream(url, headers))
}
