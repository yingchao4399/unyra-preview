import { BrowserWindow, ipcMain, shell } from 'electron'
import { lanServer } from './server'
import type { LanRequestFileOptions } from '../../shared/lan'

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send(channel, ...args)
      } catch {}
    }
  }
}

/** 注册局域网互联传输的 IPC 处理函数与广播 */
export function registerLanIpc(): void {
  // 监听服务器状态变化并广播到所有窗口
  lanServer.onStatusChange((status) => {
    broadcastToWindows('lan:status-changed', status)
  })

  // 监听新文件上传
  lanServer.onFileReceived((file) => {
    broadcastToWindows('lan:file-received', file)
  })

  // 监听设备变动
  lanServer.onDeviceChange((devices) => {
    broadcastToWindows('lan:devices-changed', devices)
  })

  ipcMain.handle('lan:start', async (_event, port?: number) => {
    return await lanServer.start(port)
  })

  ipcMain.handle('lan:stop', async () => {
    return await lanServer.stop()
  })

  ipcMain.handle('lan:status', () => {
    return lanServer.getStatus()
  })

  ipcMain.handle('lan:select-ip', (_event, ip: string) => {
    return lanServer.setSelectedIp(ip)
  })

  ipcMain.handle('lan:get-qr', async (_event, ip?: string) => {
    return await lanServer.getQrDataUrl(ip)
  })

  ipcMain.handle('lan:request-file', async (_event, options?: LanRequestFileOptions) => {
    return await lanServer.requestDeviceFile(options)
  })

  ipcMain.handle('lan:cancel-requests', (_event, reason?: string) => {
    lanServer.cancelPendingRequests(reason)
  })

  ipcMain.handle('lan:open-file', async (_event, filePath: string) => {
    if (typeof filePath === 'string' && filePath) {
      await shell.openPath(filePath)
    }
  })

  ipcMain.handle('lan:show-in-folder', (_event, filePath: string) => {
    if (typeof filePath === 'string' && filePath) {
      shell.showItemInFolder(filePath)
    }
  })
}
