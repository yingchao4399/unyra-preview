/**
 * 沙箱脚本的来源。
 *
 * 真正的运行时代码放在 sandboxRuntime.js（纯 JavaScript），这里只做一件小事：
 * 注入 api 的名字清单，然后交给 tools 塞进 Blob 交给 Worker。
 *
 * 为什么不让运行时代码躺在模板字符串里：浏览器按 JS 解析那段字符串，
 * 一旦混进 TypeScript 语法（哪怕只是 let x: unknown），Worker 会一启动就抛
 * SyntaxError，而且报错位置指向别处。单独放 .js 后，构建器会检查它的语法。
 */
import raw from './sandboxRuntime.js?raw'
import { buildSandboxHelp, exposedApiNames } from './sandbox/apiRegistry'

/**
 * 沙箱里可用的 api：**从 apiRegistry 派生**，不再手抄。
 *
 * 新增一条 api 只改注册表一处：签名、用法、示例、是否暴露都在那里；
 * 这里、`__help()`、系统提示词的组索引、设置页目录都跟着走。
 */
const API_NAMES = exposedApiNames()

/** 给探针与设置页用的只读名单（与 Worker 里那份完全一致） */
export const SANDBOX_API_NAMES = API_NAMES

/** 预先渲染好的帮助文本：Worker 侧 `__help()` 同步返回，不花一次宿主往返 */
const API_HELP = buildSandboxHelp()

/** 可直接交给 new Blob([...]) 的完整脚本 */
export const SANDBOX_SOURCE = raw
  .replace('__API_NAMES__', JSON.stringify(API_NAMES))
  .replace('__API_HELP__', JSON.stringify(API_HELP))

