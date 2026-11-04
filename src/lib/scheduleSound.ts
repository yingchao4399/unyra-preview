/**
 * 日程提醒铃声：**现场合成**，不带任何音频文件。
 *
 * 为什么不塞一个 mp3 进安装包：提醒只需要「几声不刺耳、一定听得见」的音，
 * 而音频文件要处理路径、编解码、打包体积与授权；WebAudio 几行振荡器就能给出
 * 四档风格，音量还能当场调。代价是音色朴素——提醒铃声本来也不该喧宾夺主。
 *
 * 三条纪律：
 * 1. **只在一处出声**：响铃的循环（start/stop）只有这个模块管，宿主那边只按
 *    「有没有正在响的日程」调用它——重复 start 会先停掉上一条，不会叠成一片。
 * 2. **音量 0 就是静音**：视觉提醒（顶栏渐变呼吸 + 弹层）始终在，声音是加分项。
 * 3. **浏览器的自动播放策略**：AudioContext 可能停在 suspended。这里会尝试 resume，
 *    并挂一次性指针/键盘监听解锁——真解不开也不报错，只是没有声音。
 */

import type { ScheduleSound, ScheduleSoundPreset } from '../learn/schedule'

interface Tone {
  /** 频率（Hz） */
  freq: number
  /** 相对这一轮开头的起点（秒） */
  at: number
  /** 单音时长（秒） */
  dur: number
  /** 起音时间（秒）：短 = 敲击感，长 = 柔和 */
  attack: number
  /** 相对音量（0~1，再乘用户音量） */
  gain: number
  type: OscillatorType
}

/** 四档铃声的音型。改音色就改这张表，别在播放逻辑里加分支 */
const PATTERNS: Record<ScheduleSoundPreset, Tone[]> = {
  // 双音风铃：E5 → A5，清亮但不尖
  chime: [
    { freq: 659.25, at: 0, dur: 1.1, attack: 0.008, gain: 0.5, type: 'sine' },
    { freq: 880, at: 0.22, dur: 1.3, attack: 0.008, gain: 0.42, type: 'sine' },
  ],
  // 钟声：三角波 + 上方五度，尾音长
  bell: [
    { freq: 523.25, at: 0, dur: 1.8, attack: 0.012, gain: 0.45, type: 'triangle' },
    { freq: 783.99, at: 0.01, dur: 1.6, attack: 0.012, gain: 0.22, type: 'triangle' },
    { freq: 1046.5, at: 0.02, dur: 1.2, attack: 0.01, gain: 0.12, type: 'sine' },
  ],
  // 三连短促提示：像校铃，隔着房间也听得见
  pulse: [
    { freq: 880, at: 0, dur: 0.1, attack: 0.004, gain: 0.42, type: 'square' },
    { freq: 880, at: 0.2, dur: 0.1, attack: 0.004, gain: 0.42, type: 'square' },
    { freq: 880, at: 0.4, dur: 0.1, attack: 0.004, gain: 0.42, type: 'square' },
  ],
  // 柔和两音：低八度、慢起音，适合安静环境
  soft: [
    { freq: 392, at: 0, dur: 1.6, attack: 0.14, gain: 0.4, type: 'sine' },
    { freq: 523.25, at: 0.34, dur: 1.7, attack: 0.14, gain: 0.32, type: 'sine' },
  ],
}

/** 一轮响完到下一轮开头的间隔（毫秒）：比最长尾音略长，不叠音 */
const LOOP_MS = 2_600

let ctx: AudioContext | null = null
let loopTimer: number | null = null
/** 当前是否处于「持续响铃」状态（stop 之后到点的 interval 不再出声） */
let ringing = false
/** 自动播放解锁只挂一次 */
let unlockBound = false

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    return ctx
  } catch {
    return null
  }
}

/** 试着解锁音频：解不开就算了（静音也能靠视觉提醒） */
function unlock(ac: AudioContext): void {
  if (ac.state !== 'suspended') return
  void ac.resume().catch(() => {})
  if (unlockBound || typeof document === 'undefined') return
  unlockBound = true
  const onGesture = (): void => {
    document.removeEventListener('pointerdown', onGesture, true)
    document.removeEventListener('keydown', onGesture, true)
    void ctx?.resume().catch(() => {})
  }
  document.addEventListener('pointerdown', onGesture, true)
  document.addEventListener('keydown', onGesture, true)
}

/** 放一轮（不循环）：试听与响铃共用 */
export function playScheduleSound(sound: ScheduleSound): void {
  if (!sound || sound.volume <= 0) return
  const ac = audioContext()
  if (!ac) return
  unlock(ac)
  const start = ac.currentTime + 0.02
  for (const tone of PATTERNS[sound.preset] ?? PATTERNS.chime) {
    try {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      const peak = Math.max(0.0002, Math.min(1, sound.volume) * tone.gain)
      osc.type = tone.type
      osc.frequency.setValueAtTime(tone.freq, start + tone.at)
      gain.gain.setValueAtTime(0.0001, start + tone.at)
      gain.gain.exponentialRampToValueAtTime(peak, start + tone.at + tone.attack)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.dur)
      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(start + tone.at)
      osc.stop(start + tone.at + tone.dur + 0.05)
    } catch {
      // 单个音失败不该让整轮停掉（设备被独占之类）
    }
  }
}

/** 试听：设置页里点一下听一下，与响铃共用同一套音型 */
export function previewScheduleSound(sound: ScheduleSound): void {
  playScheduleSound(sound)
}

/** 开始持续响铃：立刻放一轮，之后每 LOOP_MS 一轮，直到 stop */
export function startScheduleRing(sound: ScheduleSound): void {
  stopScheduleRing()
  ringing = true
  playScheduleSound(sound)
  loopTimer = window.setInterval(() => {
    if (ringing) playScheduleSound(sound)
  }, LOOP_MS)
}

/** 停止响铃（确认 / 稍后提醒 / 组件卸载都会走到这里） */
export function stopScheduleRing(): void {
  ringing = false
  if (loopTimer !== null) {
    window.clearInterval(loopTimer)
    loopTimer = null
  }
}
