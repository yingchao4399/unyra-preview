import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Copy,
  Database,
  FileCode2,
  History,
  Play,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react'
import { activeUserId } from '../../user/store'
import { LATEST_SCHEMA_STEP, MIGRATION_SCRIPTS, RELEASED_SCHEMA_STEP } from '../../lib/migration/scripts'
import { planChain, runChain, runSingleScript } from '../../lib/migration/engine'
import { detectSchemaStep, saveSchemaMeta } from '../../lib/migration/version'
import type { MigrationScript, SchemaMeta } from '../../lib/migration/types'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface Props {
  onToast: (msg: string) => void
}

/** 格式化时间戳 */
const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/** 旧历史记录只有版本区间，新记录有序号 */
const historyLabel = (h: { step?: number; fromVersion?: string; toVersion?: string }): string =>
  typeof h.step === 'number'
    ? t('第 {0} 次', String(h.step))
    : h.fromVersion && h.toVersion
      ? `v${h.fromVersion} → v${h.toVersion}`
      : t('早期迁移')

export function MigrationPanel({ onToast }: Props) {
  const uid = activeUserId() || 'default'

  // 当前数据状态（序号，不是版本号）
  const [currentStep, setCurrentStep] = useState<number>(LATEST_SCHEMA_STEP)
  const [meta, setMeta] = useState<SchemaMeta | undefined>()
  const [loading, setLoading] = useState<boolean>(true)

  // 运行状态
  const [running, setRunning] = useState<boolean>(false)
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [copiedLog, setCopiedLog] = useState<boolean>(false)

  const appendLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, msg])
  }, [])

  // 探测当前数据序号
  const refreshStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await detectSchemaStep(uid)
      setCurrentStep(res.step)
      setMeta(res.meta)
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // 规划链式迁移
  const chainPlan = planChain(currentStep, LATEST_SCHEMA_STEP)

  // 切换启动期自动迁移
  const toggleAutoMigrate = async (enabled: boolean) => {
    if (!meta) return
    const nextMeta: SchemaMeta = {
      ...meta,
      autoMigrate: enabled,
      updatedAt: Date.now(),
    }
    setMeta(nextMeta)
    await saveSchemaMeta(uid, nextMeta)
    onToast(enabled ? t('已开启启动期自动数据迁移') : t('已关闭自动迁移（升级后需手动进入此页面执行）'))
  }

  // 执行单步迁移
  const handleRunSingle = async (script: MigrationScript) => {
    if (running) return
    setRunning(true)
    setActiveStepId(script.id)
    appendLog(`>>> 单步触发第 ${script.step} 次迁移：${script.title}`)

    try {
      const res = await runSingleScript(uid, script, appendLog)
      if (res.ok) {
        onToast(t('迁移脚本「{0}」执行成功', script.title))
        await refreshStatus()
      } else {
        onToast(t('迁移失败：{0}', res.error || t('未知错误')))
      }
    } finally {
      setRunning(false)
      setActiveStepId(null)
    }
  }

  // 执行完整链式迁移
  const handleRunChain = async () => {
    if (running) return
    if (chainPlan.scripts.length === 0) {
      onToast(t('当前数据已是最新，无需链式迁移'))
      return
    }

    setRunning(true)
    appendLog(`>>> 开始链式数据迁移（第 ${chainPlan.currentStep} 次 → 第 ${chainPlan.targetStep} 次）`)

    try {
      const res = await runChain(
        uid,
        chainPlan.scripts,
        (cur, total, script) => {
          setActiveStepId(script.id)
          appendLog(`--- [阶段 ${cur}/${total}] 第 ${script.step} 次迁移：${script.title} ---`)
        },
        appendLog,
      )

      if (res.ok) {
        onToast(t('链式数据迁移完成！数据已升级到第 {0} 次', String(LATEST_SCHEMA_STEP)))
        await refreshStatus()
      } else {
        onToast(t('迁移中断：{0}', res.error || t('未知错误')))
      }
    } finally {
      setRunning(false)
      setActiveStepId(null)
    }
  }

  // 复制日志
  const handleCopyLogs = () => {
    if (!logs.length) return
    navigator.clipboard.writeText(logs.join('\n')).catch(() => {})
    setCopiedLog(true)
    setTimeout(() => setCopiedLog(false), 1500)
  }

  const ahead = currentStep > LATEST_SCHEMA_STEP
  const upToDate = currentStep === LATEST_SCHEMA_STEP

  return (
    <div className={pane(4, true)}>
      {/* 头部简介卡片 */}
      <div className="shrink-0 flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Database size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('数据迁移')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t(
              '按序号推进的数据迁移中心：数据结构每变一次加一个序号，与应用版本号无关，发版不涨序号。',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || running}
            onClick={() => void refreshStatus()}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink disabled:opacity-40 shadow-2xs"
            title={t('重新检查当前数据序号')}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>{t('刷新状态')}</span>
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-seal/30 bg-seal/10 px-2.5 py-1 text-[11px] text-seal-deep">
            <span className="font-mono font-bold">{t('第 {0} 次', String(LATEST_SCHEMA_STEP))}</span>
            <span>{t('最新迁移序号')}</span>
          </div>
        </div>
      </div>

      {/* 1. 当前数据序号与标识 */}
      <section className="shrink-0 rounded-xl border border-line bg-card/60 p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileCode2 size={15} className="text-seal" />
              <h3 className="text-[13px] font-medium text-ink-strong">{t('数据迁移序号')}</h3>
            </div>
            <p className="mt-1 text-[11.5px] text-ink-faint">
              {t(
                '用户目录里的 schema.json 只记「已应用到第几次迁移」，不再记版本号；版本号从此只属于应用发版。',
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                ahead
                  ? 'border-red-500/30 bg-red-500/10 text-red-700'
                  : upToDate
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700'
              }`}
              title={
                ahead
                  ? t(
                      '数据序号比当前代码还新：可能是装回了旧版本，或本机跑过尚未发布的迁移。代码可能读不懂这份数据。',
                    )
                  : undefined
              }
            >
              <CheckCircle2 size={12} />
              <span>
                {ahead
                  ? t('数据序号高于当前代码（第 {0} 次 > 第 {1} 次）', String(currentStep), String(LATEST_SCHEMA_STEP))
                  : upToDate
                    ? t('数据已是最新（第 {0} 次）', String(currentStep))
                    : t('待迁移：第 {0} 次 → 第 {1} 次', String(currentStep), String(LATEST_SCHEMA_STEP))}
              </span>
            </span>
          </div>
        </div>

        {/* 详细指标行 */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-3 border-t border-line/60">
          <div className="rounded-lg border border-line bg-paper-deep/50 p-2.5">
            <span className="text-[10.5px] text-ink-faint">{t('当前数据序号')}</span>
            <div className="mt-0.5 font-mono text-[13px] font-bold text-ink-strong">
              {t('第 {0} 次', String(currentStep))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-paper-deep/50 p-2.5">
            <span className="text-[10.5px] text-ink-faint">{t('标识文件')}</span>
            <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-soft" title="schema.json">
              users/{uid}/schema.json
            </div>
          </div>

          <div className="rounded-lg border border-line bg-paper-deep/50 p-2.5">
            <span className="text-[10.5px] text-ink-faint">{t('最近更新时间')}</span>
            <div className="mt-0.5 font-mono text-[11.5px] text-ink-soft">
              {meta?.updatedAt ? fmtTime(meta.updatedAt) : t('已记录')}
            </div>
          </div>
        </div>

        {/* 启动期自动迁移策略开关 */}
        <div className="mt-3.5 pt-3 border-t border-line/60">
          <Switch
            on={meta?.autoMigrate !== false}
            onChange={(next) => void toggleAutoMigrate(next)}
            label={t('应用启动时自动检测并升级数据结构')}
            hint={t('开启后，后续版本升级若存在待执行的迁移序号，将在启动载入前自动按序执行，无需手动点击。')}
          />
        </div>
      </section>

      {/* 2. 数据迁移脚本列表 */}
      <section className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database size={15} className="text-seal" />
            <h3 className="text-[13px] font-semibold text-ink-strong">{t('数据迁移脚本库')}</h3>
          </div>

          {chainPlan.scripts.length > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={() => void handleRunChain()}
              className="flex items-center gap-1.5 rounded-xl bg-seal px-3.5 py-1.5 text-[11.5px] font-medium text-white shadow-2xs hover:bg-seal-deep disabled:opacity-40"
            >
              <Play size={12} className={running ? 'animate-pulse' : ''} />
              <span>{t('一键迁移到第 {0} 次', String(LATEST_SCHEMA_STEP))}</span>
            </button>
          )}
        </div>

        {MIGRATION_SCRIPTS.length === 0 ? (
          <div className="rounded-xl border border-line bg-card/60 p-6 text-center shadow-2xs">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <CheckCircle2 size={20} />
            </div>
            <h4 className="mt-3 text-[13px] font-semibold text-ink-strong">
              {t('暂无待执行的迁移脚本')}
            </h4>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint max-w-[480px] mx-auto">
              {t(
                '当前数据已应用到第 {0} 次迁移。以后每改一次数据形状就在 scripts.ts 里接一个序号，脚本会自动出现在这里。',
                String(LATEST_SCHEMA_STEP),
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {MIGRATION_SCRIPTS.map((script) => {
              const isApplied = currentStep >= script.step
              const isPending = chainPlan.scripts.some((s) => s.id === script.id)
              const isStepActive = activeStepId === script.id
              const isDraft = script.step > RELEASED_SCHEMA_STEP

              return (
                <div
                  key={script.id}
                  className={`rounded-xl border p-3.5 transition shadow-2xs ${
                    isStepActive
                      ? 'border-seal bg-seal/5 ring-2 ring-seal/20'
                      : isApplied
                        ? 'border-line bg-card/60'
                        : 'border-line/80 bg-paper-deep/30'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-paper-deep px-2 py-0.5 font-mono text-[11px] font-bold text-ink-strong">
                        {t('第 {0} 次', String(script.step))}
                      </span>
                      <h5 className="text-[12.5px] font-bold text-ink-strong">{script.title}</h5>
                      {isDraft && (
                        <span
                          className="rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                          title={t('这个序号还没随公开版本发出去，上线前可以并进前一次迁移')}
                        >
                          {t('未发布 · 可合并')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          isApplied
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : isPending
                              ? 'bg-amber-500/15 text-amber-700'
                              : 'bg-line/60 text-ink-faint'
                        }`}
                      >
                        {isApplied ? t('已应用') : isPending ? t('待执行') : t('可重跑')}
                      </span>

                      <button
                        type="button"
                        disabled={running}
                        onClick={() => void handleRunSingle(script)}
                        className="flex items-center gap-1 rounded-lg border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink disabled:opacity-40 shadow-2xs"
                      >
                        <Play size={10} className={isStepActive ? 'animate-spin' : ''} />
                        <span>{isStepActive ? t('执行中…') : isApplied ? t('重新执行') : t('单步执行')}</span>
                      </button>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <p className="text-[11.5px] leading-relaxed text-ink-soft">{script.summary}</p>
                    {script.changes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] text-ink-faint list-disc">
                        {script.changes.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 3. 历史迁移履历 */}
      <section className="shrink-0 rounded-xl border border-line bg-card/60 p-4 shadow-2xs">
        <div className="flex items-center gap-2 mb-2">
          <History size={14} className="text-seal" />
          <h3 className="text-[13px] font-medium text-ink-strong">{t('迁移历史履历')}</h3>
        </div>

        {meta?.history && meta.history.length > 0 ? (
          <ul className="divide-y divide-line/60 text-[11.5px]">
            {meta.history.map((h, idx) => (
              <li key={idx} className="flex items-center justify-between py-2 text-ink-soft">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-ink-strong">{historyLabel(h)}</span>
                  <span className="text-ink-faint">{h.details || t('迁移完成')}</span>
                </div>
                <span className="font-mono text-[10.5px] text-ink-faint">{fmtTime(h.migratedAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-ink-faint">
            {t('暂无历史迁移记录（当前数据直接初始化在第 {0} 次）。', String(currentStep))}
          </p>
        )}
      </section>

      {/* 4. 迁移运行日志 (Console) */}
      {logs.length > 0 && (
        <section className="shrink-0 rounded-xl border border-line bg-sunken p-3.5 shadow-sm">
          <div className="flex items-center justify-between pb-2 border-b border-line/60">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-strong">
              <Terminal size={13} className="text-seal" />
              <span>{t('迁移运行日志 (Console)')}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyLogs}
                className="flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-0.5 text-[10.5px] text-ink-soft hover:bg-paper-deep"
                title={t('复制日志')}
              >
                {copiedLog ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                <span>{copiedLog ? t('已复制') : t('复制')}</span>
              </button>
              <button
                type="button"
                onClick={() => setLogs([])}
                className="flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-0.5 text-[10.5px] text-ink-soft hover:bg-paper-deep"
                title={t('清空日志')}
              >
                <Trash2 size={11} />
                <span>{t('清空')}</span>
              </button>
            </div>
          </div>

          <div className="mt-2.5 max-h-[140px] overflow-y-auto rounded-lg bg-paper/60 p-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
            {logs.map((log, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {log}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
