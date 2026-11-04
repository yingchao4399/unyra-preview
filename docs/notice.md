# 远程公告

应用启动时会去一条 HTTPS 地址取一份公告 JSON，按规则决定要不要弹给用户看。
公告内容**不写死在客户端**，改公告不必重新发版。

- 客户端实现：[`src/lib/notice.ts`](../src/lib/notice.ts)（取 / 校验 / 判定 / 本机状态）
  - 地址配置：[`src/lib/noticeConfig.ts`](../src/lib/noticeConfig.ts)（**唯一一处**地址）
  - 界面：[`src/components/notice/NoticeDialog.tsx`](../src/components/notice/NoticeDialog.tsx)（竖屏弹窗）
- 发布侧模板：[`notice-repo/`](notice-repo/)（放到**独立的公告仓库**里）

---

## 一、总体架构

```
本地编辑公告 JSON
      │  粘贴进 GitHub Repository Secret（NOTICE_JSON）
      ▼
手动运行 GitHub Actions（workflow_dispatch）
      │  读 Secret → 临时写 public/notice.json → 校验 → 部署
      ▼
GitHub Pages（HTTPS 提供 notice.json）
      │  HTTPS 请求
      ▼
客户端：校验 → 版本判断 → 决定是否展示
```

为什么是这个方案：

- **不部署自己的服务器**：GitHub Pages 是免费的静态托管，公告就是个静态 JSON。
- **不依赖需要绑卡的云存储**：只用到 GitHub 账号本身。
- **公告正文不进 Git**：正文存在 Secret 里，仓库里只有工作流。这样「仓库是公开的」
  也不会把公告正文变成公开提交记录。
- **可手动触发**：公告是「我想发一句话」的动作，不该被 push 意外带出去。

> ⚠️ **Secret 不等于保密。** 它只解决「正文不进 Git 提交历史」这一件事。
> 公告发布之后就是公开内容——部署产物、Pages 部署历史、Actions 日志、CDN 缓存、
> 第三方存档都可能留下痕迹。详见本文第八节。

---

## 二、数据流与缓存

1. 客户端启动时取一次公告；之后**每 5 分钟轮询一次**（`lib/notice` 的
   `startNoticePolling`，间隔 `NOTICE_POLL_MS = 5 * 60 * 1000`）。
   轮询期间新到的公告会让顶栏喇叭按钮亮起**红点**——这是轮询的意义：
   用户不必等到下次启动才发现新公告。
2. 请求地址上会挂一个每次都不同的查询串（`notice.json?_=<时间戳>`，见
   `noticeConfig.ts` 的 `noticeUrlForRequest`）：GitHub Pages 默认给静态文件
   `Cache-Control: max-age=600`，中间还可能有 CDN，不挂查询串就会出现
   「改了公告，客户端十分钟内还读旧内容」。
3. 请求超时 8 秒（`NOTICE_TIMEOUT_MS`）；主进程的 `web:fetch` 另有 20 秒硬上限。
4. 取不到 → 当作「这次没有公告」，**不影响应用的任何其它功能**，下次启动 / 下次轮询自动重试。
5. 窗口切回前台时如果**已经超过一个轮询周期没取过**，会立刻补一次——
   这样「切回来一看，红点已经亮了」，而不是还要再等几分钟。

---

## 三、公告 JSON 格式

一份文件里放**一组**公告，界面用页签把它们摊开：

```json
{
  "enabled": true,
  "notices": [
    {
      "id": "notice-002",
      "title": "公告现在能发多条了",
      "content": "正文（Markdown，可放图片）\n\n![配图](https://maplexrain.github.io/unyra-notice/images/xxx.png)",
      "publishedAt": "2026-10-16",
      "minVersion": "0.6.2"
    },
    {
      "id": "notice-001",
      "title": "公告功能已上线",
      "content": "……",
      "publishedAt": "2026-10-15"
    }
  ]
}
```

