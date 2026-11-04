import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import type { AgentSettings } from '../../agent/settings'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface PermissionsTabProps {
  settings: AgentSettings
  onChange: (next: AgentSettings) => void
}

export function PermissionsTab({ settings, onChange }: PermissionsTabProps) {
  // 目标根目录与放行目录白名单管理
  const [currentRootDir, setCurrentRootDir] = useState<string>('')
  const [newDirPath, setNewDirPath] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)
  const [copiedDir, setCopiedDir] = useState<string | null>(null)

  // 获取目标数据根目录
  useEffect(() => {
    if (typeof window !== 'undefined' && window.mojiNative?.storage?.info) {
      window.mojiNative.storage
        .info()
        .then((info) => {
          if (info?.root) setCurrentRootDir(info.root)
        })
        .catch(() => {})
    }
  }, [])

  // 添加放行目录
  const handleAddAllowedDir = (dirToAdd?: string) => {
    const target = (dirToAdd || newDirPath).trim()
    if (!target) {
      setPathError(t('目录路径不能为空'))
      return
    }
    const currentList = settings.permissions?.allowedDirs || []
    if (currentList.includes(target)) {
      setPathError(t('该目录已在放行白名单中'))
      return
    }
    setPathError(null)
    const nextList = [...currentList, target]
    const nextSettings: AgentSettings = {
      ...settings,
      permissions: {
        ...(settings.permissions || { allowedDirs: [] }),
        allowedDirs: nextList,
      },
    }
    onChange(nextSettings)
    setNewDirPath('')
  }

  // 移除放行目录
  const handleRemoveAllowedDir = (dirToRemove: string) => {
    const currentList = settings.permissions?.allowedDirs || []
    const nextList = currentList.filter((d) => d !== dirToRemove)
    const nextSettings: AgentSettings = {
      ...settings,
      permissions: {
        ...(settings.permissions || { allowedDirs: [] }),
        allowedDirs: nextList,
      },
    }
    onChange(nextSettings)
  }

  // 弹原生目录选择框
  const handlePickDirectory = async () => {
    if (typeof window !== 'undefined' && window.mojiNative?.storage?.pickRoot) {
      try {
        const res = await window.mojiNative.storage.pickRoot()
        if (res.ok && res.root && !res.canceled) {
          handleAddAllowedDir(res.root)
        }
      } catch {
        // fallback
      }
    }
  }

  const handleCopyPath = (dir: string) => {
    navigator.clipboard.writeText(dir).catch(() => {})
    setCopiedDir(dir)
    setTimeout(() => {
      setCopiedDir((cur) => (cur === dir ? null : cur))
    }, 1500)
  }

  const allowedDirs = settings.permissions?.allowedDirs || []

  return (
    <div className={pane(4)}>
      {/* 顶部全景概览卡片 */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-card via-card to-paper-deep/50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-seal/10 text-seal border border-seal/20 shadow-2xs">
              <FolderCheck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14.5px] font-bold text-ink-strong">{t('权限设置与文件安全沙箱')}</h3>
                <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep">
                  {t('已放行 {0} 个外部目录', allowedDirs.length)}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {t('受控管理超级导师与沙箱脚本对本机真实文件系统的访问边界，未经显式授权的外部路径一律拒绝。')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-paper/70 px-2.5 py-1 text-[11px] font-medium text-ink-soft shadow-2xs">
            <ShieldCheck size={13} className="text-emerald-500" />
            <span>{t('安全防护策略实时生效')}</span>
          </div>
        </div>
      </section>

      {/* 原生工具文件系统权限与放行目录 */}
      <section className="rounded-2xl border border-line bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                <FolderCheck size={13} />
              </span>
              <h4 className="text-[13.5px] font-bold text-ink-strong">{t('真实文件系统访问白名单')}</h4>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
              {t(
                '导师沙箱原生 API (files.*) 默认对学习区内部目录具有完全读写权限；如果需要让导师查看或读写外部系统文件夹（如代码仓库、本地教材、知识库），必须在此添加外部绝对路径。',
              )}
            </p>
          </div>
        </div>

        {/* 目标根目录默认授权卡片 */}
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700">
                {t('完全受信任 · 默认最高权限')}
              </span>
              <span className="text-[11.5px] font-medium text-ink-strong">{t('当前学习数据根目录')}</span>
            </div>
            <code className="mt-1 block truncate font-mono text-[11px] text-ink-soft" title={currentRootDir || t('当前工作区存储根')}>
              {currentRootDir || t('正在获取系统根路径…')}
            </code>
          </div>
          <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
        </div>

        {/* 外部目录添加控件 */}
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newDirPath}
              onChange={(e) => {
                setNewDirPath(e.target.value)
                if (pathError) setPathError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddAllowedDir()
              }}
              placeholder={t('输入允许 Agent 访问的外部系统真实绝对路径，如 E:\\project\\docs')}
              className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal focus:ring-2 focus:ring-seal/15 font-mono"
            />
            <button
              type="button"
              onClick={handlePickDirectory}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-[12px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink-strong shadow-2xs"
              title={t('在系统文件选择器中浏览')}
            >
              <FolderOpen size={14} />
              <span>{t('浏览')}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAddAllowedDir()}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-seal px-4 py-2 text-[12px] font-medium text-white shadow-2xs transition hover:bg-seal-deep"
            >
              <FolderPlus size={14} />
              <span>{t('放行目录')}</span>
            </button>
          </div>
          {pathError && (
            <p className="flex items-center gap-1 text-[11px] text-warn-deep">
              <AlertCircle size={12} />
              <span>{pathError}</span>
            </p>
          )}
        </div>

        {/* 放行白名单清单 */}
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-paper-deep/30">
          <div className="border-b border-line bg-paper-deep/60 px-3.5 py-2 text-[11.5px] font-semibold text-ink-strong">
            {t('已放行的外部白名单目录 ({0})', allowedDirs.length)}
          </div>
          {allowedDirs.length === 0 ? (
            <div className="p-4 text-center text-[11.5px] text-ink-faint">
              {t('暂无外部放行目录。除当前学习目标数据根目录外，Agent 尝试访问其他外部路径均会被安全拦截。')}
            </div>
          ) : (
            <ul className="divide-y divide-line/60">
              {allowedDirs.map((dir) => (
                <li key={dir} className="flex items-center justify-between gap-3 px-3.5 py-2 hover:bg-paper/50 transition">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-strong" title={dir}>
                    {dir}
                  </code>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyPath(dir)}
                      className="rounded p-1 text-ink-faint transition hover:bg-paper-deep hover:text-ink"
                      title={t('复制路径')}
                    >
                      {copiedDir === dir ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveAllowedDir(dir)}
                      className="rounded p-1 text-ink-faint transition hover:bg-warn/10 hover:text-warn-deep"
                      title={t('移除此放行目录')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 权限机制说明卡片 */}
      <section className="rounded-xl border border-line/60 bg-paper-deep/40 p-4 text-[11px] leading-relaxed text-ink-faint">
        <h5 className="font-semibold text-ink-soft mb-1">{t('关于沙箱访问权限的说明')}</h5>
        <ul className="list-disc pl-4 space-y-1">
          <li>{t('沙箱内的所有原生文件读写 API (如 files.read / files.write / files.list) 均在主进程校验路径。')}</li>
          <li>{t('只有包含在学习数据根目录或上方白名单中的绝对路径才允许通过，防止提示词注入或越权读写系统敏感文件。')}</li>
          <li>{t('权限变更即时保存生效，无需重启应用。')}</li>
        </ul>
      </section>
    </div>
  )
}
