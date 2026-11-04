import { useState } from 'react'
import {
  Check,
  Compass,
  Copy,
  Drama,
  Edit2,
  Eye,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { AgentSettings } from '../../agent/settings'
import {
  DEFAULT_PERSONA,
  PERSONAS,
  allPersonas,
  type Persona,
  type PersonaId,
} from '../../agent/persona'
import {
  DEFAULT_DOC_FORMAT,
  DOC_FORMATS,
  allDocFormats,
  type DocFormat,
  type DocFormatId,
} from '../../agent/docFormat'
import Switch from '../Switch'
import { pane } from '../Pane'
import { t } from '../../i18n'

interface StrategyTabProps {
  settings: AgentSettings
  onChange: (next: AgentSettings) => void
  onToast?: (msg: string) => void
}

export function StrategyTab({ settings, onChange, onToast = () => {} }: StrategyTabProps) {
  const customPersonas = settings.customPersonas || []
  const customDocFormats = settings.customDocFormats || []
  const personas = allPersonas(customPersonas)
  const docFormats = allDocFormats(customDocFormats)

  // 正在编辑/新建的人格
  const [editingPersona, setEditingPersona] = useState<Partial<Persona> | null>(null)
  // 正在编辑/新建的文档格式策略
  const [editingFormat, setEditingFormat] = useState<Partial<DocFormat> | null>(null)
  // 查看内置/自定义提示词详情弹窗
  const [viewingPrompt, setViewingPrompt] = useState<{
    title: string
    kind: 'persona' | 'format'
    isBuiltin: boolean
    instruction: string
    item: Persona | DocFormat
  } | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  const handleCopyPrompt = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPrompt(true)
    onToast(t('提示词已复制到剪贴板'))
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  const handleCreateFromTemplate = () => {
    if (!viewingPrompt) return
    if (viewingPrompt.kind === 'persona') {
      const p = viewingPrompt.item as Persona
      setEditingPersona({
        label: `${t(p.label)} (${t('副本')})`,
        short: p.short,
        role: p.role,
        tagline: p.tagline,
        instruction: p.instruction,
      })
    } else {
      const f = viewingPrompt.item as DocFormat
      setEditingFormat({
        label: `${t(f.label)} (${t('副本')})`,
        short: f.short,
        desc: f.desc,
        instruction: f.instruction,
      })
    }
    setViewingPrompt(null)
  }

  // 切换当前激活的人格
  const handleSelectPersona = (id: PersonaId) => {
    onChange({ ...settings, persona: id })
    onToast(t('已切换导师人格'))
  }

  // 保存（新增或更新）自定义人格
  const handleSavePersona = () => {
    if (!editingPersona) return
    const label = editingPersona.label?.trim()
    const instruction = editingPersona.instruction?.trim()
    if (!label) {
      onToast(t('人格名称不能为空'))
      return
    }
    if (!instruction) {
      onToast(t('人格指令提示词不能为空'))
      return
    }

    const short = editingPersona.short?.trim() || label.slice(0, 4)
    const role = editingPersona.role?.trim() || t('自定义导师')
    const tagline = editingPersona.tagline?.trim() || `「${label}」`

    const isNew = !editingPersona.id
    const id = editingPersona.id || `custom-persona-${Date.now()}`

    const updatedItem: Persona = {
      id,
      label,
      short,
      role,
      tagline,
      instruction,
      isCustom: true,
    }

    let nextCustomList: Persona[]
    if (isNew) {
      nextCustomList = [...customPersonas, updatedItem]
    } else {
      nextCustomList = customPersonas.map((p) => (p.id === id ? updatedItem : p))
    }

    onChange({
      ...settings,
      customPersonas: nextCustomList,
      persona: id, // 新建或编辑后自动选中
    })
    setEditingPersona(null)
    onToast(isNew ? t('已添加自定义人格') : t('已更新自定义人格'))
  }

  // 删除自定义人格
  const handleDeletePersona = (id: string) => {
    const nextCustomList = customPersonas.filter((p) => p.id !== id)
    const nextPersonaId = settings.persona === id ? DEFAULT_PERSONA : settings.persona
    onChange({
      ...settings,
      customPersonas: nextCustomList,
      persona: nextPersonaId,
    })
    onToast(t('已删除自定义人格'))
  }

  // 切换当前激活的文档格式策略
  const handleSelectDocFormat = (id: DocFormatId) => {
    onChange({ ...settings, docFormat: id })
    onToast(t('已切换文档格式策略'))
  }

  // 保存（新增或更新）自定义文档格式策略
  const handleSaveDocFormat = () => {
    if (!editingFormat) return
    const label = editingFormat.label?.trim()
    const instruction = editingFormat.instruction?.trim()
    if (!label) {
      onToast(t('策略名称不能为空'))
      return
    }
    if (!instruction) {
      onToast(t('策略指令提示词不能为空'))
      return
    }

    const short = editingFormat.short?.trim() || label.slice(0, 4)
    const desc = editingFormat.desc?.trim() || t('自定义文档生成格式策略')

    const isNew = !editingFormat.id
    const id = editingFormat.id || `custom-fmt-${Date.now()}`

    const updatedItem: DocFormat = {
      id,
      label,
      short,
      desc,
      instruction,
      isCustom: true,
    }

    let nextCustomList: DocFormat[]
    if (isNew) {
      nextCustomList = [...customDocFormats, updatedItem]
    } else {
      nextCustomList = customDocFormats.map((f) => (f.id === id ? updatedItem : f))
    }

    onChange({
      ...settings,
      customDocFormats: nextCustomList,
      docFormat: id, // 新建或编辑后自动选中
    })
    setEditingFormat(null)
    onToast(isNew ? t('已添加自定义策略') : t('已更新自定义策略'))
  }

  // 删除自定义格式策略
  const handleDeleteDocFormat = (id: string) => {
    const nextCustomList = customDocFormats.filter((f) => f.id !== id)
    const nextDocFormatId = settings.docFormat === id ? DEFAULT_DOC_FORMAT : settings.docFormat
    onChange({
      ...settings,
      customDocFormats: nextCustomList,
      docFormat: nextDocFormatId,
    })
    onToast(t('已删除自定义策略'))
  }

  return (
    <div className={pane(4)}>
      {/* 模块说明 */}
      <section className="relative overflow-hidden rounded-2xl border border-line-strong/60 bg-gradient-to-br from-card via-card to-paper-deep/50 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <Compass size={15} />
          </span>
          <h3 className="text-[14px] font-semibold text-ink-strong">{t('导师人格与文档策略')}</h3>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
          {t('自定义导师在教学交流中的性格语气、引导模式，以及撰写教学文档时的结构排版策略。均通过隐藏指令实时注入上下文，不破坏前缀缓存。')}
        </p>
      </section>

      {/* 导师人格列表 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Drama size={15} className="text-ink-soft" />
            <h4 className="text-[13px] font-medium text-ink-strong">{t('导师人格')}</h4>
          </div>
          <button
            type="button"
            onClick={() => setEditingPersona({ label: '', short: '', role: '', tagline: '', instruction: '' })}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-seal transition hover:border-seal hover:bg-card/80"
          >
            <Plus size={13} />
            <span>{t('新建人格')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {personas.map((p) => {
            const isCurrent = settings.persona === p.id
            const isBuiltin = PERSONAS.some((bp) => bp.id === p.id)
            return (
              <div
                key={p.id}
                onClick={() => handleSelectPersona(p.id)}
                className={
                  'group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition ' +
                  (isCurrent
                    ? 'border-seal/60 bg-seal/5 shadow-sm'
                    : 'border-line bg-card/60 hover:border-line-strong hover:bg-card')
                }
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink-strong">{t(p.label)}</span>
                      <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-faint">
                        {isBuiltin ? t('内置') : t('自定义')}
                      </span>
                    </div>
                    {isCurrent && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-seal">
                        <Check size={13} />
                        <span>{t('当前生效')}</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-1 text-[11px] font-medium text-ink-soft">{t(p.role)}</div>
                  <div className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-ink-faint">
                    {t(p.tagline)}
                  </div>
                </div>

                {/* 人格操作栏：内置与自定义均支持查看提示词与对比 */}
                <div
                  className="mt-3 flex items-center justify-between gap-1.5 pt-2 border-t border-line/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCopiedPrompt(false)
                      setViewingPrompt({
                        title: `${t(p.label)} · ${t('导师人格提示词')}`,
                        kind: 'persona',
                        isBuiltin,
                        instruction: p.instruction,
                        item: p,
                      })
                    }}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-soft transition hover:bg-line/70 hover:text-ink"
                  >
                    <Eye size={12} />
                    <span>{t('查看提示词')}</span>
                  </button>

                  {!isBuiltin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={t('编辑')}
                        onClick={() => setEditingPersona(p)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft transition hover:bg-line hover:text-ink"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        type="button"
                        title={t('删除')}
                        onClick={() => handleDeletePersona(p.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft transition hover:bg-warn/10 hover:text-warn-deep"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 文档格式策略列表 */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-ink-soft" />
            <h4 className="text-[13px] font-medium text-ink-strong">{t('文档生成策略')}</h4>
          </div>
          <button
            type="button"
            onClick={() => setEditingFormat({ label: '', short: '', desc: '', instruction: '' })}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] font-medium text-seal transition hover:border-seal hover:bg-card/80"
          >
            <Plus size={13} />
            <span>{t('新建策略')}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {docFormats.map((f) => {
            const isCurrent = settings.docFormat === f.id
            const isBuiltin = DOC_FORMATS.some((bf) => bf.id === f.id)
            return (
              <div
                key={f.id}
                onClick={() => handleSelectDocFormat(f.id)}
                className={
                  'group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3.5 transition ' +
                  (isCurrent
                    ? 'border-seal/60 bg-seal/5 shadow-sm'
                    : 'border-line bg-card/60 hover:border-line-strong hover:bg-card')
                }
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink-strong">{t(f.label)}</span>
                      <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-faint">
                        {isBuiltin ? t('内置') : t('自定义')}
                      </span>
                    </div>
                    {isCurrent && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-seal">
                        <Check size={13} />
                        <span>{t('当前生效')}</span>
                      </span>
                    )}
                  </div>

                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-soft">
                    {t(f.desc)}
                  </div>
                </div>

                {/* 格式策略操作栏：内置与自定义均支持查看提示词与对比 */}
                <div
                  className="mt-3 flex items-center justify-between gap-1.5 pt-2 border-t border-line/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setCopiedPrompt(false)
                      setViewingPrompt({
                        title: `${t(f.label)} · ${t('文档生成策略提示词')}`,
                        kind: 'format',
                        isBuiltin,
                        instruction: f.instruction,
                        item: f,
                      })
                    }}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-soft transition hover:bg-line/70 hover:text-ink"
                  >
                    <Eye size={12} />
                    <span>{t('查看提示词')}</span>
                  </button>

                  {!isBuiltin && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={t('编辑')}
                        onClick={() => setEditingFormat(f)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft transition hover:bg-line hover:text-ink"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        type="button"
                        title={t('删除')}
                        onClick={() => handleDeleteDocFormat(f.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-ink-soft transition hover:bg-warn/10 hover:text-warn-deep"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 额外系统提示词配置 */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-seal" />
            <h4 className="text-[13px] font-medium text-ink-strong">{t('额外系统提示词')}</h4>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-ink-faint">
              {settings.extraSystemPromptEnabled ? t('已启用') : t('已停用')}
            </span>
            <Switch
              on={!!settings.extraSystemPromptEnabled}
              onChange={(enabled) => onChange({ ...settings, extraSystemPromptEnabled: enabled })}
              label=""
              bare
            />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-card/60 p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] leading-relaxed text-ink-faint">
              {t('允许向超级导师全局追加自定义的系统提示词（追加于系统提示词末尾，具有最高指导效力）。默认不启用，需开启上方开关后生效。')}
            </p>
            {settings.extraSystemPromptEnabled && (
              <span className="shrink-0 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal">
                {t('生效中')}
              </span>
            )}
          </div>

          <div className="relative">
            <textarea
              rows={4}
              value={settings.extraSystemPrompt || ''}
              onChange={(e) => onChange({ ...settings, extraSystemPrompt: e.target.value })}
              placeholder={
                settings.extraSystemPromptEnabled
                  ? t('在此输入额外的全局系统提示词，例如：回答风格偏好、特定领域规则、强制遵循的格式要求等…')
                  : t('（开关未启用）开启上方开关后，在此输入的提示词将自动追加至导师系统提示词末尾…')
              }
              className={
                'w-full resize-y rounded-lg border p-2.5 text-[12px] font-mono leading-relaxed transition outline-none ' +
                (settings.extraSystemPromptEnabled
                  ? 'border-line-strong bg-paper text-ink focus:border-seal focus:ring-1 focus:ring-seal'
                  : 'border-line bg-line/20 text-ink-faint')
              }
            />
            <div className="mt-1 flex items-center justify-between text-[10.5px] text-ink-faint">
              <span>{t('将作为【学习者附加自定义系统提示词】注入运行时')}</span>
              <span>{(settings.extraSystemPrompt || '').length} {t('字')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 人格编辑弹窗 */}
      {editingPersona && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-line-strong bg-card p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h3 className="text-[14px] font-semibold text-ink-strong">
                {editingPersona.id ? t('编辑导师人格') : t('新建导师人格')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPersona(null)}
                className="rounded p-1 text-ink-soft transition hover:bg-line hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-[12px]">
              <div>
                <label className="block font-medium text-ink mb-1">{t('人格名称')}</label>
                <input
                  type="text"
                  value={editingPersona.label || ''}
                  onChange={(e) => setEditingPersona({ ...editingPersona, label: e.target.value })}
                  placeholder={t('例如：苏格拉底式启发导师')}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-ink mb-1">{t('简称（2-4字）')}</label>
                  <input
                    type="text"
                    value={editingPersona.short || ''}
                    onChange={(e) => setEditingPersona({ ...editingPersona, short: e.target.value })}
                    placeholder={t('例如：启发')}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                  />
                </div>
                <div>
                  <label className="block font-medium text-ink mb-1">{t('角色定位')}</label>
                  <input
                    type="text"
                    value={editingPersona.role || ''}
                    onChange={(e) => setEditingPersona({ ...editingPersona, role: e.target.value })}
                    placeholder={t('例如：层层提问的引导者')}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-ink mb-1">{t('核心主张标语')}</label>
                <input
                  type="text"
                  value={editingPersona.tagline || ''}
                  onChange={(e) => setEditingPersona({ ...editingPersona, tagline: e.target.value })}
                  placeholder={t('例如：「我不直接给答案，而是通过提问让你自己发现真理。」')}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                />
              </div>

              <div>
                <label className="block font-medium text-ink mb-1">{t('完整人设与指令提示词')}</label>
                <textarea
                  rows={6}
                  value={editingPersona.instruction || ''}
                  onChange={(e) => setEditingPersona({ ...editingPersona, instruction: e.target.value })}
                  placeholder={t('从现在起，用这个人格教我...\n\n说话方式：\n- 每次只抛出一个关键问题\n- 根据学生的回答层层递进\n...')}
                  className="w-full font-mono rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-seal resize-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setEditingPersona(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-line/60"
              >
                {t('取消')}
              </button>
              <button
                type="button"
                onClick={handleSavePersona}
                className="rounded-lg bg-seal px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
              >
                {t('保存人格')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 格式策略编辑弹窗 */}
      {editingFormat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-line-strong bg-card p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <h3 className="text-[14px] font-semibold text-ink-strong">
                {editingFormat.id ? t('编辑文档生成策略') : t('新建文档生成策略')}
              </h3>
              <button
                type="button"
                onClick={() => setEditingFormat(null)}
                className="rounded p-1 text-ink-soft transition hover:bg-line hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-3.5 text-[12px]">
              <div>
                <label className="block font-medium text-ink mb-1">{t('策略名称')}</label>
                <input
                  type="text"
                  value={editingFormat.label || ''}
                  onChange={(e) => setEditingFormat({ ...editingFormat, label: e.target.value })}
                  placeholder={t('例如：技术架构设计规范')}
                  className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-ink mb-1">{t('简称（2-4字）')}</label>
                  <input
                    type="text"
                    value={editingFormat.short || ''}
                    onChange={(e) => setEditingFormat({ ...editingFormat, short: e.target.value })}
                    placeholder={t('例如：架构设计')}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                  />
                </div>
                <div>
                  <label className="block font-medium text-ink mb-1">{t('说明简介')}</label>
                  <input
                    type="text"
                    value={editingFormat.desc || ''}
                    onChange={(e) => setEditingFormat({ ...editingFormat, desc: e.target.value })}
                    placeholder={t('例如：规范的技术架构文档，包含图表与接口设计')}
                    className="w-full rounded-lg border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink outline-none focus:border-seal"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-ink mb-1">{t('生成与排版指令提示词')}</label>
                <textarea
                  rows={6}
                  value={editingFormat.instruction || ''}
                  onChange={(e) => setEditingFormat({ ...editingFormat, instruction: e.target.value })}
                  placeholder={t('从现在起，生成教学文档时遵循以下排版规范：\n\n1. 结构包括：背景阐述、核心架构、时序交互、API规范、权衡考量\n2. 广泛使用 Mermaid 流程图与时序图\n...')}
                  className="w-full font-mono rounded-lg border border-line bg-paper px-3 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-seal resize-none"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setEditingFormat(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-line/60"
              >
                {t('取消')}
              </button>
              <button
                type="button"
                onClick={handleSaveDocFormat}
                className="rounded-lg bg-seal px-4 py-1.5 text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
              >
                {t('保存策略')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提示词查看与对比弹窗 */}
      {viewingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-line-strong bg-card p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-ink-strong">
                  {viewingPrompt.title}
                </h3>
                <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-faint">
                  {viewingPrompt.isBuiltin ? t('内置') : t('自定义')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingPrompt(null)}
                className="rounded p-1 text-ink-soft transition hover:bg-line hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            <div className="my-4 min-h-0 flex-1 overflow-y-auto">
              <pre className="whitespace-pre-wrap select-text rounded-xl border border-line bg-paper-deep/70 p-3.5 font-mono text-[11.5px] leading-relaxed text-ink">
                {viewingPrompt.instruction}
              </pre>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => handleCopyPrompt(viewingPrompt.instruction)}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-ink transition hover:bg-line/60"
              >
                {copiedPrompt ? <Check size={13} className="text-seal" /> : <Copy size={13} />}
                <span>{copiedPrompt ? t('已复制') : t('复制提示词')}</span>
              </button>

              <div className="flex items-center gap-2">
                {viewingPrompt.isBuiltin && (
                  <button
                    type="button"
                    onClick={handleCreateFromTemplate}
                    className="flex items-center gap-1.5 rounded-lg border border-seal/60 bg-seal/10 px-3 py-1.5 text-[12px] font-medium text-seal transition hover:bg-seal/15"
                  >
                    <Plus size={13} />
                    <span>{t('基于此模板新建')}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewingPrompt(null)}
                  className="rounded-lg bg-line/80 px-4 py-1.5 text-[12px] font-medium text-ink transition hover:bg-line"
                >
                  {t('关闭')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
