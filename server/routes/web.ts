import { Hono } from 'hono'
import { fetchPage } from '../../electron/web'
import { webUrlBlockReason } from '../../electron/web-core'

export const webRouter = new Hono()

webRouter.post('/fetch', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string }
  const res = await fetchPage(body.url)
  return c.json(res)
})

/**
 * 网页反向安全剥除代理：供普通浏览器在 <iframe> 中内嵌阅读外部学习资料
 * 剥除 X-Frame-Options 与 CSP frame-ancestors 拦截，注入 <base> 标签保留外链相对寻址
 */
webRouter.get('/proxy', async (c) => {
  const targetUrl = c.req.query('url')
  if (!targetUrl) return c.text('缺少目标地址 ?url=', 400)

  const blocked = webUrlBlockReason(targetUrl)
  if (blocked) return c.text(blocked, 403)

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    const contentType = upstream.headers.get('content-type') || 'text/html'
    let body = await upstream.text()

    if (contentType.includes('text/html')) {
      // 注入 <base href="..."> 确保外部网页的相对 CSS/图片/JS 能正确加载
      const baseTag = `<base href="${targetUrl}">`
      if (body.includes('<head>')) {
        body = body.replace('<head>', `<head>${baseTag}`)
      } else if (body.includes('<HEAD>')) {
        body = body.replace('<HEAD>', `<HEAD>${baseTag}`)
      } else {
        body = baseTag + body
      }
    }

    const headers = new Headers()
    headers.set('Content-Type', contentType)
    // 允许任何同源或本地 <iframe> 挂载
    headers.delete('X-Frame-Options')
    headers.delete('Content-Security-Policy')

    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.text(`网页抓取失败: ${msg}`, 502)
  }
})
