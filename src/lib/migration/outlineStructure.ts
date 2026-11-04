/**
 * 这个文件负责什么：**旧的大纲树 → 结构图**那两次历史迁移的占位（全图化重构，2026-10-24）。
 *
 * 结构图 v2 的画布自有状态只剩**坐标表**，而坐标没存过的卡片由 deriveCanvas 按关系
 * 自动铺排（入口在最左、树按深度落列）——于是「从旧大纲树铺一张初图」这件事不再需要
 * 迁移脚本：老库升级后第一次打开结构页，画布自己就摆好了。两个历史迁移因此退役成
 * 占位（注册表还要它们在场，重跑什么都不做）。
 */

import type { MigrationContext, MigrationScript, MigrationStepResult } from './types'

export async function migrateOutlineToStructure(ctx: MigrationContext): Promise<MigrationStepResult> {
  ctx.log('结构图已是 v2（坐标表 + 自动铺排）：这一步没有要搬的东西')
  return { ok: true, step: 1, modifiedFiles: [], details: '结构图由画布自动铺排，无需迁移' }
}

export async function migrateStructureTopology(ctx: MigrationContext): Promise<MigrationStepResult> {
  ctx.log('结构图已是 v2（连线全部派生）：这一步没有要重建的东西')
  return { ok: true, step: 2, modifiedFiles: [], details: '连线由 store 派生，无需重建' }
}

export const outlineToStructure: MigrationScript = {
  step: 1,
  id: 'm1-outline-to-structure',
  title: '大纲树 → 结构图',
  summary: '历史迁移（已退役）：结构页从「算出来的大纲树」改成「拖出来的节点图」。',
  changes: ['v2 起画布坐标由 deriveCanvas 自动铺排，本迁移（已退役）不再产出 structure.json'],
  migrate: migrateOutlineToStructure,
}

export const structureTopology: MigrationScript = {
  step: 2,
  id: 'm2-structure-topology',
  title: '结构图拓扑重建',
  summary: '历史迁移（已退役）：按「先文档再大纲」的拓扑重建存盘的图。',
  changes: ['v2 起连线全部由 store 派生（树边 / 归属 / 目标绑定），本迁移（已退役）不再重建'],
  migrate: migrateStructureTopology,
}
