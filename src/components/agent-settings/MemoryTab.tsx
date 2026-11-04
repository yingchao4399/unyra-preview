/**
 * 超级导师设置 →「记忆管理」分页。
 *
 * 界面本身在 components/agent/MemoryManager：文档区那枚记忆页签用的是同一份实现
 * （从前这里是两份，一份按目标平铺、一份只看单个目标，同一件事要看两个地方）。
 * 这里只负责「设置页里的分页长什么样」——外面套 pane 的滚动容器，外壳交给管理器自己。
 */
import MemoryManager from '../agent/MemoryManager'
import type { LearningGoal, MemoryStore } from '../../learn/types'
import type { MemoryInput, MemoryPatch } from '../../learn/memory'

interface MemoryTabProps {
  goals: LearningGoal[]
  memory: MemoryStore
  /** 当前目标：新建工作记忆时的默认归属 */
  activeGoalId: string | null
  onCreate: (input: MemoryInput) => void
  onUpdate: (uuid: string, patch: MemoryPatch) => void
  onDelete: (uuid: string) => void
  onClearWork: (goalId: string) => void
  onToast: (msg: string) => void
}

export function MemoryTab({
  goals,
  memory,
  activeGoalId,
  onCreate,
  onUpdate,
  onDelete,
  onClearWork,
  onToast,
}: MemoryTabProps) {
  return (
    <MemoryManager
      variant="embedded"
      goals={goals}
      memory={memory}
      activeGoalId={activeGoalId}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onClearWork={onClearWork}
      onToast={onToast}
    />
  )
}
