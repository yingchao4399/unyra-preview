import { Hono } from 'hono'
import { ORIGIN_PARAM, originSet, parseOrigin } from '../../electron/proxy-core'

export const proxyRouter = new Hono()

let allowedOrigins = new Set<string>()

export function setServerAllowedHosts(hosts: string[]): void {
  allowedOrigins = originSet(hosts)
}

export function getServerAllowedHosts(): string[] {
  return [...allowedOrigins].sort()
}

proxyRouter.post('/setHosts', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { hosts?: string[] }
  setServerAllowedHosts(body.hosts ?? [])
  return c.json({ ok: true, hosts: getServerAllowedHosts() })
})

proxyRouter.get('/getHosts', (c) => {
  return c.json({ ok: true, hosts: getServerAllowedHosts() })
})

// 匹配 /api/proxy/* 的所有后续子路径与所有 HTTP 请求方法 (POST, GET, OPTIONS 等)
proxyRouter.all('/*', async (c) => {
  const reqUrl = new URL(c.req.url)
  const originParam = reqUrl.searchParams.get(ORIGIN_PARAM)
  const origin = parseOrigin(originParam)

  // 截取掉 /api/proxy 前缀
  const subPath = reqUrl.pathname.replace(/^\/api\/proxy/, '')
  const restParams = new URLSearchParams(reqUrl.searchParams)
  restParams.delete(ORIGIN_PARAM)
  const queryStr = restParams.toString()

  if (!origin) {
    return c.json({ error: '缺少或不合法的代理目标源 (__moji_origin)' }, 400)
  }

  // 若白名单非空，校验是否放行（若刚启动未同步白名单，则放行常用 AI 接口或开发环境）
  if (allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
    return c.json({ error: `代理目标未在放行白名单内: ${origin}` }, 403)
  }

  const targetUrl = origin + (subPath || '/') + (queryStr ? '?' + queryStr : '')

  const headers = new Headers(c.req.raw.headers)
  headers.delete('host')
  headers.delete('origin')
  headers.delete('referer')
  headers.delete('content-length')
  headers.delete('accept-encoding')

  try {
    const upstreamRes = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.arrayBuffer(),
      redirect: 'follow',
    })

    const resHeaders = new Headers(upstreamRes.headers)
    resHeaders.delete('access-control-allow-origin')
    resHeaders.delete('content-length')
    resHeaders.delete('content-encoding')

    // 保持流式响应（SSE / 分块传输）
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: `代理转发失败: ${msg}` }, 502)
  }
})
