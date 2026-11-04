import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  findReferencedDeepSeekKey,
  resolveSearchApiKey,
  type AiSettings,
} from '../src/ai/settings'
import {
  callDeepSeekSearch,
  callDeepSeekFetch,
  searchForAgent,
  fetchForAgent,
  DEEPSEEK_SEARCH_ENDPOINT,
  DEEPSEEK_FETCH_ENDPOINT,
} from '../src/learn/webSearch'
import { buildApi } from '../src/agent/sandbox/api'
import type { SandboxCall } from '../src/agent/sandbox/types'
import { proxyUrl } from '../src/ai/http'

describe('DeepSeek 搜索与抓取设置 (settings)', () => {
  const dummyGlobal = { providerId: 'p1', model: 'm1', effort: 'medium' as const }

  it('自动发现并复用内置 DeepSeek 官方提供商的 API Key', () => {
    const settings: AiSettings = {
      version: 3,
      global: dummyGlobal,
      providers: [
        {
          id: 'deepseek',
          kind: 'provider',
          label: 'DeepSeek 官方',
          baseUrl: '',
          apiKey: 'sk-deepseek-official-key',
          models: [],
        },
      ],
    }

    const ref = findReferencedDeepSeekKey(settings)
    expect(ref).not.toBeNull()
    expect(ref?.apiKey).toBe('sk-deepseek-official-key')
    expect(ref?.provider.id).toBe('deepseek')

    // 默认未配置独立 search.apiKey 时直接复用提供商 Key
    expect(resolveSearchApiKey(settings)).toBe('sk-deepseek-official-key')
  })

  it('自动发现使用 api.deepseek.com 根地址的自定义提供商', () => {
    const settings: AiSettings = {
      version: 3,
      global: dummyGlobal,
      providers: [
        {
          id: 'custom:ds-proxy',
          kind: 'custom',
          label: 'My DeepSeek Proxy',
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'sk-custom-ds-key',
          models: [],
        },
      ],
    }

    const ref = findReferencedDeepSeekKey(settings)
    expect(ref).not.toBeNull()
    expect(ref?.apiKey).toBe('sk-custom-ds-key')
    expect(resolveSearchApiKey(settings)).toBe('sk-custom-ds-key')
  })

  it('独立配置的 search.apiKey 优先于提供商引用的 Key', () => {
    const settings: AiSettings = {
      version: 3,
      global: dummyGlobal,
      providers: [
        {
          id: 'deepseek',
          kind: 'provider',
          label: 'DeepSeek 官方',
          baseUrl: '',
          apiKey: 'sk-provider-key',
          models: [],
        },
      ],
      search: {
        provider: 'deepseek',
        apiKey: 'sk-override-search-key',
      },
    }

    expect(resolveSearchApiKey(settings)).toBe('sk-override-search-key')
  })

  it('没有 DeepSeek 提供商且未配置 search.apiKey 时返回空字符串', () => {
    const settings: AiSettings = {
      version: 3,
      global: dummyGlobal,
      providers: [
        {
          id: 'openai',
          kind: 'provider',
          label: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          models: [],
        },
      ],
    }

    expect(findReferencedDeepSeekKey(settings)).toBeNull()
    expect(resolveSearchApiKey(settings)).toBe('')
  })
})

