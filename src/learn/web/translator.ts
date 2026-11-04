/**
 * 双模翻译服务：支持「极速翻译（免费公用）」与「AI 深度翻译（当前模型）」。
 * 配合持久化缓存层，先查缓存再发网络，实现零多余 Token 消耗。
 * 极速翻译单项独立且高并发派发，出多少翻多少；AI 深度翻译进行合理分块与并发限制并严禁思维链。
 * 翻译目标语言默认跟随当前 UI 语言设置。
 */

import { isElectron, native } from '../../lib/native'
import { globalModel, globalProvider, isConfigured } from '../../ai/settings'
import { chatCompleteWith } from '../../ai/client'
import { resolveDraft } from '../../components/settings/providerDraft'
import { getLocale, t } from '../../i18n'
import {
  getCachedTranslation,
  setCachedTranslation,
  type TranslationEngine,
} from './translationCache'
import {
  detectSourceLanguage,
  isMyMemoryError,
  normalizeLangForMyMemory,
} from '../../../shared/translation'

export type { TranslationEngine }

export interface TranslationItem {
  id: string
  text: string
}

export interface TranslatedResult {
  id: string
  translation: string
}

export interface TranslateBatchOptions {
  targetLang?: string
  onProgress?: (done: number, total: number) => void
  /** 实时挂载回调：当有缓存命中或某个段落/批次翻译就绪时立刻触发，无需等待全部完成 */
  onChunkReady?: (results: TranslatedResult[]) => void
  /** 失败通知回调：当翻译出错或无有效译文时触发，用于解除 DOM 节点的正在翻译锁定 */
  onFailed?: (failedIds: string[]) => void
  signal?: AbortSignal
}

/** 智能解析当前翻译目标语言代码：未传时跟随当前 UI 使用的语言 */
export function resolveTargetLang(lang?: string): string {
  if (typeof lang === 'string' && lang.trim()) return lang.trim()
  const loc = getLocale()
  if (loc === 'zh') return 'zh-CN'
  return loc
}

/** 目标语言代码转换为用于 AI 提示词的可读名称 */
function getTargetLangLabel(targetLang: string): string {
  if (targetLang === 'zh-CN' || targetLang === 'zh') return '简体中文'
  if (targetLang === 'en') return '英文 (English)'
  if (targetLang === 'ja') return '日文 (Japanese)'
  if (targetLang === 'ko') return '韩文 (Korean)'
  if (targetLang === 'fr') return '法文 (French)'
  if (targetLang === 'de') return '德文 (German)'
  if (targetLang === 'es') return '西班牙文 (Spanish)'
  if (targetLang === 'ru') return '俄文 (Russian)'
  return targetLang
}

/**
 * 高性能并发任务执行池：
 * 限制同时活跃的异步任务上限为 concurrency，随着任务完成立即执行下一个任务。
 */
async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0

  const worker = async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) break
      const i = nextIndex++
      results[i] = await fn(items[i], i)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}

/** 翻译单段文本（带缓存检测） */
export async function translateSingle(
  text: string,
  engine: TranslationEngine,
  targetLang?: string,
): Promise<string> {
  const clean = text.trim()
  if (!clean) return ''
  const target = resolveTargetLang(targetLang)

  // 1. 优先查缓存
  const cached = getCachedTranslation(clean, engine, target)
  if (cached !== null) return cached

  let translated = ''

  if (engine === 'fast') {
    translated = await translateViaFast(clean, target)
  } else {
    translated = await translateViaAi(clean, target)
  }

  const result = translated.trim()
  if (result && result !== clean) {
    setCachedTranslation(clean, engine, result, target)
    return result
  }
  return ''
}

