/**
 * 启动期自动数据迁移调度器。
 *
 * 当应用更新到新版本启动时，若检测到用户数据落后于当前代码的迁移序号，
 * 在加载教学文档 (hydrateLearnStore) **之前**自动触发链式迁移，实现无感升级；
 * 避免用户因未手动进入设置页执行迁移而导致新代码读旧结构报错。
 *
 * 失败**不阻断启动**：只记日志并返回 `migrated: false`。旧数据原样留在盘上，
 * 旧解析器照常能读——这条是迁移安全的最后一道保险，别改成抛错。
 */

import { planChain, runChain } from './engine'
import { latestStep } from './scripts'
import { detectSchemaStep } from './version'

export interface AutoMigrateResult {
  migrated: boolean
  fromStep?: number
  toStep?: number
  error?: string
}

/**
 * 在用户作用域初始化时自动检查并执行迁移。
 * 默认开启自动迁移，可通过 schema.json 中的 autoMigrate: false 关闭。
 */
export async function autoMigrateIfNeeded(
  uid: string,
  onLog?: (msg: string) => void,
): Promise<AutoMigrateResult> {
  const logger = onLog || ((msg: string) => console.log(`[auto-migrate] ${msg}`))

  try {
    const { step: currentStep, meta } = await detectSchemaStep(uid)
    const targetStep = latestStep()

    // 用户显式关闭了自动迁移
    if (meta?.autoMigrate === false) {
      logger(`用户已配置关闭自动迁移 (autoMigrate=false)，保持当前数据序号 #${currentStep}`)
      return { migrated: false, fromStep: currentStep, toStep: currentStep }
    }

    const plan = planChain(currentStep, targetStep)

    /**
     * 数据比代码还新：降级装了旧版本，或者本机跑过某个未发布的序号、之后又被合并掉了。
     * **不能静默当成"已是最新"**——代码可能读不懂这份数据，得让人看见。
     */
    if (plan.dataAhead) {
      logger(
        `[注意] 数据序号 (#${currentStep}) 比当前代码 (#${targetStep}) 还新：` +
          `可能是装回了旧版本，或本机跑过尚未发布的迁移。不会自动处理，请确认数据形状。`,
      )
      return { migrated: false, fromStep: currentStep, toStep: currentStep }
    }

    if (plan.isUpToDate || plan.scripts.length === 0) {
      return { migrated: false, fromStep: currentStep, toStep: currentStep }
    }

    logger(
      `检测到数据落后 (第 ${currentStep} 次 → 第 ${targetStep} 次)，正在启动启动期自动链式迁移（共 ${plan.scripts.length} 个阶段）…`,
    )

    const res = await runChain(uid, plan.scripts, undefined, logger)

    if (res.ok) {
      logger(`自动链式迁移成功完成，数据已对齐至第 ${targetStep} 次。`)
      return { migrated: true, fromStep: currentStep, toStep: targetStep }
    }

    logger(`自动迁移执行遇到异常中断：${res.error}`)
    return { migrated: false, fromStep: currentStep, toStep: currentStep, error: res.error }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger(`自动迁移探测失败：${msg}`)
    return { migrated: false, error: msg }
  }
}
