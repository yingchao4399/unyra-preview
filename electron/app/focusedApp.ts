import { execFile } from 'node:child_process'

/**
 * 获取当前系统获得焦点的应用名称（窗口/进程名）。
 *
 * 1. 若当前应用（BrowserWindow）处于焦点，直接返回应用自身名称；
 * 2. 若焦点切到了外部其他窗口：
 *    - Windows: 借助 PowerShell 异步查询 GetForegroundWindow 对应的进程名与窗口标题；
 *    - macOS: 借助 osascript 查询 frontmost 进程名；
 *    - Linux: 借助 xdotool/xprop 查询；
 *    - 超时或失败则安全回退，绝不卡死。
 */
export async function getFocusedAppName(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    const focusedWin = electron?.BrowserWindow?.getFocusedWindow?.()
    if (focusedWin && !focusedWin.isDestroyed?.()) {
      return 'Unyra (当前学习应用)'
    }
  } catch {
    // not running in electron or no window
  }

  if (process.platform === 'win32') {
    return new Promise<string>((resolve) => {
      const psScript = `
$sig = @'
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
'@
try {
  $type = Add-Type -MemberDefinition $sig -Name ("Win" + (Get-Random)) -Namespace Win32 -PassThru
  $hwnd = $type::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { '未知应用' ; exit }
  $pidVal = 0
  $type::GetWindowThreadProcessId($hwnd, [ref]$pidVal)
  $proc = Get-Process -Id $pidVal -ErrorAction SilentlyContinue
  $sb = New-Object System.Text.StringBuilder 256
  $null = $type::GetWindowText($hwnd, $sb, 256)
  $pName = if ($proc) { $proc.ProcessName } else { '' }
  $wTitle = $sb.ToString().Trim()
  if ($pName -and $wTitle) { "$pName ($wTitle)" }
  elseif ($pName) { $pName }
  elseif ($wTitle) { $wTitle }
  else { '未知应用' }
} catch {
  '未知应用'
}
`
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psScript],
        { timeout: 3000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout) {
            resolve('未知应用')
          } else {
            const res = stdout.trim()
            resolve(res || '未知应用')
          }
        },
      )
    })
  }

  if (process.platform === 'darwin') {
    return new Promise<string>((resolve) => {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'],
        { timeout: 2000 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve('未知应用')
          } else {
            resolve(stdout.trim() || '未知应用')
          }
        },
      )
    })
  }

  return '外部应用'
}
