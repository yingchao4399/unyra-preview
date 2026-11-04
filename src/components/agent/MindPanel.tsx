/**
 * 记忆管理页（文档区页签 kind 'mind'，入口在 agent 栏输入框的「+」菜单）。
 *
 * 页面内容与超级导师设置里的「记忆管理」分页**是同一份实现**（components/agent/MemoryManager）：
 * 数据模型只有一套（learn/memory），界面也只有一套——两个入口只是外壳不同。
 *
 * 页签按目标一枚（tabKey = 'm:' + goalId），带着 goalId 来：打开时默认筛到
 * 这个目标的工作记忆；长期记忆跨目标，这一页同样看得到、也能改。
 *
 * 记忆的数据本身**从不自动进上下文**（那是前缀缓存的宪法，见 learn/memory 文件头）：
 * 导师要用得自己 memory.list()/get() 来取，所以这里写下的内容不会立刻改变他的行为，
 * 而是等他下一次主动翻记忆时生效。
 */
import MemoryManager from './MemoryManager'
import type { LearningGoal, MemoryStore } from '../../learn/types'
import type { MemoryInput, MemoryPatch } from '../../learn/memory'

interface Props {
  /** 页签携带的目标 id；null = 还没有活动目标（整页只给一句说明） */
  goalId: string | null
  goals: LearningGoal[]
  memory: MemoryStore
  onCreate: (input: MemoryInput) => void
  onUpdate: (uuid: string, patch: MemoryPatch) => void
  onDelete: (uuid: string) => void
  onClearWork: (goalId: string) => void
  onToast: (msg: string) => void
}

export default function MindPanel({ goalId, goals, memory, onCreate, onUpdate, onDelete, onClearWork, onToast }: Props) {
  return (
    <MemoryManager
      variant="page"
      goals={goals}
      memory={memory}
      activeGoalId={goalId}
      initialFilter={goalId ? 'work' : 'all'}
      initialGoalId={goalId}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onClearWork={onClearWork}
      onToast={onToast}
    />
  )
}
