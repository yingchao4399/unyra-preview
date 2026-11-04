import { Hono } from 'hono'
import {
  baseFileCopy,
  baseFileDelete,
  baseFileEdit,
  baseFileList,
  baseFileMkdir,
  baseFileMove,
  baseFileRead,
  baseFileStat,
  baseFileWrite,
} from '../../electron/base/files'
import {
  baseProcessCreate,
  baseProcessDelete,
  baseProcessGet,
  baseProcessList,
  baseProcessOutput,
  baseProcessStart,
  baseProcessStatus,
  baseProcessStop,
} from '../../electron/base/process'
import { syncAllowedDirs } from '../../electron/base/permissions'

export const baseRouter = new Hono()

// ---------- 真实文件系统 API ----------

baseRouter.post('/files/read', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileRead(body.path, body.opts)
  return c.json(res)
})

baseRouter.post('/files/write', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileWrite(body.path, body.content, body.opts)
  return c.json(res)
})

baseRouter.post('/files/edit', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileEdit(body.path, body.opts)
  return c.json(res)
})

baseRouter.post('/files/list', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileList(body.path)
  return c.json(res)
})

baseRouter.post('/files/stat', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileStat(body.path)
  return c.json(res)
})

baseRouter.post('/files/mkdir', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileMkdir(body.path)
  return c.json(res)
})

baseRouter.post('/files/copy', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileCopy(body.from, body.to, body.opts)
  return c.json(res)
})

baseRouter.post('/files/move', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileMove(body.from, body.to)
  return c.json(res)
})

baseRouter.post('/files/delete', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await baseFileDelete(body.path)
  return c.json(res)
})

// ---------- 受控子进程 API ----------

baseRouter.post('/process/create', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessCreate(body.opts)
  return c.json(res)
})

baseRouter.post('/process/start', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessStart(body.id)
  return c.json(res)
})

baseRouter.post('/process/status', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessStatus(body.id)
  return c.json(res)
})

baseRouter.post('/process/output', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessOutput(body.id, body.opts)
  return c.json(res)
})

baseRouter.post('/process/stop', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessStop(body.id, body.opts)
  return c.json(res)
})

baseRouter.get('/process/list', (c) => {
  return c.json(baseProcessList())
})

baseRouter.post('/process/get', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessGet(body.id)
  return c.json(res)
})

baseRouter.post('/process/delete', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = baseProcessDelete(body.id)
  return c.json(res)
})

// ---------- 权限白名单同步 ----------

baseRouter.post('/permissions/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  syncAllowedDirs(body.dirs ?? [])
  return c.json({ ok: true })
})
