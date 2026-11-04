/**
 * 这个文件负责什么：界面语言（zh / en / 用户自定义语言包）与文案函数 t()。
 *
 * 方案是「**中文原文即键**」：源码里写的中文就是键。zh 档下 t() 原样返回——
 * 零查询、零字典，现有界面一个字都不用动；en 档查 en 字典，查不到也原样返回。
 * 自定义语言查 locales/ 目录下用户放入的 JSON 字典，查不到则回落英文/中文原文。
 * 「查不到原样返回」是刻意设计：用户数据（节点名、工作流登记名、AI 写的内容）
 * 从显示层经过 t() 时天然透传，「界面文案」与「数据」因此不需要在类型上区分，
 * 显示层可以放心把任何字符串包进 t()。
 *
 * 插值用 {0} {1} 数字占位（`已保存到 {0}` + 参数按顺序填入），不用命名占位——
 * 调用点都是模板字符串改过来的， positional 最省事也最不容易写错。
 */
import { en } from './en'
import {
  getCustomLocaleTranslations,
  getLoadedCustomLocales,
  subscribeCustomLocales,
  loadCustomLocalesFromDisk,
  createEmptyLocaleTemplate,
  openLocalesDir,
  type CustomLocaleData,
} from './customLocales'

/** 界面语言类型：内置 'zh' | 'en'，或任意自定义扩展语言代码 */
export type Locale = 'zh' | 'en' | (string & {})

export const BUILTIN_LOCALES: readonly string[] = ['zh', 'en']

export let LOCALES: string[] = ['zh', 'en']

/** 语言选择器上显示的名字：各语言用自己的文字写自己的名字，不互相翻译 */
export let LOCALE_LABEL: Record<string, string> = { zh: '中文', en: 'English' }

function updateLocalesList(): void {
  const custom = getLoadedCustomLocales()
  LOCALES = ['zh', 'en', ...custom.map((c) => c.code)]
  const nextLabels: Record<string, string> = { zh: '中文', en: 'English' }
  for (const c of custom) {
    nextLabels[c.code] = c.name
  }
  LOCALE_LABEL = nextLabels
}

// 订阅自定义语言变更
subscribeCustomLocales(() => {
  updateLocalesList()
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch {
      // ignore
    }
  }
})

let current: Locale = 'zh'
const listeners = new Set<() => void>()

/** 没有存过偏好时按系统语言猜：英文系统给英文，其余（含中文）一律中文 */
export function defaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  return /^en\b/i.test(navigator.language || '') ? 'en' : 'zh'
}

export function getLocale(): Locale {
  return current
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 主进程桥（见 electron/i18n）：菜单与原生对话框说不了 React 的语言，
 * 渲染层把语言变化推过去（App 挂载时经 setLocaleBridge 接上）。桥断了就断：
 * 换语言不该因为主进程没应答而失败。
 */
let bridge: ((l: Locale) => void) | null = null

export function setLocaleBridge(fn: ((l: Locale) => void) | null): void {
  bridge = fn
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'zh' ? 'zh-CN' : l
  }
  try {
    bridge?.(l)
  } catch {
    // 桥断了不该连累界面换语言
  }
  for (const fn of [...listeners]) fn()
}

/**
 * 文案函数：中文原文即键。
 *
 * 只能在函数体 / 渲染体 / 事件处理器里调用——模块顶层常量在 import 时求值一次，
 * 语言之后切换也不会再算，会把旧语言冻结进去。模块顶层的中文常量保留中文原文，
 * 在使用处再包 t()。
 */
export function t(s: string, ...params: Array<string | number>): string {
  let raw = s
  if (current === 'zh') {
    raw = s
  } else if (current === 'en') {
    raw = en[s] ?? s
  } else {
    const customDict = getCustomLocaleTranslations(current)
    const trans = customDict ? customDict[s] : undefined
    // 若自定义语言提供了非空译文则采用，否则优雅回退到英文，再回退到中文原文
    raw = typeof trans === 'string' && trans.trim() ? trans : (en[s] ?? s)
  }

  if (params.length === 0) return raw
  return raw.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = params[Number(i)]
    return v === undefined ? m : String(v)
  })
}

/** 组件里订阅界面语言用（见 useLocale.ts）；从本模块统一转出，接入方只记一个 import 点 */
export { useLocale } from './useLocale'

export {
  loadCustomLocalesFromDisk,
  createEmptyLocaleTemplate,
  openLocalesDir,
  getLoadedCustomLocales,
  type CustomLocaleData,
}
