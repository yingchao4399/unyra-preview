/**
 * media-relay:// —— 视频播放的媒体中转协议。
 *
 * 为什么需要它：`<video>` 元素发不出自定义请求头，而平台 CDN（B 站的 bilivideo.com
 * 全系）校验 Referer，直接把上游地址塞给 src 必然 403。渲染层先把「流地址 + 请求头」
 * 经 video:openStream 登记进主进程（见 video-net.ts 的登记表），拿到一条
 * `media-relay://<id>/stream?u=<encoded 上游地址>`，再把这条塞给 src——
 * 协议处理器按 id 查出头，带在转发请求上，`<video>` 要什么（Range）就透传什么。
 *
 * 媒体请求与 API 请求的两点不同，决定了这是**另一个**处理器而不是复用 llm-proxy：
 * 1. **长连接**：一条流要挂几分钟，逐字节边到边推，全程不许设总时限（API 那条的
 *    20 秒超时在这里等于「放到一半掐掉」）；卡顿由 `<video>` 自己兜。
 * 2. **Range 语义要原样保真**：拖进度条靠的就是 206 + Content-Range。上游给什么
 *    状态就回什么状态，动不得。
 *
 * 特权声明（standard + stream + supportFetchAPI）在 main.ts 的
 * registerSchemesAsPrivileged 里，必须在 app ready 之前。
 */

import { protocol } from 'electron'
import { streamEntryOf } from './video-net'

/** 上游响应里这些头不带回来：CORS 由特权协议的 corsEnabled 管；解压与长度由转发层重算 */
function copyUpstreamHeaders(upstream: Headers): Headers {
  const out = new Headers()
  const hadEncoding = upstream.has('content-encoding')
  upstream.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k.startsWith('access-control-')) return
    if (k === 'transfer-encoding' || k === 'content-encoding') return
    // undici 会按 content-encoding 解压：长度已经对不上，留着反而让 `<video>` 算错进度
    if (k === 'content-length' && hadEncoding) return
    out.set(key, value)
  })
  return out
}

async function handleRelayRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const entry = streamEntryOf(url.hostname)
  const target = url.searchParams.get('u')
  if (!entry || !target) return new Response('stream not registered', { status: 403 })

  // 请求头 = 插件声明的（防盗链）+ `<video>` 发来的 Range（拖进度条就靠它）
  const headers: Record<string, string> = { ...entry.headers, accept: '*/*' }
  const range = request.headers.get('range')
  if (range) headers['range'] = range

  let upstream: Response
  try {
    upstream = await fetch(target, { method: 'GET', redirect: 'follow', headers })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(`media relay failed: ${message}`, { status: 502 })
  }

  // 状态原样回（206 与 Content-Range 是 seek 的命根子），body 流式直通不缓冲
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: copyUpstreamHeaders(upstream.headers),
  })
}

/** 注册协议处理器（在 app.whenReady 之后调用，与 registerProxyProtocol 同一排） */
export function registerMediaRelayProtocol(): void {
  protocol.handle('media-relay', handleRelayRequest)
}
