import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { demandDrivenPdfWorker } from '../src/learn/pdfWorkerSource'
import { transformSync } from 'esbuild'

const upstream = readFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'utf8')
const patched = demandDrivenPdfWorker(upstream)

// Execute the actual patched traversal against controlled PDF dictionaries. This
// catches page-number regressions without rasterizing images in the unit runner.
class Ref {
  readonly num: number
  constructor(num: number) { this.num = num }
}
class RefMap extends Map { put(key: unknown, value: unknown = true) { this.set(key, value) } }
class Dict {
  private values: Record<string, unknown>
  constructor(values: Record<string, unknown>) { this.values = values }
  getRaw(key: string) { return this.values[key] }
  has(key: string) { return key in this.values }
}
function catalog(root: Dict, objects: Map<Ref, Dict>) {
  const start = patched.indexOf('async getPageDict(e){')
  const end = patched.indexOf('async getAllPageDicts(', start)
  const method = patched.slice(start, end).replace('this.#zt', 'this.catalog')
  const Catalog = new Function('Ref', 'RefSet', 'Dict', 'isName', 'FormatError', `return class {${method}}`)(
    Ref, RefMap, Dict, (value: unknown, name: string) => value === name, Error)
  const instance = new Catalog()
  const fetched: number[] = []
  Object.assign(instance, { toplevelPagesDict: root, catalog: new Dict({ Pages: new Ref(0) }),
    xref: { fetchAsync: async (ref: Ref) => { fetched.push(ref.num); return objects.get(ref) } },
    pageKidsCountCache: new RefMap(), pageIndexCache: new RefMap(), pageDictCache: new RefMap() })
  return { getPage: (index: number): Promise<[Dict, Ref | null]> => instance.getPageDict(index), fetched }
}

describe('pinned PDF.js worker compatibility', () => {
  it('accepts the installed upstream worker and produces valid module syntax', () => {
    expect(() => transformSync(patched, { loader: 'js', format: 'esm' })).not.toThrow()
    expect(() => demandDrivenPdfWorker('unexpected upstream version')).toThrow('版本不兼容')
  }, 15000)
  it('loads only the requested first leaf, then finds distant flat pages', async () => {
    const refs = Array.from({ length: 300 }, (_, i) => new Ref(i + 1))
    const objects = new Map(refs.map(ref => [ref, new Dict({ Type: 'Page' })]))
    const reader = catalog(new Dict({ Count: refs.length, Kids: refs }), objects)
    expect((await reader.getPage(0))[1]).toBe(refs[0])
    expect(reader.fetched).toEqual([1])
    expect((await reader.getPage(249))[1]).toBe(refs[249])
  })
  it('counts mixed subtrees even when root Count equals Kids length', async () => {
    const empty = new Ref(1), branch = new Ref(2), leaf = new Ref(3), a = new Ref(4), b = new Ref(5)
    const objects = new Map([
      [empty, new Dict({ Type: 'Pages', Count: 0, Kids: [] })],
      [branch, new Dict({ Type: 'Pages', Count: 2, Kids: [a, b] })],
      [leaf, new Dict({ Type: 'Page' })], [a, new Dict({ Type: 'Page' })], [b, new Dict({ Type: 'Page' })],
    ])
    const reader = catalog(new Dict({ Count: 3, Kids: [empty, branch, leaf] }), objects)
    expect((await reader.getPage(1))[1]).toBe(b)
    expect((await reader.getPage(2))[1]).toBe(leaf)
  })
  it('retains fallback traversal for absent counts and rejects circular trees', async () => {
    const branch = new Ref(1), a = new Ref(2), b = new Ref(3)
    const objects = new Map([
      [branch, new Dict({ Type: 'Pages', Kids: [a, b] })],
      [a, new Dict({ Type: 'Page' })], [b, new Dict({ Type: 'Page' })],
    ])
    expect((await catalog(new Dict({ Kids: [branch] }), objects).getPage(1))[1]).toBe(b)
    objects.set(branch, new Dict({ Kids: [branch] }))
    await expect(catalog(new Dict({ Kids: [branch] }), objects).getPage(0)).rejects.toThrow('circular')
  })
})