**数组顺序 = 页签顺序**（第一条在最前）。单条公告的字段：

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 非空。公告唯一标识，用来记「这条我读过了」。**改了内容就换新 id** |
| `title` | 是 | string | 非空。标题（页签上显示的就是它） |
| `content` | 是 | string | 非空，最长 20000 字符。正文，Markdown |
| `enabled` | 否 | boolean | 缺省 true。`false` = 单独停用这一条 |
| `publishedAt` | 否 | string | 建议 `YYYY-MM-DD`，仅用于展示 |
| `minVersion` | 否 | string | 当前软件版本**低于**它时不展示这条 |

顶层的 `enabled` 是**总开关**（必填）：`false` = 整份公告一起下线，客户端当作「没有公告」。

### 兼容旧格式

第一版是「顶层直接就是一条公告」，这个写法**仍然读得动**（读成「只有一条的 notices」）：

```json
{ "enabled": true, "id": "notice-001", "title": "…", "content": "…" }
```

兼容不是洁癖：客户端与线上文件是**分开升级**的，读不动旧文件就会出现
「更新了客户端反而看不到公告」。反过来（新客户端读旧文件）也顺——两种写法都认。

### 校验严格到什么程度

- **顶层**形状不对（不是对象、`enabled` 不是布尔、`notices` 不是数组且也不像旧式单条）→ 整份无效。
- **单条**的 `id` / `title` / `content` 缺失或类型不对 → 丢掉那一条，其余照常展示。
  `enabled` **写了但不是布尔**（比如写成 `"true"`）→ 判无效，不悄悄按默认值放过去。
- `id` 在同一份文件里重复 → 只留第一条（否则后一条会顶掉前一条的已读记录）。
- 条数上限 20（页签排得下，也没人真会一次发二十条）。

发布侧（工作流）是**严格**的：任何一条不合法就直接终止发布，不让半残内容上线。
客户端那一侧对个别坏条目宽容（只丢那一条），是「万一」的兜底——正常情况下遇不到。

### 图片

正文里的图片必须是**完整 https 地址**：

```markdown
![说明文字](https://maplexrain.github.io/unyra-notice/images/xxx.png)
```

- **为什么图片不能塞进公告 JSON**：GitHub 的 Secret 有 **48 KB 硬上限**，一张截图
  base64 之后轻松几十上百 KB，塞不下。
- **图片放哪**：提交在公告仓库的 `public/images/` 下，由 Pages 一起部署
  （工作流里的 `actions/checkout` 就是为了把它们取出来）。服务时返回的是正经的
  `Content-Type: image/png`，浏览器与客户端都能直接渲染。
- **相对路径不行**：`images/xxx.png` 在客户端会被按 `file://` 解析，必然裂图。
  本地编辑器会在发布前直接报错拦住它。
- **代价**：图片**会进 Git 历史**（公告正文不会）。图片本来就是公开内容，
  进 Git 没有额外风险——但要知道它**是**在 Git 历史里的。
- 宽度由 `styles/markdown.css` 的 `.moji-agent-md img` 约束，不会撑破弹窗；
  CSP 的 `img-src` 已放行 `https:`（见 `electron/csp.ts`）。

**安全**：正文是 Markdown，渲染走 `renderNote`（marked + DOMPurify 消毒，见
[`lib/markdown.ts`](../src/lib/markdown.ts) 与 [`lib/sanitize.ts`](../src/lib/sanitize.ts)），
**不会**当 HTML 直接执行，也**不会**当 JavaScript 执行。公告里的外链点一下交给系统浏览器，
不会把应用界面顶掉。

---

## 四、客户端行为（弹 / 不弹的规则）

判定只有一处：[`shouldAutoShow`](../src/lib/notice.ts)。三条规则，顺序即优先级：

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 存档里的版本号 ≠ 当前版本号（刚更新过） | **强制弹一次**（压过用户的全部选择） |
| 2 | 用户关掉了「自动弹出」 | 不弹 |
| 3 | 都不拦 | 弹（默认：每次打开都弹） |

