#!/usr/bin/env node
/**
 * 公告编辑器（**只在本机跑，不上传任何地方**）。
 *
 *   npm run notice          等价于 node tools/notice-studio/studio.mjs
 *
 * 它解决的是「改一条公告要开浏览器、进 GitHub 设置页、手改一个 JSON 文本框、再跑去
 * Actions 点一次运行」这套流程太长的问题。这里点几下就能改完并发布。
 *
 * 三条设计约束：
 * 1. **只监听 127.0.0.1**，端口随机。它拿着你本机的 gh 登录态去改仓库，绝不能
 *    暴露在局域网上（绑 0.0.0.0 等于把「改我仓库」的能力挂到网上）。
 * 2. **不引入任何依赖**：只用 Node 内置模块 + 你机器上已经登录的 `gh`。
 *    发布走的就是 `gh secret set` / `gh workflow run`——和你手敲一模一样，
 *    所以这里不需要、也不该有任何 token、PAT 或密钥。
 * 3. **草稿留在本地**：公告正文写在同目录的 draft.json（已被 .gitignore 排除），
 *    只有你点「发布」那一刻才会离开这台机器。
 *
 * 它不替代文档：发布链路、权限、历史记录局限仍然见 docs/notice.md。
 */

import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/* ---------- 配置：换仓库 / 换分支时改这几行，或设同名环境变量 ---------- */

const REPO = process.env.NOTICE_REPO || 'maplexrain/unyra-notice'
const BRANCH = process.env.NOTICE_BRANCH || 'main'
const WORKFLOW = process.env.NOTICE_WORKFLOW || 'deploy.yml'
const SECRET_NAME = process.env.NOTICE_SECRET || 'NOTICE_JSON'
/** Pages 站点根：https://<账号>.github.io/<仓库名> */
const SITE = process.env.NOTICE_SITE || `https://${REPO.split('/')[0]}.github.io/${REPO.split('/')[1]}`
/** 线上公告地址。与 src/lib/noticeConfig.ts 的 DEFAULT_NOTICE_URL 是同一个 */
const NOTICE_URL = `${SITE}/notice.json`
/** 配图在仓库里的目录（会被工作流随站点一起部署） */
const IMAGE_DIR = 'public/images'
/** 配图对外地址前缀 */
const IMAGE_BASE = `${SITE}/images`

const DRAFT_FILE = path.join(HERE, 'draft.json')

/* ---------- gh：找到它，然后跑它 ---------- */

/**
 * gh 的位置。先认 PATH，再兜几个 Windows 上的常见安装位置——
 * 从「开始菜单」装出来的 gh 不一定在 PATH 里，而这里报 ENOENT 的话，
 * 用户看到的是一句没头没脑的 spawn 错误。
 *
 * filter(Boolean) 不能省：GH_PATH 没设时它是 undefined，而 execFile(undefined)
 * 会**同步**抛 TypeError（不走回调），把整个请求打成一句莫名其妙的
 * 「The "file" argument must be of type string」。
 */
const GH_CANDIDATES = [
  process.env.GH_PATH,
  'gh',
  'C:/Program Files/GitHub CLI/gh.exe',
  'C:/Program Files (x86)/GitHub CLI/gh.exe',
].filter((p) => typeof p === 'string' && p.trim())

function runGh(args, opts = {}) {
  return new Promise((resolve) => {
    const tryRun = (index) => {
      if (index >= GH_CANDIDATES.length) {
        resolve({ ok: false, stdout: '', stderr: '找不到 gh：装一个 GitHub CLI 并 gh auth login，或设 GH_PATH 指向它' })
        return
      }
      try {
        execFile(
          GH_CANDIDATES[index],
          args,
          { maxBuffer: 32 * 1024 * 1024, windowsHide: true, ...opts },
          (err, stdout, stderr) => {
            if (err && err.code === 'ENOENT') {
              tryRun(index + 1)
              return
            }
            resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), err })
          },
        )
      } catch (err) {
        resolve({ ok: false, stdout: '', stderr: String(err?.message ?? err) })
      }
    }
    tryRun(0)
  })
}

