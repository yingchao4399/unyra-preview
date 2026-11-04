/**
 * 抓取网页（主进程）。
 *
 * 为什么必须在主进程：渲染进程的 fetch 受同源策略约束，抓任意站点一律被 CORS 挡下；
 * 而「关掉 webSecurity」这种事不能做（那等于把整个渲染层敞开）。所以抓取放在这里，
 * 走 Node 的 fetch，渲染层通过 web:fetch 这一个频道拿结果。
 *
 * 三条自我约束（都不与用户商量，因为 agent 是模型写的代码）：
 * 1. **只读**：只发 GET，不带 cookie、不带任何本机凭据；
 * 2. **有上限**：体积与时间都有硬上限，超了就截断/中止，不把主进程拖住；
 * 3. **不碰内网**：地址先过 web-core 的判定（本机、私网段一律拒绝）。
 */

import { ipcMain } from 'electron'
import { t } from './i18n'
import type { WebBinaryFetchResult } from '../shared/ipc'
import {
  WEB_MAX_BYTES,
  WEB_TIMEOUT_MS,
  charsetFromHtml,
  charsetOf,
  kindOfContentType,
  shouldRetryWithAlt,
  webUrlBlockReason,
  type WebKind,
} from './web-core'

export interface WebFetchOk {
  ok: true
  /** 请求的地址（规范化之后） */
  url: string
  /** 重定向之后真正读到的地址 */
  finalUrl: string
  status: number
  contentType: string
  kind: WebKind
  /** 正文文本（html 就是整页 HTML，交给渲染层提取） */
  text: string
  bytes: number
  /** 超过体积上限被截断了 */
  truncated: boolean
}

export type WebFetchResult = WebFetchOk | { ok: false; error: string }

/**
 * 两组「正常浏览器」的请求指纹。
 *
 * 为什么不用 Electron 的默认 UA：不少站点（尤其文档站与博客、以及搜索引擎）会按 UA
 * 直接回 403/406，而这里读的是公开页面、与用户手动打开它没有分别——伪装成浏览器
 * 是让「读得到」而不是「绕过什么」。
 *
 * 为什么有两套：仅换 UA 已经不够了——很多防护看的是整组指纹（sec-ch-ua / sec-fetch-*
 * 的组合是否自洽）。第一套按当前 Chrome 补全；站点仍回 403/429 时换 Firefox 指纹
 * （它不发 sec-ch-ua，头组合自然不同）再试一次，同一套 20 秒总时限内完成。
 */
const UA_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const UA_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0'

function browserHeaders(kind: 'chrome' | 'firefox'): Record<string, string> {
  const base: Record<string, string> = {
    'User-Agent': kind === 'chrome' ? UA_CHROME : UA_FIREFOX,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  }
  if (kind === 'chrome') {
    base['sec-ch-ua'] = '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"'
    base['sec-ch-ua-mobile'] = '?0'
    base['sec-ch-ua-platform'] = '"Windows"'
    base['Sec-Fetch-User'] = '?1'
  }
  return base
}

async function attempt(url: string, kind: 'chrome' | 'firefox', signal: AbortSignal): Promise<Response> {
  return fetch(url, { method: 'GET', redirect: 'follow', signal, headers: browserHeaders(kind) })
}

async function fetchPage(raw: unknown): Promise<WebFetchResult> {
  const url = typeof raw === 'string' ? raw.trim() : ''
  const blocked = webUrlBlockReason(url)
  if (blocked) return { ok: false, error: blocked }

  // 总时限只有一份：403 重试与第一次共享同一个 20 秒窗口，不会把一轮对话吊成 40 秒
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), WEB_TIMEOUT_MS)
  try {
    let res = await attempt(url, 'chrome', ac.signal)
    if (shouldRetryWithAlt(res.status)) {
      res = await attempt(url, 'firefox', ac.signal).catch(() => res)
    }
    const contentType = res.headers.get('content-type') ?? ''
    const kind = kindOfContentType(contentType)
    if (!res.ok) return { ok: false, error: t('这个地址回了 {0}（{1}）', res.status, res.statusText) }
    if (kind === 'other') return { ok: false, error: t('这不是能读的网页（{0}）：只读 HTML 与纯文本', contentType) }

    const { bytes, truncated, body } = await readCapped(res)
    const text = decodeBody(body, contentType, kind)
    return {
      ok: true,
      url,
      finalUrl: res.url || url,
      status: res.status,
      contentType,
      kind,
      text,
      bytes,
      truncated,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ac.signal.aborted) return { ok: false, error: t('抓取超时（超过 {0} 秒）：这个站点太慢或连不上', Math.round(WEB_TIMEOUT_MS / 1000)) }
    return { ok: false, error: t('抓取失败：{0}', msg) }
  } finally {
    clearTimeout(timer)
  }
}

