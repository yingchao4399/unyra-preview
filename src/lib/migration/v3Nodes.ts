/**
 * 第 3 次迁移：**把一个节点的七份文件合并成一份**。
 *
 * ## 为什么是一次性迁移，而不是读盘时顺手兼容
 *
 * 旧布局里一个节点散成 `{节点}.md` + `{节点}.meta.json` + `{节点}.outline.json` +
 * `{节点}.notes/*.md` + `superdocs/*.html` + `exams/*.json`；新布局只有一个
 * `{节点}.node.json`。如果把这套折算写进 parseDocs 的日常路径，就会变成永远删不掉的
 * 兼容分支——每加一种挂件都要再问一次「老的怎么算」。所以按仓库既定的路子：
 * **迁移脚本一次搬完，业务代码只认新形状**（旧解析器只留作迁移失败时的降落伞）。
 *
 * ## 搬法
 *
 * 不自己重写一套读盘：直接复用 `parseDocsV2` 把旧树读成内存 store，再用 `buildDocs`
 * 摊成新布局——**与运行时同源**，不会出现"迁移写的和运行读的不一样"。
 * 写完新文件之后，把旧文件里"新布局不再产出"的那些删掉（`.md` / `.meta.json` /
 * `.outline.json` / `.notes/` / `superdocs/` / `exams/`）。
 *
 * 二进制（`static/` / `images/` / `workspace/`）**不在这条通道里**：它们本来就不进
 * 文本 map，既不会被读、也不会被删——目录名不变，资源原地不动。
 *
 * ## 幂等
 *
 * 已经迁移过的用户，`parseDocsV2` 找不到 `*.meta.json`，直接返回 null → 跳过。
 * 迁移中途失败的用户重跑也没问题：新文件是覆盖写，旧文件删不干净下次接着删。
 */

import type { MigrationContext, MigrationScript, MigrationStepResult } from './types'
import { isAssetBinary } from '../../learn/store/assets'
import { DOCS_DIR } from '../../learn/layout'
import { buildDocs } from '../../learn/files/build'
import { parseDocsV2, parseDocsV3 } from '../../learn/files/parse'

/** 递归列出某个目录下的全部文件（相对用户目录），目录本身不返回 */
async function listFiles(ctx: MigrationContext, dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await ctx.storage.listDir(rel)
    for (const entry of entries) {
      const child = `${rel}/${entry.name}`
      if (entry.dir) await walk(child)
      else out.push(child)
    }
  }
  await walk(dir)
  return out
}

export async function migrateNodeFiles(ctx: MigrationContext): Promise<MigrationStepResult> {
  const fail = (error: string): MigrationStepResult => ({
    ok: false,
    step: 3,
    modifiedFiles: [],
    error,
  })

  const docsRoot = `${ctx.userDir}/${DOCS_DIR}`
  const prefix = `${ctx.userDir}/`
  const all = await listFiles(ctx, docsRoot)
  const textFiles = all.filter((rel) => !isAssetBinary(rel))
  if (!textFiles.length) {
    return { ok: true, step: 3, modifiedFiles: [], details: '没有可迁移的数据' }
  }

  ctx.log(`发现 ${textFiles.length} 个文本文件，开始读取旧布局…`)
  const files = new Map<string, string>()
  for (const rel of textFiles) {
    const text = await ctx.storage.readText(rel)
    if (text === null) continue
    // parseDocs 认的是「相对用户目录」的路径
    files.set(rel.slice(prefix.length), text)
  }

  const state = await ctx.storage.readJson<unknown>(`${ctx.userDir}/state.json`)
  const store = parseDocsV2(files, state)
  if (!store) {
    return { ok: true, step: 3, modifiedFiles: [], details: '没有旧布局的节点（已迁移过）' }
  }
  ctx.log(`读到 ${store.goals.length} 个目标、${store.nodes.length} 个节点`)

  // 与运行时同源：摊成新布局
  const desired = buildDocs(store)

  // 1. 写新文件（覆盖写，可重跑）
  const modifiedFiles: string[] = []
  for (const [rel, text] of desired) {
    const ok = await ctx.storage.writeText(`${prefix}${rel}`, text)
    if (!ok) return fail(`写入 ${rel} 失败`)
    modifiedFiles.push(rel)
  }
  ctx.log(`写出 ${modifiedFiles.length} 个新文件`)

  // 2. 删掉新布局不再产出的旧文件（.md / .meta.json / .notes/ / superdocs/ / exams/ …）
  const keep = new Set(desired.keys())
  const stale = [...files.keys()].filter((rel) => !keep.has(rel))
  for (const rel of stale) {
    const ok = await ctx.storage.removePath(`${prefix}${rel}`)
    if (!ok) ctx.log(`[注意] 删除旧文件失败（下次保存会再收一次）：${rel}`)
  }
  ctx.log(`清掉 ${stale.length} 个旧文件`)

  // 3. 自查：新布局必须能被读回来，且节点一个不少
  const written = new Map<string, string>()
  for (const rel of modifiedFiles) written.set(rel, desired.get(rel) ?? '')
  const reread = parseDocsV3(written, state)
  if (!reread) return fail('迁移自查失败：写出去的文件读不回来（docs 目录不要动，先备份再反馈）')
  if (reread.nodes.length !== store.nodes.length) {
    return fail(
      `迁移自查失败：迁移前 ${store.nodes.length} 个节点，迁移后读到 ${reread.nodes.length} 个`,
    )
  }

  return {
    ok: true,
    step: 3,
    modifiedFiles,
    details: `合并了 ${store.nodes.length} 个节点的文件（删除旧文件 ${stale.length} 个）`,
  }
}

export const nodeFiles: MigrationScript = {
  step: 3,
  id: 'm3-node-single-file',
  title: '节点文件合并（一个节点一个文件）',
  summary:
    '旧布局里一个节点散成七份文件：正文 .md、大纲 .outline.json、.meta.json、notes/ 下的笔记、' +
    'superdocs/ 下的超级文档、exams/ 下的试卷（试卷与超管还各有一份重复写在 meta 里）。' +
    '这个脚本把它们合并成一个 {节点}.node.json，并删掉旧文件——加一种挂件从此只要在 parts 里加一条。',
  changes: [
    '每个节点新增 {节点}.node.json：正文 / 大纲 / 笔记 / 试卷 / 超级文档全在里面',
    '删掉旧的 .md / .meta.json / .outline.json / .notes/ / superdocs/ / exams/',
    '试卷与超级文档不再双写（以前 meta.json 里还有一整份）',
    '笔记的排列顺序改为「文件里的顺序」，不再依赖 meta 里另记一份名字清单',
    '二进制（static / images / workspace）原地不动，不经过这条通道',
    '已经迁移过的目标跳过（可重复执行）',
  ],
  migrate: migrateNodeFiles,
}
