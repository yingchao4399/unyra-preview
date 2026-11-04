// @vitest-environment happy-dom
/**
 * 公告配图的渲染链路：公告正文是**从网上取回来的**，渲染前必须过 renderNote（marked + DOMPurify）。
 * 这一组钉住「https 图片能活下来、危险属性被砍掉」。
 *
 * ⚠️ 这里**故意不测**「`<script>` 被剥掉」「`javascript:` 被剥掉」这两条：
 * happy-dom 与 DOMPurify 的配合在这个场景下不可靠——连 DOMPurify 的**默认配置**
 * （不带本项目的 SANITIZE_CONFIG）都会把 `正文<script>…</script>` 原样留下，
 * 而单独的 `<script>…</script>` 又能正常剥掉；happy-dom 自己的 DOM 解析是对的
 * （能数出 script 元素），所以问题出在两者交界处，不在我们的配置上。
 *
 * 也就是说：**不是**本项目的消毒有问题（真实运行环境是 Chromium，那条路径是
 * DOMPurify 最核心、最常被验证的一条），而是这个测试环境给不出可信的结论。
 * 与其写一条会因为测试环境缺陷而变绿/变红的断言，不如把它标出来。
 * 消毒本身由 DOMPurify 保证，调用点统一在 lib/markdown 的 renderNote。
 */
import { describe, expect, it } from 'vitest'
import { renderNote } from '../src/lib/markdown'
import { applicableNotices, parseNoticeFeed } from '../src/lib/notice'

const BANNER = 'https://maplexrain.github.io/unyra-notice/images/banner.png'

describe('公告配图的渲染', () => {
  it('https 图片能活过消毒，src 与 alt 原样保留', () => {
    const html = renderNote(`看图：\n\n![公告配图](${BANNER})`)
    expect(html).toContain('<img')
    expect(html).toContain(`src="${BANNER}"`)
    expect(html).toContain('alt="公告配图"')
  })

  it('图片外面套链接也照样能活（`[![图](x)](y)` 的写法）', () => {
    const html = renderNote(`[![点我](${BANNER})](https://github.com/maplexrain/unyra)`)
    expect(html).toContain('<img')
    expect(html).toContain(BANNER)
    expect(html).toContain('https://github.com/maplexrain/unyra')
  })

  it('图片上的事件属性被砍掉（onerror 这类不许留）', () => {
    const html = renderNote(`<img src="${BANNER}" onerror="alert(1)">`)
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('alert(1)')
  })

  it('正文里的相对路径图片会原样留着——拦住它的是本地编辑器的校验，不是渲染层', () => {
    // 相对路径在客户端会被按 file:// 解析，必然裂图。
    // 真正拦住它的是 tools/notice-studio 的 validate()（发布前就报错）。
    expect(renderNote('![x](images/foo.png)')).toContain('<img')
  })
})

describe('配图与多条公告合在一起', () => {
  it('带图的那条公告能被正常读出、筛出来，并渲染出图片', () => {
    const feed = parseNoticeFeed({
      enabled: true,
      notices: [
        { id: 'a', title: '无图', content: '正文' },
        { id: 'b', title: '有图', content: `看图\n\n![配图](${BANNER})` },
      ],
    })
    expect(feed).not.toBeNull()
    const list = applicableNotices(feed, '0.6.2')
    expect(list.map((n) => n.id)).toEqual(['a', 'b'])
    expect(renderNote(list[1].content)).toContain(BANNER)
  })
})
