import { Hono } from 'hono'
import { noticeSettings, setNoticeSettings } from '../../electron/storage/settings'
import { fetchPage } from '../../electron/web'

export const noticeRouter = new Hono()

noticeRouter.get('/get', (c) => {
  return c.json(noticeSettings())
})

noticeRouter.post('/set', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof setNoticeSettings>[0]
  const res = setNoticeSettings(body)
  return c.json(res)
})

noticeRouter.post('/fetch', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { url?: string }
  const url = body.url
  if (!url) return c.json({ ok: false, error: 'missing url' }, 400)
  const res = await fetchPage(url)
  return c.json(res)
})