/** 边读边数：超过上限就当场停下（不先读完再判断——那正是要避免的） */
async function readCapped(res: Response): Promise<{ body: Uint8Array; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    const truncated = buf.byteLength > WEB_MAX_BYTES
    return { body: buf.subarray(0, WEB_MAX_BYTES), bytes: Math.min(buf.byteLength, WEB_MAX_BYTES), truncated }
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.byteLength) continue
    const room = WEB_MAX_BYTES - bytes
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room))
      bytes += room
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    bytes += value.byteLength
  }
  const body = new Uint8Array(bytes)
  let at = 0
  for (const c of chunks) {
    body.set(c, at)
    at += c.byteLength
  }
  return { body, bytes, truncated }
}

/**
 * 解码：先看响应头，没有就嗅探 HTML 头部的 <meta charset>。
 * 中文站里这两条都不带的情况依然存在（那就是 utf-8）。
 */
function decodeBody(body: Uint8Array, contentType: string, kind: WebKind): string {
  const header = charsetOf(contentType)
  const fromHeader = /charset/i.test(contentType)
  const head = kind === 'html' ? new TextDecoder('utf-8').decode(body.subarray(0, 4096)) : ''
  const cs = fromHeader ? header : kind === 'html' ? charsetFromHtml(head) : header
  try {
    return new TextDecoder(cs).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

export function registerWebIpc(): void {
  ipcMain.handle('web:fetch', (_e, url: unknown) => fetchPage(url))
  ipcMain.handle('web:fetchBinary', (_e, url: unknown) => fetchBinary(url))
}

export { fetchPage }

/* ---------- 二进制抓取（web:fetchBinary，api.see 的取图 / 取 PDF 通道） ---------- */

/** 一次抓取的上限：与资源库单文件上限同口径（PDF 会比图片大，取 32MB） */
const BINARY_MAX_BYTES = 32 * 1024 * 1024

/** 常见二进制格式的魔数：响应头没给 content-type 时用来**报告** mime（校验由调用方做） */
function sniffMime(head: Uint8Array): string | null {
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif'
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return 'image/webp'
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp'
  if (head.length >= 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'application/pdf'
  return null
}

/**
 * 抓一个网络二进制（图片 / PDF），回 base64 data URL。
 *
 * 与 fetchPage 共用同一套纪律（webUrlBlockReason 拦内网、浏览器指纹、20 秒总时限）。
 * **这里不做内容类型校验**——图片还是 PDF 由调用方（learn/see）按魔数判定，
 * 通道只负责「把字节安全地拿回来」：上限 32MB、边读边数、超了当场停。
 */
async function fetchBinary(raw: unknown): Promise<WebBinaryFetchResult> {
  const url = typeof raw === 'string' ? raw.trim() : ''
  const blocked = webUrlBlockReason(url)
  if (blocked) return { ok: false, error: blocked }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), WEB_TIMEOUT_MS)
  try {
    let res = await attempt(url, 'chrome', ac.signal)
    if (shouldRetryWithAlt(res.status)) {
      res = await attempt(url, 'firefox', ac.signal).catch(() => res)
    }
    if (!res.ok) return { ok: false, error: t('这个地址回了 {0}（{1}）', res.status, res.statusText) }

    // 边读边数：超过上限当场停——32MB 是资源库单文件的口径，更大的东西不该进这条通道
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    let over = false
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        if (bytes + value.byteLength > BINARY_MAX_BYTES) {
          chunks.push(value.subarray(0, BINARY_MAX_BYTES - bytes))
          bytes = BINARY_MAX_BYTES
          over = true
          await reader.cancel().catch(() => {})
          break
        }
        chunks.push(value)
        bytes += value.byteLength
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer())
      over = buf.byteLength > BINARY_MAX_BYTES
      chunks.push(over ? buf.subarray(0, BINARY_MAX_BYTES) : buf)
      bytes = Math.min(buf.byteLength, BINARY_MAX_BYTES)
    }
    if (over) return { ok: false, error: t('抓取的内容超过 {0}MB 上限', Math.round(BINARY_MAX_BYTES / 1024 / 1024)) }

    const body = new Uint8Array(bytes)
    let at = 0
    for (const c of chunks) {
      body.set(c, at)
      at += c.byteLength
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
    const mime = contentType && contentType !== 'application/octet-stream'
      ? contentType.split(';')[0].trim()
      : (sniffMime(body) ?? contentType.split(';')[0].trim())

    let base64: string
    try {
      base64 = Buffer.from(body).toString('base64')
    } catch {
      base64 = ''
    }
    if (!base64) return { ok: false, error: t('内容字节编码失败') }

    return {
      ok: true,
      url,
      finalUrl: res.url || url,
      status: res.status,
      contentType,
      mime,
      bytes,
      dataUrl: `data:${mime || 'application/octet-stream'};base64,${base64}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ac.signal.aborted) return { ok: false, error: t('抓取超时（超过 {0} 秒）：这个站点太慢或连不上', Math.round(WEB_TIMEOUT_MS / 1000)) }
    return { ok: false, error: t('抓取失败：{0}', msg) }
  } finally {
    clearTimeout(timer)
  }
}

export { fetchBinary }

