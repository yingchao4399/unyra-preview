import { Hono } from 'hono'
import {
  copyPath,
  listDir,
  mkdirPath,
  movePath,
  readSession,
  readText,
  readYaml,
  removePath,
  writeSession,
  writeText,
  writeYaml,
} from '../../electron/storage/files'
import {
  readBinary,
  readImage,
  writeBinary,
  writeImage,
} from '../../electron/storage/binary'
import {
  currentRoot,
  defaultRoot,
  pickRoot,
  setRoot,
} from '../../electron/storage/settings'
import { flushSync } from '../../electron/storage/flush'
import { setWsWatchList } from '../../electron/storage/ws'

export const storageRouter = new Hono()

storageRouter.get('/info', (c) => {
  return c.json({
    root: currentRoot(),
    defaultRoot: defaultRoot(),
    isDefault: currentRoot() === defaultRoot(),
  })
})

storageRouter.post('/pickRoot', async (c) => {
  const res = await pickRoot()
  return c.json(res)
})

storageRouter.post('/setRoot', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await setRoot(body.dir)
  return c.json(res)
})

storageRouter.post('/list', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await listDir(body.rel)
  return c.json(res)
})

storageRouter.post('/read', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await readText(body.rel)
  return c.json(res)
})

storageRouter.post('/write', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeText(body.rel, body.content)
  return c.json(res)
})

storageRouter.post('/writeAtomic', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeText(body.rel, body.content)
  return c.json(res)
})

storageRouter.post('/move', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await movePath(body.from, body.to)
  return c.json(res)
})

storageRouter.post('/copy', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await copyPath(body.from, body.to)
  return c.json(res)
})

storageRouter.post('/remove', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await removePath(body.rel)
  return c.json(res)
})

storageRouter.post('/mkdir', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await mkdirPath(body.rel)
  return c.json(res)
})

storageRouter.post('/readYaml', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await readYaml(body.rel)
  return c.json(res)
})

storageRouter.post('/writeYaml', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeYaml(body.rel, body.data)
  return c.json(res)
})

storageRouter.get('/readSession', async (c) => {
  const res = await readSession()
  return c.json(res)
})

storageRouter.post('/writeSession', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeSession(body.data)
  return c.json(res)
})

storageRouter.post('/readImage', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await readImage(body.rel)
  return c.json(res)
})

storageRouter.post('/writeImage', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeImage(body.rel, body.dataUrl)
  return c.json(res)
})

storageRouter.post('/readBinary', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await readBinary(body.rel)
  return c.json(res)
})

storageRouter.post('/writeBinary', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await writeBinary(body.rel, body.dataUrl)
  return c.json(res)
})

storageRouter.post('/flush', async (c) => {
  const body = await c.req.json().catch(() => ([]))
  const res = flushSync(body)
  return c.json(res)
})

storageRouter.post('/ws/watch', async (c) => {
  const body = await c.req.json().catch(() => ([]))
  const res = setWsWatchList(body)
  return c.json(res)
})