**已读记录不参与弹不弹的判定。** `readIds` 只影响顶栏那颗**红点**：
还有没读过的公告（含轮询期间新到的）就点亮，全读完就熄灭。

### 弹窗长什么样

- **尺寸 546 × 818**（竖屏，宽高比 2:3）。这个数是量出来的，不是拍脑袋：把界面上
  这颗弹窗截下来、按标注框量到 546 × 818，而同一张图里当时的弹窗量到 380 × 656，
  与代码里的 `max-w-[380px]` / `min(78vh, 660px)` 对得上——截图与窗口 1:1，
  所以标注框的像素数就是 CSS 像素数。小窗口下用 `min()` 收一收。
- **多条公告用页签摊开**（只有一条时不显示页签）。没读过的公告，页签上有一个小红点。
- 打开时先落在**第一条没读过的**那一页（`firstUnreadIndex`），而不是永远回到第一页——
  新发的那条往往不在开头，每次都把用户丢回第一页等于让他自己去找。
- 正文可滚动；图片宽度由 `styles/markdown.css` 的 `.moji-agent-md img` 约束。

### 「更新后强制弹一次」为什么用版本号比对

存档里有一项 `shownVersion`：上一次自动弹出决策生效时的软件版本号。

- 装上新版本 → 版本号必然与存档不同 → 规则 1 命中 → 强制弹一次；
- 弹完把 `shownVersion` 追平 → 下次启动规则 1 不再命中，完全按用户的设置走。

**关键在于它不动用户的选择。** 另一种实现是「更新后把 `autoShow` 重置为 true」——
那是用一个副作用换一个效果：用户会发现自己的「不再自动弹出」被悄悄改回去了。
版本号比对没有这个问题，用户的那份选择自始至终没被动过。

首次安装（存档版本号为空）同样命中规则 1，于是第一次打开会弹一次。

### 本机状态存在哪

存在 appdata 的 `global.yaml`（`{userData}/global.yaml`，与关窗行为、自动更新开关同一处），
**跟机器走、不属于任何用户**：

```yaml
notice:
  autoShow: true            # 用户偏好：启动时要不要自动弹出
  shownVersion: "0.6.2"     # 上一次自动弹出决策生效时的软件版本号
  readIds:                  # 已经读过的公告 id（只增不减，最多保留最近 200 条）
    - notice-001
    - notice-002
```

- 为什么跟机器走：公告是应用级的一句话，同一台机器换个用户登录不该又弹一遍。
- 为什么不在 localStorage：本应用的数据一律落在用户数据目录（见
  [`lib/storage.ts`](../src/lib/storage.ts) 顶部），localStorage 是历史遗留。
- 读写通道：`notice:get` / `notice:set`（见 `electron/storage/ipc.ts`），
  主进程侧按字段合并，渲染层每次只改自己关心的那一项。

### 入口

顶栏右侧的**喇叭按钮**（原「文档」占位按钮已删除，位置让给它）。点开的是同一个弹窗，
只是不经过自动弹出判定。按钮上有一颗**红点**：还有没读过的公告（含轮询期间新到的）
就亮，全读完就熄灭。弹窗底部有「不再自动弹出」勾选框，关闭时落盘——
勾上时只把 `autoShow` 改成 `false`（不动 `readIds`，已读是另一件事）。

---

## 五、发布公告

### 推荐做法：用本地编辑器

```bash
npm run notice
```

会起一个**只在本机**的小工具（`tools/notice-studio/`，自动打开浏览器），在里面
改公告、传配图、点「发布公告」，它替你跑完「写 Secret → 触发工作流 → 等部署 → 验证线上」
整条链路。工具本身的说明见 [`tools/notice-studio/README.md`](../tools/notice-studio/README.md)。

