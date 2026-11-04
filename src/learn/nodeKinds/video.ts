/**
 * 视频节点：把**一个学习目标**与**一个视频资源**绑在一起的引用（见 learn/video/nodes）。
 *
 * 画布上从 palette 拖到空白处落地，卡上选一个现有视频绑上；之后：
 * - 打开那个视频 = 一并打开这个目标的页签组（页签归属见 groups/goals 的 video 分支）；
 * - 视频被引用期间不许删除（删除守卫读 videoNodes 这张事实源表）；
 * - 视频页里出现「视频总结」按钮（按字幕做语义分段，进度条上钉分段点）；
 * - 视频节点可以作为上级挂接文档节点（例如「视频总览文档」）。
 */
import { addEdge, removeEdge } from '../graph'
import { bindVideoNode, videoNodeById } from '../video/nodes'
import { GNode, type ConnectFilter, type NodeHelp, type NodeRelation, type NodeResult } from './base'

export class VideoGNode extends GNode {
  constructor(ctx: ConstructorParameters<typeof GNode>[0], uuid: string) {
    super(ctx, uuid)
  }

  get kind(): 'video' {
    return 'video'
  }

  protected get kindLabel(): string {
    return '视频'
  }

  /** 身后的实体记录（videoNodes 表里的一行） */
  private get entity() {
    return videoNodeById(this.ctx.store(), this.uuid)
  }

  get title(): string {
    const e = this.entity
    if (!e) return '视频 · 已不在'
    if (!e.videoId) return '视频 · 未绑定'
    const video = this.ctx.store().videos?.find((v) => v.id === e.videoId)
    return (video?.title ?? e.videoId) + ' · 视频'
  }

  exists(): boolean {
    return !!this.entity
  }

  get relations(): NodeRelation[] {
    const s = this.ctx.store()
    const out: NodeRelation[] = []
    for (const e of s.edges) {
      if (e.from === this.uuid) {
        out.push({ id: e.to, type: 'down', ...(e.portKey ? { portKey: e.portKey } : {}) })
      } else if (e.to === this.uuid) {
        out.push({ id: e.from, type: 'up', ...(e.portKey ? { portKey: e.portKey } : {}) })
      }
    }
    return out
  }

  get content(): unknown {
    const e = this.entity
    if (!e) return null
    const video = e.videoId ? this.ctx.store().videos?.find((v) => v.id === e.videoId) : undefined
    return {
      videoId: e.videoId,
      goalId: e.goalId,
      ...(video
        ? { title: video.title, plugin: video.pluginName ?? video.pluginId, selection: video.selection?.title ?? null }
        : {}),
    }
  }

  /** 内容形状：{ videoId }。给 id = 绑定 / 换绑；给 null / 空串 = 解绑（节点留下） */
  editContent(next: unknown): NodeResult {
    const e = this.entity
    if (!e) return { error: '这个视频节点已经不在了' }
    let p = next
    if (typeof next === 'string') {
      try {
        p = JSON.parse(next)
      } catch {
        return { error: '视频节点的内容是 { videoId } 对象（传字符串时必须是合法 JSON）' }
      }
    }
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { error: '视频节点的内容是 { videoId }：给视频 id 绑定，给 null 解绑' }
    }
    const input = p as Record<string, unknown>
    if (!('videoId' in input)) {
      return { error: '视频节点只认 videoId 一个字段：给视频 id 绑定，给 null 解绑（标题等显示信息都在视频资源上）' }
    }
    const videoId = input.videoId === null ? null : typeof input.videoId === 'string' ? input.videoId : ''
    const r = bindVideoNode(this.ctx.store(), this.uuid, videoId, Date.now())
    if ('error' in r) return { error: r.error }
    this.ctx.commit(r.store)
    return r.entity.videoId
      ? { ok: true, note: '已把「' + r.entity.videoId + '」绑到这个目标（打开那个视频会一并打开它的页签组）' }
      : { ok: true, note: '已解绑：视频资源还在侧栏里，这枚节点留在画布上可再选别的视频' }
  }

  help(): NodeHelp {
    const e = this.entity
    const video = e?.videoId ? this.ctx.store().videos?.find((v) => v.id === e.videoId) : undefined
    return {
      description:
        '视频节点——把一个学习目标和一个视频资源绑在一起的引用。' +
        (video ? '当前绑着「' + video.title + '」。' : e ? '还没有绑视频。' : ''),
      edit:
        '内容形状：{ videoId }。给视频的 id 绑定 / 换绑，给 null 解绑；视频列表先看 api.node.list() 的 videos 段。\n绑定是双向的：视频资源上也会记下这枚节点（被引用的视频删除会被拦下）。',
      connection:
        '不参与树结构（无上游）：下游可挂文档（如视频总览文档），通过 api.node.create({ kind: "doc", under: 我的 uuid }) 创建即挂；或通过 connect(文档, "down") 连线。删除走 api.node.delete。',
    }
  }

  onDownstream(node: GNode): ConnectFilter {
    if (node.kind === 'doc') return true
    return '视频节点下游只能挂文档（如视频总览文档）'
  }

  onUpstream(_node: GNode): ConnectFilter {
    return '视频节点不能作为其他节点的下游'
  }

  protected link(down: GNode): NodeResult {
    const s = this.ctx.store()
    if (!this.entity) return { error: '这个视频节点已经不在了' }
    if (down.kind !== 'doc') return { error: '视频节点下游只能挂文档' }
    const r = addEdge(s, this.uuid, down.uuid)
    if (!r.added) return { error: r.reason ?? '连接失败' }
    this.ctx.commit(r.store)
    return { ok: true, note: '已将文档「' + down.title + '」挂在视频节点之下' }
  }

  protected unlink(target: GNode): NodeResult {
    const s = this.ctx.store()
    const r = removeEdge(s, this.uuid, target.uuid)
    this.ctx.commit(r)
    return { ok: true, note: '已断开与文档「' + target.title + '」的连接' }
  }
}
