/**
 * execute 编排代码的形状兜底（agent/sandbox/body.ts）与回执折节点对象
 * （agent/sandbox/execute.ts）的行为钉子：
 * - 模型直接写一段语句（没有函数头）不再被形状拒绝——包一层匿名 async 箭头照跑；
 * - 函数形状照旧走原有归一化，一字不动；
 * - 节点对象（__node 门面）进返回值折成纯数据快照，不再让整批回执报废。
 */
import { describe, expect, it } from 'vitest'
import { compileBody } from '../src/agent/sandbox/body'
import { foldNodes } from '../src/agent/sandbox/fold'

/** 与真沙箱同一套求值语义：求值出函数就带着 api 调它 */
async function runBody(body: string): Promise<unknown> {
  const evaluated = new Function('api', 'return (' + body + ')')()
  return typeof evaluated === 'function' ? await evaluated(undefined) : await evaluated
}

describe('语句体兜底', () => {
  it('直接写一段语句（自己 return）：编得过、跑得出结果', async () => {
    const compiled = compileBody('const r = 6 * 7\nreturn r')
    expect(compiled).toMatchObject({ ok: true })
    if (!compiled.ok) return
    expect(await runBody(compiled.body)).toBe(42)
  })

  it('语句体里的 await 也能用（外层补了 async）', async () => {
    const compiled = compileBody('const v = await Promise.resolve(7)\nreturn v')
    expect(compiled).toMatchObject({ ok: true })
    if (!compiled.ok) return
    expect(await runBody(compiled.body)).toBe(7)
  })

  it('函数形状照旧：((api)=>{…}) 不被二次包裹', () => {
    const compiled = compileBody('((api)=>{ return 1 })')
    expect(compiled).toMatchObject({ ok: true })
    if (!compiled.ok) return
    expect(compiled.body).not.toContain('(async (api) => {')
  })

  it('真语法错照旧拒绝（不是所有形状都该兜）', () => {
    expect(compileBody('const r = (').ok).toBe(false)
  })
})

describe('回执折节点对象', () => {
  it('节点对象折成 uuid/kind/title/relations 的纯数据快照（getter/方法不外泄）', () => {
    const node = {
      uuid: 'doc-1',
      kind: 'doc',
      title: '极限',
      relations: [{ id: 'o:doc-1', type: 'down' }],
      __node: true,
    }
    Object.defineProperty(node, 'content', { get: () => Promise.resolve({}), enumerable: true })
    const folded = foldNodes({ note: 'x', n: node, list: [node] }) as Record<string, unknown>
    const foldedNode = folded.n as Record<string, unknown>
    expect(foldedNode).toEqual({
      __node: true,
      uuid: 'doc-1',
      kind: 'doc',
      title: '极限',
      relations: [{ id: 'o:doc-1', type: 'down' }],
    })
    expect('content' in foldedNode).toBe(false)
    // 列表里的同一对象也折了；普通数据原样保留
    expect((folded.list as unknown[])[0]).toEqual(foldedNode)
    expect(folded.note).toBe('x')
  })

  it('循环引用换成一句说明，不再炸克隆', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(foldNodes(a)).toEqual({ name: 'a', self: '［循环引用］' })
  })
})
