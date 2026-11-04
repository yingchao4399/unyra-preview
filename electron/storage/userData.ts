import os from 'node:os'
import path from 'node:path'

let customUserDataDir: string | null = null

/** 设置自定义用户数据目录（Web 服务端或脚本指定数据目录时使用） */
export function setUserDataDir(dir: string): void {
  customUserDataDir = dir
}

/**
 * 获取当前用户数据目录。
 *
 * 优先顺序：
 * 1. 自定义设置的目录（通过 setUserDataDir 或命令行传参）；
 * 2. Electron 运行时由 app.getPath('userData') 提供的路径；
 * 3. 独立 Node.js 运行时按操作系统规范回落（Win: %APPDATA%/unyra, Mac: ~/Library/Application Support/unyra, Linux: ~/.config/unyra）。
 */
export function getUserDataDir(): string {
  if (customUserDataDir) return customUserDataDir
  try {
    // 动态检查 Electron 运行时
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData')
    }
  } catch {
    // 处于纯 Node.js 服务端环境
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'unyra')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'unyra')
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'unyra')
}
