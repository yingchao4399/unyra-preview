import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PdfFileServer, parsePdfRange } from '../electron/pdfFileServer'

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'unyra-pdf-test-')); dirs.push(dir)
  const file = path.join(dir, 'sample.pdf')
  const data = '%PDF-1.3\n0123456789\n%%EOF'
  await writeFile(file, data)
  const server = new PdfFileServer()
  const source = await server.open(file, 1)
  if (!source.ok) throw new Error(source.error)
  return { server, source, data, file }
}
describe('local PDF capabilities and streaming', () => {
  it('returns full bytes and HEAD headers', async () => {
    const { server, source, data } = await setup()
    const response = await server.handle(new Request(source.url))
    expect(response.status).toBe(200); expect(await response.text()).toBe(data)
    const head = await server.handle(new Request(source.url, { method: 'HEAD' }))
    expect(head.headers.get('Content-Length')).toBe(String(data.length))
    expect(head.headers.get('Accept-Ranges')).toBe('bytes'); expect(await head.text()).toBe('')
  })
  it('supports exact, suffix and open-ended byte ranges', async () => {
    const { server, source, data } = await setup()
    for (const [range, expected] of [['bytes=9-12', data.slice(9, 13)], ['bytes=-5', data.slice(-5)], ['bytes=10-', data.slice(10)]]) {
      const response = await server.handle(new Request(source.url, { headers: { Range: range } }))
      expect(response.status).toBe(206); expect(await response.text()).toBe(expected)
      expect(response.headers.get('Content-Range')).toMatch(/^bytes \d+-\d+\/\d+$/)
    }
  })
  it('rejects invalid ranges, methods, URL paths and revoked capabilities', async () => {
    const { server, source } = await setup()
    for (const range of ['bytes=999-', 'bytes=2-1', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=9007199254740993-', 'bytes=-9007199254740993']) {
      expect((await server.handle(new Request(source.url, { headers: { Range: range } }))).status).toBe(416)
    }
    expect((await server.handle(new Request(source.url, { method: 'POST' }))).status).toBe(405)
    expect((await server.handle(new Request(source.url.replace('document.pdf', 'secret.pdf')))).status).toBe(403)
    expect((await server.handle(new Request('unyra-pdf://unknown/document.pdf'))).status).toBe(403)
    expect(server.close(source.url, 2)).toBe(false)
    server.closeOwner(1)
    expect((await server.handle(new Request(source.url))).status).toBe(403)
    expect((await server.open('relative.pdf', 1)).ok).toBe(false)
  })
  it('fingerprints change with content and rejects changed files during a session', async () => {
    const { server, source, file } = await setup()
    await writeFile(file, '%PDF-1.3\nnew content')
    expect((await server.handle(new Request(source.url))).status).toBe(409)
    const changed = await server.open(file, 1)
    expect(changed.ok && changed.fingerprint).not.toBe(source.fingerprint)
  })
  it('clamps end and suffix bounds', () => {
    expect(parsePdfRange('bytes=5-999', 10)).toEqual({ start: 5, end: 9 })
    expect(parsePdfRange('bytes=-999', 10)).toEqual({ start: 0, end: 9 })
  })
})
