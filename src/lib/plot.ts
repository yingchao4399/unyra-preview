import type { FunctionPlotOptions } from 'function-plot'
import { t } from '../i18n'
import { renderInline } from './markdown'
import { normalizePlotData } from './plotExpr'

/**
 * 函数图像渲染。
 *
 * marked 把 ```plot 围栏渲染成占位容器（见 lib/markdown.ts），
 * 这里在 DOM 提交后把容器变成真正的图像。分两步的原因：
 * - renderNote 是同步纯函数，只产出 HTML 字符串，产不出图；
 * - 绘图库（function-plot 解包 ~800KB）按需动态加载，
 *   文档里没有图像时完全不会加载它。
 */

type PlotFn = (options: FunctionPlotOptions) => unknown

/** 成功加载的函数（只缓存成功结果） */
let cached: PlotFn | null = null
/** 在途加载，避免同一时刻重复 import */
let pending: Promise<PlotFn | null> | null = null
/** 最近一次加载失败的原因，用于把真实错误显示给用户 */
let lastError = ''

/**
 * function-plot 只有 CJS 产物，不同打包路径下默认导出的层级不一致：
 * dev 预打包会把 module.exports 整个挂到 default（真正函数在 default.default），
 * 生产构建通常直接就是函数。逐个候选探测，避免绑死某一层形态。
 */
function resolvePlotFn(m: unknown): PlotFn | null {
  const candidates = [
    (m as { default?: { default?: unknown } })?.default?.default,
    (m as { default?: unknown })?.default,
    m,
  ]
  for (const c of candidates) if (typeof c === 'function') return c as PlotFn
  return null
}

/**
 * 按需加载绘图库。
 *
 * 只把**成功**结果缓存下来；失败不缓存，下次调用会重新尝试。
 * 这一点很关键：开发时 Vite 重新预打包依赖（例如新增依赖后）会让旧页面
 * 里已使用的模块地址失效，动态 import 会短暂报错；若把这次失败缓存成
 * null，页面就会一直卡在「加载失败」直到手动刷新。不缓存失败即可自愈。
 */
function loadPlot(): Promise<PlotFn | null> {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = import('function-plot')
      .then((m) => {
        const fn = resolvePlotFn(m)
        if (fn) cached = fn
        else lastError = t('函数图像组件的导出形态异常')
        return fn
      })
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err)
        return null
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** 图像宽度上限，避免在宽屏上拉得过大；下限保证窄栏里仍可读 */
const MIN_WIDTH = 220
const MAX_WIDTH = 720
/** 宽度变化超过这个阈值才重绘，防止拖拽侧栏时疯狂重排 */
const RESIZE_STEP = 16
/** 绘图库加载失败后的退避重试间隔（毫秒）；用尽仍失败才提示错误 */
const RETRY_DELAYS = [300, 800, 1500]
/**
 * 首次绘制让给浏览器的空闲时间。
 *
 * 画一张图是同步的 d3 布局（实测每张 9~15ms），一份文档挂五张图就是 70ms 上下。
 * 这些工作若紧跟正文挂载执行，就会和「切换节点」挤在同一帧里，正文白白晚半拍才上屏。
 * 推迟到空闲时段后，正文先出现，图像紧随其后补上——占位文案「正在绘制函数图像…」
 * 本来就在，补上的过程看着是连贯的。timeout 是兜底：主线程一直忙时也要画出来。
 */
const IDLE_TIMEOUT = 120

/** 空闲时执行 fn；返回取消函数（浏览器没有 requestIdleCallback 时退回 setTimeout） */
function whenIdle(fn: () => void): () => void {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number })
    .requestIdleCallback
  if (!ric) {
    const timer = window.setTimeout(fn, 0)
    return () => window.clearTimeout(timer)
  }
  const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
  const id = ric(fn, { timeout: IDLE_TIMEOUT })
  return () => cancel?.(id)
}