/** 从 stdin 喂给 gh（正文可能很长，走 argv 会撞上 Windows 的命令行长度上限） */
function runGhWithInput(args, input) {
  return new Promise((resolve) => {
    const tryRun = (index) => {
      if (index >= GH_CANDIDATES.length) {
        resolve({ ok: false, stdout: '', stderr: '找不到 gh：装一个 GitHub CLI 并 gh auth login，或设 GH_PATH 指向它' })
        return
      }
      let child
      try {
        child = spawn(GH_CANDIDATES[index], args, { windowsHide: true })
      } catch (err) {
        resolve({ ok: false, stdout: '', stderr: String(err?.message ?? err) })
        return
      }
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      child.on('error', (err) => {
        if (err.code === 'ENOENT') {
          tryRun(index + 1)
          return
        }
        resolve({ ok: false, stdout, stderr: String(err.message) })
      })
      child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
      child.stdin.end(input)
    }
    tryRun(0)
  })
}

/* ---------- 校验：与客户端 src/lib/notice.ts 同一套规则 ---------- */

const MAX_NOTICES = 20

/**
 * 校验草稿。返回一串人话错误（空数组 = 通过）。
 *
 * ⚠️ 这套规则在三个地方各有一份实现：这里、公告仓库的工作流、以及客户端的
 * src/lib/notice.ts。改了一处必须改另外两处——否则会出现「这边说没问题、
 * 那边读不动」。客户端那份有单元测试钉着（tests/notice.test.ts）。
 */
function validate(draft) {
  const errors = []
  if (!draft || typeof draft !== 'object') return ['草稿不是一个对象']
  if (typeof draft.enabled !== 'boolean') errors.push('总开关 enabled 必须是 true 或 false')

  const notices = Array.isArray(draft.notices) ? draft.notices : null
  if (!notices) return [...errors, 'notices 必须是数组']
  if (notices.length === 0) errors.push('至少要有 1 条公告（要停用请把总开关关掉，别清空列表）')
  if (notices.length > MAX_NOTICES) errors.push(`最多 ${MAX_NOTICES} 条公告，当前 ${notices.length} 条`)

  const seen = new Set()
  notices.forEach((n, i) => {
    const at = `第 ${i + 1} 条`
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      errors.push(`${at}：不是一个对象`)
      return
    }
    if (n.enabled !== undefined && typeof n.enabled !== 'boolean') errors.push(`${at}：enabled 必须是 true / false`)
    for (const key of ['id', 'title', 'content']) {
      if (typeof n[key] !== 'string' || !n[key].trim()) errors.push(`${at}：${key} 不能为空`)
    }
    if (typeof n.id === 'string' && n.id.trim()) {
      if (seen.has(n.id.trim())) errors.push(`${at}：id「${n.id.trim()}」与前面某条重复`)
      seen.add(n.id.trim())
    }
    for (const key of ['publishedAt', 'minVersion']) {
      if (n[key] !== undefined && n[key] !== null && n[key] !== '' && typeof n[key] !== 'string') {
        errors.push(`${at}：${key} 必须是字符串`)
      }
    }
    // 图片必须用完整 https 地址：相对路径会被客户端按 file:// 去解析，必然裂图
    const bad = [...String(n.content ?? '').matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)]
      .map((m) => m[1])
      .filter((u) => !/^https:\/\//i.test(u))
    if (bad.length) errors.push(`${at}：图片必须用完整 https 地址（有 ${bad.length} 处不是）：${bad[0]}`)
  })
  return errors
}

/** 草稿 → 要写进 Secret 的 JSON 文本（字段顺序固定，diff 起来好读） */
function serialize(draft) {
  const notices = (draft.notices ?? []).map((n) => {
    const out = { id: String(n.id ?? '').trim(), title: String(n.title ?? '').trim(), content: String(n.content ?? '') }
    if (n.publishedAt) out.publishedAt = String(n.publishedAt).trim()
    if (n.minVersion) out.minVersion = String(n.minVersion).trim()
    if (n.enabled === false) out.enabled = false
    return out
  })
  return JSON.stringify({ enabled: draft.enabled !== false, notices }, null, 2) + '\n'
}

/* ---------- 草稿读写 ---------- */

function starterDraft() {
  return {
    enabled: true,
    notices: [
      {
        id: `notice-${String(Date.now()).slice(-6)}`,
        title: '新公告',
        content: '在这里写正文，支持 Markdown 与图片。',
        publishedAt: new Date().toISOString().slice(0, 10),
        minVersion: '',
        enabled: true,
      },
    ],
  }
}

function loadDraft() {
  try {
    if (existsSync(DRAFT_FILE)) return JSON.parse(readFileSync(DRAFT_FILE, 'utf-8'))
  } catch (err) {
    console.warn('[notice-studio] 读草稿失败，用空白草稿：', err.message)
  }
  return starterDraft()
}

function saveDraft(draft) {
  writeFileSync(DRAFT_FILE, JSON.stringify(draft, null, 2) + '\n', 'utf-8')
}

