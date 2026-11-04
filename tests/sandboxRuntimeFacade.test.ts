/**
 * 真沙箱门面（sandboxRuntime.js，纯 JS 字符串塞给 Worker）与进程内门面
 * （sandbox/nodeObject 的 attachNodeFacade）是**同一份行为的两份手写实现**，
 * 没有共享代码可依赖——这里用结构守卫钉住两条已经踩过的坑：
 * 1. node.get 包装器不许调用替换后的自己（曾真炸过：真沙箱里 node.get 栈溢出）；
 * 2. 两份门面的成员清单必须一致（一边加了成员另一边忘了，沙箱里就是「没有这个成员」）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NODE_MEMBERS_ORDER } from '../src/learn/nodeKinds'

const js = readFileSync(new URL('../src/agent/sandboxRuntime.js', import.meta.url), 'utf-8')
const ts = readFileSync(new URL('../src/agent/sandbox/nodeObject.ts', import.meta.url), 'utf-8')

describe('真沙箱节点门面的结构守卫', () => {
  it('node.get 包装器调用的必须是替换前摘下来的 rawGet（channel.get 会递归到自己）', () => {
    expect(js).toMatch(/const rawGet = channel\.get\.bind\(channel\)/)
    expect(js).not.toMatch(/channel\.get\(/)
  })

  it('api 调用的参数回传必须先折（节点对象→uuid、Promise/函数→人话占位）', () => {
    // toWire 只覆盖节点门面方法的参数；普通 api 调用的 args 在 postMessage 前没人折的话，
    // 一个没 await 的 Promise 就能让整批调用报废（真事）
    expect(js).toMatch(/function foldArg\(/)
    expect(js).toMatch(/args: foldArg\(args, new Set\(\)\)/)
    expect(js).toMatch(/__node === true\) return v\.uuid/)
  })

  it('两份门面的成员清单一致（invoke 分发 / facade 方法表 / NODE_MEMBERS_ORDER）', () => {
    const members = NODE_MEMBERS_ORDER as readonly string[]
    // 进程内 facade 的方法表（attachNodeFacade 里那个字面量数组）
    const tsList = /\[('(?:editContent|help|connect|disconnect|getPortData)'(?:\s*,\s*'(?:editContent|help|connect|disconnect|getPortData)')*)\] as const/.exec(ts)
    expect(tsList).toBeTruthy()
    expect(tsList![1].split(',').map((x) => x.trim().replaceAll("'", ''))).toEqual([...members].filter((m) => m !== 'content'))
    // 真沙箱 facade 的方法表（wrapManifest 里那个字面量数组）
    const jsList = /\[('(?:editContent|help|connect|disconnect|getPortData)'(?:\s*,\s*'(?:editContent|help|connect|disconnect|getPortData)')*)\]/.exec(js)
    expect(jsList).toBeTruthy()
    expect(jsList![1].split(',').map((x) => x.trim().replaceAll("'", ''))).toEqual([...members].filter((m) => m !== 'content'))
  })
})