/**
 * 挂载 root 内所有 plot 占位容器；返回清理函数（取消观察、丢弃在途渲染）。
 * 可重复调用：React 每次因内容变化重渲染后都会重新挂载。
 */
export function hydratePlots(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  for (const el of root.querySelectorAll<HTMLElement>('.moji-plot[data-plot]')) {
    const cleanup = hydrateOne(el)
    if (cleanup) cleanups.push(cleanup)
  }
  return () => {
    for (const fn of cleanups) fn()
  }
}

function hydrateOne(el: HTMLElement): (() => void) | null {
  const stage = el.querySelector<HTMLElement>('.moji-plot-stage')
  if (!stage) return null

  const raw = el.dataset.plot ? decodeURIComponent(el.dataset.plot) : ''
  let options: FunctionPlotOptions | null = null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') options = parsed as FunctionPlotOptions
  } catch {
    options = null
  }
  if (!options || !Array.isArray(options.data) || options.data.length === 0) {
    fail(el, stage, t('函数图像格式不正确（需要一段含 data 的 JSON）'), raw)
    return null
  }
  const opts = options
  /*
   * 表达式在这里就归一化：函数库的区间采样器算不了分数次幂（x^(1/3) 会返回空集，
   * 既刷屏 warning 又让整条曲线消失），改写理由与边界见 lib/plotExpr.ts。
   */
  const data = normalizePlotData(opts.data)

  let disposed = false
  let timer = 0
  let retry = 0
  let lastWidth = 0
  const detach: Array<() => void> = []

  // 用舞台元素的宽度而不是外层容器：外层还有内边距，
  // 按外层宽度画会让 svg 比舞台宽、再被 CSS 缩回，坐标与视觉就不一致了
  const currentWidth = () =>
    Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(stage.clientWidth)))

  const render = async () => {
    if (disposed) return
    const width = currentWidth()
    if (width <= 0) return
    const plot = await loadPlot()
    // 组件可能在等待期间已被卸载/换内容，此时再画会画进废弃节点
    if (disposed) return
    if (!plot) {
      // 加载失败多为开发期依赖重新预打包导致的短暂失效：不写死错误，退避重试几次，
      // 期间保留「正在绘制」状态，避免用户看到一个其实会自愈的失败。
      if (retry < RETRY_DELAYS.length) {
        const wait = RETRY_DELAYS[retry++]
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void render(), wait)
        return
      }
      fail(el, stage, lastError ? t('函数图像组件加载失败：{0}', lastError) : t('函数图像组件加载失败'), raw)
      return
    }
    const height =
      typeof opts.height === 'number' && opts.height > 0 ? opts.height : Math.round(width * 0.62)
    try {
      // function-plot 是追加式渲染，重绘前先清空，避免叠出多张图
      stage.replaceChildren()
      plot({ ...opts, data, target: stage, width, height, disableZoom: opts.disableZoom ?? true })
      /*
        画完了，也可能是**一张什么都没有的图**：表达式在区间内无取值时（定义域外、
        分母为零、变量名不是 x），区间采样器返回空集——plot() 不抛错，SVG 里只剩坐标轴。
        这种静默留白用户看不出任何原因，所以在这里补一句。
      */
      if (!hasDrawableLine(stage)) {
        fail(el, stage, t('函数图像没有画出可见曲线：表达式在绘图区间内没有取值（定义域外、分母为零，或变量名不是 x）。请检查表达式与 xAxis / yAxis 的区间'), raw)
        return
      }
      // 占位期那一行是**估算**（见 lib/markdown 的 plotReserve）：画完就换成真实高度。
      // 换的是一个 0.x 像素级的修正，肉眼看不见，但从此这个坑的深度就是确定的
      stage.style.aspectRatio = 'auto'
      stage.style.minHeight = height + 'px'
      el.querySelector('.moji-plot-hint')?.remove()
      // 之前若失败过（例如依赖重打包），成功后要把错误态清掉
      el.classList.remove('moji-plot-error')
      applyPlotLabels(el, stage)
      // 默认禁用交互缩放：d3-zoom 会劫持滚轮，长文档里会挡住翻页
      if (opts.disableZoom !== false) guardScroll(stage, detach)
      lastWidth = width
    } catch (err) {
      /*
        真实异常要**显示给用户**，不能只丢控制台：绘图库抛出来的类型错误（例如
        "Cannot create property 'type' on string 'x'"）本身就是最准确的排查线索，
        一句「请检查表达式与参数」等于什么都没说。
        控制台仍然留一份（带堆栈），卡片上给一句人话 + 原始报错。
      */
      console.warn('函数图像绘制失败', err)
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      fail(el, stage, t('函数图像绘制失败：{0}', detail), raw)
    }
  }

  const schedule = () => {
    if (disposed) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void render(), 120)
  }

  const ro = new ResizeObserver(() => {
    // 容器没有宽度时不重画：隐藏的页签（见 learn/resident）与还没排版的阶段都会量到 0，
    // 那时画出来只会是 MIN_WIDTH 缩着的那一版，白费一次 function-plot 的采样。
    // 等它重新有宽度时 RO 会再来一次，画面自然补上。
    if (stage.clientWidth <= 0) return
    if (Math.abs(currentWidth() - lastWidth) >= RESIZE_STEP) schedule()
  })
  ro.observe(el)
  // 首帧不抢：等正文挂载完、浏览器空下来再画（见 whenIdle 的说明）
  const cancelIdle = whenIdle(() => void render())

  return () => {
    disposed = true
    cancelIdle()
    window.clearTimeout(timer)
    ro.disconnect()
    for (const off of detach) off()
  }
}

