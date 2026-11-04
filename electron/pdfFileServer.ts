import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

interface Entry { path: string; size: number; modifiedAt: number; owner: number }

export function parsePdfRange(value: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return 'invalid'
  const first = Number(match[1])
  const last = Number(match[2])
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return 'invalid'
  const start = match[1] ? first : Math.max(0, size - last)
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1
  if ((!match[1] && last <= 0) || start >= size || end < start) return 'invalid'
  return { start, end }
}

/** Opaque, owner-scoped capabilities. No URL ever contains a filesystem path. */
export class PdfFileServer {
  private entries = new Map<string, Entry>()

  async open(rawPath: unknown, owner: number) {
    if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath) || path.extname(rawPath).toLowerCase() !== '.pdf') {
      return { ok: false as const, error: '只允许打开本地 PDF 文件' }
    }
    try {
      if (this.entries.size >= 128) return { ok: false as const, error: '打开的 PDF 过多，请先关闭部分文档' }
      const absolute = await fs.realpath(rawPath)
      const file = await fs.open(absolute, 'r')
      let stat
      let fingerprint
      try {
        stat = await file.stat()
        if (!stat.isFile() || stat.size <= 0) throw new Error('empty PDF')
        const first = Buffer.alloc(Math.min(65536, stat.size))
        const last = Buffer.alloc(Math.min(65536, stat.size))
        await file.read(first, 0, first.length, 0)
        await file.read(last, 0, last.length, stat.size - last.length)
        if (!first.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('invalid PDF')
        fingerprint = createHash('sha256').update(absolute).update(`${stat.size}:${stat.mtimeMs}`).update(first).update(last).digest('hex')
      } finally { await file.close() }
      const token = randomUUID().replaceAll('-', '')
      this.entries.set(token, { path: absolute, size: stat.size, modifiedAt: stat.mtimeMs, owner })
      return { ok: true as const, url: `unyra-pdf://${token}/document.pdf`, size: stat.size, modifiedAt: stat.mtimeMs, fingerprint }
    } catch { return { ok: false as const, error: '无法访问 PDF，文件可能已移动、为空或格式错误' } }
  }

  close(rawUrl: unknown, owner: number): boolean {
    try {
      if (typeof rawUrl !== 'string') return false
      const token = new URL(rawUrl).hostname
      return this.entries.get(token)?.owner === owner && this.entries.delete(token)
    } catch { return false }
  }

  closeOwner(owner: number): void {
    for (const [token, entry] of this.entries) if (entry.owner === owner) this.entries.delete(token)
  }

  async handle(request: Request): Promise<Response> {
    const headers = new Headers({
      'Accept-Ranges': 'bytes', 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Accept-Ranges,Content-Length,Content-Range',
    })
    const url = new URL(request.url)
    const entry = this.entries.get(url.hostname)
    if (!entry || url.protocol !== 'unyra-pdf:' || url.pathname !== '/document.pdf' || url.search || url.username || url.password || url.port) {
      return new Response('PDF session not found', { status: 403, headers })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('Allow', 'GET, HEAD')
      return new Response(null, { status: 405, headers })
    }
    const range = parsePdfRange(request.headers.get('range'), entry.size)
    if (range === 'invalid') {
      headers.set('Content-Range', `bytes */${entry.size}`)
      return new Response(null, { status: 416, headers })
    }
    const start = range?.start ?? 0
    const end = range?.end ?? entry.size - 1
    headers.set('Content-Length', String(end - start + 1))
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${entry.size}`)
    let file: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      file = await fs.open(entry.path, 'r')
      const stat = await file.stat()
      if (stat.size !== entry.size || stat.mtimeMs !== entry.modifiedAt) {
        await file.close()
        return new Response('PDF changed; reopen it', { status: 409 })
      }
      if (request.method === 'HEAD') {
        await file.close()
        return new Response(null, { status: range ? 206 : 200, headers })
      }
      const stream = file.createReadStream({ start, end, autoClose: true })
      file = undefined // The stream now owns the handle, including error/abort cleanup.
      const abort = () => { stream.destroy() }
      request.signal.addEventListener('abort', abort, { once: true })
      stream.once('close', () => request.signal.removeEventListener('abort', abort))
      if (request.signal.aborted) stream.destroy()
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers })
    } catch { await file?.close().catch(() => {}); return new Response('PDF unavailable', { status: 404 }) }
  }
}
