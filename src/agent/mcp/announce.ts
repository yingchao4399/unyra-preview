/**
 * 这个文件负责什么：MCP 的**感知注入**——把「用户配置了哪些外部服务、各有哪些工具」
 * 作为一条隐藏消息进上下文，随配置变更重注入（与技能发现层 agent/skill/registry 同一套机制）。
 *
 * 为什么要有它：主观能动性的前提是**知情**。mcp.list() 虽然快（读设置缓存、不发请求），
 * 但模型不知道「存在哪些服务」就不会想到去调——任务涉及外部能力时它只会说「我做不到」。
 * 把清单摆到眼前，配合 executeGuide 的「说做不到之前先三查」纪律，MCP 才真的会被用起来。
 *
 * 为什么走隐藏消息而不是改系统提示词：技能清单同一条纪律——动态内容进消息流，
 * digest 变了才重注入，系统提示词保持逐字节稳定（前缀缓存命中的前提，见 agent/persona 顶部）。
 */

import type { ConversationMessage } from '../types'
import type { McpSettings } from './types'

/**
 * 已启用服务的感知指纹：id + 缓存的工具名集合。
 * 服务增删、启停、工具清单变化都会改变指纹 → 触发重注入。
 * 没有已启用服务时返回空串（此时不注入：mcp 组本身也不会挂进沙箱）。
 */
export function getMcpDigest(settings: McpSettings | null | undefined): string {
  if (!settings || !settings.enabled) return ''
  const enabled = (Array.isArray(settings.servers) ? settings.servers : []).filter((s) => s.enabled)
  if (!enabled.length) return ''
  return enabled
    .map((s) => `${s.id}@${(s.tools ?? []).map((t) => t.name).sort().join(',')}`)
    .sort()
    .join(';')
}

/** 感知层的正文：一段紧凑的「有哪些服务、各有哪些工具」清单 */
export function formatMcpDiscoveryPrompt(settings: McpSettings | null | undefined): string {
  const enabled = (settings && settings.enabled ? settings.servers ?? [] : []).filter((s) => s.enabled)
  if (!enabled.length) return ''
  const lines = enabled.map((s) => {
    const desc = s.description ? `（${s.description}）` : ''
    const tools = s.tools ?? []
    const toolNames = tools.length ? tools.map((t) => t.name).join('、') : '工具清单未知——先 api.mcp.discover(服务) 现场探测'
    return `- [${s.id}] ${s.name}${desc}：${toolNames}`
  })
  return [
    '### 可用的外部 MCP 服务：',
    '- 这些是用户接进来的外部能力，与你的内置 api 并列；调用走 `api.mcp.call(服务, 工具, 参数)`，',
    '  清单细节用 `api.mcp.list()`（快，读缓存）与 `api.mcp.discover(服务)`（现场探测最新工具）查询。',
    '- 任务涉及外部系统、实时数据或你内置能力之外的动作时，先来这里找找有没有现成的工具。',
    '',
    '**当前已接入的服务**：',
    ...lines,
  ].join('\n')
}

/** 这一段对话里，MCP 感知是否需要注入或更新（判据与技能指纹一致：最后一条带指纹的消息比对） */
export function needsMcpAnnounce(messages: ConversationMessage[], digest: string): boolean {
  if (!digest) return false
  const activeMsgs = messages.filter((m) => !m.retired && m.mcpDigest !== undefined)
  if (!activeMsgs.length) return true
  return activeMsgs[activeMsgs.length - 1].mcpDigest !== digest
}

/** 构造 MCP 感知注入消息（隐藏 assistant 消息，进过程组不画分界条——与技能注入同款） */
export function mcpAnnounceMessage(
  settings: McpSettings | null | undefined,
  at: number,
  uuid: string,
  digest: string,
  isUpdate = false,
): ConversationMessage {
  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: formatMcpDiscoveryPrompt(settings) }],
    ts: at,
    hidden: true,
    mark: isUpdate ? '可用 MCP 服务已更新' : '可用 MCP 服务',
    mcpDigest: digest,
    inject: 'prompt',
  }
}