describe('DeepSeek Search & Fetch 客户端 API 调用', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('未配置 API Key 时返回明确的配置引导错误', async () => {
    const searchRes = await callDeepSeekSearch({ query: '量子力学' }, '')
    expect('error' in searchRes).toBe(true)
    if ('error' in searchRes) {
      expect(searchRes.error).toContain('尚未配置 DeepSeek API Key')
    }

    const fetchRes = await callDeepSeekFetch({ url: 'https://example.com' }, '')
    expect('error' in fetchRes).toBe(true)
    if ('error' in fetchRes) {
      expect(fetchRes.error).toContain('尚未配置 DeepSeek API Key')
    }
  })

  it('query 为空时报错', async () => {
    const res = await callDeepSeekSearch({ query: '   ' }, 'sk-valid-key')
    expect('error' in res).toBe(true)
    if ('error' in res) {
      expect(res.error).toContain('query 不能为空')
    }
  })

  it('fetch url 非法时报错', async () => {
    const res = await callDeepSeekFetch({ url: 'ftp://not-http.com' }, 'sk-valid-key')
    expect('error' in res).toBe(true)
    if ('error' in res) {
      expect(res.error).toContain('合法的 http:// 或 https://')
    }
  })

  it('callDeepSeekSearch 正确向端点发送 POST 请求并解析返回结果', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({
          results: [
            {
              title: '量子计算入门',
              url: 'https://example.com/quantum',
              snippet: '量子计算基础概念...',
              summary: '总结核心要点',
              rerank_score: 3.14,
              content: '# 正文内容',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await callDeepSeekSearch(
      {
        query: '量子计算',
        count: 20,
        ori_question: '什么是量子计算？',
        need_content: true,
      },
      'sk-test-ds-key',
    )

    expect('results' in res).toBe(true)
    if ('results' in res) {
      expect(res.results).toHaveLength(1)
      expect(res.results[0].title).toBe('量子计算入门')
    }

    expect(capturedUrl).toBe(proxyUrl(DEEPSEEK_SEARCH_ENDPOINT))
    expect(capturedInit?.method).toBe('POST')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test-ds-key')

    const sentBody = JSON.parse(capturedInit?.body as string)
    expect(sentBody.query).toBe('量子计算')
    expect(sentBody.count).toBe(20)
    expect(sentBody.ori_question).toBe('什么是量子计算？')
    expect(sentBody.need_content).toBe(true)
  })

  it('callDeepSeekSearch 正确支持 count 别名 (maxResults, limit)、默认条数 5 与参数归一化', async () => {
    let sentBody: any = null

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({
          results: [{ title: '测试', url: 'https://ex.com', snippet: 's', summary: 'sum', rerank_score: 1.0 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    // 1. 未指定 count 时默认 5 条（防止大体积打满 32k 沙箱输出）
    const r1 = await callDeepSeekSearch({ query: '测试默认' }, 'sk-test')
    expect(r1.ok).toBe(true)
    expect(sentBody?.count).toBe(5)

    // 2. 传 maxResults: 3 时正确映射为 count: 3
    const r2 = await callDeepSeekSearch({ query: '测试别名', maxResults: 3 } as any, 'sk-test')
    expect(r2.ok).toBe(true)
    expect(sentBody?.count).toBe(3)

    // 3. 传 limit: 4 时正确映射为 count: 4
    await callDeepSeekSearch({ query: '测试 limit', limit: 4 } as any, 'sk-test')
    expect(sentBody?.count).toBe(4)

    // 4. 字符串数字 "2" 解析为 2
    await callDeepSeekSearch({ query: '测试字符串数字', count: '2' as any }, 'sk-test')
    expect(sentBody?.count).toBe(2)

    // 5. query 别名 q / keyword
    await callDeepSeekSearch({ q: '别名查询' } as any, 'sk-test')
    expect(sentBody?.query).toBe('别名查询')
  })

  it('callDeepSeekFetch 在服务端抓取失败（返回 error）时回退安全结构，content 恒为字符串', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          error: 'failed to fetch URL: timeout or anti-scraping block',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await callDeepSeekFetch(
      { url: 'https://zh.wikipedia.org/wiki/Blocked' },
      'sk-test-fetch-key',
    )

    // 关键契约：ok 为 false，content 恒定是 string（空字符串），绝不会是 undefined
    expect(res.ok).toBe(false)
    expect(res.title).toBe('')
    expect(res.content).toBe('')
    expect(typeof res.content).toBe('string')
    expect(res.content.slice(0, 10)).toBe('')
    if (!res.ok) {
      expect(res.error).toContain('failed to fetch URL')
    }
  })

  it('callDeepSeekFetch 正确支持 link 与 href 别名', async () => {
    let capturedBody: any = null
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      return new Response(
        JSON.stringify({ title: 'T', content: 'C' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const r = await callDeepSeekFetch({ link: 'https://example.com/from-link' } as any, 'sk-key')
    expect(r.ok).toBe(true)
    expect(capturedBody.url).toBe('https://example.com/from-link')
  })

  it('callDeepSeekFetch 正确向端点发送 POST 请求并解析 Markdown 正文', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response(
        JSON.stringify({
          title: 'DeepSeek API 文档',
          content: '# DeepSeek API\n\n欢迎查阅官方文档。',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const res = await callDeepSeekFetch(
      { url: 'https://api-docs.deepseek.com' },
      'sk-test-fetch-key',
    )

    expect(res.ok).toBe(true)
    expect('title' in res && 'content' in res).toBe(true)
    if ('title' in res) {
      expect(res.title).toBe('DeepSeek API 文档')
      expect(res.content).toContain('欢迎查阅官方文档')
    }

    expect(capturedUrl).toBe(proxyUrl(DEEPSEEK_FETCH_ENDPOINT))
    expect(capturedInit?.method).toBe('POST')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test-fetch-key')

    const sentBody = JSON.parse(capturedInit?.body as string)
    expect(sentBody.url).toBe('https://api-docs.deepseek.com')
  })
})

const dummyOpts = {
  nodeId: () => 'test-node',
  resolveNode: () => ({ ok: false as const, message: 'none' }),
  resolveDoc: () => ({ ok: false as const, message: 'none' }),
  docOps: {
    read: () => '',
    write: () => ({ ok: true, content: '' }),
    replace: () => ({ ok: true, content: '' }),
    append: () => ({ ok: true, content: '' }),
    annotate: () => ({ ok: true, content: '' }),
  },
  nodeOps: {
    list: () => [],
    read: () => ({ ok: false }),
    create: () => ({ ok: false, content: '' }),
    update: () => ({ ok: false, content: '' }),
    remove: () => ({ ok: false, content: '' }),
    move: () => ({ ok: false, content: '' }),
  },
}

describe('searchForAgent 与 fetchForAgent 封装校验', () => {
  it('searchForAgent 在 query 为空时返回结构化错误且 results 为空数组', async () => {
    const r1 = (await searchForAgent('')) as { ok: boolean; results: unknown[]; error: string }
    expect(r1.ok).toBe(false)
    expect(Array.isArray(r1.results)).toBe(true)
    expect(r1.error).toContain('web.search 需要有效的 query 搜索词')

    const r2 = (await searchForAgent({ query: '' })) as { ok: boolean; results: unknown[]; error: string }
    expect(r2.ok).toBe(false)
    expect(Array.isArray(r2.results)).toBe(true)
    expect(r2.error).toContain('web.search 需要有效的 query 搜索词')
  })

  it('fetchForAgent 在 url 为空时返回结构化错误且 content 为空字符串', async () => {
    const r1 = (await fetchForAgent('')) as { ok: boolean; title: string; content: string; error: string }
    expect(r1.ok).toBe(false)
    expect(r1.title).toBe('')
    expect(r1.content).toBe('')
    expect(r1.error).toContain('fetch 需要有效的 url 参数')

    const r2 = (await fetchForAgent({ url: '' })) as { ok: boolean; title: string; content: string; error: string }
    expect(r2.ok).toBe(false)
    expect(r2.content).toBe('')
    expect(r2.error).toContain('fetch 需要有效的 url 参数')
  })
})

describe('沙箱中的 fetch 与 web.search 工具调用', () => {
  it('沙箱暴露 fetch, web.fetch 与 web.search，且删除 web.read', async () => {
    let fetchCalledWith: unknown = null
    let searchCalledWith: unknown = null

    const mockFetch = vi.fn().mockImplementation(async (arg: unknown) => {
      fetchCalledWith = arg
      return { ok: true, title: '测试页', content: '# 测试正文' }
    })
    const mockSearch = vi.fn().mockImplementation(async (arg: unknown) => {
      searchCalledWith = arg
      return { ok: true, results: [{ title: '搜出结果', url: 'https://ex.com' }] }
    })

    const logs: SandboxCall[] = []
    const { api } = buildApi(
      {
        ...dummyOpts,
        web: {
          fetch: mockFetch,
          search: mockSearch,
        },
      },
      logs,
    )

    // 检查 api 结构
    expect(typeof api.fetch).toBe('function')
    const webApi = api.web as Record<string, unknown>
    expect(typeof webApi.fetch).toBe('function')
    expect(typeof webApi.search).toBe('function')
    expect(webApi.read).toBeUndefined()
    expect(webApi.webFetch).toBeUndefined()

    // 1. 测试 api.fetch 对象形式
    const r1 = await (api.fetch as Function)({ url: 'https://example.com/item' })
    expect(r1).toEqual({ ok: true, title: '测试页', content: '# 测试正文' })
    expect(fetchCalledWith).toEqual({ url: 'https://example.com/item' })

    // 2. 测试 api.fetch 字符串形式
    const r2 = await (api.fetch as Function)('https://example.com/str')
    expect(r2).toEqual({ ok: true, title: '测试页', content: '# 测试正文' })
    expect(fetchCalledWith).toEqual({ url: 'https://example.com/str' })

    // 3. 测试 api.web.fetch
    const r3 = await (webApi.fetch as Function)({ url: 'https://example.com/web' })
    expect(r3).toEqual({ ok: true, title: '测试页', content: '# 测试正文' })

    // 4. 测试 api.web.search 支持对象入参及别名
    const r4 = await (webApi.search as Function)({
      query: '深度学习',
      maxResults: 5,
      need_content: true,
    })
    expect(r4).toEqual({ ok: true, results: [{ title: '搜出结果', url: 'https://ex.com' }] })
    expect(searchCalledWith).toEqual({
      query: '深度学习',
      maxResults: 5,
      need_content: true,
    })

    // 5. 测试 api.web.search 支持 (query, opts) 入参
    await (webApi.search as Function)('机器学习', { count: 3 })
    expect(searchCalledWith).toEqual({
      query: '机器学习',
      count: 3,
    })

    // 6. 测试 api.fetch 别名 link
    await (api.fetch as Function)({ link: 'https://example.com/alias-link' })
    expect(fetchCalledWith).toEqual({
      link: 'https://example.com/alias-link',
      url: 'https://example.com/alias-link',
    })
  })
})
