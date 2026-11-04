/**
 * 远程公告的**唯一配置点**。
 *
 * 为什么单独一个文件：公告地址（部署到 GitHub Pages 之后的那条 HTTPS URL）只该有
 * 一处真值——散在请求代码、设置页、文档里各写一遍，改一次地址就要满仓库找，
 * 漏掉一处的表现是「某个入口读的是旧地址」，很难查。lib/notice.ts 从这里读，
 * 其余任何地方都不许再出现字面量地址。
 *
 * 地址怎么来（见 docs/notice.md 的完整步骤）：
 * 1. 公告发布仓库：`maplexrain/unyra-notice`（**独立于**应用源码仓库，理由见文档）；
 * 2. 仓库里放 `.github/workflows/deploy.yml`（模板见 docs/notice-repo/）；
 * 3. 在 Settings → Pages 把 Source 设成 GitHub Actions；
 * 4. 手动跑一次工作流，Pages 就会给出 `https://<账号>.github.io/unyra-notice/notice.json`；
 * 5. 把这条 URL 填到下面的 DEFAULT_NOTICE_URL，或者构建时用环境变量覆盖。
 */

/**
 * 默认公告地址。
 *
 * 公告发布仓库是 `maplexrain/unyra-notice`（公开），Pages 给出的地址就是这个形状：
 * `https://<账号>.github.io/<仓库名>/notice.json`。换成自己的账号 / 仓库名时改这一行。
 */
const DEFAULT_NOTICE_URL = 'https://maplexrain.github.io/unyra-notice/notice.json'

/**
 * 构建时可覆盖的公告地址：`VITE_NOTICE_URL=... npm run build`。
 *
 * 为什么留这个口子：fork 出去自己维护的人不必改源码，CI 里注入一个环境变量就行。
 * 值由 vite.config.ts 的 define 在构建时替换成字面量（`__NOTICE_URL_ENV__`）——
 * 渲染层跑在浏览器环境里，读不到 process.env，只能靠注入（与 __APP_VERSION__ 同套路）。
 */
const fromEnv = typeof __NOTICE_URL_ENV__ === 'string' ? __NOTICE_URL_ENV__.trim() : ''

/** 生效的公告地址；空串表示没配置（公告功能整体关闭，见 lib/notice.ts） */
export const NOTICE_URL: string = fromEnv || DEFAULT_NOTICE_URL

/**
 * 一次公告请求的超时（毫秒）。
 *
 * 主进程的 web:fetch 自己还有 20 秒硬上限（见 electron/web-core.ts），这里收紧到 8 秒：
 * 公告是启动路径上的一次「顺手取一下」，它慢不该让用户等——超时就当这次没有公告，
 * 下次启动再试。
 */
export const NOTICE_TIMEOUT_MS = 8000

/**
 * 公告请求的缓存击穿参数。
 *
 * GitHub Pages 默认给静态文件 `Cache-Control: max-age=600`（10 分钟），中间还可能有
 * CDN。只在 URL 上挂一个每次都不同的查询串，才能保证「改了公告、下次启动就看得见」，
 * 而不必去等缓存过期。代价是每次启动都真取一次——启动只取一次、不轮询，可以接受
 * （见需求「不要通过高频轮询来强制刷新公告」）。
 */
export function noticeUrlForRequest(now: number = Date.now()): string {
  if (!NOTICE_URL) return ''
  const sep = NOTICE_URL.includes('?') ? '&' : '?'
  return `${NOTICE_URL}${sep}_=${now}`
}