/**
 * function-plot 的标题与轴标签是 SVG <text>，没法直接排 LaTeX。
 * 这里只对**含公式标记**的标签做处理：用 HTML 覆盖层（走 renderInline → KaTeX）
 * 叠在原位，并隐藏原 <text>；纯文本标签保持 SVG 原样，避免无谓重排。
 * 位置从渲染后的 getBoundingClientRect 取，因此能跟随自适应缩放。
 */
function applyPlotLabels(el: HTMLElement, stage: HTMLElement): void {
  for (const n of Array.from(el.querySelectorAll('.moji-plot-label'))) n.remove()
  const svg = stage.querySelector('svg')
  if (!svg) return
  // 只有出现公式标记才走覆盖层：$...$ 是 KaTeX 语法，反斜杠说明是 LaTeX 命令
  const markups = ['$', '\\']
  const els = Array.from(svg.querySelectorAll<SVGTextElement>('text.title, text.x.axis-label, text.y.axis-label'))
  // 用 client 坐标换算：容器有边框与 padding，取 offset 会让覆盖层偏离原文字
  const base = el.getBoundingClientRect()
  for (const t of els) {
    const text = t.textContent ?? ''
    const r = t.getBoundingClientRect()
    if (!r.width && !r.height) continue
    const isTitle = t.classList.contains('title')
    /*
     * 两种标签要走 HTML 覆盖层：
     * 1. 含公式标记的（SVG <text> 排不了 LaTeX）；
     * 2. **本身就是标题、而且已经宽过容器**的——SVG 文本不换行，长标题会被
     *    .moji-plot 的 overflow:hidden 从右边切掉（用户截过图：标题最后几个字没了）。
     *    交给覆盖层，那边会换行并收边。
     */
    const tooWide = isTitle && r.width > el.clientWidth - 24
    if (!markups.some((m) => text.includes(m)) && !tooWide) continue
    const overlay = document.createElement('div')
    overlay.className = `moji-plot-label${isTitle ? ' moji-plot-label-title' : ''}`
    overlay.innerHTML = renderInline(text)
    overlay.style.left = `${r.left + r.width / 2 - base.left}px`
    overlay.style.top = `${r.top + r.height / 2 - base.top}px`
    el.appendChild(overlay)
    t.style.display = 'none'
    /*
     * 覆盖层的收边（标题最容易出这个问题）。
     *
     * 覆盖层是 absolute + translate(-50%,-50%)，宽度由内容决定：一句长标题在
     * .moji-plot 的 overflow:hidden 里会被**右边裁掉**（用户截过图：标题最后几个字没了）。
     * 所以量一次，做两件事：
     * 1. 宽了就换行（CSS 那边给 title 放开 white-space 与 max-width），并把锚点从
     *    「垂直居中」改成「从原标题顶部往下排」——不然两行标题会往上顶进图里；
     * 2. 万一锚点本身靠边（宽度不够两行也放不下），把 left 夹回容器内，别指望父级不裁。
     */
    const box = overlay.getBoundingClientRect()
    const pad = 8
    const avail = base.width - pad * 2
    /*
     * 判据要**同时看原文本**：覆盖层是 absolute（右边界 auto），它自己一开始就被
     * 左偏移挤成窄窄一条（实测 620 的容器里只有 298），拿它自己量根本量不出「宽了」。
     * r.width 是 SVG 里那段文字的真实宽度，那才是该比的数。
     */
    if (r.width > avail || box.width > avail) {
      /*
       * 标题宽过容器：**铺满可用宽度来换行**，并改掉锚点。
       *
       * 两处都必须显式写死，不能只给 max-width：
       * 1. 覆盖层是 absolute、右边界 auto，可用宽度会被 left 吃掉一半（实测 620 的容器
       *    只换来 298 宽、四行）；
       * 2. 默认 transform 是 translate(-50%,-50%)（以原标题中心为准），两行标题
       *    按中心排会往上顶出容器。标题改成「占满一行宽度、从原标题顶边往下排」。
       */
      if (isTitle) {
        overlay.style.width = `${avail}px`
        overlay.style.transform = 'translateY(0)'
        overlay.style.left = `${pad}px`
        overlay.style.top = `${r.top - base.top}px`
      } else {
        overlay.style.maxWidth = `${avail}px`
        const wrapped = overlay.getBoundingClientRect()
        const center = r.left + r.width / 2 - base.left
        const half = wrapped.width / 2
        overlay.style.left = `${Math.min(Math.max(center, half + pad), base.width - half - pad)}px`
      }
    }
  }
}

