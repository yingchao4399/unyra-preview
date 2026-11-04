/**
 * **真 Worker 协议复现**（此前两次修克隆泄漏都只靠结构断言，没复现——这次直接把
 * sandboxRuntime.js 原文丢进 vm，self 桩的 postMessage 按宿主 worker.postMessage 的
 * 真实语义强制 structuredClone；宿主一侧用真实的 createAgentOps + buildApi 装配）。
 *
 * 编排里任何一环的回执带 Promise / 函数，postMessage 当场炸——测试会点名是哪条 api。
 */
import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { SANDBOX_SOURCE } from '../src/agent/sandboxWorker'
import { buildApi } from '../src/agent/sandbox/api'
import { createAgentOps } from '../src/learn/agentOps'
import { baseStore } from '../scripts/agent-ops/harness'
import type { SandboxCall, SandboxOptions } from '../src/agent/sandbox/types'
import type { LearnStore } from '../src/learn/types'

/** 把沙箱原文装进 vm：self 桩 + 宿主路由。返回跑一段 body 的把手。 */
function bootProtocol(hostCall: (name: string, args: unknown[]) => Promise<unknown>) {
  const calls: Array<{ name: string; args: unknown[] }> = []
  let onDone: ((r: { ok: boolean; value?: unknown; error?: string }) => void) | null = null

  const post = (raw: unknown): void => {
    const m = raw as { kind?: string; id?: number; name?: string; args?: unknown[]; ok?: boolean; value?: unknown; error?: string; message?: string; ms?: number }
    /*
     * 克隆语义只对**宿主发出的**消息成立（worker.postMessage 在宿主这一侧调用）：
     * 宿主只发 reply 与心跳。Worker 自己发出的 call / done 的克隆失败是 Worker 侧的
     * 事（运行时自己有守卫），不在这里模拟。
     */
    let msg = m
    if (m.kind === 'reply') {
      try {
        msg = structuredClone(raw) as typeof msg
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        repliesBroken.push((lastCall ?? '?') + ' :: ' + message)
        queue(() => sandbox.self.onmessage?.({ data: { kind: 'reply', id: m.id, ok: false, message: '［复现］回执不可克隆：' + (lastCall ?? '?') } }))
        return
      }
    }
    if (msg.kind === 'reply') {
      if (process.env.PROTO_DEBUG) console.log('[proto] route-reply', msg.id, msg.ok)
      queue(() => {
        try {
          if (process.env.PROTO_DEBUG) console.log('[proto] deliver-reply', msg.id, msg.ok)
          sandbox.self.onmessage?.({ data: msg })
        } catch (err) {
          console.log('[proto] onmessage-throw', String(err instanceof Error ? err.stack : err).slice(0, 300))
        }
      })
      return
    }
    if (msg.kind === 'call' && typeof msg.id === 'number') {
      const name = msg.name ?? ''
      const args = msg.args ?? []
      if (process.env.PROTO_DEBUG) console.log('[proto] call', name, 'id', msg.id)
      calls.push({ name, args })
      lastCall = name
      void (async () => {
        try {
          const value = await hostCall(name, args)
          if (process.env.PROTO_DEBUG) console.log('[proto] reply', name)
          queue(() => post({ kind: 'reply', id: msg.id, ok: true, value }))
        } catch (err) {
          if (process.env.PROTO_DEBUG) console.log('[proto] host-throw', name, String(err instanceof Error ? err.message : err).slice(0, 120))
          queue(() => post({ kind: 'reply', id: msg.id, ok: false, message: err instanceof Error ? err.message : String(err) }))
        }
      })()
      return
    }
    if (msg.kind === 'done') {
      if (process.env.PROTO_DEBUG) console.log('[proto] done', msg.ok, String(msg.error ?? '').slice(0, 200))
      onDone?.({ ok: !!msg.ok, value: msg.value, error: msg.error })
    }
  }

  const repliesBroken: string[] = []
  let lastCall: string | null = null
  const queue = (fn: () => void): void => {
    void setTimeout(fn, 0)
  }
  const sandbox: { self: { onmessage: ((ev: { data: unknown }) => void) | null; postMessage: (msg: unknown) => void } } = {
    self: { onmessage: null, postMessage: () => {} },
  }
  sandbox.self.postMessage = post

  const ctx = vm.createContext({
    self: sandbox.self,
    setTimeout,
    clearTimeout,
    console,
    structuredClone,
    performance: { now: () => Date.now() },
  })
  vm.runInContext(SANDBOX_SOURCE, ctx)
  expect(typeof sandbox.self.onmessage).toBe('function')
  if (process.env.PROTO_DEBUG) {
    vm.runInContext(
      [
        'const __orig = self.onmessage;',
        'self.onmessage = (ev) => {',
        "  console.log('[proto] vm-onmessage kind=' + ev.data.kind + ' id=' + ev.data.id + ' ok=' + ev.data.ok)",
        '  const r = __orig(ev)',
        "  console.log('[proto] vm-onmessage returned')",
        '  return r',
        '}',
      ].join(String.fromCharCode(10)),
      ctx,
    )
  }
  if (process.env.PROTO_DEBUG) {
    vm.runInContext(
      'self.__mt = false; Promise.resolve().then(() => { self.__mt = true })',
      ctx,
    )
    setTimeout(() => {
      console.log('[proto] vm-microtask-ran:', vm.runInContext('self.__mt', ctx))
    }, 10)
  }

  return {
    calls,
    leaks: repliesBroken,
    run: (body: string): Promise<{ ok: boolean; value?: unknown; error?: string }> =>
      new Promise((resolve) => {
        onDone = resolve
        sandbox.self.onmessage?.({ data: { kind: 'run', body, timeoutMs: 8000 } })
      }),
  }
}

