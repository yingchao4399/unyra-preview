/**
 * 记忆的单元用例（见 learn/memory）。
 *
 * 钉的是这次重构的四条规矩：
 * 1. 两类记忆的**作用域**不同——工作记忆按目标，长期记忆跨目标；
 * 2. 长期记忆**不能随手删**（api 层要 { confirm: true }），工作记忆可以；
 * 3. 一条记忆的身份是 uuid，update 只改给了的字段；
 * 4. 上一版的 `minds`（按目标的 MindEntry）能原样折成工作记忆，一条都不丢。
 */
import { describe, expect, it } from 'vitest'

import { emptyLearnStore } from '../src/learn/store/empty'
import {
  MEMORY_CONTENT_MAX,
  MEMORY_KEYS_MAX,
  MEMORY_TITLE_MAX,
  MEMORY_WORK_MAX,
  clearWorkMemories,
  createMemory,
  createMemoryOps,
  deleteMemory,
  findMemory,
  longMemories,
  memoriesOf,
  normalizeKeys,
  normalizeMemoryStore,
  normalizeTitle,
  updateMemory,
  workMemories,
} from '../src/learn/memory'
import type { LearnStore } from '../src/learn/types'

const store = (): LearnStore => emptyLearnStore()

const withWork = (content = '本轮进度：讲完夹逼定理', goalId = 'g1'): LearnStore =>
  createMemory(store(), { type: 'work', goalId, title: '进度', content })

const withLong = (content = '用户习惯凌晨学习', title = '作息'): LearnStore =>
  createMemory(store(), { type: 'long', title, content })

describe('新建', () => {
  it('工作记忆落在目标下，长期记忆落在 long；字段齐全、时间同一刻', () => {
    const s1 = withWork()
    expect(workMemories(s1, 'g1')).toHaveLength(1)
    expect(workMemories(s1, 'g2')).toHaveLength(0)
    const work = workMemories(s1, 'g1')[0]
    expect(work.type).toBe('work')
    expect(work.uuid).toBeTruthy()
    expect(work.keys).toEqual([])
    expect(work.title).toBe('进度')
    expect(work.createAt).toBe(work.updateAt)

    const s2 = withLong()
    expect(longMemories(s2)).toHaveLength(1)
    expect(longMemories(s2)[0].type).toBe('long')
    expect(s2.memory?.work).toEqual({})
  })

  it('正文为空不写；工作记忆没有目标也不写', () => {
    const base = store()
    expect(createMemory(base, { type: 'work', goalId: 'g1', content: '   ' })).toBe(base)
    expect(createMemory(base, { type: 'work', goalId: null, content: '有内容' })).toBe(base)
  })

  it('标题缺省取正文首行；关键词去空去重并限量', () => {
    const s = createMemory(store(), { type: 'long', content: '第一行标题\n第二行细节' })
    expect(longMemories(s)[0].title).toBe('第一行标题')

    const keys = normalizeKeys('a, b，a、 、c')
    expect(keys).toEqual(['a', 'b', 'c'])
    const many = normalizeKeys(Array.from({ length: MEMORY_KEYS_MAX + 5 }, (_, i) => 'k' + i))
    expect(many).toHaveLength(MEMORY_KEYS_MAX)
  })

  it('正文与标题按上限截断', () => {
    const long = 'x'.repeat(MEMORY_CONTENT_MAX + 100)
    const s = createMemory(store(), { type: 'long', content: long })
    expect(longMemories(s)[0].content).toHaveLength(MEMORY_CONTENT_MAX)
    expect(normalizeTitle('y'.repeat(500), '正文')).toHaveLength(MEMORY_TITLE_MAX)
  })

  it('一个目标的工作记忆超过上限时挤掉最旧的', () => {
    let s = store()
    for (let i = 0; i < MEMORY_WORK_MAX + 3; i++) {
      s = createMemory(s, { type: 'work', goalId: 'g1', content: '第 ' + i + ' 条' })
    }
    expect(workMemories(s, 'g1')).toHaveLength(MEMORY_WORK_MAX)
    // 最新的在最前（withItem 头插）
    expect(workMemories(s, 'g1')[0].content).toBe('第 ' + (MEMORY_WORK_MAX + 2) + ' 条')
  })
})

