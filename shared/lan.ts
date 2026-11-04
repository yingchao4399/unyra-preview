/**
 * 局域网互联与文件传输服务契约。
 * 共享于渲染层、主进程与移动端 H5 之间。
 */

export interface LanDeviceInfo {
  id: string
  name: string
  ip: string
  userAgent: string
  joinedAt: number
  lastSeenAt: number
}

export interface LanUploadedFile {
  id: string
  name: string
  size: number
  mime: string
  path: string
  url: string
  uploadTime: number
  deviceId?: string
  deviceName?: string
  requestId?: string
}

export interface LanServerStatus {
  running: boolean
  port: number
  ipList: string[]
  selectedIp: string
  qrUrl: string
  devices: LanDeviceInfo[]
  files: LanUploadedFile[]
}

export interface LanRequestFileOptions {
  /** 提示语（如：请拍摄或选择错题照片） */
  prompt?: string
  /** 允许接收的 MIME 类型或文件扩展名，如 'image/*', '.pdf' */
  accept?: string
  /** 指定请求发送给哪台设备（如果不指定则向所有当前已连接设备广播） */
  deviceId?: string
  /** 超时毫秒数，默认 180000 (3分钟) */
  timeoutMs?: number
  /** 若当前没有设备连接，是否先保留请求待设备连接后自动发出，默认 false */
  waitForDevice?: boolean
}

export interface LanRequestFileResult {
  ok: boolean
  file?: LanUploadedFile
  error?: string
}

/** 移动端向服务器发送的 WebSocket 信令消息 */
export type LanWsClientMessage =
  | { type: 'device_join'; deviceId: string; deviceName: string; userAgent?: string }
  | { type: 'pong' }
  | { type: 'intent_rejected'; requestId: string; reason?: string }

/** 服务器向移动端推送的 WebSocket 信令消息 */
export type LanWsServerMessage =
  | { type: 'device_welcome'; serverName: string; deviceId: string }
  | { type: 'ping' }
  | { type: 'request_file'; requestId: string; prompt?: string; accept?: string }
  | { type: 'file_ack'; requestId?: string; fileId: string; name: string }
