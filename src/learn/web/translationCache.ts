/**
 * 网页双语/划词翻译的持久化缓存管理器：按 text 哈希 + 引擎 + 目标语言索引。
 * 同一页面重复打开或二次翻译时直接命中缓存，避免重复消耗网络与 AI Token。
 */

const STORAGE_KEY = 'unyra:web:translation_cache'
const MAX_CACHE_ENTRIES = 5000

export function fnv1a(str: string): string {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export type TranslationEngine = 'fast' | 'ai'

export function cacheKeyOf(text: string, engine: TranslationEngine, targetLang = 'zh-CN'): string {
  return `${engine}:${targetLang}:${fnv1a(text.trim())}`
}

let memCache: Map<string, string> | null = null
let dirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 单元测试或无宿主环境忽略
  }
  return null
}

function initMemCache(): Map<string, string> {
  if (memCache) return memCache
  memCache = new Map<string, string>()
  try {
    const s = getStorage()
    if (s) {
      const raw = s.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') memCache.set(k, v)
          }
        }
      }
    }
  } catch {
    // 忽略格式解析错误
  }
  return memCache
}

function scheduleSave(): void {
  if (saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!dirty || !memCache) return
    dirty = false
    try {
      const s = getStorage()
      if (!s) return
      // 保持不超过上限（FIFO 截断）
      const entries = Array.from(memCache.entries())
      const trimmed = entries.slice(Math.max(0, entries.length - MAX_CACHE_ENTRIES))
      const obj = Object.fromEntries(trimmed)
      s.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // 忽略存储超额异常
    }
  }, 500)
}

/** 查询缓存的译文，若不存在返回 null */
export function getCachedTranslation(text: string, engine: TranslationEngine, targetLang = 'zh-CN'): string | null {
  const clean = text.trim()
  if (!clean) return ''
  const cache = initMemCache()
  const key = cacheKeyOf(clean, engine, targetLang)
  return cache.get(key) ?? null
}

/** 写入一条译文到缓存 */
export function setCachedTranslation(
  text: string,
  engine: TranslationEngine,
  translation: string,
  targetLang = 'zh-CN',
): void {
  const clean = text.trim()
  const cleanTrans = translation.trim()
  if (!clean || !cleanTrans) return
  const cache = initMemCache()
  const key = cacheKeyOf(clean, engine, targetLang)
  cache.set(key, cleanTrans)
  dirty = true
  scheduleSave()
}

/** 清理全部翻译缓存 */
export function clearTranslationCache(): void {
  const cache = initMemCache()
  cache.clear()
  dirty = false
  try {
    const s = getStorage()
    s?.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** 获取当前缓存的条数 */
export function getTranslationCacheCount(): number {
  const cache = initMemCache()
  return cache.size
}