/** 批量翻译多段文本（优先命中缓存，未命中部分分批并发请求） */
export async function translateBatch(
  items: TranslationItem[],
  engine: TranslationEngine,
  opts: TranslateBatchOptions = {},
): Promise<TranslatedResult[]> {
  const target = resolveTargetLang(opts.targetLang)
  const { onProgress, onChunkReady, signal } = opts
  const results: TranslatedResult[] = []
  const missing: TranslationItem[] = []
  const cachedBatch: TranslatedResult[] = []

  // 1. 批量命中本地缓存
  for (const item of items) {
    const cached = getCachedTranslation(item.text, engine, target)
    if (cached !== null) {
      const entry = { id: item.id, translation: cached }
      results.push(entry)
      cachedBatch.push(entry)
    } else {
      missing.push(item)
    }
  }

  // 命中的缓存内容第一时间立刻挂载，零等待呈现
  if (cachedBatch.length > 0) {
    onChunkReady?.(cachedBatch)
  }

  let completedCount = results.length
  if (onProgress) {
    onProgress(completedCount, items.length)
  }

  if (missing.length === 0) {
    return results
  }

  // 2. 处理未命中的部分
  if (engine === 'fast') {
    // 免费公用极速翻译：每个待翻译项完全独立（不合成一段），20 路高并发同时派送，哪个完成就立刻挂载哪个
    const CONCURRENCY_FAST = 20
    await mapConcurrent(
      missing,
      CONCURRENCY_FAST,
      async (item) => {
        try {
          const trans = await translateViaFast(item.text, target)
          const cleanTrans = trans.trim()
          if (!cleanTrans || cleanTrans === item.text) {
            opts.onFailed?.([item.id])
            return
          }
          setCachedTranslation(item.text, engine, cleanTrans, target)
          const itemRes = { id: item.id, translation: cleanTrans }
          results.push(itemRes)
          onChunkReady?.([itemRes])
        } catch {
          // 翻译失败时绝不能将原文作为译文挂载，通知页面解除正在翻译锁定以供后续重试
          opts.onFailed?.([item.id])
        } finally {
          completedCount++
          if (onProgress) {
            onProgress(completedCount, items.length)
          }
        }
      },
      signal,
    )
  } else {
    // AI 深度翻译：只有 AI 翻译才进行动态合并打包与并发限制（控制 token 开销与 API 限频）
    const MAX_CHUNK_ITEMS = 6
    const MAX_CHUNK_CHARS = 1200
    const chunks: TranslationItem[][] = []
    let currentChunk: TranslationItem[] = []
    let currentChars = 0

    for (const item of missing) {
      const len = item.text.length
      if (
        currentChunk.length > 0 &&
        (currentChunk.length >= MAX_CHUNK_ITEMS || currentChars + len > MAX_CHUNK_CHARS)
      ) {
        chunks.push(currentChunk)
        currentChunk = []
        currentChars = 0
      }
      currentChunk.push(item)
      currentChars += len
    }
    if (currentChunk.length > 0) {
      chunks.push(currentChunk)
    }

    const CONCURRENCY_AI = 2
    await mapConcurrent(
      chunks,
      CONCURRENCY_AI,
      async (chunk) => {
        if (signal?.aborted) return
        try {
          const chunkResults = await translateChunkWithAi(chunk, target)
          const readyBatch: TranslatedResult[] = []
          const failedIds: string[] = []
          for (const item of chunk) {
            const found = chunkResults.find((x) => x.id === item.id)
            const cleanTrans = found ? found.translation.trim() : ''
            if (cleanTrans && cleanTrans !== item.text) {
              setCachedTranslation(item.text, engine, cleanTrans, target)
              const itemRes = { id: item.id, translation: cleanTrans }
              results.push(itemRes)
              readyBatch.push(itemRes)
            } else {
              failedIds.push(item.id)
            }
          }
          if (readyBatch.length > 0) {
            onChunkReady?.(readyBatch)
          }
          if (failedIds.length > 0) {
            opts.onFailed?.(failedIds)
          }
        } catch {
          // 若打包解析异常，降级逐条翻译并即刻挂载
          for (const item of chunk) {
            try {
              const trans = await translateViaAi(item.text, target)
              const cleanTrans = trans.trim()
              if (!cleanTrans || cleanTrans === item.text) {
                opts.onFailed?.([item.id])
                continue
              }
              setCachedTranslation(item.text, engine, cleanTrans, target)
              const itemRes = { id: item.id, translation: cleanTrans }
              results.push(itemRes)
              onChunkReady?.([itemRes])
            } catch {
              opts.onFailed?.([item.id])
            }
          }
        } finally {
          completedCount += chunk.length
          if (onProgress) {
            onProgress(completedCount, items.length)
          }
        }
      },
      signal,
    )
  }

  return results
}

