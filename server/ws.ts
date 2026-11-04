import type { Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { onWsChange } from '../electron/storage/ws'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

/**
 * 挂载 WebSocket 服务端到现有 HTTP 服务。
 * 负责实时推送：工作区目录变化、本地文件变更、终端输出等。
 */
export function initWebSocketServer(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    clients.add(ws)

    ws.on('close', () => {
      clients.delete(ws)
    })

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch {
        // 忽略非 JSON 帧
      }
    })
  })

  // 监听底层工作区目录变更并主动广播给所有已连接的 Web 客户端
  onWsChange(() => {
    broadcast({ type: 'ws:changed' })
  })
}

/** 向所有在线客户端广播消息 */
export function broadcast(payload: Record<string, unknown>): void {
  const json = JSON.stringify(payload)
  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      try {
        client.send(json)
      } catch {
        // 客户端断开由 close 钩子清理
      }
    }
  }
}
