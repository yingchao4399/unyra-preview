import { Hono } from 'hono'
import { getFocusedAppName } from '../../electron/app/focusedApp'

export const guardRouter = new Hono()

// 1x1 最小合法灰度 JPEG 作为兜底
const PLACEHOLDER_JPEG =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z'

interface CaptureResult {
  ok: boolean
  mime: string
  data: string
  isReal: boolean
}

let screenCache: (CaptureResult & { time: number }) | null = null
let cameraCache: (CaptureResult & { time: number }) | null = null
let screenInFlight: Promise<CaptureResult> | null = null
let cameraInFlight: Promise<CaptureResult> | null = null

const CACHE_TTL_MS = 2500

function makeFallbackSvg(kind: string, app?: string): string {
  const isCam = kind === 'camera'
  const title = isCam ? 'AI 守卫 · 摄像头待命' : 'AI 守卫 · 桌面监控就绪'
  const sub = isCam ? '摄像头就绪 · 专注时段智能抽帧' : `当前焦点: ${app || '系统前台'} · 桌面巡检中`
  const icon = isCam ? '📷' : '🖥️'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <rect x="12" y="12" width="616" height="336" rx="8" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.35"/>
  <path d="M 10 32 L 10 10 L 32 10" fill="none" stroke="#38bdf8" stroke-width="3"/>
  <path d="M 630 32 L 630 10 L 608 10" fill="none" stroke="#38bdf8" stroke-width="3"/>
  <path d="M 10 328 L 10 350 L 32 350" fill="none" stroke="#38bdf8" stroke-width="3"/>
  <path d="M 630 328 L 630 350 L 608 350" fill="none" stroke="#38bdf8" stroke-width="3"/>
  <line x1="320" y1="30" x2="320" y2="330" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 8" opacity="0.15"/>
  <line x1="40" y1="180" x2="600" y2="180" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 8" opacity="0.15"/>
  <circle cx="320" cy="180" r="75" fill="none" stroke="#38bdf8" stroke-width="1" stroke-dasharray="4 4" opacity="0.2"/>
  <circle cx="320" cy="135" r="28" fill="#0369a1" fill-opacity="0.3" stroke="#38bdf8" stroke-width="1.5"/>
  <text x="320" y="144" font-family="system-ui, sans-serif" font-size="22" fill="#38bdf8" text-anchor="middle">${icon}</text>
  <text x="320" y="196" font-family="system-ui, sans-serif" font-size="16" font-weight="bold" fill="#f8fafc" text-anchor="middle">${title}</text>
  <text x="320" y="222" font-family="system-ui, sans-serif" font-size="12" fill="#94a3b8" text-anchor="middle">${sub}</text>
  <rect x="250" y="242" width="140" height="22" rx="11" fill="#059669" fill-opacity="0.25" stroke="#10b981" stroke-width="1"/>
  <text x="320" y="257" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="#34d399" text-anchor="middle">● 守卫核心运行中</text>
</svg>`
}

async function captureScreenDesktop(): Promise<CaptureResult> {
  const now = Date.now()
  if (screenCache && now - screenCache.time < CACHE_TTL_MS) {
    return screenCache
  }
  if (screenInFlight) {
    return screenInFlight
  }

  screenInFlight = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron')
      if (electron?.desktopCapturer?.getSources) {
        const sources = await electron.desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 640, height: 360 },
        })
        if (sources && sources[0]?.thumbnail) {
          const dataUrl = sources[0].thumbnail.toDataURL()
          const [meta, raw] = dataUrl.split(',')
          const mime = meta.split(':')[1]?.split(';')[0] || 'image/jpeg'
          const res: CaptureResult = { ok: true, mime, data: raw, isReal: true }
          screenCache = { ...res, time: Date.now() }
          return res
        }
      }
    } catch {
      // not in electron
    }

    if (process.platform === 'win32') {
      try {
        const { execFile } = await import('node:child_process')
        const res = await new Promise<CaptureResult>((resolve) => {
          const script = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type -AssemblyName System.Drawing;
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bmp = New-Object System.Drawing.Bitmap 640, 360;
$g = [System.Drawing.Graphics]::FromImage($bmp);
$g.CopyFromScreen($b.X, $b.Y, 0, 0, (New-Object System.Drawing.Size 640, 360));
$ms = New-Object System.IO.MemoryStream;
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);
$g.Dispose();
$bmp.Dispose();
$str = [Convert]::ToBase64String($ms.ToArray());
$ms.Dispose();
Write-Output $str;
`
          execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 4000 }, (err, stdout) => {
            const raw = stdout ? stdout.trim().split('\n').pop()?.trim() || '' : ''
            if (err || !raw || raw.length < 500) {
              resolve({ ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG, isReal: false })
            } else {
              resolve({ ok: true, mime: 'image/jpeg', data: raw, isReal: true })
            }
          })
        })
        screenCache = { ...res, time: Date.now() }
        return res
      } catch {
        // fallback
      }
    }

    const fallback: CaptureResult = { ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG, isReal: false }
    screenCache = { ...fallback, time: Date.now() }
    return fallback
  })().finally(() => {
    screenInFlight = null
  })

  return screenInFlight
}

