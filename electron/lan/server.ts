import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { WebSocketServer, WebSocket } from 'ws'
import QRCode from 'qrcode'
import { getUserDataDir } from '../storage/userData'
import { getLanIpList } from './netInfo'
import { getMobileHtml } from './mobileHtml'
import type {
  LanDeviceInfo,
  LanRequestFileOptions,
  LanRequestFileResult,
  LanServerStatus,
  LanUploadedFile,
  LanWsClientMessage,
  LanWsServerMessage,
} from '../../shared/lan'

interface ConnectedClient {
  info: LanDeviceInfo
  ws: WebSocket
}

interface PendingRequest {
  resolve: (res: LanRequestFileResult) => void
  reject: (err: unknown) => void
  timer: NodeJS.Timeout
  options: LanRequestFileOptions
}

const DEFAULT_PORT = 51888
const MAX_HISTORY = 100

class LanTransferServer {
  private server: http.Server | null = null
  private wss: WebSocketServer | null = null
  private port: number = DEFAULT_PORT
  private selectedIp: string = ''
  private running = false

  private devices = new Map<string, ConnectedClient>()
  private files: LanUploadedFile[] = []
  private pendingRequests = new Map<string, PendingRequest>()
  private pingInterval: NodeJS.Timeout | null = null

  /** 状态与事件监听器（通知 IPC / 桌面端） */
  private statusListeners = new Set<(status: LanServerStatus) => void>()
  private fileListeners = new Set<(file: LanUploadedFile) => void>()
  private deviceListeners = new Set<(devices: LanDeviceInfo[]) => void>()

