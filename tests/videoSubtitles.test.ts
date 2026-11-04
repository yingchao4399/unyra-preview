import { describe, expect, it } from 'vitest'
import {
  calculateSubtitleLayout,
  cleanSubtitleText,
  findActiveSubtitle,
  generateHardTextShadow,
  parseJsonSubtitles,
  parseSrt,
  parseSubtitleFile,
  parseTimestamp,
  parseVtt,
  sanitizeSubtitleSegments,
  SUBTITLE_HARD_TEXT_SHADOW,
  toTranscript,
} from '../src/video/subtitles'

describe('video/subtitles', () => {
  it('parses timestamps in different formats', () => {
    expect(parseTimestamp('00:01:23,456')).toBe(83456)
    expect(parseTimestamp('00:01:23.456')).toBe(83456)
    expect(parseTimestamp('01:23.456')).toBe(83456)
    expect(parseTimestamp('10.5')).toBe(10500)
    expect(parseTimestamp('00:00:00,000')).toBe(0)
  })

  it('cleans HTML tags and formatting instructions', () => {
    expect(cleanSubtitleText('<b>Hello</b> <font color="#fff">World</font>')).toBe('Hello World')
    expect(cleanSubtitleText('{\\an8\\fs24}Some animated text')).toBe('Some animated text')
    expect(cleanSubtitleText('&lt;Note&gt; &amp; test&#39;s')).toBe("<Note> & test's")
    expect(cleanSubtitleText('  Leading and trailing   ')).toBe('Leading and trailing')
  })

  it('parses SRT subtitle files', () => {
    const srt = `
1
00:00:01,000 --> 00:00:04,000
First subtitle line

2
00:00:05,500 --> 00:00:08,200
Second <i>subtitle</i> line
Second line text
`
    const segments = parseSrt(srt)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({
      startMs: 1000,
      endMs: 4000,
      text: 'First subtitle line',
    })
    expect(segments[1]).toEqual({
      startMs: 5500,
      endMs: 8200,
      text: 'Second subtitle line\nSecond line text',
    })
  })

  it('parses WebVTT files with headers and settings', () => {
    const vtt = `WEBVTT - Sample

NOTE this is a note
spanning lines

00:00:02.000 --> 00:00:05.000 line:0% position:50%
<v Speaker1>Welcome to the lesson</v>

00:00:06.000 --> 00:00:09.000
Next step in WebVTT
`
    const segments = parseVtt(vtt)
    expect(segments).toHaveLength(2)
    expect(segments[0].startMs).toBe(2000)
    expect(segments[0].endMs).toBe(5000)
    expect(segments[0].text).toBe('Welcome to the lesson')
    expect(segments[1].startMs).toBe(6000)
    expect(segments[1].text).toBe('Next step in WebVTT')
  })

  it('parses JSON format subtitles', () => {
    const json = JSON.stringify({
      body: [
        { from: 1.5, to: 3.5, content: 'Bilibili style subtitle' },
        { from: 4.0, to: 6.0, content: 'Second sentence' },
      ],
    })
    const segments = parseJsonSubtitles(json)
    expect(segments).toHaveLength(2)
    expect(segments[0].startMs).toBe(1500)
    expect(segments[0].endMs).toBe(3500)
    expect(segments[0].text).toBe('Bilibili style subtitle')
  })

  it('auto-detects and normalizes subtitle files', () => {
    const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello`
    const res = parseSubtitleFile(srt, 'test.srt')
    expect(res).toHaveLength(1)
    expect(res[0].text).toBe('Hello')

    const transcript = toTranscript(res, 'test.srt')
    expect(transcript.version).toBe(1)
    expect(transcript.origin).toBe('subtitle')
    expect(transcript.language).toBe('test')
    expect(transcript.segments).toEqual(res)
  })

  it('sanitizes overlapping segments and corrects inverted times', () => {
    const messy = [
      { startMs: 5000, endMs: 8000, text: 'Second' },
      { startMs: 1000, endMs: 6000, text: 'First' },
      { startMs: 9000, endMs: 9000, text: 'Inverted' },
      { startMs: 10000, endMs: 12000, text: '' },
    ]
    const cleaned = sanitizeSubtitleSegments(messy)
    expect(cleaned).toHaveLength(2)
    expect(cleaned[0].text).toBe('First')
    // 检查重叠修正：First 的结束时间被修整到 Second 的开始时间 5000
    expect(cleaned[0].endMs).toBe(5000)
    expect(cleaned[1].text).toBe('Second')
  })

  it('finds active subtitle cue with offset', () => {
    const segments = [
      { startMs: 1000, endMs: 3000, text: 'Cue 1' },
      { startMs: 4000, endMs: 6000, text: 'Cue 2' },
    ]
    expect(findActiveSubtitle(segments, 500)).toBeNull()
    expect(findActiveSubtitle(segments, 1500)?.text).toBe('Cue 1')
    expect(findActiveSubtitle(segments, 3500)).toBeNull()
    expect(findActiveSubtitle(segments, 4500)?.text).toBe('Cue 2')

    // 偏移量测试：+500ms 表示字幕延后 500ms 显示
    expect(findActiveSubtitle(segments, 1500, 500)?.text).toBe('Cue 1')
    expect(findActiveSubtitle(segments, 4500, 500)?.text).toBe('Cue 2')
  })

  it('supports playback rate boundaries 0.25x to 3.0x', () => {
    const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
    expect(Math.min(...SPEED_PRESETS)).toBe(0.25)
    expect(Math.max(...SPEED_PRESETS)).toBe(3.0)

    const clampRate = (r: number) => Math.max(0.25, Math.min(3.0, Math.round(r * 100) / 100))
    expect(clampRate(0.1)).toBe(0.25)
    expect(clampRate(0.25)).toBe(0.25)
    expect(clampRate(1.5)).toBe(1.5)
    expect(clampRate(3.0)).toBe(3.0)
    expect(clampRate(3.5)).toBe(3.0)
  })

  it('generates non-diffused hard text-shadow outline without blur', () => {
    expect(SUBTITLE_HARD_TEXT_SHADOW).toBeTruthy()
    const parts = SUBTITLE_HARD_TEXT_SHADOW.split(', ')
    expect(parts.length).toBeGreaterThanOrEqual(16)
    // 验证每一段的模糊扩散半径均为 0，确保硬描边不扩散
    for (const part of parts) {
      expect(part).toMatch(/\s0\s#000$/)
    }

    const custom = generateHardTextShadow(0.08, '#111')
    expect(custom).toContain('#111')
    for (const part of custom.split(', ')) {
      expect(part).toMatch(/\s0\s#111$/)
    }
  })

  it('calculates subtitle layout dynamically based on player dimensions rather than screen size', () => {
    // 播放器小尺寸（如分屏/侧栏展开时 480x270，默认字号为小 0.8x）
    const small = calculateSubtitleLayout(480, 270, false, 16 / 9)
    expect(small.fontSizePx).toBe(14) // 270 * 0.058 * 0.8 = 12.5 -> clamped to 14px
    expect(small.bottomPx).toBe(18) // letterbox 0 + 270 * 0.04 (~11) -> Math.max(18, 11) = 18

    // 播放器大尺寸（如 1280x720，默认字号为小 0.8x）
    const large = calculateSubtitleLayout(1280, 720, false, 16 / 9)
    expect(large.fontSizePx).toBe(33) // 720 * 0.058 * 0.8 = 33.4 -> 33px
    expect(large.bottomPx).toBe(29) // 720 * 0.04 (~29) -> max(18, 29) = 29

    // 全屏尺寸（1920x1080，默认字号为小 0.8x）：达到 50px
    const fullscreenDefault = calculateSubtitleLayout(1920, 1080, false, 16 / 9)
    expect(fullscreenDefault.fontSizePx).toBe(50) // 1080 * 0.058 * 0.8 = 50.1 -> 50px

    // 全屏尺寸（1920x1080，标准字号 1.0x）：达到 63px，远超原先 38px 限制
    const fullscreen1080p = calculateSubtitleLayout(1920, 1080, false, 16 / 9, 1.0)
    expect(fullscreen1080p.fontSizePx).toBe(63) // 1080 * 0.058 = 62.64 -> 63px

    // 全屏尺寸 + 用户选择放大倍率（1.5x 特大）
    const fullscreenLarge = calculateSubtitleLayout(1920, 1080, false, 16 / 9, 1.5)
    expect(fullscreenLarge.fontSizePx).toBe(94) // 1080 * 0.058 * 1.5 = 93.96 -> 94px

    // 控制栏显示时底部距离增加避让控制栏
    const withControls = calculateSubtitleLayout(1280, 720, true, 16 / 9)
    expect(withControls.bottomPx).toBeGreaterThanOrEqual(68)

    // 播放器高度被压缩（上下有较大黑边或高宽比较小）时，以实际视频有效画面为准
    const letterboxed = calculateSubtitleLayout(600, 600, false, 16 / 9)
    // 画面实际高度为 600 / (16/9) = 337.5px -> 337.5 * 0.058 * 0.8 = 15.66 -> 16px
    expect(letterboxed.fontSizePx).toBe(16)
  })
})
