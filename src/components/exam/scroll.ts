/**
 * 这个文件负责：把「把某一题滚进可视区」算成一个纯函数。
 *
 * 为什么不用 `el.scrollIntoView()`：
 * 它按规范要把**所有祖先滚动容器**都滚一遍。考试窗口里题目流是自己滚的，而根滚动元素
 * （html）即便写着 overflow:hidden，Chromium 仍然接受脚本滚动——答到最后几题时，
 * 一次 scrollIntoView 能把整页顶上去几百像素，页面底下留出一大片空白
 * （也就是「选完对错题，卷面突然空了一大块」那个 bug）。
 *
 * 所以这里只算题目流自己的 scrollTop，位移不许溢出到外层容器。纯函数不碰 DOM，
 * 边界（刚好可见、在上方、在下方、比可视区还高）都在 tests/examScroll.test.ts 里钉住。
 */

export interface ScrollBoxMetrics {
  /** 当前滚动位置 */
  scrollTop: number
  /** 可视高度（不含边框） */
  clientHeight: number
  /** 内容总高度 */
  scrollHeight: number
}

export interface RectMetrics {
  /** 元素顶部在**滚动内容坐标系**里的位置（不是视口坐标） */
  contentTop: number
  height: number
}

/**
 * 让元素「刚好露出来」所需的 scrollTop，语义对齐 `scrollIntoView({ block: 'nearest' })`：
 *
 * - 已经完整可见（含 margin 留白）→ 原地不动，不做无谓的跳动；
 * - 在可视区上方 → 顶部对齐（留 margin）；
 * - 在可视区下方 → 底部对齐（留 margin）；
 * - 比可视区还高 → 一律顶部对齐，否则题目开头被切掉，得自己往上找。
 *
 * 结果夹在 `[0, scrollHeight - clientHeight]`：滚不出内容范围。
 */
export function nearestScrollTop(box: ScrollBoxMetrics, el: RectMetrics, margin = 0): number {
  const max = Math.max(0, box.scrollHeight - box.clientHeight)
  const clamp = (v: number): number => Math.max(0, Math.min(max, Math.round(v)))
  const viewTop = box.scrollTop
  const viewBottom = viewTop + box.clientHeight
  const elTop = el.contentTop
  const elBottom = elTop + el.height
  const gap = Math.max(0, margin)

  if (elTop >= viewTop + gap && elBottom <= viewBottom - gap) return viewTop
  if (elTop < viewTop + gap) return clamp(elTop - gap)
  if (el.height > box.clientHeight - gap * 2) return clamp(elTop - gap)
  return clamp(elBottom - box.clientHeight + gap)
}