下面 1～8 步是**从零再来一遍**的完整说明（换账号、换仓库名时照它做），
也是这个工具背后实际做的事——工具只是把这套命令包了一层界面。

> **当前部署状态**（2026-10-16 实测）：
>
> | 项 | 值 |
> | --- | --- |
> | 公告仓库 | [`maplexrain/unyra-notice`](https://github.com/maplexrain/unyra-notice)（公开） |
> | 公告地址 | `https://maplexrain.github.io/unyra-notice/notice.json` |
> | 配图地址 | `https://maplexrain.github.io/unyra-notice/images/<文件名>` |
> | Pages Source | GitHub Actions（已启用） |
> | Secret | `NOTICE_JSON`（已配置） |
> | 工作流 | `Deploy notice`，已跑通多次（build + deploy 均成功） |
> | 线上验证 | 3 条公告、正文含配图；`curl` 返回 200，内容与 Secret 一致 |
> | 本地工具 | `npm run notice` |

工作流模板在仓库里：
[`docs/notice-repo/.github/workflows/deploy.yml`](notice-repo/.github/workflows/deploy.yml)。

### 1. 建一个**独立的**公告仓库

**不要**把应用源码仓库改造成公告仓库。公告仓库是公开的静态托管，应用源码仓库是另一回事，
两者的可见性、协作人、提交历史都不该混在一起。新建一个仓库，命名 `unyra-notice`。

### 2. 放入工作流

```bash
# 在你 clone 下来的 unyra-notice 仓库里
mkdir -p .github/workflows
cp <应用仓库>/docs/notice-repo/.github/workflows/deploy.yml .github/workflows/deploy.yml
git add .github/workflows/deploy.yml
git commit -m "chore: 公告发布工作流"
git push
```

仓库里**只该有这一个文件**（外加一个 README）。不要提交 `notice.json`、不要提交 `public/`。

### 3. 配置 Repository Secret

GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**

- **Name**：`NOTICE_JSON`
- **Secret**：整份公告 JSON（把上面第三节那份贴进去，改成你要发的内容）

工作流用 `env:` 把 Secret 传给脚本，**不会**让它出现在日志的「展开后命令」里。

### 4. 在 Settings → Pages 里启用 GitHub Actions 部署

仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。

必须先做这一步。跳过的话，工作流跑到部署那一步会报 `Get Pages site failed`。

### 5. 手动运行发布工作流

仓库 → **Actions** → 左侧选 **Deploy notice** → 右上 **Run workflow** → 选分支 → **Run**。

工作流会：读 Secret → 写 `public/notice.json` → 校验 JSON 与字段 → 用官方 Pages
Actions 打包并部署。校验不过会**直接失败**，不会把半残的公告发出去。

### 6. 拿到 `notice.json` 的 HTTPS URL

部署那一步（`deploy` job）的最后会打印一行：

```
公告地址（填进客户端的 src/lib/noticeConfig.ts）：https://<用户名>.github.io/unyra-notice/notice.json
```

也可以用命令行验证它真的能访问（**这条必须自己跑一遍**，别假定部署成功）：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<用户名>.github.io/unyra-notice/notice.json
# 期望：200
curl -sS https://<用户名>.github.io/unyra-notice/notice.json | head -c 200
# 期望：看到你写的那份 JSON
```

### 7. 把 URL 配置到客户端

改 [`src/lib/noticeConfig.ts`](../src/lib/noticeConfig.ts) 的 `DEFAULT_NOTICE_URL`，重新构建。
或者构建时注入环境变量（fork 出去自己维护的人用这条，不必改源码）：

```bash
VITE_NOTICE_URL=https://<用户名>.github.io/unyra-notice/notice.json npm run build
```

> **注意**：主进程的抓取会拒绝本机与内网地址（见 `electron/web-core.ts` 的
> `isPrivateHost`），所以 `http://127.0.0.1:...` 这种本地地址**抓不到**。
> 想本地调试公告，只能临时在 `notice.ts` 里直接构造 `RemoteNotice` 传给界面。

### 8. 用 `gh` 一条龙（不想点网页时走这条）

装了 [GitHub CLI](https://cli.github.com/) 并 `gh auth login` 之后，上面 1～6 步可以这样走
（需要 `repo` 与 `workflow` 两个 scope）：

```bash
# 建仓库（公开）
gh repo create unyra-notice --public --description "归一（Unyra）公告发布仓库"

# 放工作流并推上去
git init -b main && git remote add origin https://github.com/<用户名>/unyra-notice.git
mkdir -p .github/workflows
cp <应用仓库>/docs/notice-repo/.github/workflows/deploy.yml .github/workflows/deploy.yml
cp <应用仓库>/docs/notice-repo/README.md README.md
git add -A && git commit -m "chore: 公告发布工作流" && git push -u origin main

# 开 Pages：Source = GitHub Actions（等价于在 Settings → Pages 里点那一下）
gh api --method POST repos/<用户名>/unyra-notice/pages -f build_type=workflow

# 配置公告内容（把 notice.json 换成你的公告 JSON 文件）
gh secret set NOTICE_JSON --repo <用户名>/unyra-notice --body "$(cat notice.json)"

# 发布并盯到跑完
gh workflow run deploy.yml --repo <用户名>/unyra-notice --ref main
gh run watch --repo <用户名>/unyra-notice --exit-status

# 验证
curl -sS -o /dev/null -w '%{http_code}\n' https://<用户名>.github.io/unyra-notice/notice.json
```

---

## 六、日常操作

### 更新公告

**用本地编辑器（推荐）**：`npm run notice` → 改内容 → 点「发布公告」。它会顺手校验、
写 Secret、跑工作流、验证线上，最后告诉你成了没有。

**手动做**：

1. Settings → Secrets and variables → Actions → `NOTICE_JSON` → **Update**，改内容；
   **同时给改过的那条换一个新 `id`**（如 `notice-002`）——不换 id 的话，已经点过
   「不再自动弹出」的用户不会再看它。
2. Actions → `Deploy notice` → Run workflow。
3. 用第五节的 `curl` 命令确认新内容已经上线。

### 加配图

在编辑器里点「插入图片…」选一张图，它会：

1. 把图提交到公告仓库的 `public/images/`（文件名前面加一段随机串，不会互相覆盖）；
2. 把 `![名字](完整 https 地址)` 插到正文的光标处。

手动做的话，把图提交到 `public/images/`，然后在正文里写完整地址：

```markdown
![说明文字](https://<用户名>.github.io/unyra-notice/images/图文件名.png)
```

**必须用完整地址**（相对路径在客户端会按 `file://` 解析，必然裂图）。

### 停用公告

- **停一条**：把那条的 `enabled` 改成 `false`。
- **全停**：把顶层的 `enabled` 改成 `false`。

改完再跑一次工作流。客户端下次启动就当作「没有公告」，弹窗里的手动入口会显示
「暂时没有新的公告」。

**不要**为了让公告消失而删 Secret 或删仓库——那会让客户端取到 404，
表现成「公告弹窗显示取不到公告」，反而更像坏了。

### 验证发布结果

```bash
# 1. 文件在不在、内容对不对
curl -sS https://<用户名>.github.io/unyra-notice/notice.json

# 2. 绕开缓存看最新（与客户端挂的查询串同理）
curl -sS "https://<用户名>.github.io/unyra-notice/notice.json?_=$(date +%s)"

# 3. 字段校验（与工作流里那段同源的检查）
curl -sS https://<用户名>.github.io/unyra-notice/notice.json \
  | node --input-type=module -e "
      let raw
      try { raw = JSON.parse(await new Promise((r) => { let s=''; process.stdin.on('data',(d)=>s+=d).on('end',()=>r(s)) })) }
      catch { console.error('不是合法 JSON'); process.exit(1) }
      for (const k of ['id','title','content']) if (typeof raw[k] !== 'string' || !raw[k].trim()) { console.error(k+' 不合法'); process.exit(1) }
      if (typeof raw.enabled !== 'boolean') { console.error('enabled 不合法'); process.exit(1) }
      console.log('校验通过：'+raw.id)
    "
```

客户端侧的验证：把 `shownVersion` 改成别的版本号（或直接删掉 `global.yaml` 里的
`notice` 段）再启动，应当弹一次公告。

---

## 七、常见错误排查

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 工作流报 `还没有配置仓库 Secret NOTICE_JSON` | Secret 名写错或没建 | Settings → Secrets and variables → Actions 里确认名字**逐字**是 `NOTICE_JSON` |
| 工作流报 `notice.json 校验失败：不是合法的 JSON` | Secret 里贴的不是合法 JSON（常见：多了注释、少了逗号、被 Markdown 代码围栏包住） | 本地 `node -e "JSON.parse(require('fs').readFileSync('notice.json','utf8'))"` 先过一遍 |
| 工作流报 `notice.json 校验失败：id 必须是非空字符串` 等 | 字段缺失或类型不对 | 对照第三节的表逐项检查；`enabled` 要写 `true` 不是 `"true"` |
| 部署那一步报 `Get Pages site failed` / `Not Found` | Pages 的 Source 没设成 GitHub Actions | Settings → Pages → Source 选 **GitHub Actions**，再重跑 |
| 部署成功但 URL 404 | 第一次部署后 Pages 要一两分钟生效；或 URL 拼错（用户名 / 仓库名） | 等一会儿重试；在 Actions 的部署输出里核对 `page_url` |
| 客户端弹窗显示「没能获取公告」 | 地址错、网络不通、或 Pages 还没生效 | 先用 `curl` 确认 URL 能访问；再看客户端日志里的 `[notice]` 前缀 |
| 客户端弹窗显示「公告不是合法的 JSON」/「缺少必需字段」 | 线上文件与预期不符 | `curl` 看线上原文；多半是 Secret 更新后**没重跑工作流** |
| 改了公告但客户端还是旧内容 | 缓存（Pages / CDN） | 确认客户端带查询串请求；或 `curl` 加 `?_=$(date +%s)` 看线上是否已经是新的 |
| 弹窗显示「还没有配置公告地址」 | `NOTICE_URL` 是空串 | 检查 `noticeConfig.ts` 或构建时的 `VITE_NOTICE_URL` |
| 更新到新版本后没弹 | `shownVersion` 已经等于当前版本 | 这是预期行为（已经弹过）；要重测就手改 `global.yaml` 里的 `shownVersion` |

---

## 八、安全与历史记录的限制

这套方案的目标是「**让公告正文不进入普通 Git 提交历史**」，**不是**「让公告保密」。
别把这两件事混为一谈。

必须清楚：

- **Secret 不是保密手段。** 公告发布之后就是公开内容，任何人都能访问 Pages 上的
  `notice.json`。Secret 只是让正文不出现在仓库的提交记录里。
- **配图是例外，它确实在 Git 里。** 图片放不进 Secret（48 KB 上限），所以提交在
  `public/images/` 下，**会进 Git 提交历史**。公告正文不会。
  图片本来就是公开内容，进 Git 没有额外风险——但要知道它**是**在历史里的，
  而且删掉文件之后旧提交里仍然找得到。
- **信息会残留。** 至少这些地方可能留下痕迹：
  - Actions 的运行日志与工作流摘要（本工作流刻意不打印正文，但 GitHub 自身的机制仍在）；
  - 部署产物（Pages artifact，本工作流把保留期压到 1 天，但仍在保留期内可下载）；
  - Pages 的部署历史；
  - CDN / 浏览器 / 客户端的缓存；
  - 第三方存档站（对公开 URL 的自动抓取与快照）。
- **覆盖 ≠ 删除。** 把 Secret 里的公告改成新的，**不会**让以前发布过的内容从上述位置
  彻底消失。GitHub Secret 本身也不提供「改了就没了」的保证。
- **本工作流不做任何清理动作。** 不会为了隐藏历史去删仓库、强推重写 Git 历史或做其它
  不可逆操作——那些动作的风险远大于它们能掩盖的东西。
- **不执行公告内容。** 工作流只用官方 Action，校验脚本只做 JSON 解析与字段类型判断，
  不会执行正文里的任何命令。客户端也只把正文当 Markdown 渲染，且渲染前经过 DOMPurify。
- **凭据不进客户端。** 客户端里没有任何 GitHub Secret、PAT 或部署凭据——它只是
  匿名 GET 一条公开 URL。本地编辑器用的也是你机器上已登录的 `gh`，代码里没有任何密钥。

**结论**：公告是公开内容。要发不能公开的东西，换别的渠道。

---

## 九、费用与配额限制

- **GitHub Pages**：公开仓库免费；私有仓库的 Pages 站点可见性取决于你的套餐
  （免费账号的私有仓库 Pages 站点**同样是公开可访问的**，但需要付费套餐才支持
  私有仓库启用 Pages——以 GitHub 当前的定价页为准）。
- **GitHub Actions**：公开仓库免费；私有仓库每月有免费分钟数，超出按分钟计费。
  本工作流一次运行只需十几秒，正常使用远低于配额。
- **带宽**：Pages 有软性带宽限制（约每月 100 GB），公告 JSON 只有几百字节，
  客户端每次启动取一次，可以忽略。
- **没有绑定银行卡**：整套流程只用到 GitHub 账号本身。

---

## 十、验收对照

| 验收项 | 落在哪 | 状态 |
| --- | --- | --- |
| 有可复用的公告获取模块 | `src/lib/notice.ts` 的 `fetchNotice` / `refreshNotice` | ✅ 有单测 |
| 请求失败不影响软件正常运行 | 失败一律收敛成快照里的 `fail`，只影响弹窗内容；`App.tsx` 里的启动流程静默 catch | ✅ 有单测 |
| 能正确解析、校验、展示有效公告 | `parseNoticeFeed` / `parseNoticeItem`（严格校验）+ `MarkdownView`（消毒后渲染） | ✅ 有单测 |
| 每次打开自动弹出 | `shouldAutoShow` 规则 3（只剩 `autoShow` 一个开关，已读不参与判定） | ✅ 有单测 |
| 停用公告后不再展示 | 顶层 / 单条 `enabled === false` → 跳过 | ✅ 有单测 |
| 支持多条公告、页签切换 | `NoticeFeed.notices` + `NoticeDialog` 的 `NoticeTabs`；打开时落在 `firstUnreadIndex` | ✅ 有单测（判定）+ 线上 3 条 |
| 公告窗口是竖屏、尺寸对齐标注框 | `NoticeDialog` 的 `PANEL_W/PANEL_H = 546 × 818`（量自截图，1:1） | ✅ 已量 |
| 公告支持图片 | 图片提交在 `public/images/`，由 Pages 提供（`Content-Type: image/png`）；渲染走 `renderNote` | ✅ 线上已挂图 |
| 本地公告编辑器 | `tools/notice-studio/`（`npm run notice`），只监听 127.0.0.1，零依赖，走本机 `gh` | ✅ 已实测发布 |
| 每 5 分钟轮询 + 未读红点 | `startNoticePolling(NOTICE_POLL_MS)` + `unreadNotices` → `NoticeButton` 红点 | ✅ 有单测 |
| 窗口切回前台补取 | `visibilitychange` + `lastFetchTime` 判断 | ✅ 代码可见 |
| 公告仓库只存工作流配置与配图 | `unyra-notice` 仓库里只有 `deploy.yml`、`README.md`、`public/images/*` | ✅ 已核对 |
| 工作流可手动触发并完成 Pages 部署 | `deploy.yml` 的 `workflow_dispatch` + 四个官方 Action（checkout@v5 / configure-pages@v6 / upload-pages-artifact@v5 / deploy-pages@v5） | ✅ 已跑通 |
| 部署后的 JSON 与配图可通过 HTTPS 访问 | `.../notice.json` 与 `.../images/*.png` | ✅ 均 200 |
| 公告正文不进入 Git 提交历史 | 仓库文件树无 `notice.json`；代码搜索搜不到公告标题 | ✅ 已核对 |
| 公告正文不进入 Actions 日志 | 逐字 grep 日志：标题 / 正文片段命中 0 次（只打印 id 与条数） | ✅ 已核对 |
| 不存在把凭据嵌入客户端或工具 | 客户端只 GET 公开 URL；工具走本机已登录的 `gh`，代码里无密钥 | ✅ 代码可见 |

**仍未验证的部分**（说清楚，不含糊）：

- 客户端的自动弹出、勾选「不再自动弹出」、更新后强制弹一次、页签切换、图片渲染、
  轮询与红点，逻辑与渲染有单元测试覆盖（`tests/notice.test.ts` 44 条 +
  `tests/noticeImage.test.ts` 5 条），但**尚未在打包后的应用里端到端手测**——
  「点开软件真的会弹出、图真的显示出来、红点真的亮」还没有亲眼见过，
  只有逻辑证据 + 线上链路证据。
- 三条线上公告（`notice-001`～`003`）是我代拟的占位内容，请按你的意思改掉
  （改完记得换新 `id`，否则已勾过「不再自动弹出」的人不会再看到它）。

---

## 十一、部署记录

2026-10-15 / 10-16 实际执行的步骤与结果（供日后排查参照）：

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 推工作流 | `git push -u origin main` | ✅ commit `3365837` |
| 开 Pages | `gh api --method POST repos/maplexrain/unyra-notice/pages -f build_type=workflow` | ✅ `html_url: https://maplexrain.github.io/unyra-notice/` |
| 配 Secret | `gh secret set NOTICE_JSON --repo maplexrain/unyra-notice` | ✅ |
| 第一次发布 | `gh workflow run deploy.yml` | ✅ run `38764588189`，build 4s + deploy 27s |
| 升级 Action | 三个 Action 换到 node24 版本，commit `d4019bf` | ✅ 弃用警告消失 |
| 第二次发布 | `gh workflow run deploy.yml` | ✅ run `38764894633`，build 4s + deploy 19s |
| 线上验证 | `curl .../notice.json` | ✅ 200，内容与 Secret 一致 |
| 日志核对 | `gh run view --log` + grep 公告正文 | ✅ 正文 0 命中 |
| 多条公告格式 | 客户端改 `NoticeFeed`，工作流同步改校验 | ⚠️ 第一次发布失败——**改了本地工作流忘了推仓库**，线上还是旧校验；推送后成功 |
| 配图上传 | 编辑器 `POST /api/upload-image` → 提交到 `public/images/` | ✅ 27 KB 横幅，Pages 返回 `image/png` |
| 三次发布（含配图） | `npm run notice` 的「发布公告」 | ✅ run 全部 success，线上 3 条、正文含图 |
| 轮询 + 红点 | `startNoticePolling` + `unreadNotices` + `NoticeButton` | ✅ 类型通过 + 49 条单测 |

三条已知的非阻塞提示（都是 GitHub 侧的，不用管）：

- `ubuntu-latest` 将在 2026-10-19 起迁移到 Ubuntu 26——标签不变，无需改。
- 升级前那版 Action 会打 Node 20 弃用警告，升级后已消失。
- 工作流的校验脚本与客户端、本地编辑器是**三处实现**（公告仓库拿不到应用仓库的代码）。
  改一处必须改另外两处——这次的多条格式改动就踩过一次。