describe('真 Worker 协议：编排回执不得含不可克隆值', () => {
  const store = (): LearnStore => {
    const base = baseStore()
    // baseStore 已带目标与节点；这里只需要「有一个可看的文档」
    return { ...base } as LearnStore
  }

  it('agent 的「查看知识树现状与目标节点内容」编排全程可克隆', async () => {
    let s = store()
    const first = s.nodes[0]
    const ops = createAgentOps({
      getLatest: () => s,
      set: (n: LearnStore) => {
        s = n
      },
      nodeId: () => first.id,
      goalId: () => s.goals[0].id,
    })
    const log: SandboxCall[] = []
    const { api } = buildApi(ops as unknown as SandboxOptions, log)

    const hostCall = async (name: string, args: unknown[]): Promise<unknown> => {
      let target: unknown = api
      for (const seg of name.split('.')) {
        if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
          target = undefined
          break
        }
        target = (target as Record<string, unknown>)[seg]
      }
      const fn = typeof target === 'function' ? (target as (...a: unknown[]) => unknown) : undefined
      if (!fn) throw new Error('宿主侧没有这个 api：' + name)
      return await fn(...args)
    }

    const proto = bootProtocol(hostCall)
    const done = await proto.run(
      '(async (api) => {' +
        ' const listing = await api.node.list();' +
        ' const first = (listing.nodes || [])[0];' +
        ' const n = await api.node.get(first.uuid);' +
        ' const content = await n.content;' +
        ' const help = await n.help();' +
        ' const ports = await n.getPortData();' +
        ' return { listing, node: n, content, help, ports }' +
        '})',
    )
    if (proto.leaks.length) console.log('[leak]', JSON.stringify(proto.leaks, null, 1))
    expect(proto.leaks).toEqual([])
    expect(done.error ?? '').toBe('')
    expect(done.ok).toBe(true)
  })

  it('二分：纯计算 body 立即 done', async () => {
    const proto = bootProtocol(async () => null)
    const done = await proto.run('(async (api) => { return 41 + 1 })')
    expect(done.ok).toBe(true)
  })

  it('二分：一次 api 调用后能继续（await 唤醒）', async () => {
    let s = store()
    const first = s.nodes[0]
    const ops = createAgentOps({
      getLatest: () => s,
      set: (n: LearnStore) => {
        s = n
      },
      nodeId: () => first.id,
      goalId: () => s.goals[0].id,
    })
    const log: SandboxCall[] = []
    const { api } = buildApi(ops as unknown as SandboxOptions, log)
    const proto = bootProtocol(async (name, args) => {
      let target: unknown = api
      for (const seg of name.split('.')) {
        if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
          target = undefined
          break
        }
        target = (target as Record<string, unknown>)[seg]
      }
      const fn = typeof target === 'function' ? (target as (...a: unknown[]) => unknown) : undefined
      if (!fn) throw new Error('宿主侧没有这个 api：' + name)
      return await fn(...args)
    })
    const done = await proto.run('(async (api) => { const x = await api.node.list(); return x.nodes.length })')
    expect(done.ok).toBe(true)
    expect(done.value).toBeGreaterThan(0)
  })
})
