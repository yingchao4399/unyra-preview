/**
 * 外链：一律交给系统浏览器，**不在应用内打开**。
 *
 * 一道边界写在两个地方（都和这里对得上）：
 * - 主进程的 hardenLinks（见 electron/main.ts）拦的是**意外**——markdown 里的链接没有 target，
 *   点下去就是一次主框架导航，不拦整个界面会被那个网页顶掉；
 * - 这里的 openExternalLink 给的是**明确的意图**：组件自己就知道这个地址该出去，
 *   于是不必先发起一次注定被拦的导航。
 *
 * 协议判定**只在主进程**做（electron/link-core）：渲染层能被开发者工具改，
 * 这条边界不能只靠它自觉。这里只负责「看起来像不像外链」。
 */

import { native, isWeb } from './native'

/** 这个地址是不是「该出去」的链接（http / https / mailto） */
export function isExternalHref(href: string): boolean {
  try {
    const u = new URL(href)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}

let webLinkHandler: ((url: string) => void) | null = null

/** 注册应用内打开网页的处理器（通常是 LearnWorkspace 的 openWebTab） */
export function setWebLinkHandler(fn: ((url: string) => void) | null): void {
  webLinkHandler = fn
}

/**
 * 打开网页链接：按用户规则，超链接与网页类 chip 打开的网站在 Electron 内部通过浏览器 tab 打开；
 * 在 WebUI 模式下不支持内置浏览器，统一转为使用当前浏览器环境打开。
 */
export function openWebLink(href: string): void {
  if (!isExternalHref(href)) return
  if (!isWeb() && webLinkHandler && (href.startsWith('http://') || href.startsWith('https://'))) {
    webLinkHandler(href)
    return
  }
  void openExternalLink(href)
}

/** 交给系统浏览器打开；被主进程拒了（协议不对/没有桥）返回 false */
export async function openExternalLink(href: string): Promise<boolean> {
  if (!isExternalHref(href)) return false
  try {
    return await native().shell.openExternal(href)
  } catch (err) {
    console.warn('[link] 打开外链失败：', href, err)
    return false
  }
}