describe('更新', () => {
  it('只改给了的字段，身份与创建时间不动，更新时间前进', () => {
    const s = withWork()
    const before = workMemories(s, 'g1')[0]
    const after = workMemories(updateMemory(s, before.uuid, { content: '改过的正文' }), 'g1')[0]
    expect(after.uuid).toBe(before.uuid)
    expect(after.createAt).toBe(before.createAt)
    expect(after.content).toBe('改过的正文')
    expect(after.title).toBe('进度')
    expect(after.updateAt).toBeGreaterThanOrEqual(before.updateAt)
  })

  it('改 type 等于搬家：工作 → 长期之后原目标里就没有它了', () => {
    const s = withWork()
    const uuid = workMemories(s, 'g1')[0].uuid
    const moved = updateMemory(s, uuid, { type: 'long' })
    expect(workMemories(moved, 'g1')).toHaveLength(0)
    expect(longMemories(moved).map((m) => m.uuid)).toEqual([uuid])
  })

  it('正文改成空串不接受（保留原样）', () => {
    const s = withWork()
    const uuid = workMemories(s, 'g1')[0].uuid
    expect(updateMemory(s, uuid, { content: '  ' })).toBe(s)
  })

  it('uuid 对不上时原样返回', () => {
    const s = withWork()
    expect(updateMemory(s, 'nope', { content: 'x' })).toBe(s)
  })
})

describe('删除与清空', () => {
  it('按 uuid 删除；清空只清工作记忆', () => {
    let s = withLong()
    s = createMemory(s, { type: 'work', goalId: 'g1', content: '工作一条' })
    const uuid = workMemories(s, 'g1')[0].uuid
    s = deleteMemory(s, uuid)
    expect(workMemories(s, 'g1')).toHaveLength(0)
    expect(longMemories(s)).toHaveLength(1)

    s = createMemory(s, { type: 'work', goalId: 'g1', content: '再一条' })
    s = clearWorkMemories(s, 'g1')
    expect(workMemories(s, 'g1')).toHaveLength(0)
    // 长期记忆不受清空影响
    expect(longMemories(s)).toHaveLength(1)
  })

  it('findMemory 能认出工作记忆属于哪个目标', () => {
    const s = withWork()
    const uuid = workMemories(s, 'g1')[0].uuid
    expect(findMemory(s, uuid)).toMatchObject({ goalId: 'g1' })
    const shared = withLong()
    expect(findMemory(shared, longMemories(shared)[0].uuid)).toMatchObject({ goalId: null })
  })
})

