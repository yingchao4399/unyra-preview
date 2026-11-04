/**
 * 「插件文档」页签的打开器。
 *
 * 设置页（PluginsPanel）里那颗按钮要开一个文档页签，而开页签的能力住在
 * LearnWorkspace。沿用 lib/externalLink / lib/docChip 的同一套做法：
 * 工作区挂载时注册，设置页只管调——两棵树之间不递回调。
 */
let opener: (() => void) | null = null

export function setPluginDocOpener(fn: (() => void) | null): void {
  opener = fn
}

/** 打开插件文档页签（没有页签环境时静默——设置页不该因此报错） */
export function openPluginDocTab(): void {
  opener?.()
}