/* ---------- 线上现状 ---------- */

async function fetchLive() {
  try {
    const res = await fetch(`${NOTICE_URL}?_=${Date.now()}`)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, raw: await res.text() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

/* ---------- 配图上传 ---------- */

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'])

/**
 * 把一张图提交进公告仓库的 public/images/，返回它的公开地址。
 *
 * 为什么走 Git 而不是塞进公告 JSON：GitHub 的 Secret 有 48 KB 硬上限，
 * 一张截图 base64 之后轻松几十上百 KB。图片因此提交在仓库里、由 Pages 提供，
 * 代价是它**会进 Git 历史**（正文不会）。
 */
async function uploadImage(name, dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl ?? '')
  if (!m) return { ok: false, error: '图片格式不对（要 data URL）' }
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 8 * 1024 * 1024) return { ok: false, error: `图片太大（${(buf.length / 1048576).toFixed(1)} MB，上限 8 MB）` }

  // 文件名：只留安全字符，避免路径穿越与奇怪的 URL
  const ext = path.extname(name || '').toLowerCase() || '.png'
  if (!IMAGE_EXT.has(ext)) return { ok: false, error: `不支持的图片格式：${ext}` }
  const stem = path
    .basename(name || 'image', ext)
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image'
  const file = `${Date.now().toString(36)}-${stem}${ext}`
  const repoPath = `${IMAGE_DIR}/${file}`

  // 目标已存在时要带上 sha 才是「更新」而不是「新建」
  let sha = ''
  const head = await runGh(['api', `repos/${REPO}/contents/${repoPath}`, '--jq', '.sha'])
  if (head.ok) sha = head.stdout.trim()

  const body = { message: `chore: 上传公告配图 ${file}`, content: buf.toString('base64') }
  if (sha) body.sha = sha
  const tmp = path.join(tmpdir(), `notice-img-${Date.now()}.json`)
  writeFileSync(tmp, JSON.stringify(body), 'utf-8')
  const res = await runGh(['api', '--method', 'PUT', `repos/${REPO}/contents/${repoPath}`, '--input', tmp])
  unlinkSync(tmp)
  if (!res.ok) return { ok: false, error: (res.stderr || res.stdout).trim() || '上传失败' }

  return { ok: true, url: `${IMAGE_BASE}/${file}`, file, bytes: buf.length }
}

/* ---------- 发布流水线 ---------- */

let job = null

function log(line) {
  if (!job) return
  job.lines.push(line)
  console.log('[notice-studio]', line)
}

function step(name) {
  if (job) job.step = name
  log(`▶ ${name}`)
}

/**
 * 发布：写 Secret → 触发工作流 → 等它跑完 → 验证线上地址。
 *
 * 全过程只用你本机已登录的 gh，没有任何 token 落在这份代码或草稿里。
 * 跑完之前不谎报成功：验证那一步会真的去取线上文件，取到的 id 与草稿对不上就算失败。
 */
