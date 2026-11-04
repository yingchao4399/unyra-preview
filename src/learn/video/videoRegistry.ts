/**
 * 视频页签的音频控制登记表（与 learn/web/webviewRegistry 同一套路）：
 * 播放器把自己的静音控制登记在**页签 id** 名下，页签条上的快捷静音按钮
 * 跨组件读 / 写同一份。
 *
 * 静音态的唯一事实在播放器里（它自己的按钮、localStorage 持久化、元素属性
 * 同步 effect 都以它为准）——页签按钮必须走 `setMuted` 而不是直接改元素，
 * 否则下一次换流 / 调音量就会被播放器的同步 effect 改回去。
 */

export interface VideoAudioControl {
  /** 现在是不是静音（播放器自己的状态，含它启动时恢复的持久化值） */
  getMuted: () => boolean
  /** 写静音：经过播放器自己的状态，图标 / 播放器按钮 / 持久化保持同一份 */
  setMuted: (muted: boolean) => void
  /** 主 <video> 元素；流还没解析出来时是 null */
  element: HTMLVideoElement | null
}

const controls = new Map<string, VideoAudioControl>()
const subs = new Set<() => void>()

/** 播放器挂上 / 卸下时登记：null = 注销 */
export function registerVideoAudio(tabId: string, ctrl: VideoAudioControl | null): void {
  if (ctrl) controls.set(tabId, ctrl)
  else controls.delete(tabId)
  for (const fn of subs) fn()
}

export function videoAudioOf(tabId: string): VideoAudioControl | undefined {
  return controls.get(tabId)
}

/** 登记表变了（播放器挂上 / 卸下）：页签按钮据此出现或消失 */
export function subscribeVideoAudio(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}