/**
 * 在捕获阶段截住滚轮/触摸：阻止其到达 d3-zoom（否则滚动会变成缩放），
 * 但不 preventDefault，浏览器该滚的页照常滚。
 */
function guardScroll(stage: HTMLElement, detach: Array<() => void>): void {
  const stop = (e: Event) => e.stopPropagation()
  for (const type of ['wheel', 'touchstart', 'touchmove']) {
    stage.addEventListener(type, stop, { capture: true })
    detach.push(() => stage.removeEventListener(type, stop, { capture: true }))
  }
}

/**
 * 图上到底有没有画出线。
 *
 * 判据看 function-plot 的产物而不是表达式本身：区间采样器对每条 series 都会建一个
 * `path.line`，采不出点时这个元素仍在、只是 `d` 是空串——所以「有元素但没有可画的 d」
 * 正是「表达式在这段区间里没有取值」。散点走 `circle`（没有 path.line），这条判据管不到，
 * 直接放过，免得把一张正常的散点图误判成失败。
 */
function hasDrawableLine(stage: HTMLElement): boolean {
  const lines = stage.querySelectorAll('path.line')
  if (!lines.length) return true
  for (const p of Array.from(lines)) {
    const d = p.getAttribute('d') ?? ''
    // 至少两个绘制命令才算一条线；只有一个 M 的点画不出来
    if (d.length > 4 && (d.match(/[ML]/g)?.length ?? 0) >= 2) return true
  }
  return false
}

