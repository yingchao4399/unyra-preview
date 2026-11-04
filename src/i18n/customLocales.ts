/**
 * 用户自定义国际化语言包管理模块：
 * 允许用户在指定的 locales/ 目录下放入 json 文件进行语言扩展。
 * 支持生成目标语言为空的模板 json 文件，方便用户填写后放回。
 */

import { en } from './en'

export interface CustomLocaleData {
  code: string
  name: string
  translations: Record<string, string>
}

/** 语言包在存储目录中的相对路径 */
export const LOCALES_DIR_REL = 'locales'

/** 内存中已加载的自定义语言字典：code -> CustomLocaleData */
const customLocalesMap = new Map<string, CustomLocaleData>()

/** 自定义语言变动监听器 */
const changeListeners = new Set<() => void>()

function getStorage() {
  if (typeof window !== 'undefined') {
    const w = window as unknown as {
      mojiNative?: {
        storage?: {
          mkdir(rel: string): Promise<{ ok: boolean; error?: string }>
          list(rel: string): Promise<{ ok: boolean; entries?: Array<{ name: string; dir: boolean }>; error?: string }>
          read(rel: string): Promise<{ ok: boolean; content?: string | null; error?: string }>
          write(rel: string, content: string): Promise<{ ok: boolean; error?: string }>
          reveal(rel: string): Promise<{ ok: boolean; error?: string }>
        }
      }
    }
    return w.mojiNative?.storage || null
  }
  return null
}

export function subscribeCustomLocales(fn: () => void): () => void {
  changeListeners.add(fn)
  return () => {
    changeListeners.delete(fn)
  }
}

function notifyCustomLocalesChanged(): void {
  for (const fn of changeListeners) {
    try {
      fn()
    } catch {
      // 忽略单个监听器异常
    }
  }
}

/** 获取所有已加载的自定义语言列表 */
export function getLoadedCustomLocales(): CustomLocaleData[] {
  return Array.from(customLocalesMap.values())
}

/** 获取指定语言代码的翻译字典 */
export function getCustomLocaleTranslations(code: string): Record<string, string> | null {
  return customLocalesMap.get(code)?.translations || null
}

/**
 * 解析用户提供的 JSON 文件内容为标准的 CustomLocaleData：
 * 兼容多种常见 JSON 组织结构：
 * 1. 结构化对象：{ "name": "日本語", "code": "ja", "translations": { ... } }
 * 2. 扁平对象：{ "__name__": "日本語", "中文原文": "译文" }
 * 3. 语言映射包：{ "ja": { "name": "日本語", "translations": { ... } } }
 * 4. 纯键值对：{ "中文原文": "译文" }（语言代码由文件名补全）
 */
export function parseLocaleJson(content: string, fallbackCode: string): CustomLocaleData[] {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return []

    // 格式 3：根对象为多个语言代码的映射
    const firstVal = Object.values(parsed as Record<string, unknown>)[0]
    if (
      firstVal &&
      typeof firstVal === 'object' &&
      firstVal !== null &&
      'translations' in (firstVal as Record<string, unknown>)
    ) {
      const results: CustomLocaleData[] = []
      for (const [code, val] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof val === 'object' && val !== null) {
          const item = val as Record<string, unknown>
          const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : code
          const translations =
            typeof item.translations === 'object' && item.translations !== null
              ? (item.translations as Record<string, string>)
              : {}
          results.push({ code, name, translations })
        }
      }
      return results
    }

    const obj = parsed as Record<string, unknown>

    // 格式 1：含有 translations 字段
    if (typeof obj.translations === 'object' && obj.translations !== null) {
      const code = typeof obj.code === 'string' && obj.code.trim() ? obj.code.trim() : fallbackCode
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : code
      return [
        {
          code,
          name,
          translations: obj.translations as Record<string, string>,
        },
      ]
    }

    // 格式 2 或 4：扁平键值对
    const translations: Record<string, string> = {}
    let name = fallbackCode
    let code = fallbackCode

    for (const [k, v] of Object.entries(obj)) {
      if (k === '__name__' && typeof v === 'string') {
        name = v.trim()
      } else if (k === '__code__' && typeof v === 'string') {
        code = v.trim()
      } else if (typeof v === 'string') {
        translations[k] = v
      }
    }

    return [{ code, name, translations }]
  } catch {
    return []
  }
}