  public onStatusChange(cb: (status: LanServerStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  public onFileReceived(cb: (file: LanUploadedFile) => void): () => void {
    this.fileListeners.add(cb)
    return () => this.fileListeners.delete(cb)
  }

  public onDeviceChange(cb: (devices: LanDeviceInfo[]) => void): () => void {
    this.deviceListeners.add(cb)
    return () => this.deviceListeners.delete(cb)
  }

  private notifyStatus(): void {
    const status = this.getStatus()
    for (const cb of this.statusListeners) {
      try { cb(status) } catch {}
    }
  }

  private notifyFile(file: LanUploadedFile): void {
    for (const cb of this.fileListeners) {
      try { cb(file) } catch {}
    }
  }

  private notifyDevices(): void {
    const devList = Array.from(this.devices.values()).map((d) => d.info)
    for (const cb of this.deviceListeners) {
      try { cb(devList) } catch {}
    }
    this.notifyStatus()
  }

  /** 获取落盘目录 */
  public getStorageDir(): string {
    const baseDir = getUserDataDir()
    const target = path.join(baseDir, 'lan-transfers')
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true })
    }
    return target
  }

  /** 获取当前连接 URL */
  public getConnectUrl(ip?: string): string {
    const host = ip || this.selectedIp || getLanIpList().defaultIp
    return `http://${host}:${this.port}`
  }

  /** 生成二维码 Base64 DataURL */
  public async getQrDataUrl(ip?: string): Promise<string> {
    const url = this.getConnectUrl(ip)
    try {
      return await QRCode.toDataURL(url, {
        margin: 2,
        width: 300,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      })
    } catch {
      return ''
    }
  }

  /** 获取当前服务快照状态 */
  public getStatus(): LanServerStatus {
    const { defaultIp, allIps } = getLanIpList()
    const currentIp = this.selectedIp || defaultIp
    return {
      running: this.running,
      port: this.port,
      ipList: allIps,
      selectedIp: currentIp,
      qrUrl: this.getConnectUrl(currentIp),
      devices: Array.from(this.devices.values()).map((d) => d.info),
      files: [...this.files],
    }
  }

  /** 切换选中的局域网 IP（用于多网卡展示二维码） */
  public setSelectedIp(ip: string): LanServerStatus {
    this.selectedIp = ip
    this.notifyStatus()
    return this.getStatus()
  }

  /** 寻找可用端口并启动 HTTP + WebSocket 服务 */
  public async start(desiredPort = DEFAULT_PORT): Promise<LanServerStatus> {
    if (this.running && this.server) {
      return this.getStatus()
    }

    const { defaultIp } = getLanIpList()
    if (!this.selectedIp) {
      this.selectedIp = defaultIp
    }

    const port = await this.findAvailablePort(desiredPort)
    this.port = port

    const server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res)
    })

    const wss = new WebSocketServer({ server, path: '/ws' })
    this.setupWebSocketServer(wss)

    await new Promise<void>((resolve, reject) => {
      server.listen(this.port, '0.0.0.0', () => {
        this.server = server
        this.wss = wss
        this.running = true
        resolve()
      })
      server.on('error', (err) => {
        reject(err)
      })
    })

    // 心跳保活
    this.pingInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, client] of this.devices.entries()) {
        if (now - client.info.lastSeenAt > 60000) {
          // 超过 60 秒无心跳，清理
          try { client.ws.terminate() } catch {}
          this.devices.delete(id)
        } else if (client.ws.readyState === WebSocket.OPEN) {
          try {
            const pingMsg: LanWsServerMessage = { type: 'ping' }
            client.ws.send(JSON.stringify(pingMsg))
          } catch {}
        }
      }
    }, 15000)

    this.notifyStatus()
    return this.getStatus()
  }

  /** 停止服务 */
  public async stop(): Promise<boolean> {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }

    // 清理所有等待中的意图请求
    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: '服务已停止' })
    }
    this.pendingRequests.clear()

    // 关闭全部 WS
    if (this.wss) {
      for (const client of this.devices.values()) {
        try { client.ws.close() } catch {}
      }
      this.wss.close()
      this.wss = null
    }
    this.devices.clear()

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve())
      })
      this.server = null
    }

    this.running = false
    this.notifyStatus()
    return true
  }

  /** 自动向新连接的设备发出之前保留的意图请求 */
  private dispatchRetainedRequests(deviceId: string): void {
    const client = this.devices.get(deviceId)
    if (!client || client.ws.readyState !== WebSocket.OPEN) return

    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.options.deviceId && pending.options.deviceId !== deviceId) {
        continue
      }
      const msg: LanWsServerMessage = {
        type: 'request_file',
        requestId,
        prompt: pending.options.prompt,
        accept: pending.options.accept,
      }
      try {
        client.ws.send(JSON.stringify(msg))
      } catch (err) {
        console.error('[LanServer] 发送保留意图失败:', err)
      }
    }
  }

  /** 取消所有保留/等待中的意图请求 */
  public cancelPendingRequests(reason = '用户已取消请求'): void {
    for (const [, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error: reason })
    }
    this.pendingRequests.clear()
  }

  /** 核心 API：向连接的设备发布获取文件的意图 */
  public async requestDeviceFile(options: LanRequestFileOptions = {}): Promise<LanRequestFileResult> {
    // 确保服务在运行
    if (!this.running) {
      await this.start()
    }

    const onlineDevices = Array.from(this.devices.values())
    if (onlineDevices.length === 0 && !options.waitForDevice) {
      return { ok: false, error: '当前没有手机设备连接，请先用手机扫码连接' }
    }

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
    const timeoutMs = options.timeoutMs || 180000

    return new Promise<LanRequestFileResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        resolve({ ok: false, error: '等待手机端上传超时' })
      }, timeoutMs)

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        options,
      })

      // 向目标设备或所有在线设备发送意图消息
      const msg: LanWsServerMessage = {
        type: 'request_file',
        requestId,
        prompt: options.prompt,
        accept: options.accept,
      }
      const raw = JSON.stringify(msg)

      let sentCount = 0
      for (const client of onlineDevices) {
        if (!options.deviceId || client.info.id === options.deviceId) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(raw)
            sentCount++
          }
        }
      }

      if (sentCount === 0 && !options.waitForDevice) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        resolve({ ok: false, error: '目标设备未在线或无法发送消息' })
      }
    })
  }

  /** 处理 HTTP 请求 */
  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const rawUrl = req.url || '/'
    const parsed = new URL(rawUrl, `http://localhost:${this.port}`)
    const pathname = parsed.pathname

    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getMobileHtml())
      return
    }

    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(this.getStatus()))
      return
    }

    if (pathname === '/api/upload' && req.method === 'POST') {
      await this.handleFileUpload(req, res, parsed)
      return
    }

    if (pathname.startsWith('/api/file/')) {
      const fileId = pathname.slice('/api/file/'.length)
      const target = this.files.find((f) => f.id === fileId)
      if (target && fs.existsSync(target.path)) {
        res.writeHead(200, {
          'Content-Type': target.mime || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${encodeURIComponent(target.name)}"`,
        })
        fs.createReadStream(target.path).pipe(res)
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('文件不存在')
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }

  /** 处理文件上传 */
  private async handleFileUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    try {
      const rawFilename = url.searchParams.get('filename') || 'upload_' + Date.now() + '.bin'
      const requestId = url.searchParams.get('requestId') || undefined
      const deviceId = url.searchParams.get('deviceId') || undefined
      const deviceName = url.searchParams.get('deviceName') || undefined

      // 安全过滤文件名
      const sanitizedFilename = path.basename(decodeURIComponent(rawFilename)).replace(/[\\/:\*\?"<>\|]/g, '_')
      const ext = path.extname(sanitizedFilename)
      const base = path.basename(sanitizedFilename, ext)
      const storageDir = this.getStorageDir()

      let uniqueName = sanitizedFilename
      let targetPath = path.join(storageDir, uniqueName)
      let counter = 1
      while (fs.existsSync(targetPath)) {
        uniqueName = `${base}_${Date.now()}_${counter}${ext}`
        targetPath = path.join(storageDir, uniqueName)
        counter++
      }

      const fileWriteStream = fs.createWriteStream(targetPath)
      await pipeline(req, fileWriteStream)

      const stat = fs.statSync(targetPath)
      const contentType = req.headers['content-type'] || 'application/octet-stream'
      const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)

      const uploadedFile: LanUploadedFile = {
        id: fileId,
        name: uniqueName,
        size: stat.size,
        mime: contentType,
        path: targetPath,
        url: `/api/file/${fileId}`,
        uploadTime: Date.now(),
        deviceId,
        deviceName,
        requestId,
      }

      this.files.unshift(uploadedFile)
      if (this.files.length > MAX_HISTORY) {
        this.files.pop()
      }

      // 如果有挂起的意图请求与此关联，立即唤醒 Promise
      if (requestId && this.pendingRequests.has(requestId)) {
        const pending = this.pendingRequests.get(requestId)!
        clearTimeout(pending.timer)
        this.pendingRequests.delete(requestId)
        pending.resolve({ ok: true, file: uploadedFile })
      }

      // 桌面端通知
      this.notifyFile(uploadedFile)
      this.notifyStatus()

      // 向设备发送确认消息
      if (deviceId && this.devices.has(deviceId)) {
        const client = this.devices.get(deviceId)!
        if (client.ws.readyState === WebSocket.OPEN) {
          const ackMsg: LanWsServerMessage = {
            type: 'file_ack',
            fileId,
            name: uniqueName,
            requestId,
          }
          client.ws.send(JSON.stringify(ackMsg))
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, file: uploadedFile }))
    } catch (err: unknown) {
      console.error('[LanServer] 文件上传失败:', err)
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String(err) }))
    }
  }

  /** WebSocket 连接管理 */
  private setupWebSocketServer(wss: WebSocketServer): void {
    wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress || ''
      let currentDeviceId = ''

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as LanWsClientMessage
          if (msg.type === 'device_join') {
            currentDeviceId = msg.deviceId
            const devInfo: LanDeviceInfo = {
              id: msg.deviceId,
              name: msg.deviceName || '移动设备',
              ip: clientIp.replace(/^.*:/, ''), // 去掉 IPv6 前缀
              userAgent: msg.userAgent || '',
              joinedAt: Date.now(),
              lastSeenAt: Date.now(),
            }
            this.devices.set(msg.deviceId, { info: devInfo, ws })
            this.notifyDevices()

            const welcome: LanWsServerMessage = {
              type: 'device_welcome',
              serverName: '归一 Unyra',
              deviceId: msg.deviceId,
            }
            ws.send(JSON.stringify(welcome))

            // 自动向新连接的设备发出之前保留的意图请求
            this.dispatchRetainedRequests(msg.deviceId)
          } else if (msg.type === 'pong') {
            if (currentDeviceId && this.devices.has(currentDeviceId)) {
              this.devices.get(currentDeviceId)!.info.lastSeenAt = Date.now()
            }
          } else if (msg.type === 'intent_rejected') {
            if (this.pendingRequests.has(msg.requestId)) {
              const pending = this.pendingRequests.get(msg.requestId)!
              clearTimeout(pending.timer)
              this.pendingRequests.delete(msg.requestId)
              pending.resolve({ ok: false, error: msg.reason || '移动端用户已取消上传' })
            }
          }
        } catch (err) {
          console.error('[LanServer] WS 消息解析异常:', err)
        }
      })

      ws.on('close', () => {
        if (currentDeviceId && this.devices.has(currentDeviceId)) {
          this.devices.delete(currentDeviceId)
          this.notifyDevices()
        }
      })

      ws.on('error', () => {
        if (currentDeviceId && this.devices.has(currentDeviceId)) {
          this.devices.delete(currentDeviceId)
          this.notifyDevices()
        }
      })
    })
  }

  /** 端口探测 */
  private async findAvailablePort(startPort: number): Promise<number> {
    let port = startPort
    while (port < startPort + 100) {
      const available = await this.checkPortAvailable(port)
      if (available) return port
      port++
    }
    return startPort
  }

  private checkPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = http.createServer()
      tester.once('error', () => resolve(false))
      tester.once('listening', () => {
        tester.close(() => resolve(true))
      })
      tester.listen(port, '0.0.0.0')
    })
  }
}

export const lanServer = new LanTransferServer()
