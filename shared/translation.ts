/**
 * 跨主进程与渲染进程共用的翻译辅助逻辑：语言识别、MyMemory 规范化与错误检测。
 */

/**
 * 启发式源语言检测：
 * MyMemory 等公共翻译接口不支持 'auto' 源语言代码，必须显式传递 RFC 3066 或 2 位 ISO 语言代码。
 * 针对常见语种（中、日、韩、俄、欧语系、英）进行轻量正则特征匹配。
 */
export function detectSourceLanguage(text: string, targetLang = 'zh-CN'): string {
  const clean = (text || '').trim()
  if (!clean) return 'en'

  // 日文平假名/片假名
  if (/[\u3040-\u30ff]/.test(clean)) return 'ja'
  // 韩文谚文音节/字母
  if (/[\uac00-\ud7af]|[\u1100-\u11ff]/.test(clean)) return 'ko'
  // 俄文西里尔字母
  if (/[\u0400-\u04ff]/.test(clean)) return 'ru'
  // 中文字符：仅当目标语言非中文时才认定源语言为中文
  if (/[\u4e00-\u9fa5]/.test(clean)) {
    if (!targetLang.toLowerCase().startsWith('zh')) {
      return 'zh-CN'
    }
  }
  // 常见德法西重音/特殊字符
  if (/[äöüßÄÖÜ]/.test(clean)) return 'de'
  if (/[éèêëàâùûçÉÈÊËÀÂÙÛÇ]/.test(clean)) return 'fr'
  if (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(clean)) return 'es'

  // 默认作为英文
  return 'en'
}

/**
 * 将任意区域语言代码规范化为 MyMemory 严格认可的 2 字母 ISO 或 RFC 3066 代码
 */
export function normalizeLangForMyMemory(lang: string): string {
  const clean = (lang || '').trim()
  const lower = clean.toLowerCase()
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-hans') return 'zh-CN'
  if (lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh-hk') return 'zh-TW'
  const primary = clean.split('-')[0].toLowerCase()
  return primary || 'en'
}

/**
 * 校验 MyMemory 接口返回的译文是否实际上是错误提示或配额警告。
 * MyMemory 在参数非法或超额时，经常在 HTTP 200/403 的 responseData.translatedText 中返回纯英文警告字符串。
 */
export function isMyMemoryError(text: string, status?: number | string): boolean {
  if (!text) return true
  if (status !== undefined && status !== null) {
    const code = Number(status)
    if (Number.isFinite(code) && code !== 200) return true
  }
  const upper = text.toUpperCase()
  return (
    upper.includes('INVALID SOURCE LANGUAGE') ||
    upper.includes('IS AN INVALID') ||
    upper.includes('MYMEMORY WARNING') ||
    upper.includes('NO QUERY SPECIFIED') ||
    upper.includes('YOU USED ALL AVAILABLE FREE TRANSLATIONS') ||
    upper.includes('INVALID LANGUAGE PAIR') ||
    upper.includes('QUERY LENGTH LIMIT EXCEEDED') ||
    upper.includes('PLEASE SELECT TWO DISTINCT LANGUAGES')
  )
}
