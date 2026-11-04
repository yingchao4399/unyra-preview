import { useEffect, useState, useCallback } from 'react'
import { native } from './native'
import type {
  LanDeviceInfo,
  LanRequestFileOptions,
  LanRequestFileResult,
  LanServerStatus,
  LanUploadedFile,
} from '../../shared/lan'

export type {
  LanDeviceInfo,
  LanRequestFileOptions,
  LanRequestFileResult,
  LanServerStatus,
  LanUploadedFile,
}

type LanQrModalCallback = (open: boolean) => void
const lanModalListeners = new Set<LanQrModalCallback>()
const lanModalCancelCallbacks = new Set<() => void>()

/**
 * 弹出局域网扫码连接窗口。
 * @param onCancel 若用户主动关闭弹窗（未扫码连接）时的回调
 */
export function openLanQrModal(onCancel?: () => void): void {
  if (onCancel) lanModalCancelCallbacks.add(onCancel)
  for (const cb of lanModalListeners) {
    try { cb(true) } catch {}
  }
}

/**
 * 关闭局域网扫码连接窗口。
 * @param isUserCancel 是否为用户主动点击关闭（若为主动关闭且有等待连接的请求，将触发取消）
 */
export function closeLanQrModal(isUserCancel = false): void {
  if (isUserCancel) {
    for (const cb of lanModalCancelCallbacks) {
      try { cb() } catch {}
    }
  }
  lanModalCancelCallbacks.clear()
  for (const cb of lanModalListeners) {
    try { cb(false) } catch {}
  }
}

/**
 * 订阅扫码弹窗的打开/关闭事件（用于驱动全局弹窗渲染）
 */
export function subscribeLanQrModal(cb: LanQrModalCallback): () => void {
  lanModalListeners.add(cb)
  return () => {
    lanModalListeners.delete(cb)
  }
}

/**
 * 软件内部核心 API：向连接的局域网移动设备发布获取文件的意图。
 * 如果调用时没有建立连接，自动启动服务并弹出二维码窗口；
 * 手机扫码连接成功后，二维码窗口自动关闭，无缝继续发送意图并等待回传文件。
 *
 * @example
 * ```ts
 * const res = await requestDeviceFile({ prompt: '请拍照上传笔记草稿', accept: 'image/*' })
 * if (res.ok && res.file) {
 *   console.log('收到手机上传的文件:', res.file.path)
 * }
 * ```
 */
export async function requestDeviceFile(
  options: LanRequestFileOptions = {},
): Promise<LanRequestFileResult> {
  const bridge = native().lan
  if (!bridge) {
    return { ok: false, error: '当前环境不支持局域网服务' }
  }

  // 1. 确保局域网服务已启动
  let currentStatus = await bridge.getStatus()
  if (!currentStatus || !currentStatus.running) {
    currentStatus = await bridge.startServer()
  }

  // 2. 检查是否有在线移动设备
  const hasConnectedDevice = !!(currentStatus && currentStatus.devices && currentStatus.devices.length > 0)

  if (!hasConnectedDevice) {
    // 未连接移动设备：先保留请求并弹出二维码窗口，若用户主动关闭弹窗则取消保留的请求
    openLanQrModal(() => {
      void bridge.cancelRequests?.('用户关闭了扫码连接窗口')
    })
  }

  // 无论是已有连接设备，还是未连接时保留请求，统一通过 waitForDevice: true 提交给服务端；
  // 服务端在无设备时会保留此请求；移动端设备扫码连接后，服务端会自动将保留的请求发出！
  return await bridge.requestDeviceFile({
    ...options,
    waitForDevice: true,
  })
}

export async function startLanServer(port?: number): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.startServer(port)
}

export async function stopLanServer(): Promise<boolean> {
  const bridge = native().lan
  if (!bridge) return false
  return await bridge.stopServer()
}

export async function getLanStatus(): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.getStatus()
}

export async function setSelectedLanIp(ip: string): Promise<LanServerStatus | null> {
  const bridge = native().lan
  if (!bridge) return null
  return await bridge.setSelectedIp(ip)
}

export async function getLanQrDataUrl(ip?: string): Promise<string> {
  const bridge = native().lan
  if (!bridge) return ''
  return await bridge.getQrDataUrl(ip)
}

export async function openLanFile(filePath: string): Promise<void> {
  await native().lan?.openFile(filePath)
}

export async function showLanFileInFolder(filePath: string): Promise<void> {
  await native().lan?.showInFolder(filePath)
}

// 注册到全局 window，方便开发者随时在控制台或外部脚本调用与测试
if (typeof window !== 'undefined') {
  ;(window as unknown as { requestDeviceFile: typeof requestDeviceFile }).requestDeviceFile = requestDeviceFile
}

const DEFAULT_STATUS: LanServerStatus = {
  running: false,
  port: 51888,
  ipList: ['127.0.0.1'],
  selectedIp: '127.0.0.1',
  qrUrl: '',
  devices: [],
  files: [],
}

/**
 * React Hook：订阅局域网服务运行状态、已连接设备列表与上传文件列表
 */
export function useLanServer() {
  const [status, setStatus] = useState<LanServerStatus>(DEFAULT_STATUS)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    const s = await getLanStatus()
    if (s) {
      setStatus(s)
    }
  }, [])

  useEffect(() => {
    const bridge = native().lan
    if (!bridge) return

    let mounted = true
    void (async () => {
      const s = await getLanStatus()
      if (mounted && s) {
        setStatus(s)
      }
    })()

    const unStatus = bridge.onStatusChange((newStatus) => {
      setStatus(newStatus)
    })

    const unFile = bridge.onFileReceived((file) => {
      setStatus((prev) => ({
        ...prev,
        files: [file, ...prev.files.filter((f) => f.id !== file.id)],
      }))
    })

    const unDev = bridge.onDevicesChange((devices) => {
      setStatus((prev) => ({
        ...prev,
        devices,
      }))
    })

    return () => {
      mounted = false
      unStatus()
      unFile()
      unDev()
    }
  }, [refresh])

  const start = useCallback(async (port?: number) => {
    setLoading(true)
    try {
      const res = await startLanServer(port)
      if (res) setStatus(res)
      return res
    } finally {
      setLoading(false)
    }
  }, [])

  const stop = useCallback(async () => {
    setLoading(true)
    try {
      await stopLanServer()
      await refresh()
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const selectIp = useCallback(async (ip: string) => {
    const res = await setSelectedLanIp(ip)
    if (res) setStatus(res)
  }, [])

  return {
    status,
    loading,
    refresh,
    start,
    stop,
    selectIp,
    requestFile: requestDeviceFile,
  }
}
