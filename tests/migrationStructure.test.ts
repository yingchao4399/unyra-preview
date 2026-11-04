import { describe, expect, it } from 'vitest'
import { migrateOutlineToStructure, migrateStructureTopology, outlineToStructure, structureTopology } from '../src/lib/migration/outlineStructure'
import type { MigrationContext } from '../src/lib/migration/types'

/** 一份内存里的假用户目录：够 listDir 用（迁移占位只看目录） */
function fakeContext(logs: string[]): MigrationContext {
  const dirs = new Map<string, Array<{ name: string; dir: boolean }>>([
    ['users/u1/docs', [{ name: '高数', dir: true }]],
    ['users/u1/docs/高数', [{ name: '高数.node.json', dir: false }]],
  ])
  return {
    userDir: 'users/u1',
    log: (msg: string) => logs.push(msg),
    storage: {
      listDir: (dir: string) => Promise.resolve(dirs.get(dir) ?? []),
      readJson: () => Promise.resolve(null),
      readText: () => Promise.resolve(null),
      writeJson: () => Promise.resolve(true),
    },
  } as unknown as MigrationContext
}

describe('历史结构迁移（已退役的占位）', () => {
  it('两个迁移什么都不做：v2 的画布由 deriveCanvas 自动铺排、连线由 store 派生', async () => {
    const logs1: string[] = []
    const r1 = await migrateOutlineToStructure(fakeContext(logs1))
    expect(r1).toMatchObject({ ok: true, modifiedFiles: [] })
    expect(logs1.join('\n')).toContain('自动铺排')

    const logs2: string[] = []
    const r2 = await migrateStructureTopology(fakeContext(logs2))
    expect(r2).toMatchObject({ ok: true, modifiedFiles: [] })
    expect(logs2.join('\n')).toContain('派生')
  })

  it('注册条目还在（迁移表要它们在场），说明写明已退役', () => {
    expect(outlineToStructure.id).toBe('m1-outline-to-structure')
    expect(outlineToStructure.changes.join()).toContain('退役')
    expect(structureTopology.id).toBe('m2-structure-topology')
    expect(structureTopology.changes.join()).toContain('退役')
  })
})
