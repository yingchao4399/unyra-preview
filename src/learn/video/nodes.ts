/**
 * 视频节点的数据层：目标 × 视频的绑定表（store.videoNodes）与它的**双向镜像**
 * （VideoResource.boundTo）。
 *
 * 谁是事实源：store.videoNodes。引用判定（删除守卫、打开视频找目标、总结按钮的
 * 出现条件）一律扫这张表；boundTo 是写给**视频资源**的那一份记录（「学习视频的数据
 * 也会有记录」），由这里的写操作两边同一次提交一起动、读盘归一时整表重建——
 * 它漂了只影响显示，不影响判定。
 *
 * 不进大纲树：视频节点没有树边、没有上下游，绑定就是它的全部语义。
 */
import type { LearnStore, VideoNodeEntity } from '../types'

/** 取一枚视频节点；不在了返回 undefined */
export function videoNodeById(store: LearnStore, id: string): VideoNodeEntity | undefined {
  return (store.videoNodes ?? []).find((v) => v.id === id)
}

/** 引用着某个视频的全部视频节点（删除守卫、打开时找目标、总结按钮判据都走它） */
export function videoBindingsOf(store: LearnStore, videoId: string): VideoNodeEntity[] {
  return (store.videoNodes ?? []).filter((v) => v.videoId === videoId)
}

/** 这个视频此刻有没有被任何目标绑着（「绑定后」才出现的行为判据） */
export function isVideoBound(store: LearnStore, videoId: string): boolean {
  return videoBindingsOf(store, videoId).length > 0
}

/**
 * 按事实源（videoNodes）重建视频资源上的 boundTo 镜像。读盘归一与目标删除用——
 * 落库的那份永远可以从这张表推回来，镜像里不该有任何「推不出来」的东西。
 */
export function withVideoMirror(store: LearnStore): LearnStore {
  const refs = new Map<string, string[]>()
  for (const v of store.videoNodes ?? []) {
    if (!v.videoId) continue
    refs.set(v.videoId, [...(refs.get(v.videoId) ?? []), v.id])
  }
  const videos = (store.videos ?? []).map((video) => {
    const boundTo = refs.get(video.id) ?? []
    if (boundTo.length) return { ...video, boundTo }
    // 没有引用了：把旧镜像摘掉（只对真有过的资产生成新对象，别的原样返回）
    if (!video.boundTo?.length) return video
    const { boundTo: _stale, ...rest } = video
    return rest
  })
  return { ...store, videos }
}

/** 建一枚空视频节点（还没选视频；画布 palette 落地与 agent 建节点走这里） */
export function createVideoNode(
  store: LearnStore,
  goalId: string,
  at: number,
): { store: LearnStore; entity: VideoNodeEntity } {
  const entity: VideoNodeEntity = {
    id: crypto.randomUUID(),
    goalId,
    videoId: null,
    createdAt: at,
    updatedAt: at,
  }
  return { store: { ...store, videoNodes: [...(store.videoNodes ?? []), entity] }, entity }
}

/**
 * 绑定 / 换绑 / 解绑一枚视频节点。videoId 为 null 或空串 = 解绑（节点留在画布上，
 * 随时再选）。两边（节点表 + 资源镜像）同一次提交一起动。
 */
export function bindVideoNode(
  store: LearnStore,
  nodeId: string,
  videoId: string | null,
  at: number,
): { store: LearnStore; entity: VideoNodeEntity } | { error: string } {
  const entity = videoNodeById(store, nodeId)
  if (!entity) return { error: '这个视频节点已经不在了' }
  const raw = (videoId ?? '').trim()
  if (raw && !(store.videos ?? []).some((v) => v.id === raw)) {
    return { error: '没有这个视频：先在侧栏「视频」里创建，再来绑' }
  }
  const next: VideoNodeEntity = { ...entity, videoId: raw || null, updatedAt: at }
  return { store: withVideoMirror({ ...store, videoNodes: (store.videoNodes ?? []).map((v) => (v.id === nodeId ? next : v)) }), entity: next }
}

/** 删掉一枚视频节点（视频资源不动，镜像重建） */
export function deleteVideoNode(store: LearnStore, nodeId: string): LearnStore | null {
  if (!videoNodeById(store, nodeId)) return null
  const edges = store.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
  return withVideoMirror({ ...store, edges, videoNodes: (store.videoNodes ?? []).filter((v) => v.id !== nodeId) })
}

/**
 * 读盘归一：只认「id 唯一 + 目标还在」的条目；videoId 指向的视频不在了就把绑定
 * 摘掉（节点留下来当空节点——删除守卫拦着，这只兜手改过的 state.json）。
 */
export function normalizeVideoNodes(raw: unknown, goalIds: ReadonlySet<string>, videoIds: ReadonlySet<string>): VideoNodeEntity[] {
  if (!Array.isArray(raw)) return []
  const out: VideoNodeEntity[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const goalId = typeof o.goalId === 'string' ? o.goalId : ''
    if (!id || !goalId || seen.has(id) || !goalIds.has(goalId)) continue
    seen.add(id)
    const videoId = typeof o.videoId === 'string' && o.videoId.trim() && videoIds.has(o.videoId.trim()) ? o.videoId.trim() : null
    out.push({
      id,
      goalId,
      videoId,
      createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
      updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
    })
  }
  return out
}
