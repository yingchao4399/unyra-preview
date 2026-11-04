/**
 * 视频 / 音频来源插件 —— 插件家族里的一类（宿主见 lib/plugins，装载与开关都在那里）。
 *
 * 为什么要有这一类：**应用本体零平台知识**。视频学习页签只认契约（流 + 转录），
 * 具体平台（B 站、播客站……）全部在用户自己安装的 `{数据根}/plugins/*.js` 里——
 * 用户装的代码随插件目录走、随用户删除，应用不分发任何平台解析器（合规边界）。
 *
 * 这一类的形状校验与派发都在这里：
 * - normalize：apiVersion / kinds / provides / match / resolve / settings 的硬校验，
 *   不合法就抛一句能直接显示给用户的话；
 * - 派发：match → resolve → 宿主统一归一（normalizeTranscript）与**时长对账**——
 *   插件只交「大致对」的东西，语义一致性由宿主集中收口（B 站串台字幕踩过的坑）。
 *
 * 插件拿到的唯一外部触手是编译期注入的 host（settings / fetch / log，见 lib/plugins
 * 的 PluginHost）：网络必须走主进程通道（渲染层 CSP 拦外网），配置由主进程解密后交来。
 */
import { t } from '../i18n'
import {
  currentCompileHost,
  definePluginCategory,
  pluginOriginOf,
  pluginsOf,
  type PluginBase,
  type PluginHost,
  type PluginSettingField,
  type PluginSettingType,
} from './plugins'
import { formatClock, normalizeTranscript } from '../video/transcript'
import type { Transcript, VideoSource } from '../video/types'

/** 来源种类：视频（有画面）与音频（播客 / 有声书，转录靠字幕或宿主 ASR） */
export type VideoSourceKind = 'video' | 'audio'
/** 能力声明：stream = 能出播放流；transcript = 能直取字幕 */
export type VideoProvides = 'stream' | 'transcript'

/** 插件执行时的上下文（就是编译期注入的 host） */
export type VideoPluginCtx = PluginHost

/** 一类插件的完整形状：PluginBase + 视频来源钩子 */
export interface VideoPlugin extends PluginBase {
  category: 'video'
  kinds: VideoSourceKind[]
  provides: VideoProvides[]
  /** 认领输入；不认识的返回 null（不抛错——抛错也只当不匹配） */
  match(input: string): { input: string } | null
  /** 解析：拿到流与/或转录。失败抛 Error（原话直达界面） */
  resolve(ctx: VideoPluginCtx, matched: { input: string }): Promise<VideoSource>
  /** 只取转录（合集批量导出用）：省略时宿主回退到完整 resolve 再挑 transcript */
  resolveTranscript?(ctx: VideoPluginCtx, matched: { input: string }): Promise<Transcript>
  /** 设置页「测试连接」（可选） */
  onTest?(ctx: VideoPluginCtx): Promise<{ ok: boolean; message?: string }>
  /**
   * 创建视频时**每个视频各填一次**的字段（例如画质、课程密码）。与全局 settings
   * 用同一套声明式 schema；值随视频资源落库，解析时合并进 host.settings
   * （同键以这里的值为准——插件不必区分两份配置从哪来）。
   */
  createFields?: PluginSettingField[]
  /** 编译期注入的宿主（settings 快照 + fetch + log），由 compilePlugin 缝进来 */
  host?: PluginHost
}

const KIND_VALUES: VideoSourceKind[] = ['video', 'audio']
const PROVIDE_VALUES: VideoProvides[] = ['stream', 'transcript']
const SETTING_TYPES: PluginSettingType[] = ['text', 'password', 'number', 'select', 'boolean', 'textarea', 'static']

function asArray(raw: unknown, fallback: VideoSourceKind[] | VideoProvides[], field: string): string[] {
  if (raw === undefined) return [...(fallback as string[])]
  if (!Array.isArray(raw)) throw new Error(t('插件的 {0} 必须是数组', field))
  return raw.filter((x): x is string => typeof x === 'string')
}

