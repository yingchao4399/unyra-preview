/**
 * 本文件负责：按 id 取节点 / 取目标这两个最小的查表函数。
 *
 * 单独成一个文件是为了切掉 nodes ↔ edges 的循环依赖：节点那边要用 edges 的边查询，
 * 而 edges 的 isUnlocked / unmetPrereqs / backtrackTargets 又要按 id 找节点。两边都要读的
 * 这两个小函数因此独立出来——谁都可以依赖它，它不依赖谁。
 *
 * ## 为什么要有索引
 *
 * `store.nodes` 是数组，按 id 找原来是 `find`——整仓库有 160 多处调用它，
 * 每次渲染、每次保存都要把节点表从头扫一遍。节点几十个时不明显，但这是纯浪费。
 *
 * 索引用 `WeakMap` 挂在**数组引用**上：store 是不可变的（图操作一律返回新 store，
 * 数组只换不原地改），所以数组引用就是天然的版本号——引用没变，索引一定还是对的；
 * 引用变了，旧索引跟着旧数组一起被回收，不会泄漏。
 *
 * 重复 id 的取舍与原实现一致：**保留第一个**（`find` 的语义）。
 */
import type { KnowledgeNode, LearnStore } from '../types'

const nodeIndexCache = new WeakMap<readonly KnowledgeNode[], Map<string, KnowledgeNode>>()

function nodeIndex(nodes: readonly KnowledgeNode[]): Map<string, KnowledgeNode> {
  let index = nodeIndexCache.get(nodes)
  if (!index) {
    index = new Map<string, KnowledgeNode>()
    for (const node of nodes) if (!index.has(node.id)) index.set(node.id, node)
    nodeIndexCache.set(nodes, index)
  }
  return index
}

export function nodeById(store: LearnStore, id: string): KnowledgeNode | undefined {
  return nodeIndex(store.nodes).get(id)
}

export function goalById(store: LearnStore, id: string | null): LearnStore['goals'][number] | undefined {
  return id ? store.goals.find((g) => g.id === id) : undefined
}
