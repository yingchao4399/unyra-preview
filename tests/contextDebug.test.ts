/**
 * 上下文对比调试器（agent/contextDebug）的行为钉子：
 * 滚动只留两份、命中骤降才定格；断点分析认得五种形态（改写 / 裁剪 / 只增 / 工具 / 系统），
 * 每条消息带 原文 / 职责 / 角色。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/ai/types'
import {
  captureDrop,
  clearDropReports,
  dropBundleOf,
  dutyOf,
  lastDropReport,
  noteRequest,
} from '../src/agent/contextDebug'

const msg = (role: ChatMessage['role'], content: string): ChatMessage =>
  ({ role, content }) as ChatMessage

const snap = (messages: ChatMessage[]) => ({
  system: 'S',
  messages: [msg('system', 'S'), ...messages],
  tools: [{ name: 'execute' }],
})

beforeEach(() => clearDropReports())

describe('滚动与定格', () => {
  it('没有请求时定格返回 false；三连记后定格用的是最近两份', () => {
    expect(captureDrop('c1', 100, 10)).toBe(false)
    noteRequest('c1', snap([msg('user', '第二轮')]))
    noteRequest('c1', snap([msg('user', '第二轮'), msg('assistant', '答')]))
    expect(captureDrop('c1', 100, 10)).toBe(true)
    const report = lastDropReport()!
    // 最近两份（第二、三份）逐字节只增 → 服务商侧
    expect(report.kind).toBe('append')
    expect(report.prevRead).toBe(100)
    expect(report.currRead).toBe(10)
  })

  it('清空之后窗口归零', () => {
    noteRequest('c1', snap([msg('user', '你好')]))
    noteRequest('c1', snap([msg('user', '你好')]))
    expect(captureDrop('c1', 50, 5)).toBe(true)
    clearDropReports()
    expect(lastDropReport()).toBeNull()
  })

  it('下载包：报告结论 + 前后两份实发上下文的原样字节', () => {
    noteRequest('c1', snap([msg('user', '你好')]))
    noteRequest('c1', snap([msg('user', '你好'), msg('assistant', '答')]))
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const bundle = dropBundleOf(lastDropReport()!)
    expect(bundle.type).toBe('context-drop')
    expect(bundle.kind).toBe('append')
    expect((bundle.prev as { messages: unknown[] }).messages).toHaveLength(2)
    expect((bundle.curr as { messages: unknown[] }).messages).toHaveLength(3)
  })

  it('快照定格即深拷贝：轮内继续 push 不污染上一份', () => {
    const arr = [msg('system', 'S'), msg('user', '你好')]
    noteRequest('c1', { system: 'S', messages: arr, tools: [] })
    // 模拟 runtime 逐跳 push：同一份活数组在第二跳又长了一截
    arr.push(msg('assistant', '答'))
    noteRequest('c1', { system: 'S', messages: arr, tools: [] })
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.prev.messages).toHaveLength(2)
    expect(report.curr.messages).toHaveLength(3)
  })

  it('请求身份翻面写进报告：模型/档位变了 identity 点名，没变不写', () => {
    const messages = [msg('system', 'S'), msg('user', '你好')]
    noteRequest('c1', { system: 'S', messages, tools: [], model: 'deepseek-reasoner', reasoningEffort: 'low' })
    noteRequest('c1', {
      system: 'S',
      messages: [...messages, msg('assistant', '答')],
      tools: [],
      model: 'deepseek-reasoner',
      reasoningEffort: 'none',
    })
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.identity).toContain('档位 low → none')
    expect(report.identity).not.toContain('模型')
    // 身份没变时：不写 identity
    noteRequest('c1', { system: 'S', messages, tools: [], model: 'm', reasoningEffort: 'low' })
    noteRequest('c1', {
      system: 'S',
      messages: [...messages, msg('assistant', '答2')],
      tools: [],
      model: 'm',
      reasoningEffort: 'low',
    })
    captureDrop('c1', 900, 300)
    expect(lastDropReport()!.identity).toBeUndefined()
  })
})

describe('断点分析：五种形态', () => {
  it('中途改写：断在那一条，逐条摆出新旧两份', () => {
    noteRequest('c1', snap([msg('user', '你好'), msg('assistant', '答'), msg('user', '下一问')]))
    noteRequest('c1', snap([msg('user', '你好（改过）'), msg('assistant', '答'), msg('user', '下一问')]))
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.kind).toBe('rewrite')
    expect(report.headline).toContain('第 1 条')
    expect(report.breakAt).toBe(0)
    const changed = report.messages.find((m) => m.status === 'changed')!
    expect(changed.index).toBe(1)
    expect(changed.role).toBe('user')
    expect(changed.duty).toBe('用户消息')
    expect(changed.text).toContain('你好（改过）')
    expect(changed.oldText).toContain('你好')
    expect(changed.firstDiff).toBeTruthy()
  })

  it('裁剪形状：开头被裁的条目标「被裁掉」，对齐段一致，尾巴是新增', () => {
    noteRequest('c1', snap([msg('user', '旧一'), msg('assistant', '旧二'), msg('user', '旧三'), msg('assistant', '旧四')]))
    noteRequest('c1', snap([msg('user', '旧三'), msg('assistant', '旧四'), msg('user', '新五')]))
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.kind).toBe('trim')
    expect(report.droppedCount).toBe(2)
    // 被裁掉的两条给的是「上一次的下标」（1、2）
    expect(report.messages.filter((m) => m.status === 'removed').length).toBe(2)
    expect(report.messages.some((m) => m.status === 'same' && m.text.includes('旧三'))).toBe(true)
    expect(report.messages.some((m) => m.status === 'added' && m.text.includes('新五'))).toBe(true)
    expect(report.headline).toContain('2 条被裁掉')
  })

  it('逐字节只增：断开在服务商侧，不是分叉', () => {
    noteRequest('c1', snap([msg('user', '你好')]))
    noteRequest('c1', snap([msg('user', '你好'), msg('assistant', '答')]))
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.kind).toBe('append')
    expect(report.headline).toContain('服务商侧')
    expect(report.breakAt).toBeNull()
  })

  it('工具声明变了：断点不在消息上', () => {
    noteRequest('c1', { system: 'S', messages: [msg('system', 'S'), msg('user', '你好')], tools: [{ name: 'execute' }] })
    noteRequest('c1', { system: 'S', messages: [msg('system', 'S'), msg('user', '你好')], tools: [{ name: 'files' }] })
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.kind).toBe('tools')
    expect(report.breakAt).toBeNull()
    expect(report.headline).toContain('工具声明')
  })

  it('系统提示词变了：断在第 0 条', () => {
    noteRequest('c1', { system: 'S1', messages: [msg('system', 'S1'), msg('user', '你好')], tools: [] })
    noteRequest('c1', { system: 'S2', messages: [msg('system', 'S2'), msg('user', '你好')], tools: [] })
    expect(captureDrop('c1', 900, 300)).toBe(true)
    const report = lastDropReport()!
    expect(report.kind).toBe('system')
    expect(report.breakAt).toBe(0)
    expect(report.messages[0].status).toBe('changed')
  })
})

describe('消息职责：从 wire 形状推', () => {
  it('认得出几类显眼标记，认不出按角色落回', () => {
    expect(dutyOf(msg('system', 'S'))).toBe('系统提示词')
    expect(dutyOf(msg('user', '## 使用「开讲」工作流。\n- 目标节点: x'))).toBe('工作流指令')
    expect(dutyOf(msg('user', '【先前对话的压缩摘要】\n……'))).toBe('上下文压缩摘要')
    expect(
      dutyOf({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: '1', type: 'function', function: { name: 'files.write', arguments: '{}' } }],
      } as ChatMessage),
    ).toBe('助手 · 发起工具调用（files.write）')
    expect(dutyOf(msg('tool', '回执'))).toBe('工具回执')
    expect(dutyOf(msg('assistant', '【提示词模块 · 超级文档】规范全文'))).toBe('助手 · 提示词模块注入')
    expect(dutyOf({ role: 'user', content: [{ type: 'text', text: '看了这张图' }] } as ChatMessage)).toBe('工具图片')
    expect(dutyOf(msg('user', '帮我讲讲'))).toBe('用户消息')
    expect(dutyOf(msg('assistant', '好的'))).toBe('助手回复')
  })
})
