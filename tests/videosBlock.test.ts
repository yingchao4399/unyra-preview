// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  parseEpisodeRange,
  parseVideosBlock,
  videosBlock,
  hydrateVideos,
  setVideoBlockHost,
  cleanVideoNodeUuid,
  cleanRangeText,
  type VideoBlockHost,
} from '../src/lib/videosBlock'

describe('videosBlock 选集链路解析与渲染', () => {
  describe('cleanVideoNodeUuid & cleanRangeText', () => {
    it('去除模板插值符号与属性前缀', () => {
      expect(cleanVideoNodeUuid('{{videoNodeUUID}}')).toBe('')
      expect(cleanVideoNodeUuid('{{ node-12345 }}')).toBe('node-12345')
      expect(cleanVideoNodeUuid('uuid: node-12345')).toBe('node-12345')
      expect(cleanVideoNodeUuid('"node-12345"')).toBe('node-12345')

      expect(cleanRangeText('{{ 1-20 }}')).toBe('1-20')
      expect(cleanRangeText('range: 1-20')).toBe('1-20')
      expect(cleanRangeText('选集: 1-10')).toBe('1-10')
    })
  })
  describe('parseEpisodeRange', () => {
    it('正确解析混合区间与单集：1-20, 23, 29-30', () => {
      const res = parseEpisodeRange('1-20, 23, 29-30')
      expect(Array.isArray(res)).toBe(true)
      const list = res as number[]
      expect(list.length).toBe(23)
      expect(list.slice(0, 5)).toEqual([1, 2, 3, 4, 5])
      expect(list[19]).toBe(20)
      expect(list[20]).toBe(23)
      expect(list[21]).toBe(29)
      expect(list[22]).toBe(30)
    })

    it('支持波浪号与中文连接符：1~5, 8，10至12', () => {
      const res = parseEpisodeRange('1~5, 8，10至12')
      expect(res).toEqual([1, 2, 3, 4, 5, 8, 10, 11, 12])
    })

    it('空值、all 或 * 解析为 all', () => {
      expect(parseEpisodeRange('')).toBe('all')
      expect(parseEpisodeRange('all')).toBe('all')
      expect(parseEpisodeRange('ALL')).toBe('all')
      expect(parseEpisodeRange('*')).toBe('all')
    })

    it('去重并按升序排列', () => {
      expect(parseEpisodeRange('5, 3, 1-3, 5')).toEqual([1, 2, 3, 5])
    })
  })

  describe('parseVideosBlock', () => {
    it('提取首行视频节点 UUID 与次行范围', () => {
      const source = `
      video-node-12345
      1-10, 15
      `
      const parsed = parseVideosBlock(source)
      expect(parsed.videoNodeUuid).toBe('video-node-12345')
      expect(parsed.rangeText).toBe('1-10, 15')
      expect(parsed.episodesRange).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15])
    })

    it('过滤注释与空行', () => {
      const source = `
      // 视频分类
      video-uuid-999
      # 范围定义
      1-3
      `
      const parsed = parseVideosBlock(source)
      expect(parsed.videoNodeUuid).toBe('video-uuid-999')
      expect(parsed.rangeText).toBe('1-3')
      expect(parsed.episodesRange).toEqual([1, 2, 3])
    })
  })

  describe('videosBlock 同步渲染', () => {
    it('包含 data-video-node 与 data-range 占位属性', () => {
      const ctx = {
        escape: (s: string) => s,
        attr: (s: string) => s,
      }
      const html = videosBlock('vn-abc\n1-5', ctx)
      expect(html).toContain('data-video-node="vn-abc"')
      expect(html).toContain('data-range="1-5"')
      expect(html).toContain('moji-videos-block')
    })
  })

  describe('hydrateVideos DOM 水合与交互', () => {
    it('通过 host 读取选集并渲染，点击触发 onOpenEpisode', async () => {
      const onOpen = vi.fn()
      const mockHost: VideoBlockHost = {
        getVideoData: vi.fn().mockResolvedValue({
          videoTitle: '测试课程视频',
          episodes: [
            { page: 1, title: '第一讲 导论', source: 'src-1' },
            { page: 2, title: '第二讲 基础语法', source: 'src-2' },
            { page: 3, title: '第三讲 进阶特性', source: 'src-3' },
          ],
        }),
        onOpenEpisode: onOpen,
      }

      setVideoBlockHost(mockHost)

      const container = document.createElement('div')
      container.innerHTML = `
        <div class="moji-videos-block" data-video-node="node-1" data-range="1, 3">
          <div class="placeholder">loading</div>
        </div>
      `

      hydrateVideos(container)

      // 等待异步 promise 决议
      await new Promise((r) => setTimeout(r, 10))

      expect(mockHost.getVideoData).toHaveBeenCalledWith('node-1')
      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBe(2) // 只有第 1 讲和第 3 讲

      buttons[0].click()
      expect(onOpen).toHaveBeenCalledWith('node-1', {
        page: 1,
        title: '第一讲 导论',
        source: 'src-1',
      })

      setVideoBlockHost(null)
    })

    it('宿主未注入时先挂起，注入后响应式重新水合渲染', async () => {
      setVideoBlockHost(null)

      const container = document.createElement('div')
      container.innerHTML = `
        <div class="moji-videos-block" data-video-node="late-node-9" data-range="1">
          <div class="placeholder">loading</div>
        </div>
      `

      // 首次水合时没有 host
      const cleanup = hydrateVideos(container)
      expect(container.querySelectorAll('button').length).toBe(0)

      // 稍后宿主注入
      const mockHost: VideoBlockHost = {
        getVideoData: vi.fn().mockResolvedValue({
          videoTitle: '延后课程',
          episodes: [{ page: 1, title: '延后第一讲', source: 'src-late' }],
        }),
        onOpenEpisode: vi.fn(),
      }
      setVideoBlockHost(mockHost)

      await new Promise((r) => setTimeout(r, 10))

      expect(mockHost.getVideoData).toHaveBeenCalledWith('late-node-9')
      expect(container.querySelectorAll('button').length).toBe(1)
      expect(container.querySelector('button')?.textContent).toContain('延后第一讲')

      cleanup()
      setVideoBlockHost(null)
    })
  })
})
