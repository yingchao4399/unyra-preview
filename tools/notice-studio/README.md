# 公告编辑器（本地）

一个**只在你本机跑**的小工具：改公告、传配图、一键发布，不用开浏览器进 GitHub 设置页手改 JSON。

```bash
npm run notice
```

跑起来会自动打开 `http://127.0.0.1:<随机端口>/`（端口每次不同，只监听本机）。

## 它做了什么

| 步骤 | 实际动作 |
| --- | --- |
| 保存草稿 | 写同目录的 `draft.json`（已在 `.gitignore` 里，不进版本库） |
| 插入图片 | 把图提交到公告仓库的 `public/images/`，把公开地址插进正文光标处 |
| 发布公告 | `gh secret set NOTICE_JSON` → `gh workflow run deploy.yml` → 等部署 → 取线上文件核对 |

发布那一步走的就是你手敲的那几条 `gh` 命令——**没有 token、没有 PAT、没有密钥**
落在这份代码或草稿里，用的是你机器上已登录的 `gh`。

## 前置条件

- 装了 [GitHub CLI](https://cli.github.com/) 并 `gh auth login`（需要 `repo` 与 `workflow` 两个 scope）
- 公告仓库已经按 [`docs/notice.md`](../../docs/notice.md) 配好（工作流 + Pages + Secret）

## 配置

换仓库 / 换分支时改 `studio.mjs` 顶部那几行，或设同名环境变量：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NOTICE_REPO` | `maplexrain/unyra-notice` | 公告仓库 `账号/仓库名` |
| `NOTICE_BRANCH` | `main` | 工作流跑哪个分支 |
| `NOTICE_WORKFLOW` | `deploy.yml` | 工作流文件名 |
| `NOTICE_SECRET` | `NOTICE_JSON` | 存公告 JSON 的 Secret 名 |
| `NOTICE_SITE` | 按仓库名推出来的 Pages 地址 | 站点根地址 |
| `GH_PATH` | 自动找 | gh 可执行文件的完整路径 |
| `NOTICE_NO_OPEN` | — | 设了就**不**自动打开浏览器（自动化测试用） |

## 几个设计上的取舍

- **只监听 127.0.0.1**，且校验 `Origin` 必须是本机。它拿着你的 gh 登录态去改仓库，
  绑到 `0.0.0.0` 等于把「改我仓库」的能力挂到局域网上。
- **零依赖**：只用 Node 内置模块。断网也能打开界面、编辑、存草稿（发布当然要网）。
- **图片走 Git，正文不走**：GitHub 的 Secret 有 48 KB 硬上限，图片塞不进公告 JSON，
  所以图片提交在仓库里、由 Pages 提供。代价是**图片会进 Git 历史**（正文不会）。
- **发布前先校验**：id 重复、正文为空、图片写成相对路径……都在点「发布」时当场报错，
  不会把半残的内容推上去。

## 校验规则在哪

这套规则目前有**三份实现**（公告仓库拿不到应用仓库的代码）：

1. `studio.mjs` 的 `validate()` —— 你看到的那些错误提示；
2. 公告仓库 `.github/workflows/deploy.yml` 里内嵌的那段 node 脚本 —— 防手改 Secret；
3. 客户端的 [`src/lib/notice.ts`](../../src/lib/notice.ts) —— 真正决定读不读得动。

**改了一处必须改另外两处。** 客户端那份有单元测试钉着（`tests/notice.test.ts`）。

## 它不做什么

- 不替代文档：[`docs/notice.md`](../../docs/notice.md) 才是发布链路、权限、费用与
  历史记录局限的正式说明。
- 不碰 Pages 设置、不建仓库、不改工作流——那些是[一次性配置](../../docs/notice.md)。
