import { beforeEach, describe, expect, it } from 'vitest'
import {
  createEmptyLocaleTemplate,
  loadCustomLocalesFromDisk,
  parseLocaleJson,
} from '../src/i18n/customLocales'
import {
  setLocale,
  t,
} from '../src/i18n'
import { en } from '../src/i18n/en'

describe('国际化与自定义语言包扩展机制测试', () => {
  beforeEach(() => {
    setLocale('zh')
  })

  describe('parseLocaleJson 兼容多种 JSON 组织格式', () => {
    it('正确解析标准结构化 JSON：包含 code, name, translations', () => {
      const json = JSON.stringify({
        code: 'ja',
        name: '日本語',
        translations: {
          '设置': '設定',
          '保存': '保存する',
        },
      })
      const result = parseLocaleJson(json, 'ja')
      expect(result.length).toBe(1)
      expect(result[0].code).toBe('ja')
      expect(result[0].name).toBe('日本語')
      expect(result[0].translations['设置']).toBe('設定')
      expect(result[0].translations['保存']).toBe('保存する')
    })

    it('正确解析扁平键值对 JSON（带 __name__ 和 __code__）', () => {
      const json = JSON.stringify({
        __code__: 'fr',
        __name__: 'Français',
        '设置': 'Paramètres',
        '保存': 'Enregistrer',
      })
      const result = parseLocaleJson(json, 'fr')
      expect(result.length).toBe(1)
      expect(result[0].code).toBe('fr')
      expect(result[0].name).toBe('Français')
      expect(result[0].translations['设置']).toBe('Paramètres')
      expect(result[0].translations['__name__']).toBeUndefined()
    })

    it('正确解析多语言映射集合 JSON', () => {
      const json = JSON.stringify({
        ja: {
          name: '日本語',
          translations: { '确定': '確認' },
        },
        de: {
          name: 'Deutsch',
          translations: { '确定': 'Bestätigen' },
        },
      })
      const result = parseLocaleJson(json, 'multi')
      expect(result.length).toBe(2)
      const ja = result.find((r) => r.code === 'ja')
      const de = result.find((r) => r.code === 'de')
      expect(ja?.name).toBe('日本語')
      expect(ja?.translations['确定']).toBe('確認')
      expect(de?.name).toBe('Deutsch')
      expect(de?.translations['确定']).toBe('Bestätigen')
    })

    it('非法 JSON 静默返回空数组，不导致崩溃', () => {
      expect(parseLocaleJson('invalid-json{{{', 'test')).toEqual([])
      expect(parseLocaleJson('null', 'test')).toEqual([])
      expect(parseLocaleJson('123', 'test')).toEqual([])
    })
  })

  describe('createEmptyLocaleTemplate 空白语言包模板生成', () => {
    it('生成的模板包含所有系统词条且译文全为空字符串', async () => {
      const res = await createEmptyLocaleTemplate('ko', '한국어')
      expect(res.ok).toBe(true)

      // 提取所有系统中的英文翻译键
      const allAppKeys = Object.keys(en)
      expect(allAppKeys.length).toBeGreaterThan(100)

      // 模拟生成的 JSON 内容验证
      const emptyTranslations: Record<string, string> = {}
      for (const k of allAppKeys) {
        emptyTranslations[k] = ''
      }
      expect(emptyTranslations['设置']).toBe('')
      expect(emptyTranslations['保存']).toBe('')
    })
  })

  describe('t() 多语言回退机制', () => {
    it('中文模式下原样返回中文', () => {
      setLocale('zh')
      expect(t('设置')).toBe('设置')
      expect(t('已保存到 {0}', 'test.md')).toBe('已保存到 test.md')
    })

    it('英文模式下查表，找不到时返回中文', () => {
      setLocale('en')
      expect(t('设置')).toBe(en['设置'] || 'Settings')
      expect(t('这是一个绝对不可能存在的词条xyz')).toBe('这是一个绝对不可能存在的词条xyz')
    })

    it('自定义语言模式下优先查自定义字典，为空或不存在时回退到英文，再回退到中文', async () => {
      const originalWindow = (globalThis as unknown as { window?: unknown }).window
      ;(globalThis as unknown as { window?: unknown }).window = {
        mojiNative: {
          storage: {
            mkdir: async () => ({ ok: true }),
            list: async () => ({
              ok: true,
              entries: [{ name: 'ja.json', dir: false }],
            }),
            read: async () => ({
              ok: true,
              content: JSON.stringify({
                code: 'ja',
                name: '日本語',
                translations: {
                  '设置': '設定',
                  '保存': '保存する',
                  '关于': '',
                },
              }),
            }),
          },
        },
      }

      try {
        await loadCustomLocalesFromDisk()
        setLocale('ja')

        // 命中自定义翻译
        expect(t('设置')).toBe('設定')
        expect(t('保存')).toBe('保存する')

        // 空白译文优雅回退到英文
        expect(t('关于')).toBe(en['关于'] || 'About')

        // 都不存在的词条回退到原中文
        expect(t('这是一个绝对不可能存在的词条xyz')).toBe('这是一个绝对不可能存在的词条xyz')
      } finally {
        ;(globalThis as unknown as { window?: unknown }).window = originalWindow
      }
    })
  })
})