/** 声明式配置的硬校验：字段不合法宁可拒载，也别让设置页渲染出半截表单 */
function normalizeSettings(raw: unknown): PluginSettingField[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(t('插件的 settings 必须是数组'))
  const out: PluginSettingField[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error(t('settings 里的每一项都必须是对象'))
    const f = item as Record<string, unknown>
    const key = typeof f.key === 'string' ? f.key.trim() : ''
    const type = typeof f.type === 'string' ? (f.type as PluginSettingType) : null
    const label = typeof f.label === 'string' ? f.label : ''
    if (!key) throw new Error(t('settings 字段缺少 key'))
    if (seen.has(key)) throw new Error(t('settings 字段 key 重复：{0}', key))
    if (!type || !SETTING_TYPES.includes(type)) throw new Error(t('settings 字段「{0}」的 type 不认识', key))
    if (!label) throw new Error(t('settings 字段「{0}」缺少 label', key))
    seen.add(key)
    const field: PluginSettingField = { key, type, label }
    if (typeof f.placeholder === 'string') field.placeholder = f.placeholder
    if (typeof f.help === 'string') field.help = f.help
    if (typeof f.default === 'string' || typeof f.default === 'number' || typeof f.default === 'boolean') {
      field.default = f.default
    }
    if (f.required === true) field.required = true
    if (type === 'select') {
      if (!Array.isArray(f.options) || !f.options.length) {
        throw new Error(t('settings 字段「{0}」是 select，必须给 options', key))
      }
      field.options = f.options
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({ value: String(o.value ?? ''), label: String(o.label ?? o.value ?? '') }))
    }
    out.push(field)
  }
  return out
}

/** 类别登记：形状校验 + 设置页描述 */
definePluginCategory({
  id: 'video',
  label: '视频 / 音频来源',
  hint: '给「视频学习」页签提供流与字幕，或把音频交给语音识别。',
  // 不碰全局渲染管线（marked / 文档缓存），装卸可以在运行中完成
  hotReload: true,
  normalize(raw: Record<string, unknown>, id: string): PluginBase {
    if (raw.apiVersion !== 1) {
      throw new Error(
        t('插件需要 apiVersion: 1（当前宿主契约 v1，插件里写的是 {0}）', String(raw.apiVersion ?? '（没写）')),
      )
    }
    const kinds = asArray(raw.kinds, ['video'], 'kinds').filter((k): k is VideoSourceKind =>
      (KIND_VALUES as string[]).includes(k),
    )
    if (!kinds.length) throw new Error(t('插件的 kinds 必须是 video / audio 之一'))
    const provides = asArray(raw.provides, ['stream'], 'provides').filter((p): p is VideoProvides =>
      (PROVIDE_VALUES as string[]).includes(p),
    )
    if (!provides.length) throw new Error(t('插件的 provides 必须是 stream / transcript 之一'))
    if (typeof raw.match !== 'function') throw new Error(t('插件缺少 match(input) 函数'))
    if (typeof raw.resolve !== 'function') throw new Error(t('插件缺少 resolve(host, matched) 函数'))
    const settings = normalizeSettings(raw.settings)
    const createFields = normalizeSettings(raw.createFields)
    const host = currentCompileHost()
    const plugin: VideoPlugin = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id,
      category: 'video',
      builtin: false,
      defaultEnabled: false,
      kinds,
      provides,
      match: raw.match as VideoPlugin['match'],
      resolve: raw.resolve as VideoPlugin['resolve'],
      ...(typeof raw.resolveTranscript === 'function'
        ? { resolveTranscript: raw.resolveTranscript as VideoPlugin['resolveTranscript'] }
        : {}),
      ...(typeof raw.onTest === 'function' ? { onTest: raw.onTest as VideoPlugin['onTest'] } : {}),
      ...(settings.length ? { settings } : {}),
      ...(createFields.length ? { createFields } : {}),
      ...(typeof raw.version === 'string' ? { version: raw.version } : {}),
      ...(host ? { host } : {}),
    }
    return plugin
  },
  describe(plugin: PluginBase): string[] {
    const p = plugin as VideoPlugin
    const kind = p.kinds?.includes('audio') ? t('音频来源') : t('视频来源')
    const caps = (p.provides ?? [])
      .map((x) => (x === 'stream' ? t('播放流') : t('字幕直取')))
      .join('、')
    return [kind + (caps ? ' · ' + caps : '')]
  },
})

/* ---------- 派发 ---------- */

/** 已装载的视频来源插件（宿主注册表里的那一类） */
export function videoSourcePlugins(): VideoPlugin[] {
  return pluginsOf('video') as VideoPlugin[]
}