/**
 * 扫描并加载 locales/ 目录下的全部语言包 JSON 文件
 */
export async function loadCustomLocalesFromDisk(): Promise<CustomLocaleData[]> {
  customLocalesMap.clear()

  const storage = getStorage()
  if (!storage) {
    // 纯网页环境兜底：尝试从 localStorage 读取
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('__moji_custom_locales__') : null
      if (saved) {
        const list = JSON.parse(saved) as CustomLocaleData[]
        for (const item of list) {
          if (item?.code && item?.translations) {
            customLocalesMap.set(item.code, item)
          }
        }
      }
    } catch {
      // ignore
    }
    notifyCustomLocalesChanged()
    return getLoadedCustomLocales()
  }

  try {
    // 确保 locales 目录存在
    await storage.mkdir(LOCALES_DIR_REL).catch(() => {})

    const res = await storage.list(LOCALES_DIR_REL)
    if (!res.ok || !Array.isArray(res.entries)) {
      notifyCustomLocalesChanged()
      return []
    }

    for (const item of res.entries) {
      // 只读 .json 且排除 template.json
      if (!item.name.endsWith('.json') || item.name.toLowerCase() === 'template.json') {
        continue
      }
      const fileRel = `${LOCALES_DIR_REL}/${item.name}`
      const readRes = await storage.read(fileRel)
      if (!readRes.ok || !readRes.content) continue

      const baseName = item.name.replace(/\.json$/i, '')
      const locales = parseLocaleJson(readRes.content, baseName)
      for (const loc of locales) {
        if (loc.code && loc.code !== 'zh' && loc.code !== 'en') {
          customLocalesMap.set(loc.code, loc)
        }
      }
    }
  } catch {
    // 静默容错
  }

  notifyCustomLocalesChanged()
  return getLoadedCustomLocales()
}

/**
 * 生成包含全部中文键、目标语言译文为空的 JSON 模板文件
 * @param targetCode 预期的语言代码（如 'ja', 'es'，默认 'template'）
 * @param targetName 预期的语言显示名称（如 '日本語'）
 */
export async function createEmptyLocaleTemplate(
  targetCode = 'template',
  targetName = '目标语言名称（如：日本語）',
): Promise<{ ok: boolean; path?: string; error?: string }> {
  // 汇总全部可翻译的中文原文键（按首字母排序便于对比阅读）
  const allKeys = Object.keys(en).sort((a, b) => a.localeCompare(b, 'zh'))

  const emptyTranslations: Record<string, string> = {}
  for (const k of allKeys) {
    emptyTranslations[k] = ''
  }

  const templateObj = {
    code: targetCode,
    name: targetName,
    _comment: '请在 translations 中将中文键对应的空字符串替换为目标语言的译文，保存为 <语言代码>.json 并存放在 locales/ 目录下即可由应用自动识别',
    translations: emptyTranslations,
  }

  const jsonStr = JSON.stringify(templateObj, null, 2)
  const filename = `${targetCode || 'template'}.json`
  const fileRel = `${LOCALES_DIR_REL}/${filename}`

  const storage = getStorage()
  if (storage) {
    try {
      await storage.mkdir(LOCALES_DIR_REL).catch(() => {})
      const res = await storage.write(fileRel, jsonStr)
      if (!res.ok) {
        return { ok: false, error: res.error || '写入模板文件失败' }
      }
      // 尝试在系统文件管理器中定位该文件
      await storage.reveal(fileRel).catch(() => {})
      return { ok: true, path: fileRel }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  } else {
    // 浏览器环境触发下载
    try {
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        const blob = new Blob([jsonStr], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }
      return { ok: true, path: filename }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** 打开语言包目录 */
export async function openLocalesDir(): Promise<void> {
  const storage = getStorage()
  if (storage) {
    await storage.mkdir(LOCALES_DIR_REL).catch(() => {})
    await storage.reveal(LOCALES_DIR_REL).catch(() => {})
  }
}
