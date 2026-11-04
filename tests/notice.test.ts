import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTICE_STORE,
  applicableNotices,
  compareVersions,
  fetchNotice,
  firstUnreadIndex,
  meetsMinVersion,
  parseNoticeFeed,
  parseNoticeItem,
  shouldAutoShow,
  unreadNotices,
  type NoticeStore,
  type RemoteNotice,
} from '../src/lib/notice'
import { noticeUrlForRequest } from '../src/lib/noticeConfig'

/* ---------- 造数据的小工具 ---------- */

function itemRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'notice-001',
    title: '软件公告',
    content: '公告正文',
    publishedAt: '2026-10-15',
    minVersion: '1.0.0',
    ...over,
  }
}

function feedRaw(notices: Array<Record<string, unknown>>, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { enabled: true, notices, ...over }
}

function notice(over: Partial<RemoteNotice> = {}): RemoteNotice {
  return { enabled: true, id: 'notice-001', title: '软件公告', content: '正文', ...over }
}

function store(over: Partial<NoticeStore> = {}): NoticeStore {
  return { ...DEFAULT_NOTICE_STORE, ...over }
}

/* ---------- 单条校验 ---------- */

describe('parseNoticeItem', () => {
  it('数组里的条目可以不写 enabled，缺省按启用算', () => {
    const got = parseNoticeItem(itemRaw(), true)
    expect(got).not.toBeNull()
    expect(got?.enabled).toBe(true)
  })

  it('数组里的条目显式写 enabled:false 要认', () => {
    expect(parseNoticeItem(itemRaw({ enabled: false }), true)?.enabled).toBe(false)
  })

  it('旧式单条（defaultEnabled=null）必须写 enabled', () => {
    expect(parseNoticeItem(itemRaw(), null)).toBeNull()
    expect(parseNoticeItem(itemRaw({ enabled: true }), null)).not.toBeNull()
  })

  it('可选字段缺失合法；给了空串按「没写」处理', () => {
    const raw = itemRaw()
    delete raw.publishedAt
    delete raw.minVersion
    const got = parseNoticeItem(raw, true)
    expect(got?.publishedAt).toBeUndefined()
    expect(got?.minVersion).toBeUndefined()
    expect(parseNoticeItem(itemRaw({ publishedAt: '', minVersion: '' }), true)?.publishedAt).toBeUndefined()
  })

  it('id / title / content 缺失、空串或类型不对都判无效', () => {
    expect(parseNoticeItem(itemRaw({ id: '' }), true)).toBeNull()
    expect(parseNoticeItem(itemRaw({ id: 123 }), true)).toBeNull()
    expect(parseNoticeItem(itemRaw({ title: '   ' }), true)).toBeNull()
    expect(parseNoticeItem(itemRaw({ content: null }), true)).toBeNull()
  })

  it('可选字段给了但不是字符串判无效（而不是悄悄忽略）', () => {
    expect(parseNoticeItem(itemRaw({ minVersion: 100 }), true)).toBeNull()
    expect(parseNoticeItem(itemRaw({ publishedAt: { at: 1 } }), true)).toBeNull()
  })

  it('enabled 给了但不是布尔判无效', () => {
    expect(parseNoticeItem(itemRaw({ enabled: 'true' }), true)).toBeNull()
  })

  it('超长正文判无效（公告是「一句话」，不是文档）', () => {
    expect(parseNoticeItem(itemRaw({ content: 'x'.repeat(20_001) }), true)).toBeNull()
    expect(parseNoticeItem(itemRaw({ content: 'x'.repeat(20_000) }), true)).not.toBeNull()
  })

  it('非对象一律判无效：null / 数组 / 字符串 / 数字', () => {
    expect(parseNoticeItem(null, true)).toBeNull()
    expect(parseNoticeItem(undefined, true)).toBeNull()
    expect(parseNoticeItem([], true)).toBeNull()
    expect(parseNoticeItem('notice', true)).toBeNull()
    expect(parseNoticeItem(42, true)).toBeNull()
  })
})

/* ---------- 整份文件校验 ---------- */