/** 极速翻译通道实现 */
async function translateViaFast(text: string, targetLang: string): Promise<string> {
  if (isElectron()) {
    const res = await native().browser.fastTranslate(text, targetLang)
    if (res.ok && res.text) {
      return res.text
    }
    if (!res.ok && res.error) {
      throw new Error(res.error)
    }
  }

  // 纯浏览器端回退调用：MyMemory 不支持 auto，需检测源语言并过滤错误响应
  try {
    const srcLang = detectSourceLanguage(text, targetLang)
    const normSrc = normalizeLangForMyMemory(srcLang)
    const normTgt = normalizeLangForMyMemory(targetLang)
    if (normSrc.toLowerCase() === normTgt.toLowerCase()) {
      return text
    }

    const langpair = `${normSrc}|${normTgt}`
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as {
        responseData?: { translatedText?: string }
        responseStatus?: number | string
      }
      const tr = data?.responseData?.translatedText?.trim()
      if (tr && !isMyMemoryError(tr, data?.responseStatus) && tr !== text.trim()) {
        return tr
      }
    }
  } catch (err) {
    if (err instanceof Error) throw err
  }

  throw new Error(t('极速翻译公用接口连接异常，请稍后重试或切换至 AI 深度翻译'))
}

/** AI 翻译通道单条实现 */
async function translateViaAi(text: string, targetLang: string): Promise<string> {
  const provider = globalProvider()
  const model = globalModel()

  if (!provider || !isConfigured(provider)) {
    throw new Error(t('尚未配置可用的 AI 模型提供商（请在「设置 - 模型」中配置 API Key，或选用极速翻译）'))
  }

  const langLabel = getTargetLangLabel(targetLang)
  const hasPlaceholders = /\[[ab]\d+\]/.test(text)
  const placeholderInstruction = hasPlaceholders
    ? '若文本中包含形如 [a0]...[/a0] 或 [b0]...[/b0] 的标签占位符，必须在译文中完整保留这些标签并包裹在对应译文词句两端，切勿删除或翻译标签名称。\n'
    : ''
  const prompt = `你是一个专业严谨的翻译引擎。请将以下内容翻译为${langLabel}。
要求：准确、地道、通顺，保持专业术语和代码标记不变，${placeholderInstruction}禁止输出任何思考过程、思维链、前后缀或多余解释，只输出译文本身：\n\n${text}`

  const resolved = resolveDraft(provider)
  const result = await chatCompleteWith(resolved, model, {
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    reasoningEffort: 'none',
    purpose: 'translate',
  })

  return result.trim()
}

/** AI 打包多段翻译实现 */
async function translateChunkWithAi(
  chunk: TranslationItem[],
  targetLang: string,
): Promise<TranslatedResult[]> {
  const provider = globalProvider()
  const model = globalModel()

  if (!provider || !isConfigured(provider)) {
    throw new Error(t('尚未配置可用的 AI 模型提供商'))
  }

  const langLabel = getTargetLangLabel(targetLang)
  const paragraphsText = chunk.map((c, idx) => `[${idx + 1}] ${c.text}`).join('\n\n')
  const hasPlaceholders = chunk.some((c) => /\[[ab]\d+\]/.test(c.text))
  const placeholderInstruction = hasPlaceholders
    ? '若段落中包含形如 [a0]...[/a0] 或 [b0]...[/b0] 的标签占位符，必须在译文中完整保留这些标签并包裹在对应译文词句两端，切勿删除或翻译标签名称。\n'
    : ''
  const prompt = `你是一个高质量翻译引擎。请将以下按序号给出的 ${chunk.length} 个段落逐段翻译为${langLabel}。
要求：保持专业术语、代码标记与原意，${placeholderInstruction}严禁输出任何思考过程、思维链或解释说明，严格输出为包含 translations 字符串数组的 JSON 对象，格式如：
{"translations": ["第1段译文", "第2段译文"]}

待翻段落：
${paragraphsText}`

  const resolved = resolveDraft(provider)
  const raw = await chatCompleteWith(resolved, model, {
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    json: true,
    reasoningEffort: 'none',
    purpose: 'translate',
  })

  // 尝试解析 JSON
  try {
    const startIdx = raw.indexOf('{')
    const endIdx = raw.lastIndexOf('}')
    if (startIdx >= 0 && endIdx > startIdx) {
      const jsonStr = raw.substring(startIdx, endIdx + 1)
      const parsed = JSON.parse(jsonStr) as { translations?: string[] }
      if (Array.isArray(parsed.translations) && parsed.translations.length === chunk.length) {
        return chunk.map((c, i) => ({
          id: c.id,
          translation: parsed.translations![i] || c.text,
        }))
      }
    }
  } catch {
    // ignore
  }

  // 降级：正则按 [1] / [2] 或行拆分
  const lines = raw.split(/\n+/).map((l) => l.replace(/^\[\d+\]\s*/, '').trim()).filter(Boolean)
  if (lines.length === chunk.length) {
    return chunk.map((c, i) => ({
      id: c.id,
      translation: lines[i] || c.text,
    }))
  }

  throw new Error('AI 批量响应格式解析不符')
}