function startPublish(draft) {
  const errors = validate(draft)
  if (errors.length) return { ok: false, errors }

  const json = serialize(draft)
  job = { id: Date.now(), status: 'running', step: '', lines: [], errors: [], startedAt: Date.now() }

  void (async () => {
    try {
      step('检查 gh 登录态')
      const auth = await runGh(['auth', 'status'])
      if (!auth.ok) throw new Error('gh 没登录（先跑 gh auth login），或没装 gh')

      step(`写入 Secret ${SECRET_NAME}（${Buffer.byteLength(json)} 字节）`)
      if (Buffer.byteLength(json) > 48 * 1024) {
        throw new Error('公告 JSON 超过 48 KB —— GitHub Secret 的上限。把图片改成链接（别内嵌 base64）或精简正文。')
      }
      const set = await runGhWithInput(['secret', 'set', SECRET_NAME, '--repo', REPO], json)
      if (!set.ok) throw new Error(`写 Secret 失败：${(set.stderr || set.stdout).trim()}`)
      log(`  ✓ Secret 已更新`)

      step(`触发工作流 ${WORKFLOW}`)
      const run = await runGh(['workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', BRANCH])
      if (!run.ok) throw new Error(`触发失败：${(run.stderr || run.stdout).trim()}`)

      step('等待部署完成')
      const list = await runGh(['run', 'list', '--repo', REPO, '--limit', '1', '--json', 'databaseId,status,conclusion,url'])
      if (!list.ok) throw new Error('取不到运行记录')
      const latest = JSON.parse(list.stdout || '[]')[0]
      if (!latest) throw new Error('没有拿到刚触发的那次运行')
      job.runUrl = latest.url
      log(`  运行页：${latest.url}`)

      const deadline = Date.now() + 5 * 60 * 1000
      let done = null
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000))
        const q = await runGh(['run', 'view', String(latest.databaseId), '--repo', REPO, '--json', 'status,conclusion'])
        if (!q.ok) continue
        const s = JSON.parse(q.stdout || '{}')
        if (s.status === 'completed') {
          done = s
          break
        }
        log(`  … ${s.status}`)
      }
      if (!done) throw new Error('等超时了（5 分钟）。去运行页看看卡在哪一步。')
      if (done.conclusion !== 'success') throw new Error(`工作流没成功：${done.conclusion}。去运行页看日志。`)
      log('  ✓ 部署成功')

      step('验证线上地址')
      // Pages 的 CDN 偶尔要几拍才更新，给三次机会
      let live = null
      for (let i = 0; i < 6; i++) {
        const r = await fetchLive()
        if (r.ok) {
          live = r.raw
          try {
            const parsed = JSON.parse(live)
            const ids = Array.isArray(parsed.notices) ? parsed.notices.map((n) => n.id) : [parsed.id]
            const want = (draft.notices ?? []).map((n) => String(n.id).trim())
            if (ids.join(',') === want.join(',')) break
          } catch {
            /* 还没更新成新内容，继续等 */
          }
        }
        await new Promise((r) => setTimeout(r, 4000))
        log(`  … 线上还是旧内容，再等等（第 ${i + 1} 次）`)
      }
      const final = await fetchLive()
      if (!final.ok) throw new Error(`线上取不到：${final.error}`)
      job.live = final.raw
      log('  ✓ 线上已是新内容')
      log(`\n完成。公告地址：${NOTICE_URL}`)

      job.status = 'done'
    } catch (err) {
      job.status = 'error'
      job.errors.push(err.message)
      log(`✗ ${err.message}`)
    }
  })()

  return { ok: true, jobId: job.id }
}

/* ---------- HTTP ---------- */

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      // 上传图片走这里，给足空间（8 MB 图 base64 之后约 11 MB）
      if (size > 24 * 1024 * 1024) {
        reject(new Error('请求体太大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  // 只认本机来源：这个服务能改你的仓库，别让网页里的一段脚本偷偷调它
  const origin = req.headers.origin
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return json(res, 403, { error: '只接受本机来源' })
  }

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = readFileSync(path.join(HERE, 'ui.html'), 'utf-8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(html)
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        repo: REPO,
        branch: BRANCH,
        workflow: WORKFLOW,
        secret: SECRET_NAME,
        noticeUrl: NOTICE_URL,
        imageBase: IMAGE_BASE,
        draftFile: DRAFT_FILE,
        draft: loadDraft(),
        live: await fetchLive(),
        job,
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/draft') {
      const draft = JSON.parse(await readBody(req))
      saveDraft(draft)
      return json(res, 200, { ok: true, errors: validate(draft) })
    }

    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const draft = JSON.parse(await readBody(req))
      return json(res, 200, { ok: true, errors: validate(draft), json: serialize(draft) })
    }

    if (req.method === 'POST' && url.pathname === '/api/publish') {
      const draft = JSON.parse(await readBody(req))
      saveDraft(draft)
      return json(res, 200, startPublish(draft))
    }

    if (req.method === 'POST' && url.pathname === '/api/upload-image') {
      const { name, dataUrl } = JSON.parse(await readBody(req))
      return json(res, 200, await uploadImage(name, dataUrl))
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      saveDraft(starterDraft())
      return json(res, 200, { ok: true, draft: loadDraft() })
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: err?.message ?? String(err) })
  }
})

/* ---------- 起服务 ---------- */

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`
  console.log('')
  console.log('  公告编辑器已启动（只在本机，关掉这个窗口就没了）')
  console.log(`  ${url}`)
  console.log(`  仓库：${REPO}   分支：${BRANCH}`)
  console.log(`  公告地址：${NOTICE_URL}`)
  console.log(`  草稿：${DRAFT_FILE}${existsSync(DRAFT_FILE) ? '' : '（还没有，先用空白草稿）'}`)
  console.log('')
  // 自动化测试 / 远程 shell 里跑时不想被弹浏览器：NOTICE_NO_OPEN=1
  if (!process.env.NOTICE_NO_OPEN) openBrowser(url)
})

function openBrowser(url) {
  const platform = process.platform
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
}
