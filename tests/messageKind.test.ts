/**
 * 注入类别的判据（见 agent/messageKind）。
 *
 * 它决定两件界面上的事：画不画分界条、并进不并进过程组。判错的形态是「对话流里
 * 多出一条挤满提示词的横线」——不报错、不崩，只有用例说得清什么才算对。
 */
import { describe, expect, it } from 'vitest'

import { injectKindOf, isInstructionMark, isPromptInject } from '../src/agent/messageKind'
import type { ConversationMessage } from '../src/agent/types'

const msg = (patch: Partial<ConversationMessage>): ConversationMessage => ({
  id: 'm1',
  role: 'user',
  parts: [{ type: 'text', text: '注入的正文' }],
  ts: 0,
  ...patch,
})

describe('注入类别', () => {
  it('显式字段优先：工作流指令与提示词注入各归各的', () => {
    expect(injectKindOf(msg({ hidden: true, mark: '开讲', inject: 'instruction' }))).toBe('instruction')
    expect(injectKindOf(msg({ hidden: true, mark: '导师人格 · 标准导师', inject: 'prompt' }))).toBe('prompt')
  })

  it('老数据按既有标记反推：人格 / 格式 / 技能库 / 模块都是提示词注入', () => {
    expect(injectKindOf(msg({ hidden: true, mark: '导师人格 · 标准导师', persona: 'standard' }))).toBe('prompt')
    expect(injectKindOf(msg({ hidden: true, mark: '文档格式 · 混合', docFormat: 'mixed' }))).toBe('prompt')
    expect(injectKindOf(msg({ hidden: true, mark: '可用专业技能库', skillsDigest: 'abc' }))).toBe('prompt')
    expect(injectKindOf(msg({ hidden: true, mark: '提示词模块 · 界面操作', promptModule: 'ui' }))).toBe('prompt')
  })

  it('剩下的「hidden + mark」就是工作流指令（与加字段之前同一个口径）', () => {
    expect(injectKindOf(msg({ hidden: true, mark: '开讲' }))).toBe('instruction')
    expect(injectKindOf(msg({ hidden: true, mark: '出卷' }))).toBe('instruction')
  })

  it('普通消息与没有 mark 的隐藏消息都不是注入（不画分界条、也不进过程组）', () => {
    expect(injectKindOf(msg({}))).toBeNull()
    expect(injectKindOf(msg({ role: 'assistant' }))).toBeNull()
    expect(injectKindOf(msg({ hidden: true }))).toBeNull()
  })

  it('两个便捷判据互斥，且只有指令算锚点', () => {
    const instruction = msg({ hidden: true, mark: '开讲', inject: 'instruction' })
    const prompt = msg({ hidden: true, mark: '导师人格 · 标准导师', inject: 'prompt' })
    expect(isInstructionMark(instruction)).toBe(true)
    expect(isPromptInject(instruction)).toBe(false)
    expect(isInstructionMark(prompt)).toBe(false)
    expect(isPromptInject(prompt)).toBe(true)
  })
})
