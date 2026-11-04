import type { SandboxOptions, VideoInfoResult } from '../../agent/sandbox/types'
import { resolveVideoSource } from '../../lib/videoPlugins'
import type { AgentOpsDeps } from './deps'

/**
 * 视频资源与选集信息操作（video.*）：
 * 提供列出视频及解析获取选集列表（episodes）的能力。
 */
export function createVideoOps(deps: AgentOpsDeps): SandboxOptions['video'] {
  return {
    list: () => {
      const store = deps.getLatest()
      return (store.videos ?? []).map((v) => ({
        id: v.id,
        title: v.title,
        plugin: v.pluginName ?? v.pluginId,
      }))
    },
    get: async (target: string): Promise<VideoInfoResult> => {
      const store = deps.getLatest()
      const raw = (target ?? '').trim()
      // 若 target 是视频节点 uuid，优先取其绑定的 videoId
      const vNode = (store.videoNodes ?? []).find((vn) => vn.id === raw)
      const videoId = vNode?.videoId ?? raw
      const video = (store.videos ?? []).find((v) => v.id === videoId)
      if (!video) {
        return {
          ok: false,
          id: raw,
          title: '',
          hasEpisodes: false,
          episodeCount: 0,
          episodes: [],
          error: `未找到视频资源「${raw}」`,
        }
      }
      try {
        const src = await resolveVideoSource(video.selection?.source ?? video.input, video.fields)
        let episodes: Array<{ page: number; title: string; source: string; durationMs?: number }> = []
        if (src.pages && src.pages.length > 0) {
          episodes = src.pages.map((p) => ({
            page: p.page,
            title: p.title,
            source: p.source,
            durationMs: p.durationMs,
          }))
        } else if (src.collection?.items && src.collection.items.length > 0) {
          episodes = src.collection.items.map((it, idx) => ({
            page: idx + 1,
            title: it.title,
            source: it.source,
            durationMs: it.durationMs,
          }))
        }
        return {
          ok: true,
          id: video.id,
          title: src.title || video.title,
          hasEpisodes: episodes.length > 1,
          episodeCount: episodes.length,
          episodes,
        }
      } catch (err) {
        return {
          ok: false,
          id: video.id,
          title: video.title,
          hasEpisodes: false,
          episodeCount: 0,
          episodes: [],
          error: `解析视频选集失败: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  }
}
