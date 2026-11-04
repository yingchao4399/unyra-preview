/**
 * 插件开发文档的正文（也是「导出文档文件」导出的那份内容）。
 *
 * 为什么是 markdown 字符串而不是 JSX：导出功能要原样落一份 .md，正文与导出
 * 共用同一份源，改一处两边一致。
 *
 * 合规：这份文档描述**契约**，不包含任何平台解析实现；示例骨架只打到一个
 * 虚构的 example.com 接口上，真实平台的插件由用户自行获取与安装。
 */
export const PLUGIN_DOC_TITLE = '插件开发文档'
export const PLUGIN_DOC_NAME = '归一插件开发文档.md'

export const PLUGIN_DOC_MD = `# 归一插件开发文档

> 这份文档介绍「归一」的插件系统：怎么装、怎么写、契约长什么样。
> 文档本身可以导出成 Markdown 文件（页面右上角「导出」），方便离线查阅或分享给插件作者。

## 一、插件是什么、边界在哪

插件是**用户自己安装的代码文件**，放在数据目录的 \`plugins/\` 目录里，应用只负责装载与派发。

合规边界（有意为之的设计）：

- 应用本体**零平台知识**：不内置、不分发任何视频 / 音频平台的解析器；
- 平台怎么拿流、怎么拿字幕，全部在插件里；插件随插件目录走，也随用户删除；
- 插件需要的账号凭据（Cookie / Token）由插件自己的配置面板收集，**密码类字段由主进程系统级加密落盘**。

## 二、安装与启停

1. 打开「设置 → 插件」，点「打开插件目录」（默认在数据目录下的 \`plugins/\`）；
2. 把 \`xxx.js\` 放进去；
3. 在「视频 / 音频来源」分类下打开开关——**即开即用，不用重启**（这一类支持热插拔）；
4. 有配置项的插件，点「插件配置」展开表单填写，保存**立即生效**；
5. 改了插件代码：点那一行的「重新加载」按钮即可。

> Markdown 文档插件（另一类）仍然需要重启：它们的扩展装进全局渲染器，运行中摘不下来。

## 三、最小插件骨架

\`\`\`js
register({
  apiVersion: 1,
  category: 'video',        // 视频 / 音频来源这一类必须显式声明
  id: 'my-source',          // 全局唯一，建议小写字母与连字符
  name: '我的来源',
  version: '1.0.0',
  kinds: ['video'],         // 'video' | 'audio'
  provides: ['stream', 'transcript'],
  settings: [],             // 见「配置面板」
  match(input) {
    return /^my:/.test(input) ? { input } : null
  },
  async resolve(host, matched) {
    // host.fetch 走应用的主进程通道（渲染层 CSP 拦外网，这是唯一出口）
    const res = await host.fetch('https://example.com/api/item?id=' + encodeURIComponent(matched.input))
    if (!res.ok) throw new Error(res.error)          // 错误原话会直接显示给用户
    const data = JSON.parse(res.body)
    return {
      mediaId: 'my:' + data.id,
      title: data.title,
      durationMs: data.duration * 1000,
      stream: { kind: 'url', url: data.streamUrl, headers: { referer: 'https://example.com/' } },
      // transcript 可选：拿不到就省略，播放照常
    }
  },
})
\`\`\`

## 四、manifest 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| \`apiVersion\` | 是 | 宿主契约版本，当前为 \`1\`；不匹配会被拒载 |
| \`category\` | 是 | \`'video'\`（视频 / 音频来源）或 \`'markdown'\`、\`'functional'\` |
| \`id\` | 是 | 全局唯一标识；缺省时用文件名 |
| \`name\` / \`version\` | 否 | 设置页展示用 |
| \`kinds\` | 是 | \`['video']\` 或 \`['audio']\`（音频来源走宿主的语音识别兜底） |
| \`provides\` | 是 | \`'stream'\`（出播放流）/ \`'transcript'\`（直取字幕） |
| \`settings\` | 否 | 声明式配置字段，见下 |
| \`match(input)\` | 是 | 认领输入；不认识返回 \`null\`，抛错等同不匹配 |
| \`resolve(host, matched)\` | 是 | 解析出「来源」对象，失败抛 \`Error\` |
| \`resolveTranscript(host, matched)\` | 否 | 只取转录（批量导出用）；省略时宿主回退到完整 resolve |
| \`onTest(host)\` | 否 | 配置面板的「测试连接」 |

## 五、宿主注入的 \`host\`

插件拿不到文件系统、窗口或别的插件的数据；唯一的外部触手是这三个：

- \`host.settings\`：你声明的配置值（password 字段已解密），**编译期快照**——改配置后宿主会热重载插件；
- \`host.fetch(url, { headers, timeoutMs })\`：带自定义请求头的 GET。\`User-Agent / Referer / Cookie\` 这类 \`fetch()\` 发不出的头必须走它；
- \`host.log(...args)\`：打到控制台，前缀是 \`[plugin:文件名]\`，方便排查。

## 六、配置面板（声明式）

插件不画 UI，只声明字段；设置页统一渲染，值由主进程加密保存：

\`\`\`js
settings: [
  {
    key: 'cookie',
    type: 'password',        // text | password | number | select | boolean | textarea | static
    label: '登录凭据（可选）',
    placeholder: '粘贴值即可',
    help: '怎么拿到它：浏览器登录 → F12 → Application → Cookies …',
    required: false,
  },
  { key: 'quality', type: 'select', label: '画质', options: [
    { value: '480', label: '480p' }, { value: '720', label: '720p' },
  ] },
]
\`\`\`

- \`password\`：主进程用系统钥匙串加密（换机器后需要重填）；
- \`static\`：只显示一段说明（label 当正文）；
- 字段值在 \`host.settings[key]\` 里取。

## 七、解析输出契约

\`\`\`ts
{
  mediaId: string            // 稳定身份（缓存键）
  title: string
  durationMs?: number        // 给「时长对账」用，强烈建议填
  stream?: { kind: 'url'; url: string; headers?: Record<string, string> }
  transcript?: {
    version: 1
    origin: 'subtitle' | 'stt'
    language?: string        // 如 'zh-Hans'、'ai-zh'
    segments: { startMs: number; endMs: number; text: string }[]
  }
  transcriptError?: string   // 试过拿字幕但失败了：原话上屏（与「没有字幕」区分）
  collection?: { name: string; items: { source: string; title: string; durationMs?: number; current?: boolean }[] }
  pages?:      { source: string; page: number; title: string; durationMs?: number; current?: boolean }[]
}
\`\`\`

转录的三条硬约束（宿主会校验，不合格整体拒绝）：

1. 时间一律**整数毫秒**；
2. \`text\` 是**纯文本**（无标签、无换行）；
3. 段按 \`startMs\` **升序、互不重叠**（双语字幕请自己合并或选主语言）。

另外宿主会做**时长对账**：字幕末段明显超出视频时长时判为错配并拦截——平台侧偶尔会返回别的视频的字幕，这道闸在宿主统一把关。

\`collection\` 的每项 \`source\` 要能被同一个插件的 \`match\` 再认领（点击切换时会当作新输入重走 resolve）；\`pages\` 表达同一媒体内的分 P，宿主用它做选集切换与批量导出。

### 状态归属（什么归宿主、什么归插件）

- **通用状态归宿主**：播放进度（自动记录、重开自动跳回）、转录段与语言、合集 / 选集结构。
  这些换一个插件仍然成立，宿主只存一份。
- **本机偏好归播放器**：音量、倍速、静音跟机器走，不随视频资源。
- **插件专属、创建时要定的数据 → \`createFields\`**（画质、课程密码、线路选择…）：
  随视频资源落库，解析时合并进 \`host.settings\`。
- 新增一个状态前先问：**换一个插件它还有意义吗？** 有 → 归宿主；没有 → 归插件。

## 八、错误与调试

- **错误原话**会直接显示给用户，不做任何预判文案——报错要说清哪一步、怎么改；
- 重试纪律：同一种写法最多重试 1 次，连续失败换策略；
- 调试三板斧：\`host.log\` 看参数、设置页「测试连接」验凭据、行内「重新加载」改完就跑。

## 九、已知边界

- 音频来源（\`kinds: ['audio']\`）：插件出音频流，转录由宿主的语音识别兜底；
- 扫描件 / 图片型 PDF 这类没有文本层的媒体不在本期范围；
- 需要交互式登录（扫码 / 跳转授权）的授权流是二期的契约预留（\`auth\`），当前请用静态凭据字段。
`
