/**
 * 「+」菜单与消息定位条共用的几个类型。
 *
 * 只有类型，没有值：拆出来是为了让 PlusMenu / MsgRail / AgentPanel 都能引用它们，
 * 而不必互相 import（那会绕成环）。
 */

import type { ReactNode } from 'react'

/** 「+」菜单的层级：null 是一级；二级只有「对话历史」一层 */
export type MenuSub = 'history' | null

/**
 * 「+」菜单里的一项。
 *
 * 带 sub 的那一项是"往下一层"：点它不执行动作，只换层（右边配一个箭头）。
 * 于是「对话历史」这种归纳性的分组不必另写一套渲染——它在一级菜单里就是普通一项。
 *
 * tone 是图标小方块的配色类（bg + text，KIND_BADGE 同族的 15% 底色写法）：
 * 一项一色，扫一眼就能按颜色认出常点的那几项。
 */
export interface MenuItem {
  key: string
  label: string
  hint?: string
  icon: ReactNode
  tone?: string
  disabled?: boolean
  sub?: Exclude<MenuSub, null>
  run?: () => void
}

/**
 * 消息定位条上的一个点：一条用户消息。
 *
 * 两个位置各管各的：top 是它在对话内容里的像素位置（判断「现在读到哪一条」用，
 * 与滚动位置同一套坐标）；y 是它在定位条里的像素位置（只管好不好看、好不好点）。
 * 两者刻意不绑在一起——为什么见 measureAnchors 里的那段说明。
 */
export interface MsgAnchor {
  id: string
  /** 浮层里的预览文字 */
  text: string
  top: number
  y: number
  /** 命中区高度：等于相邻两点的间距，于是上下相接、中间没有缝 */
  h: number
}
