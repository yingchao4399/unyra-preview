/**
 * 专注模式的标志：盾牌（守卫）里嵌一个靶心（专注）。
 *
 * 不用 lucide 的 Timer —— 这个功能已经不是计时器了。自己画是为了让图标本身
 * 说出「有人守着」这件事；盾与靶心两层都只用圆与直线，14px 下也认得出来。
 */
export default function FocusIcon({
  size = 14,
  className,
  strokeWidth = 1.6,
}: {
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* 盾牌：守卫 */}
      <path d="M12 2.9 5.1 5.6v5c0 4.3 2.8 7.9 6.9 9.9 4.1-2 6.9-5.6 6.9-9.9v-5L12 2.9Z" />
      {/* 靶心：专注 */}
      <circle cx="12" cy="10.6" r="3.2" />
      <circle cx="12" cy="10.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