/* ---------- 修复入口：把报错交回给导师 ---------- */

/**
 * 「让导师修复」按钮的落点，由宿主（LearnWorkspace）挂载时登记——与 chip 的
 * opener 同一套模式：lib 只管把报错打包递出去，发给谁、怎么发它不认识。
 * 没登记（静态导出、独立预览）就不出按钮。
 */
type PlotFixHandler = (p: { reason: string; source: string }) => void

let plotFixHandler: PlotFixHandler | null = null

export function setPlotFixHandler(fn: PlotFixHandler | null): void {
  plotFixHandler = fn
}

function fixButton(reason: string, source: string): HTMLButtonElement | null {
  if (!plotFixHandler) return null
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'moji-plot-fix'
  // 无文字：图标就是全部，说明放 title / aria-label
  btn.title = t('让导师修复')
  btn.setAttribute('aria-label', btn.title)
  // 扳手（lucide 的 wrench 路径，同 stroke 口径）：手绘内联，lib 层不引 React
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94' +
    'l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>'
  btn.addEventListener('click', () => {
    btn.disabled = true
    btn.title = t('已把报错发给导师')
    plotFixHandler?.({ reason, source })
  })
  return btn
}

function fail(el: HTMLElement, stage: HTMLElement, message: string, source: string): void {
  el.classList.add('moji-plot-error')
  el.querySelector('.moji-plot-hint')?.remove()
  // 图画不出来就别再占着那块地方：错误信息自己有多高就多高（见 lib/markdown 的 plotReserve）
  stage.style.aspectRatio = 'auto'
  stage.style.minHeight = '0px'
  const box = document.createElement('div')
  box.className = 'moji-plot-msg'
  box.textContent = message
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = source
  pre.appendChild(code)
  /*
    图标按钮与报错文案**同一行**：图标在前、无底无边，纯靠颜色示意可点
    （用户定的样式）。没有宿主登记时按钮缺席，文案单独一行。
  */
  const row = document.createElement('div')
  row.className = 'moji-plot-row'
  const btn = fixButton(message, source)
  if (btn) row.appendChild(btn)
  row.appendChild(box)
  stage.replaceChildren(row, pre)
}

/**
 * 交给教学 Agent 的语法说明（写进系统提示词，与上面的实现保持同步）。
 *
 * 系统提示词里只保留**每次写图像都要用**的基本结构与开方规矩；data 各形态的完整写法
 * （参数曲线、极坐标、散点、向量、隐函数）搬进了提示词模块 plot-forms
 * （learn/ai/promptModules，模型第一次写出 plot 围栏时注入）。
 *
 * 关于 graphType：function-plot 的采样器由 graphType 决定，默认 graphType 是
 * interval，只支持 linear / implicit。points、parametric、polar 必须显式换成
 * polyline / scatter 才会切到 builtIn 采样器，否则运行时会抛错。
 * 变量名由采样器固定传参决定：参数曲线用 t，极坐标用 theta。
 */
export const PLOT_SYNTAX_GUIDE = `函数图像：用三个反引号 + plot 包一段 JSON 插入可交互图像（如 \`\`\`plot { "data": [{ "fn": "x^2" }] } \`\`\`）。
- 支持 title, xAxis, yAxis, data, annotations；支持 LaTeX 公式。
- **xAxis / yAxis 是设置对象，不是变量名**：想控制显示范围就写 { "xAxis": { "domain": [-5, 5] } }；写成 "xAxis": "x" 会直接报错。函数变量固定用 x（参数方程用 t，极坐标用 theta），不需要声明。
- 表达式写明乘号 (*)，开方写 sqrt(x) 或 nthRoot(x, 3)，避免分数指数。极坐标/参数方程等高级形态写出图像时由 \`plot-forms\` 自动注入。`