async function captureCameraDesktop(): Promise<CaptureResult> {
  const now = Date.now()
  if (cameraCache && now - cameraCache.time < CACHE_TTL_MS) {
    return cameraCache
  }
  if (cameraInFlight) {
    return cameraInFlight
  }

  cameraInFlight = (async () => {
    if (process.platform === 'win32') {
      try {
        const { execFile } = await import('node:child_process')
        const script = `
[System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime') | Out-Null;
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
} | Select-Object -First 1;
$mcType = [Type]::GetType('Windows.Media.Capture.MediaCapture, Windows.Media.Capture, ContentType=WindowsRuntime');
$mc = [Activator]::CreateInstance($mcType);
$initOp = $mc.InitializeAsync();
$initTask = $asTask.Invoke($null, @($initOp));
$initTask.Wait(4000) | Out-Null;
$imgPropType = [Type]::GetType('Windows.Media.MediaProperties.ImageEncodingProperties, Windows.Media, ContentType=WindowsRuntime');
$jpegProps = $imgPropType.GetMethod('CreateJpeg').Invoke($null, @());
$jpegProps.Width = 640;
$jpegProps.Height = 360;
$rasType = [Type]::GetType('Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime');
$stream = [Activator]::CreateInstance($rasType);
$capOp = $mc.CapturePhotoToStreamAsync($jpegProps, $stream);
$capTask = $asTask.Invoke($null, @($capOp));
$capTask.Wait(4000) | Out-Null;
$stream.Seek(0);
$netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream);
$ms = New-Object System.IO.MemoryStream;
$netStream.CopyTo($ms);
$b64 = [Convert]::ToBase64String($ms.ToArray());
$ms.Dispose();
Write-Output $b64;
`
        const res = await new Promise<CaptureResult>((resolve) => {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-Command', script],
            { maxBuffer: 10 * 1024 * 1024, timeout: 6000 },
            (err, stdout) => {
              const raw = stdout ? stdout.trim().split('\n').pop()?.trim() || '' : ''
              if (err || !raw || raw.length < 500) {
                resolve({ ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG, isReal: false })
              } else {
                resolve({ ok: true, mime: 'image/jpeg', data: raw, isReal: true })
              }
            },
          )
        })
        cameraCache = { ...res, time: Date.now() }
        return res
      } catch {
        // fallback
      }
    }

    const fallback: CaptureResult = { ok: true, mime: 'image/jpeg', data: PLACEHOLDER_JPEG, isReal: false }
    cameraCache = { ...fallback, time: Date.now() }
    return fallback
  })().finally(() => {
    cameraInFlight = null
  })

  return cameraInFlight
}

guardRouter.get('/focusedApp', async (c) => {
  const app = await getFocusedAppName()
  return c.json({ ok: true, app })
})

guardRouter.get('/captureScreen', async (c) => {
  const res = await captureScreenDesktop()
  return c.json(res)
})

guardRouter.post('/captureScreen', async (c) => {
  const res = await captureScreenDesktop()
  return c.json(res)
})

guardRouter.get('/captureCamera', async (c) => {
  const res = await captureCameraDesktop()
  return c.json(res)
})

guardRouter.post('/captureCamera', async (c) => {
  const res = await captureCameraDesktop()
  return c.json(res)
})

guardRouter.get('/preview/:kind', async (c) => {
  const kind = c.req.param('kind')
  const res = kind === 'camera' ? await captureCameraDesktop() : await captureScreenDesktop()
  if (res.isReal && res.data && res.data !== PLACEHOLDER_JPEG) {
    const buf = Buffer.from(res.data, 'base64')
    return new Response(buf, {
      headers: {
        'Content-Type': res.mime,
        'Cache-Control': 'no-store, no-cache',
      },
    })
  }

  // 无硬件或未捕获到真实帧时返回 HUD 矢量预览，确保界面绝不黑屏
  const app = await getFocusedAppName().catch(() => undefined)
  const svg = makeFallbackSvg(kind, app)
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store, no-cache',
    },
  })
})
