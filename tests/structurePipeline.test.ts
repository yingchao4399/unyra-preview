import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocs } from '../src/learn/files'
import { emptyLearnStore } from '../src/learn/store/empty'
import { normalizeStructure } from '../src/learn/structure'
import { entryUuid, outlineUuid } from '../src/learn/nodeKinds'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import type { LearnStore, NoteFile, SuperDocFile } from '../src/learn/types'

/* ---------- 夹具 ---------- */

function fixture(): LearnStore {
  const base = emptyLearnStore()
  const note: NoteFile = { id: 'note-uuid-1', name: '错题本', content: '内容', createdAt: 1, updatedAt: 1 }
  const sdoc: SuperDocFile = { id: 'sdoc-uuid-1', name: '实验', html: '<p>x</p>', createdAt: 1, updatedAt: 1 }
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [
      {
        id: 'r',
        title: '微积分',
        key: 'weijifen',
        description: '',
        docs: { teaching: '# 微积分' },
        notes: [note],
        superdocs: [sdoc],
        outline: { intro: '', children: [{ key: 'jixian', title: '极限', summary: '' }], updatedAt: 1 },
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a',
        title: '极限',
        key: 'jixian',
        description: '',
        docs: { teaching: '正文' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [{ from: 'r', to: 'a', createdAt: 1 }],
  }
}

describe('落盘往返（v2）：坐标表原样进出，笔记与超级文档的 uuid 一起活着回来', () => {
  it('structure.json 只剩坐标与便条：build → parse 往返不丢、不变形', () => {
    const store = fixture()
    const withStructure: LearnStore = {
      ...store,
      structure: {
        g1: {
          version: 2,
          positions: {
            r: { x: 10, y: 20, note: '便条' },
            'note-uuid-1': { x: 30, y: 40 },
          },
          edgeStyle: 'curved',
        },
      },
    }
    const files = buildDocs(withStructure)
    const structureFile = files.get('docs/微积分/structure.json')
    expect(structureFile).toBeTruthy()
    const parsed = JSON.parse(structureFile as string)
    expect(parsed).toMatchObject({
      version: 2,
      positions: {
        r: { x: 10, y: 20, note: '便条' },
        'note-uuid-1': { x: 30, y: 40 },
      },
      edgeStyle: 'curved',
    })

    const back = parseDocs(files, { ...emptyLearnStore() })
    expect(back?.structure?.g1.positions).toEqual({
      r: { x: 10, y: 20, note: '便条' },
      'note-uuid-1': { x: 30, y: 40 },
    })
  })

  it('笔记与超级文档的 uuid 随节点文件往返（改名不改 id）', () => {
    const files = buildDocs(fixture())
    const back = parseDocs(files, { ...emptyLearnStore() })
    const r = back?.nodes.find((n) => n.id === 'r')
    expect(r?.notes[0]).toMatchObject({ id: 'note-uuid-1', name: '错题本' })
    expect(r?.superdocs?.[0]).toMatchObject({ id: 'sdoc-uuid-1', name: '实验' })
  })
})

describe('实体先行（全图化定稿）：卡片的存在性一律由 store 派生', () => {
  it('实体长出来卡就在、连线跟着事实走；不需要任何「意图卡」与对账', () => {
    const store = fixture()
    const view = deriveCanvas(store, 'g1', undefined)
    // 树边 r→a 表达为「根的大纲 → 子文档」；挂件与大纲挂在归属文档下游
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).toContain(`${outlineUuid('r')}>a`)
    expect(keys).toContain(`r>${outlineUuid('r')}`)
    expect(keys).toContain('r>note-uuid-1')
    expect(keys).not.toContain(`${entryUuid('r')}>r`) // 入口不再是独立的卡，也就不在任何线上
  })

  it('v1 存量（卡片表）读盘折成 v2 坐标表：d:/e: 剥前缀、o:/entry: 原样、n:/s: 放弃坐标', () => {
    const v1 = {
      version: 1,
      nodes: [
        { id: 'd:r', kind: 'doc', x: 1, y: 2, ref: 'r' },
        { id: 'o:r', kind: 'outline', x: 3, y: 4, ref: 'r' },
        { id: 'd:a', kind: 'doc', x: 5, y: 6, ref: 'a' },
        { id: 'n:r:错题本', kind: 'note', x: 7, y: 8, ref: 'r:错题本' },
      ],
      edges: [
        { from: 'o:r', to: 'd:a' },
        { from: 'd:r', to: 'n:r:错题本' },
      ],
      hidden: ['d:gone'],
    }
    const map = normalizeStructure(v1)
    expect(map.positions).toEqual({
      r: { x: 1, y: 2 },
      'o:r': { x: 3, y: 4 },
      a: { x: 5, y: 6 },
    })
    // 折算后的坐标接得上派生：同一份 store，卡片一个不落
    const view = deriveCanvas(fixture(), 'g1', map)
    expect(view.cards.map((c) => c.uuid)).toEqual(expect.arrayContaining(['r', 'a', outlineUuid('r'), 'note-uuid-1']))
  })
})
