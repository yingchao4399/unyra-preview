import { Hono } from 'hono'
import {
  cleanupAllMcpSessions,
  mcpStdioCall,
  mcpStdioDiscover,
  stopMcpSessions,
  type McpStdioCtx,
} from '../../electron/mcp/stdio'
import { currentRoot } from '../../electron/storage/settings'

export const mcpRouter = new Hono()

function getCtx(): McpStdioCtx {
  return {
    cwd: currentRoot(),
    clientVersion: '0.6.5-web',
  }
}

mcpRouter.post('/discover', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await mcpStdioDiscover(body.server, getCtx())
  return c.json(res)
})

mcpRouter.post('/call', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const res = await mcpStdioCall(body.server, body.tool, body.args, getCtx())
  return c.json(res)
})

mcpRouter.post('/stop', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body.serverId) {
    stopMcpSessions(body.serverId)
  } else {
    cleanupAllMcpSessions()
  }
  return c.json({ ok: true })
})