describe('parseNoticeFeed', () => {
  it('新式：读出一组公告，顺序保持原样', () => {
    const feed = parseNoticeFeed(feedRaw([itemRaw({ id: 'a' }), itemRaw({ id: 'b' })]))
    expect(feed).not.toBeNull()
    expect(feed?.enabled).toBe(true)
    expect(feed?.notices.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('旧式：顶层直接是一条公告，也读成「只有一条的 notices」', () => {
    const feed = parseNoticeFeed({ enabled: true, ...itemRaw() })
    expect(feed?.notices).toHaveLength(1)
    expect(feed?.notices[0].id).toBe('notice-001')
  })

  it('顶层 enabled 缺失或不是布尔 → 整份无效', () => {
    const raw = feedRaw([itemRaw()])
    delete raw.enabled
    expect(parseNoticeFeed(raw)).toBeNull()
    expect(parseNoticeFeed(feedRaw([itemRaw()], { enabled: 'yes' }))).toBeNull()
  })

  it('顶层不是对象 / 是数组 → 整份无效', () => {
    expect(parseNoticeFeed(null)).toBeNull()
    expect(parseNoticeFeed([])).toBeNull()
    expect(parseNoticeFeed('x')).toBeNull()
  })

  it('数组里个别条目写坏了只丢那一条，其余照常展示', () => {
    const feed = parseNoticeFeed(feedRaw([itemRaw({ id: 'good' }), { id: '' }, itemRaw({ id: 'also-good' })]))
    expect(feed?.notices.map((n) => n.id)).toEqual(['good', 'also-good'])
  })

  it('同一份文件里 id 重复时只留第一条（否则已读记录会被后一条顶掉）', () => {
    const feed = parseNoticeFeed(feedRaw([itemRaw({ id: 'dup' }), itemRaw({ id: 'dup' })]))
    expect(feed?.notices).toHaveLength(1)
  })

  it('公告条数有上限，超了整份无效（页签排不下）', () => {
    const many = Array.from({ length: 21 }, (_, i) => itemRaw({ id: `n${i}` }))
    expect(parseNoticeFeed(feedRaw(many))).toBeNull()
    expect(parseNoticeFeed(feedRaw(many.slice(0, 20)))).not.toBeNull()
  })

  it('空数组是合法的（= 当前没有公告）', () => {
    expect(parseNoticeFeed(feedRaw([]))?.notices).toEqual([])
  })
})

/* ---------- 版本号 ---------- */

describe('compareVersions', () => {
  it('按段做数值比较，不是字符串比较（1.10.0 > 1.9.0）', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
  })

  it('相等返回 0，段数不同按缺位补 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })

  it('认 v 前缀；段里的非数字尾巴按 0 计', () => {
    expect(compareVersions('v0.6.2', '0.6.2')).toBe(0)
    expect(compareVersions('0.7.0-beta.1', '0.6.2')).toBe(1)
  })
})

describe('meetsMinVersion', () => {
  it('没写 minVersion = 对哪个版本都适用', () => {
    expect(meetsMinVersion('0.1.0', undefined)).toBe(true)
    expect(meetsMinVersion('0.1.0', '')).toBe(true)
  })

  it('不低于就算通过（相等也算）；低于就不适用', () => {
    expect(meetsMinVersion('1.0.0', '1.0.0')).toBe(true)
    expect(meetsMinVersion('1.2.0', '1.0.0')).toBe(true)
    expect(meetsMinVersion('0.9.9', '1.0.0')).toBe(false)
  })
})

/* ---------- 筛选 ---------- */

describe('applicableNotices', () => {
  // itemRaw 默认带 minVersion '1.0.0'，所以这几条用例的「当前版本」取 1.0.0
  const CUR = '1.0.0'

  it('整份停用 → 一条都不留', () => {
    const feed = parseNoticeFeed(feedRaw([itemRaw()], { enabled: false }))
    expect(applicableNotices(feed, CUR)).toEqual([])
  })

  it('单条停用 → 只筛掉那一条', () => {
    const feed = parseNoticeFeed(feedRaw([itemRaw({ id: 'on' }), itemRaw({ id: 'off', enabled: false })]))
    expect(applicableNotices(feed, CUR).map((n) => n.id)).toEqual(['on'])
  })

  it('版本够不上的筛掉，够得上的留下', () => {
    const feed = parseNoticeFeed(
      feedRaw([itemRaw({ id: 'old', minVersion: '0.1.0' }), itemRaw({ id: 'future', minVersion: '9.9.9' })]),
    )
    expect(applicableNotices(feed, CUR).map((n) => n.id)).toEqual(['old'])
  })

  it('null 输入给空数组，不抛', () => {
    expect(applicableNotices(null, CUR)).toEqual([])
  })
})

/* ---------- 自动弹出判定 ---------- */

describe('shouldAutoShow', () => {
  const one = [notice()]

  it('默认（没更新过、没关掉）→ 每次都弹', () => {
    expect(shouldAutoShow(one, store({ shownVersion: '0.6.2' }), '0.6.2')).toBe(true)
  })

  it('没有公告 → 不弹', () => {
    expect(shouldAutoShow([], store(), '0.6.2')).toBe(false)
    expect(shouldAutoShow([notice({ enabled: false })], store(), '0.6.2')).toBe(false)
  })

  it('用户关掉自动弹出 → 不弹', () => {
    expect(shouldAutoShow(one, store({ shownVersion: '0.6.2', autoShow: false }), '0.6.2')).toBe(false)
  })

  it('**已读不影响弹不弹**：读过了照样每次打开都弹（红点才是「有没有新东西」的信号）', () => {
    const allRead = store({ shownVersion: '0.6.2', readIds: ['notice-001'] })
    expect(shouldAutoShow(one, allRead, '0.6.2')).toBe(true)
    const two = [notice({ id: 'a' }), notice({ id: 'b' })]
    expect(shouldAutoShow(two, store({ shownVersion: '0.6.2', readIds: ['a', 'b'] }), '0.6.2')).toBe(true)
  })

  it('版本变了（刚更新过）→ 强制弹一次，压过用户的全部选择', () => {
    const optedOut = store({ shownVersion: '0.6.2', autoShow: false, readIds: ['notice-001'] })
    expect(shouldAutoShow(one, optedOut, '0.7.0')).toBe(true)
  })

  it('「更新后强制弹一次」只发生在版本变化那一次，之后照用户的设置走', () => {
    const afterUpdate = store({ shownVersion: '0.6.2', autoShow: false, readIds: ['notice-001'] })
    expect(shouldAutoShow(one, afterUpdate, '0.7.0')).toBe(true)
    const settled = store({ ...afterUpdate, shownVersion: '0.7.0' })
    expect(shouldAutoShow(one, settled, '0.7.0')).toBe(false)
  })

  it('首次安装（存档版本号为空）视为「版本变了」→ 弹一次', () => {
    expect(shouldAutoShow(one, store({ shownVersion: '' }), '0.6.2')).toBe(true)
  })
})

/* ---------- 未读（顶栏红点的依据） ---------- */

describe('unreadNotices', () => {
  const two = [notice({ id: 'a' }), notice({ id: 'b' })]

  it('都没读过 → 全部算未读', () => {
    expect(unreadNotices(two, store()).map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('读过的不算，没读过的还在（顺序不变）', () => {
    expect(unreadNotices(two, store({ readIds: ['a'] })).map((n) => n.id)).toEqual(['b'])
  })

  it('全读过 → 空数组（红点熄灭）', () => {
    expect(unreadNotices(two, store({ readIds: ['a', 'b'] }))).toEqual([])
  })

  it('停用的那条不算未读（它压根不会展示）', () => {
    const list = [notice({ id: 'a' }), notice({ id: 'b', enabled: false })]
    expect(unreadNotices(list, store()).map((n) => n.id)).toEqual(['a'])
  })

  it('与 shouldAutoShow 分工明确：全读过照样弹，但红点熄灭', () => {
    const allRead = store({ shownVersion: '0.6.2', readIds: ['a', 'b'] })
    expect(unreadNotices(two, allRead)).toEqual([])
    expect(shouldAutoShow(two, allRead, '0.6.2')).toBe(true)
  })
})

/* ---------- 打开时落在哪一页 ---------- */

describe('firstUnreadIndex', () => {
  const two = [notice({ id: 'a' }), notice({ id: 'b' })]

  it('落在第一条没读过的上，而不是永远第一页', () => {
    expect(firstUnreadIndex(two, store({ readIds: ['a'] }))).toBe(1)
  })

  it('都没读过 → 第一页', () => {
    expect(firstUnreadIndex(two, store())).toBe(0)
  })

  it('全读过 → 回第一页（不留一个越界下标）', () => {
    expect(firstUnreadIndex(two, store({ readIds: ['a', 'b'] }))).toBe(0)
  })

  it('空列表给 0', () => {
    expect(firstUnreadIndex([], store())).toBe(0)
  })
})

/* ---------- 取公告的失败路径 ---------- */

describe('fetchNotice', () => {
  it('不在 Electron 环境里（Node 探针）给出 no-bridge，而不是抛异常', async () => {
    await expect(fetchNotice()).resolves.toEqual({ ok: false, reason: 'no-bridge' })
  })
})

describe('noticeUrlForRequest', () => {
  it('给地址挂一个每次都不同的查询串，绕开 GitHub Pages / CDN 的缓存', () => {
    const a = noticeUrlForRequest(1)
    const b = noticeUrlForRequest(2)
    expect(a).not.toBe(b)
    expect(a).toContain('_=1')
    expect(a).toContain('notice.json')
  })
})
