import { useEffect, useMemo, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Globe2,
  Lightbulb,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import type { LearningGoal, MemoryItem, MemoryStore, MemoryType } from '../../learn/types'
import {
  MEMORY_CONTENT_MAX,
  MEMORY_KEYS_MAX,
  MEMORY_TITLE_MAX,
  normalizeKeys,
  type MemoryInput,
  type MemoryPatch,
} from '../../learn/memory'
import { pane } from '../Pane'
import { t } from '../../i18n'

/**
 * 记忆管理（一处实现，两个外壳）。
 *
 * 两种外壳指的是入口，不是两套逻辑：
 * - `embedded`：超级导师设置 →「记忆管理」分页（AgentSettingsPanel）；
 * - `page`：文档区的记忆页签（入口在 agent 栏输入框的「+」菜单）。
 * 从前这是两份界面、两套写法（一份按目标平铺、一份只看单个目标），同一件事要看两个地方，
 * 这次合成一份：数据、筛选、表单、删除纪律都只有一处。
 *
 * 界面按**记忆的两类**分区，因为它们的语义真的不同（见 learn/memory）：
 * - 长期记忆跨目标共享，删它要两步确认——它是所有目标的共同底账；
 * - 工作记忆只属于一个目标，agent 觉得是负担就能删，这里点一下也直接删。
 */

export type MemoryFilter = 'all' | MemoryType

interface Props {
  goals: LearningGoal[]
  memory: MemoryStore
  /** 当前目标：新建工作记忆时的默认归属；null = 还没有目标 */
  activeGoalId: string | null
  /** 外壳：设置页分页 / 文档区整页 */
  variant: 'page' | 'embedded'
  /** 打开时的筛选（记忆页签默认落在工作记忆上） */
  initialFilter?: MemoryFilter
  /** 打开时默认筛到哪个目标（记忆页签带着它来） */
  initialGoalId?: string | null
  onCreate: (input: MemoryInput) => void
  onUpdate: (uuid: string, patch: MemoryPatch) => void
  onDelete: (uuid: string) => void
  onClearWork: (goalId: string) => void
  onToast: (msg: string) => void
}

/** 时间：到分钟为止，够认出先后即可 */
const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** 表单草稿（新建与编辑共用一个形状） */
interface Draft {
  type: MemoryType
  goalId: string
  title: string
  keys: string
  content: string
}

const emptyDraft = (type: MemoryType, goalId: string): Draft => ({ type, goalId, title: '', keys: '', content: '' })

export default function MemoryManager({
  goals,
  memory,
  activeGoalId,
  variant,
  initialFilter = 'all',
  initialGoalId = null,
  onCreate,
  onUpdate,
  onDelete,
  onClearWork,
  onToast,
}: Props) {
  const [filter, setFilter] = useState<MemoryFilter>(initialFilter)
  const [goalFilter, setGoalFilter] = useState<string>(initialGoalId ?? '')
  const [query, setQuery] = useState('')
  /** 正在编辑的 uuid（null = 没在编辑）；`new` = 正在新建 */
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('work', initialGoalId ?? activeGoalId ?? goals[0]?.id ?? ''))
  /** 待确认删除的 uuid（长期记忆要两步） */
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /** 待确认清空的目标 id（清空一整本工作记忆也要两步） */
  const [confirmClear, setConfirmClear] = useState<string | null>(null)
  /** 展开看全文的 uuid */
  const [expanded, setExpanded] = useState<string | null>(null)

  const goalTitle = useMemo(() => {
    const map = new Map(goals.map((g) => [g.id, g.question]))
    return (id: string): string => map.get(id) ?? t('未知目标')
  }, [goals])

  /** 展开成「带归属」的条目：工作记忆要标出它属于哪个目标 */
  const rows = useMemo(() => {
    const list: Array<{ item: MemoryItem; goalId: string | null }> = []
    for (const item of memory.long) list.push({ item, goalId: null })
    for (const [goalId, items] of Object.entries(memory.work)) {
      for (const item of items) list.push({ item, goalId })
    }
    return list.sort((a, b) => b.item.updateAt - a.item.updateAt)
  }, [memory])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(({ item, goalId }) => {
      if (filter !== 'all' && item.type !== filter) return false
      // 目标筛选只作用于工作记忆：长期记忆没有归属，选了目标也不该把它筛掉
      if (goalFilter && item.type === 'work' && goalId !== goalFilter) return false
      if (!q) return true
      const hay = [item.title, item.content, item.keys.join(' '), goalId ? goalTitle(goalId) : '']
        .join('\n')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, filter, goalFilter, query, goalTitle])

  const longRows = filtered.filter((r) => r.item.type === 'long')
  const workRows = filtered.filter((r) => r.item.type === 'work')
  const longCount = memory.long.length
  const workCount = Object.values(memory.work).reduce((n, list) => n + list.length, 0)
  const activeWorkCount = activeGoalId ? (memory.work[activeGoalId]?.length ?? 0) : 0

  // 目标列表变了（比如刚新建目标）而草稿里的归属已失效时，落回当前目标
  useEffect(() => {
    if (!draft.goalId || !goals.some((g) => g.id === draft.goalId)) {
      const next = activeGoalId ?? goals[0]?.id ?? ''
      if (next) setDraft((d) => ({ ...d, goalId: next }))
    }
  }, [goals, activeGoalId, draft.goalId])

  const startNew = (type: MemoryType) => {
    setEditing('new')
    setConfirmDel(null)
    setDraft(emptyDraft(type, goalFilter || activeGoalId || goals[0]?.id || ''))
  }

  const startEdit = (item: MemoryItem, goalId: string | null) => {
    setEditing(item.uuid)
    setConfirmDel(null)
    setDraft({
      type: item.type,
      goalId: goalId ?? activeGoalId ?? goals[0]?.id ?? '',
      title: item.title,
      keys: item.keys.join(', '),
      content: item.content,
    })
  }

  const submit = () => {
    const content = draft.content.trim()
    if (!content) {
      onToast(t('记忆内容不能为空'))
      return
    }
    if (draft.type === 'work' && !draft.goalId) {
      onToast(t('请先选择一个学习目标'))
      return
    }
    if (editing === 'new') {
      onCreate({
        type: draft.type,
        goalId: draft.type === 'work' ? draft.goalId : null,
        title: draft.title,
        keys: draft.keys,
        content,
      })
      onToast(t('已新建一条记忆'))
    } else if (editing) {
      onUpdate(editing, {
        type: draft.type,
        ...(draft.type === 'work' ? { goalId: draft.goalId } : {}),
        title: draft.title,
        keys: draft.keys,
        content,
      })
      onToast(t('记忆已更新'))
    }
    setEditing(null)
  }

  const remove = (item: MemoryItem) => {
    // 长期记忆两步确认：它跨目标，删掉之后别的目标也跟着失忆
    if (item.type === 'long' && confirmDel !== item.uuid) {
      setConfirmDel(item.uuid)
      window.setTimeout(() => setConfirmDel((cur) => (cur === item.uuid ? null : cur)), 4000)
      return
    }
    setConfirmDel(null)
    onDelete(item.uuid)
    onToast(item.type === 'long' ? t('长期记忆已删除') : t('工作记忆已删除'))
  }

  const draftKeys = normalizeKeys(draft.keys)

  /**
   * 表单：新建时是一块独立的卡片；在列表里就地编辑时**不带外框**——
   * 它已经在那张卡片里了，再套一层边框就是「盒子里的盒子」。
   */
  const renderForm = (bare: boolean) => (
    <section className={bare ? '' : 'rounded-xl border border-seal/30 bg-seal/5 p-3.5'}>
      <div className="flex items-center gap-2 pb-2.5 text-[12.5px] font-semibold text-ink-strong">
        <Sparkles size={13} className="text-seal" />
        {editing === 'new' ? t('新建一条记忆') : t('编辑这条记忆')}
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-ink-faint transition hover:bg-line/60 hover:text-ink"
          title={t('取消')}
        >
          <X size={13} />
        </button>
      </div>

      {/* 类型：两类记忆的分工写在按钮下面，选的时候就看得到 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['work', 'long'] as MemoryType[]).map((type) => {
          const on = draft.type === type
          return (
            <button
              key={type}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, type }))}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] transition ${
                on
                  ? 'border-seal/50 bg-seal/10 text-seal-deep'
                  : 'border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink'
              }`}
            >
              {type === 'long' ? <Globe2 size={12} /> : <Target size={12} />}
              {type === 'long' ? t('长期记忆') : t('工作记忆')}
            </button>
          )
        })}
        {draft.type === 'work' && goals.length > 0 && (
          <select
            value={draft.goalId}
            onChange={(e) => setDraft((d) => ({ ...d, goalId: e.target.value }))}
            className="ml-auto max-w-[220px] rounded-lg border border-line bg-paper px-2 py-1 text-[11.5px] text-ink-strong outline-none focus:border-seal/60"
          >
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.question}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
        {draft.type === 'long'
          ? t('跨目标共享：记对用户的印象、作息与重要约定。任何目标的导师都读得到，删除需要二次确认。')
          : t('目标级：记这个目标里发生了什么、要做什么、过程与结果。只有本目标的导师读得到，可随时删。')}
      </p>

      <input
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder={t('标题：一行说清这条记忆是什么')}
        maxLength={MEMORY_TITLE_MAX}
        className="mt-2.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
      />
      <input
        value={draft.keys}
        onChange={(e) => setDraft((d) => ({ ...d, keys: e.target.value }))}
        placeholder={t('关键词（逗号分隔，最多 {0} 个）', MEMORY_KEYS_MAX)}
        className="mt-1.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
      />
      {draftKeys.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {draftKeys.map((k) => (
            <span key={k} className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
              {k}
            </span>
          ))}
        </div>
      )}
      <textarea
        value={draft.content}
        onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
        placeholder={t('详细内容：发生了什么 / 要做什么 / 怎么做 / 结果怎么样，或者你对用户的印象与约定')}
        rows={5}
        maxLength={MEMORY_CONTENT_MAX}
        className="mt-1.5 w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-2 text-[12px] leading-relaxed text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10.5px] text-ink-faint">
          {t('{0} / {1} 字符', draft.content.length, MEMORY_CONTENT_MAX)}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.content.trim()}
          className="ml-auto flex items-center gap-1 rounded-lg bg-seal px-3 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-seal-deep disabled:pointer-events-none disabled:opacity-40"
        >
          <Check size={12} />
          {editing === 'new' ? t('保存') : t('保存修改')}
        </button>
      </div>
    </section>
  )

  const card = ({ item, goalId }: { item: MemoryItem; goalId: string | null }) => {
    const long = item.type === 'long'
    const open = expanded === item.uuid
    const longContent = item.content.length > 180 || item.content.split('\n').length > 4
    return (
      <li key={item.uuid} className="rounded-xl border border-line bg-card px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              long ? 'bg-seal/10 text-seal-deep' : 'bg-line/60 text-ink-soft'
            }`}
          >
            {long ? <Globe2 size={10} /> : <Target size={10} />}
            {long ? t('长期') : t('工作')}
          </span>
          <h4 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-strong" title={item.title}>
            {item.title}
          </h4>
          <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">{fmtTime(item.updateAt)}</span>
          {editing !== item.uuid && (
            <>
              <button
                type="button"
                title={t('编辑')}
                onClick={() => startEdit(item, goalId)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/60 hover:text-ink"
              >
                <Pencil size={12} />
              </button>
              <button
                type="button"
                title={confirmDel === item.uuid ? t('再点一次确认删除') : long ? t('删除（需要二次确认）') : t('删除')}
                onClick={() => remove(item)}
                onBlur={() => setConfirmDel((cur) => (cur === item.uuid ? null : cur))}
                className={`flex h-6 shrink-0 items-center justify-center rounded transition ${
                  confirmDel === item.uuid
                    ? 'bg-warn/10 px-1.5 text-[10.5px] font-medium text-warn-deep ring-1 ring-warn/40'
                    : 'w-6 text-ink-faint hover:bg-line/60 hover:text-warn-deep'
                }`}
              >
                {confirmDel === item.uuid ? t('确认删除') : <Trash2 size={12} />}
              </button>
            </>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {goalId && (
            <span className="text-[10.5px] text-ink-faint">
              {t('归属')}: {goalTitle(goalId)}
            </span>
          )}
          {item.keys.map((k) => (
            <span key={k} className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
              {k}
            </span>
          ))}
        </div>

        {editing === item.uuid ? (
          <div className="mt-2">{renderForm(true)}</div>
        ) : (
          <>
            <p
              className={`mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-soft ${
                longContent && !open ? 'line-clamp-4' : ''
              }`}
            >
              {item.content}
            </p>
            {longContent && (
              <button
                type="button"
                onClick={() => setExpanded(open ? null : item.uuid)}
                className="mt-1 flex items-center gap-1 text-[10.5px] text-ink-faint transition hover:text-ink-soft"
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {open ? t('收起') : t('展开全文')}
              </button>
            )}
          </>
        )}
      </li>
    )
  }

  const body = (
    <>
      {/* 概览 */}
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-gradient-to-br from-card via-card to-paper-deep/50 px-4 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-seal/20 bg-seal/10 text-seal">
          <Brain size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* 页签外壳的顶栏已经写着「记忆管理」，这里不再重复一次 */}
            <h3 className="text-[13.5px] font-bold text-ink-strong">
              {variant === 'page' ? t('概览') : t('记忆管理')}
            </h3>
            <span className="rounded-full bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep">
              {t('长期 {0} · 工作 {1}', longCount, workCount)}
            </span>
            {activeGoalId && (
              <span className="rounded-full bg-line/60 px-2 py-0.5 text-[10.5px] text-ink-soft">
                {t('当前目标 {0} 条', activeWorkCount)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
            {t('导师在对话里自己记下的东西：工作记忆跟着目标走，长期记忆跨目标共享。它们不会自动进上下文，需要时导师自己来翻。')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (editing === 'new' ? setEditing(null) : startNew(filter === 'long' ? 'long' : 'work'))}
          className="flex items-center gap-1.5 rounded-xl bg-seal px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep"
        >
          <Plus size={14} />
          {editing === 'new' ? t('收起表单') : t('新建记忆')}
        </button>
      </section>

      {/* 新建表单：列表顶部，写完就消失 */}
      {editing === 'new' && renderForm(false)}

      {/* 工具条：搜索 + 类型筛选 + 目标筛选 */}
      <section className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('搜索标题、内容或关键词')}
            className="w-full rounded-lg border border-line bg-paper py-1.5 pl-7 pr-2.5 text-[11.5px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-paper p-0.5">
          {(
            [
              ['all', t('全部')],
              ['long', t('长期')],
              ['work', t('工作')],
            ] as Array<[MemoryFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                filter === key ? 'bg-seal/10 font-medium text-seal-deep' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {(filter === 'all' || filter === 'work') && goals.length > 1 && (
          <select
            value={goalFilter}
            onChange={(e) => setGoalFilter(e.target.value)}
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[11.5px] text-ink-soft outline-none focus:border-seal/60"
          >
            <option value="">{t('全部目标')}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.question}
              </option>
            ))}
          </select>
        )}
        {goalFilter && (memory.work[goalFilter]?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => {
              if (confirmClear !== goalFilter) {
                setConfirmClear(goalFilter)
                window.setTimeout(() => setConfirmClear((cur) => (cur === goalFilter ? null : cur)), 4000)
                return
              }
              setConfirmClear(null)
              onClearWork(goalFilter)
              onToast(t('已清空这个目标的工作记忆'))
            }}
            onBlur={() => setConfirmClear((cur) => (cur === goalFilter ? null : cur))}
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition ${
              confirmClear === goalFilter
                ? 'bg-warn/10 text-warn-deep ring-1 ring-warn/40'
                : 'text-ink-faint hover:bg-line/60 hover:text-warn-deep'
            }`}
          >
            <Trash2 size={11} />
            {confirmClear === goalFilter ? t('再点一次确认清空') : t('清空该目标的工作记忆')}
          </button>
        )}
      </section>

      {/* 长期记忆 */}
      {filter !== 'work' && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft">
            <Globe2 size={12} className="text-seal" />
            {t('长期记忆')}
            <span className="font-normal text-ink-faint">
              {t('· 跨目标共享，{0} 条', longRows.length)}
            </span>
          </div>
          {longRows.length ? (
            <ul className="flex flex-col gap-2">{longRows.map(card)}</ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] text-ink-faint">
              {t('还没有长期记忆。对用户的印象、作息、定下的约定该放这里——它跨目标都读得到。')}
            </p>
          )}
        </section>
      )}

      {/* 工作记忆 */}
      {filter !== 'long' && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft">
            <Target size={12} className="text-ink-soft" />
            {t('工作记忆')}
            <span className="font-normal text-ink-faint">
              {goalFilter
                ? t('· {0}，{1} 条', goalTitle(goalFilter), workRows.length)
                : t('· 目标级，{0} 条', workRows.length)}
            </span>
          </div>
          {workRows.length ? (
            <ul className="flex flex-col gap-2">{workRows.map(card)}</ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[11px] text-ink-faint">
              {t('这个范围还没有工作记忆。导师做一段活之后记下「做到哪、下一步做什么」，下轮就不用你重复交代。')}
            </p>
          )}
        </section>
      )}

      {/* 机制说明：为什么这些字不会自动出现在对话里 */}
      <section className="flex items-start gap-2 rounded-xl border border-line/60 bg-paper-deep/40 p-3 text-[10.5px] leading-relaxed text-ink-faint">
        <Lightbulb size={13} className="mt-0.5 shrink-0 text-seal" />
        <div>
          <span className="font-semibold text-ink-soft">{t('为什么不自动注入：')}</span>
          {t(
            '记忆一旦拼进系统提示词，前缀缓存每一轮都会失效、上下文也会逐轮漂移。所以这里写下的内容不会立刻改变导师的行为——等他下一次主动 api.memory.list / get 时生效。',
          )}
        </div>
      </section>
    </>
  )

  if (variant === 'embedded') return <div className={pane(4)}>{body}</div>

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-paper">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <Brain size={15} className="text-seal" />
        <h2 className="text-[15px] font-semibold text-ink-strong">{t('记忆管理')}</h2>
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
          {initialGoalId ? `${t('当前目标')}: ${goalTitle(initialGoalId)}` : t('长期记忆跨目标共享')}
        </span>
      </header>
      <div className={pane(4)}>{body}</div>
    </div>
  )
}
