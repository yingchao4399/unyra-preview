/**
 * 思考档位的唯一性守卫：全应用的档位只有**全局滑条**一份（ai/settings 的 effort），
 * 工作流不再绑档位（三态配置已删）——档位一翻面，服务商那边可能整体换缓存引擎，
 * 已有上下文的对话下一轮就全 miss（2026-10-25 实测确认的骤降根源）。
 *
 * 所以手动切档要提醒一句。这个模块是提醒两侧的解耦点：useAgent 注册「有没有已带
 * 上下文的对话」的探针（它拥有全部会话数据），LearnWorkspace 注册提醒的出口（toast），
 * ModelPicker 在档位真的变了时问一句、喊一声——不经过任何 prop 钻孔。
 */
import type { ReasoningEffort } from '../ai/types'

type ContextProbe = () => boolean
type EffortNotice = (next: ReasoningEffort, prev: ReasoningEffort) => void

let contextProbe: ContextProbe | null = null
let notice: EffortNotice | null = null

/** useAgent 注册 / 注销（卸载时不留悬空闭包） */
export function setEffortContextProbe(fn: ContextProbe | null): void {
  contextProbe = fn
}

/** LearnWorkspace 注册 / 注销提醒出口（toast 随它的生命周期走） */
export function setEffortNotice(fn: EffortNotice | null): void {
  notice = fn
}

/** ModelPicker 在档位真的变了时调用：存在已带上下文的对话才提醒 */
export function effortSwitched(next: ReasoningEffort, prev: ReasoningEffort): void {
  if (!notice) return
  if (contextProbe && !contextProbe()) return
  notice(next, prev)
}