/**
 * 组装插件上下文：全局配置是编译期快照，视频级的 createFields 值按次合并
 * （同键以视频资源为准）。没有额外值时直接复用快照，不产生新对象。
 */
function ctxOf(plugin: VideoPlugin, extra?: Record<string, string | number | boolean>): VideoPluginCtx {
  const host = plugin.host
  if (!host) throw new Error(t('插件「{0}」没有装载上下文（重启应用后重试）', plugin.name ?? plugin.id))
  if (!extra || !Object.keys(extra).length) return host
  return { settings: Object.freeze({ ...host.settings, ...extra }), fetch: host.fetch, log: host.log }
}

/** 设置页「测试连接」：按文件找到已装载的视频插件，跑它的 onTest（没声明就算不支持） */
export async function testVideoPlugin(file: string): Promise<{ ok: boolean; message?: string }> {
  const plugin = videoSourcePlugins().find((p) => pluginOriginOf(p.id) === file)
  if (!plugin) return { ok: false, message: t('这个插件还没装载（重启应用后重试）') }
  if (!plugin.onTest) return { ok: false, message: t('这个插件不支持测试连接') }
  return plugin.onTest(ctxOf(plugin))
}

/** 找出认领这个输入的插件；插件自己抛错只当不匹配（错误不外溢） */
export function matchVideoPlugin(input: string): { plugin: VideoPlugin; matched: { input: string } } | null {
  for (const plugin of videoSourcePlugins()) {
    try {
      const matched = plugin.match(input)
      if (matched) return { plugin, matched }
    } catch {
      continue
    }
  }
  return null
}

const NO_PLUGIN_HINT = () =>
  t('没有插件支持这个输入：{0}。视频来源插件在「设置 → 插件 → 视频 / 音频来源」里安装与配置。')

/**
 * 字幕与视频的**时长对账**：字幕末段超出视频时长明显（余量 5 秒之外还超 10%）时
 * 判为平台侧错配，拒之门外。实测确实存在——B 站 AI 字幕给过一条 13:20 的转写，
 * 配的却是 7:39 的视频。脏字幕不进面板，transcriptError 带上两边的时长当证据。
 */
function vetTranscript(source: VideoSource): VideoSource {
  if (!source.transcript || !source.durationMs) return source
  const last = source.transcript.segments[source.transcript.segments.length - 1]
  if (!last) return source
  if (last.endMs > source.durationMs + 5_000 && last.endMs > source.durationMs * 1.1) {
    return {
      ...source,
      transcript: undefined,
      transcriptError: t(
        '字幕时间轴到 {0}，视频只有 {1}——平台侧字幕错配，已拦截不显示',
        formatClock(last.endMs),
        formatClock(source.durationMs),
      ),
    }
  }
  return source
}

/** 解析一次：match → resolve → 归一校验 + 时长对账。错误原话原样上抛 */
export async function resolveVideoSource(
  input: string,
  fields?: Record<string, string | number | boolean>,
): Promise<VideoSource> {
  const hit = matchVideoPlugin(input)
  if (!hit) throw new Error(NO_PLUGIN_HINT().replace('{0}', input.slice(0, 80)))
  const source = await hit.plugin.resolve(ctxOf(hit.plugin, fields), hit.matched)
  const normalized = source.transcript
    ? { ...source, transcript: normalizeTranscript(source.transcript) }
    : source
  return vetTranscript(normalized)
}

/** 只取一份转录（合集批量导出用）：插件有专用路径走专用，没有就完整解析后挑 transcript */
export async function resolveVideoTranscript(
  input: string,
  fields?: Record<string, string | number | boolean>,
): Promise<Transcript> {
  const hit = matchVideoPlugin(input)
  if (!hit) throw new Error(NO_PLUGIN_HINT().replace('{0}', input.slice(0, 80)))
  const ctx = ctxOf(hit.plugin, fields)
  const transcript = hit.plugin.resolveTranscript
    ? await hit.plugin.resolveTranscript(ctx, hit.matched)
    : (await hit.plugin.resolve(ctx, hit.matched)).transcript
  if (!transcript) throw new Error(t('这条来源没有可用字幕'))
  return normalizeTranscript(transcript)
}
