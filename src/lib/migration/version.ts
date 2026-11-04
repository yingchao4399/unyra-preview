/**
 * 数据 Schema 的**序号**探测与元数据管理。
 *
 * ## 从版本号改成序号（2026-10-22）
 *
 * 早先这里是 `LATEST_SCHEMA_VERSION = '0.7.1'`，每个迁移脚本写 `fromVersion → toVersion`。
 * 后果是**每改一次数据形状就要涨一次版本号**——迁移加到第三次，发版号就被推到 0.8，
 * 而线上其实才 0.6.7。版本号被迁移绑架之后，既表达不了"这次发版改了什么"，
 * 也没法在上线前合并几次迁移。
 *
 * 现在：
 * - `schema.json` 记 `schemaStep`（已应用到第几次迁移），不记版本字符串；
 * - 版本号只属于应用发版，数据只认序号；
 * - 老数据里的 `schemaVersion` **只读**，用 `stepOfLegacyVersion` 折算成序号，折算完按新形状写回。
 *
 * ## 没有标识的老用户怎么算
 *
 * 三种情况分开处理（见 `detectSchemaStep`）：
 * 1. 有 `schemaStep` —— 直接用；
 * 2. 只有 `schemaVersion`（0.7.1 及更早写的）—— 折算成序号；
 * 3. 什么都没有 —— **看 `docs/` 里有没有数据**：有数据说明是很老的用户，从 0 开始跑全部迁移；
 *    没数据说明是全新用户，直接落在最新序号（不该白跑一遍迁移）。
 *
 * 第 3 条是这次顺手修的一个坑：早先没标识时**一律按最新版本**算，于是 0.6.3 之前的老用户
 * 永远不迁移，数据形状一直停在旧的那一套。
 */

import { DOCS_DIR } from '../../learn/layout'
import { listDir, readJson, userRel, writeJson } from '../storage'
import { LATEST_SCHEMA_STEP } from './scripts'
import type { SchemaMeta } from './types'

export { LATEST_SCHEMA_STEP }

export const SCHEMA_FILE = 'schema.json'
export const STATE_FILE = 'state.json'

/** 版本号比对：v1 < v2 返回 -1，v1 === v2 返回 0，v1 > v2 返回 1 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const p2 = v2.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(p1.length, p2.length)
  for (let i = 0; i < len; i++) {
    const a = p1[i] ?? 0
    const b = p2[i] ?? 0
    if (a < b) return -1
    if (a > b) return 1
  }
  return 0
}

/**
 * 旧版本号 → 序号。
 *
 * 这张表只在**读回老数据**时用一次（0.7.1 及更早的 `schema.json`）。
 * 以后新写出的数据都带 `schemaStep`，不会再走到这里。
 */
const LEGACY_VERSION_STEPS: ReadonlyArray<readonly [version: string, step: number]> = [
  ['0.7.0', 1],
  ['0.7.1', 2],
]

export function stepOfLegacyVersion(version: string): number {
  const v = version.trim()
  if (!v) return 0
  let step = 0
  for (const [legacy, s] of LEGACY_VERSION_STEPS) {
    if (compareVersions(v, legacy) >= 0) step = s
  }
  return step
}

/** 读 `schema.json`，兼容"只有 schemaVersion 的老文件" */
async function readSchemaMeta(uid: string): Promise<SchemaMeta | null> {
  const raw = await readJson<Partial<SchemaMeta>>(userRel(uid, SCHEMA_FILE))
  if (!raw || typeof raw !== 'object') return null
  return {
    schemaStep: typeof raw.schemaStep === 'number' && Number.isFinite(raw.schemaStep) ? raw.schemaStep : -1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    ...(typeof raw.autoMigrate === 'boolean' ? { autoMigrate: raw.autoMigrate } : {}),
    history: Array.isArray(raw.history) ? raw.history : [],
    ...(typeof raw.schemaVersion === 'string' ? { schemaVersion: raw.schemaVersion } : {}),
  }
}

/**
 * 什么都没有的用户落在哪一档。
 *
 * 有 `docs/` 内容 = 很老的用户（0.6.3 之前没有 schema.json），从 0 开始跑全部迁移；
 * 空目录 = 全新用户，直接算最新，别让他白跑一遍。
 */
async function stepForBareUser(uid: string): Promise<number> {
  const entries = await listDir(userRel(uid, DOCS_DIR))
  return entries.length ? 0 : LATEST_SCHEMA_STEP
}

/** 探测并确保指定用户的数据迁移序号 */
export async function detectSchemaStep(uid: string): Promise<{
  step: number
  isExplicit: boolean
  meta?: SchemaMeta
}> {
  // 1. 新形状：schemaStep 直接可用
  const meta = await readSchemaMeta(uid)
  if (meta && meta.schemaStep >= 0) {
    return { step: meta.schemaStep, isExplicit: true, meta }
  }

  // 2. 老形状：只有 schemaVersion —— 折算一次，然后按新形状写回（下次就不再折算）
  if (meta && meta.schemaVersion) {
    const step = stepOfLegacyVersion(meta.schemaVersion)
    const next: SchemaMeta = { ...meta, schemaStep: step, updatedAt: Date.now() }
    await saveSchemaMeta(uid, next)
    return { step, isExplicit: true, meta: next }
  }

  // 3. state.json 里可能还留着老标记
  const state = await readJson<Record<string, unknown>>(userRel(uid, STATE_FILE))
  const legacy = typeof state?.schemaVersion === 'string' ? state.schemaVersion : ''
  const step = legacy ? stepOfLegacyVersion(legacy) : await stepForBareUser(uid)

  const initial: SchemaMeta = {
    schemaStep: step,
    updatedAt: Date.now(),
    history: meta?.history ?? [],
    ...(meta?.autoMigrate === false ? { autoMigrate: false } : {}),
  }
  await saveSchemaMeta(uid, initial)
  return { step, isExplicit: true, meta: initial }
}

/**
 * 保存 `schema.json`，并同步在 `state.json` 里盖一枚 `schemaStep`（双重校验）。
 *
 * **不再写 `schemaVersion`**：版本号与应用发版绑定，数据只认序号。
 * （降级到旧版本应用不在支持范围内：旧代码会按版本号判断，然后按旧解析器读新数据。）
 */
export async function saveSchemaMeta(uid: string, meta: SchemaMeta): Promise<boolean> {
  const schemaPath = userRel(uid, SCHEMA_FILE)
  const ok = await writeJson(schemaPath, meta)

  const statePath = userRel(uid, STATE_FILE)
  const state = await readJson<Record<string, unknown>>(statePath)
  if (state && typeof state === 'object') {
    await writeJson(statePath, {
      ...state,
      schemaStep: meta.schemaStep,
      schemaUpdatedAt: meta.updatedAt,
    })
  }

  return ok
}
