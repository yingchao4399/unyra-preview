import { Hono } from 'hono'

export const audioRouter = new Hono()

function generateSpectrum(bins = 1024): number[] {
  const t = Date.now() / 1000
  const data: number[] = new Array(bins)

  // 120 BPM 动态节奏（底鼓强拍 + 军鼓次强拍）
  const beatTime = (t * 2) % 2
  const kick = Math.pow(Math.max(0, 1 - beatTime), 3) // 强劲底鼓冲击
  const snare = Math.pow(Math.max(0, 1 - Math.abs(beatTime - 1)), 4) // 军鼓爆破感
  const bassLevel = 0.5 + 0.5 * kick

  // 旋律波形合成
  const m1 = Math.sin(t * 3.7) * 0.35 + 0.65
  const m2 = Math.cos(t * 2.3) * 0.3 + 0.7
  const hiHat = Math.sin(t * 16) > 0.3 ? 0.7 : 0.2 // 高频擦片律动

  for (let i = 0; i < bins; i++) {
    let val = 0
    if (i < 40) {
      // 超重低音区 (30Hz - 860Hz)：能量最集中，随节拍起伏
      const sub = Math.sin(t * 5 + i * 0.2) * 0.2 + 0.8
      val = 140 + 115 * bassLevel * sub * Math.exp(-i / 28)
    } else if (i < 180) {
      // 中低频与基音区 (860Hz - 3.8kHz)
      const mid = Math.sin(t * 4 + i * 0.08) * 0.3 + 0.7
      val = 80 + 130 * m1 * mid * (0.6 + 0.4 * snare) * Math.exp(-(i - 40) / 90)
    } else if (i < 500) {
      // 中高频人声与谐波 (3.8kHz - 10.7kHz)
      const hi = Math.sin(t * 7 + i * 0.04) * 0.35 + 0.65
      val = 50 + 95 * m2 * hi * Math.exp(-(i - 180) / 160)
    } else if (i < 800) {
      // 高频细节与空气感 (10.7kHz - 17kHz)
      const air = Math.sin(t * 11 + i * 0.03) * 0.3 + 0.7
      val = 30 + 65 * hiHat * air * Math.exp(-(i - 500) / 220)
    } else {
      // 极高频底噪
      val = 18 + Math.floor(Math.random() * 14)
    }

    data[i] = Math.max(15, Math.min(255, Math.floor(val)))
  }
  return data
}

audioRouter.get('/spectrum', (c) => {
  const bins = Math.min(2048, Math.max(64, Number(c.req.query('bins')) || 1024))
  return c.json({
    ok: true,
    bins,
    sampleRate: 44100,
    data: generateSpectrum(bins),
  })
})

audioRouter.get('/status', (c) => {
  return c.json({
    ok: true,
    mode: 'server-loopback',
  })
})