describe('沙箱那一组（api.memory）', () => {
  const opsOf = (initial: LearnStore, goalId = 'g1') => {
    let s = initial
    const ops = createMemoryOps({ getLatest: () => s, set: (n) => { s = n }, goalId: () => goalId })
    return { ops, get: () => s }
  }

  it('list 只回长期 + 当前目标的工作记忆，并按更新时间倒序', () => {
    let s = withLong()
    s = createMemory(s, { type: 'work', goalId: 'g1', content: '本目标' })
    s = createMemory(s, { type: 'work', goalId: 'g2', content: '别的目标' })
    const { ops } = opsOf(s)
    const out = ops.list() as { count: number; long: number; work: number; items: Array<{ title: string }> }
    expect(out.count).toBe(2)
    expect(out.long).toBe(1)
    expect(out.work).toBe(1)
    expect(out.items.map((x) => x.title)).not.toContain('别的目标')
  })

  it('get：别的目标的工作记忆按「没有」处理，长期记忆到处都能读', () => {
    let s = createMemory(store(), { type: 'work', goalId: 'g2', content: '别人的' })
    s = createMemory(s, { type: 'long', content: '共同的', title: '共同' })
    const { ops } = opsOf(s, 'g1')
    const other = workMemories(s, 'g2')[0]
    expect(ops.get(other.uuid)).toMatchObject({ error: expect.stringContaining('没有这条记忆') })
    const shared = longMemories(s)[0]
    expect(ops.get(shared.uuid)).toMatchObject({ uuid: shared.uuid, content: '共同的' })
  })

  it('create 省略 type 按 work；工作记忆记在当前目标下', () => {
    const { ops, get } = opsOf(store(), 'g9')
    expect(ops.create({ title: '进度', content: '讲到第三课' })).toMatchObject({ ok: true, type: 'work' })
    expect(workMemories(get(), 'g9')).toHaveLength(1)
  })

  it('长期记忆不能随手删：没有 confirm 就回一句说明，给了才真删', () => {
    const { ops, get } = opsOf(withLong(), 'g1')
    const uuid = longMemories(get())[0].uuid
    const first = ops.remove(uuid) as { error?: string }
    expect(first.error).toContain('confirm: true')
    expect(longMemories(get())).toHaveLength(1)

    expect(ops.remove(uuid, { confirm: true })).toMatchObject({ ok: true, type: 'long' })
    expect(longMemories(get())).toHaveLength(0)
  })

  it('工作记忆可以直接删（agent 觉得是负担就删）', () => {
    const { ops, get } = opsOf(withWork(), 'g1')
    const uuid = workMemories(get(), 'g1')[0].uuid
    expect(ops.remove(uuid)).toMatchObject({ ok: true, type: 'work' })
    expect(workMemories(get(), 'g1')).toHaveLength(0)
  })

  it('update 改不到别的目标的条目', () => {
    let s = createMemory(store(), { type: 'work', goalId: 'g2', content: '别人的' })
    const other = workMemories(s, 'g2')[0].uuid
    const { ops, get } = opsOf(s, 'g1')
    expect(ops.update(other, { content: '篡改' })).toMatchObject({ error: expect.any(String) })
    expect(workMemories(get(), 'g2')[0].content).toBe('别人的')
  })
})

describe('归一化（读盘 / 迁移）', () => {
  it('上一版的 minds 折成工作记忆：key → 关键词，text → 正文', () => {
    const m = normalizeMemoryStore(
      undefined,
      {
        g1: [
          { id: 'old-1', key: '学习偏好', text: '喜欢先看例子再看定义', createdAt: 1, updatedAt: 2 },
        ],
      },
      new Set(['g1']),
    )
    expect(m.work.g1).toHaveLength(1)
    expect(m.work.g1[0]).toMatchObject({
      uuid: 'old-1',
      type: 'work',
      title: '学习偏好',
      keys: ['学习偏好'],
      content: '喜欢先看例子再看定义',
      createAt: 1,
      updateAt: 2,
    })
    expect(m.long).toEqual([])
  })

  it('目标没了的工作记忆跟着丢（与 resources / methods 同一条纪律）', () => {
    const m = normalizeMemoryStore(
      { long: [], work: { gone: [{ uuid: 'a', content: 'x' }] } },
      undefined,
      new Set(['g1']),
    )
    expect(m.work).toEqual({})
  })

  it('长期记忆跨目标，不按目标过滤；重复 uuid 只留第一条', () => {
    const m = normalizeMemoryStore(
      {
        long: [
          { uuid: 'x', type: 'long', content: '第一条', updateAt: 10 },
          { uuid: 'x', type: 'long', content: '重复', updateAt: 20 },
        ],
      },
      undefined,
      new Set(),
    )
    expect(m.long).toHaveLength(1)
    expect(m.long[0].content).toBe('第一条')
  })

  it('没有正文 / 没有 uuid 的条目丢掉；type 认不出时按所在清单兜底', () => {
    const m = normalizeMemoryStore(
      { long: [{ uuid: 'a', content: '' }, { content: '没 uuid' }, { uuid: 'b', content: '好的' }], work: {} },
      undefined,
      new Set(),
    )
    expect(m.long.map((x) => x.uuid)).toEqual(['b'])
    expect(m.long[0].type).toBe('long')
  })
})

describe('可见范围（列表页用）', () => {
  it('memoriesOf 按类型取：work 必须给目标，long 不需要', () => {
    let s = withLong()
    s = createMemory(s, { type: 'work', goalId: 'g1', content: '本目标' })
    expect(memoriesOf(s, 'long')).toHaveLength(1)
    expect(memoriesOf(s, 'work', 'g1')).toHaveLength(1)
    expect(memoriesOf(s, 'work', null)).toEqual([])
  })
})
