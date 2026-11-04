/**
 * 回执折节点对象：节点对象（__node 门面）的 content 是吐 Promise 的 getter、方法都是
 * 函数——结构化克隆必炸（真沙箱），进 safeJson 也只会变成 {}（进程内）。返回值里遇到
 * 就折成一份**纯数据快照**（uuid/kind/title/relations）：回执照样可读，模型要再用这个
 * 节点就按 uuid 重新 get。
 *
 * 两份运行时各自自包含：真沙箱的副本在 sandboxRuntime.js（结构守卫
 * tests/sandboxRuntimeFacade.test.ts 钉住两份都在），本文件服务进程内直调。
 */
export function foldNodes(v: unknown, seen: Set<unknown> = new Set()): unknown {
  if (!v || typeof v !== 'object') return v
  // __node 判定放在 seen 之前：节点对象折成快照就返回（终结点），不进路径也不该挡后面再次出现
  if ((v as { __node?: unknown }).__node === true) {
    const n = v as { uuid?: unknown; kind?: unknown; title?: unknown; relations?: unknown }
    return { __node: true, uuid: n.uuid, kind: n.kind, title: n.title, relations: n.relations }
  }
  if (seen.has(v)) return '［循环引用］'
  seen.add(v)
  // seen 记的是「当前路径」而不是「见过的全部」：同一对象出现两次是重复，不是循环
  if (Array.isArray(v)) {
    const out = v.map((x) => foldNodes(x, seen))
    seen.delete(v)
    return out
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = foldNodes((v as Record<string, unknown>)[k], seen)
  }
  seen.delete(v)
  return out
}
