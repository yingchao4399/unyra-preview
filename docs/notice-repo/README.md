# unyra-notice —— 归一（Unyra）的公告发布仓库

这个仓库放**发布工作流**和**公告配图**，不放公告正文。

- 公告正文存在仓库 Secret `NOTICE_JSON` 里（Settings → Secrets and variables → Actions）。
- 手动跑一次 `Deploy notice` 工作流，它会把 Secret 写成 `public/notice.json`，
  连同仓库里的 `public/images/`（配图）一起部署到 GitHub Pages。
- 客户端的 `src/lib/noticeConfig.ts` 读的就是部署出来的那条 URL。

> ⚠️ 注意：Secret 只是让公告正文**不进入 Git 提交历史**，不是让公告保密。
> 公告发布之后就是公开内容——部署产物、Pages 部署历史、Actions 日志、缓存与
> 第三方存档都可能留下痕迹。要发不能公开的东西，别用这套。
>
> 另外：**配图是进 Git 的**。图片放不进 Secret（GitHub 的 Secret 有 48 KB 硬上限），
> 所以它们提交在 `public/images/` 下。详见
> [应用仓库的 `docs/notice.md`](https://github.com/maplexrain/unyra/blob/main/docs/notice.md)。

## 这个仓库里有什么

```
.github/workflows/deploy.yml   # 手动触发的发布工作流
public/images/*.png            # 公告配图（会被随站点一起部署）
README.md                      # 就是这份说明
```

**没有** `notice.json`——它是工作流运行时临时生成、随产物部署出去的，
不会被提交进仓库。

## 怎么发公告

在应用仓库里跑 `npm run notice`（本地编辑器），改完点「发布公告」就行——
它会写 Secret、跑工作流、验证线上，一条龙。手动做的步骤见下面的「一次性配置」
与应用仓库的 `docs/notice.md`。

## 一次性配置

1. **建仓库**：新建一个仓库，命名 `unyra-notice`（公开或私有都行；
   GitHub Pages 对私有仓库的站点可见性受你的套餐限制，见文档「费用与限制」）。
2. **放入工作流**：把应用仓库 `docs/notice-repo/.github/workflows/deploy.yml`
   复制到本仓库的 `.github/workflows/deploy.yml`。
3. **配置 Secret**：Settings → Secrets and variables → Actions → New repository secret
   - Name：`NOTICE_JSON`
   - Secret：整份公告 JSON（见下面的格式）
4. **打开 Pages**：Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。
   （必须先做这一步，否则工作流跑到部署那一步会报 `Get Pages site failed`。）

## 发布 / 更新公告

1. 改 Secret：Settings → Secrets and variables → Actions → `NOTICE_JSON` → Update。
2. Actions → `Deploy notice` → Run workflow。
3. 跑完在部署那一步的输出里能看到公告地址：
   `https://<用户名>.github.io/unyra-notice/notice.json`

## 公告 JSON 格式

一份文件里放**一组**公告，客户端的弹窗用页签把它们摊开：

```json
{
  "enabled": true,
  "notices": [
    {
      "id": "notice-002",
      "title": "公告标题（页签上显示的就是它）",
      "content": "正文，支持 Markdown。\n\n![配图](https://<用户名>.github.io/unyra-notice/images/xxx.png)",
      "publishedAt": "2026-10-16",
      "minVersion": "0.6.2"
    },
    {
      "id": "notice-001",
      "title": "另一条",
      "content": "……"
    }
  ]
}
```

**数组顺序 = 页签顺序**。单条字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 非空字符串。唯一标识，用来记「这条我已经看过了」。**改了内容就换一个新 id** |
| `title` | 是 | 非空字符串。标题 |
| `content` | 是 | 非空字符串。正文，Markdown（客户端会消毒后再渲染） |
| `enabled` | 否 | 布尔值，缺省 true。`false` = 单独停用这一条 |
| `publishedAt` | 否 | 字符串，建议 `YYYY-MM-DD`。仅用于展示 |
| `minVersion` | 否 | 字符串，如 `0.6.2`。当前软件版本**低于**它时客户端不展示这条 |

顶层的 `enabled` 是**总开关**（必填）：`false` = 整份公告一起下线。

**旧格式仍然读得动**（顶层直接就是一条公告），客户端两种写法都认。

字段缺失或类型不对，工作流会在校验那一步直接失败（**不会**把半残的公告发出去）。

## 配图

正文里的图片要用**完整 https 地址**：

```markdown
![说明文字](https://<用户名>.github.io/unyra-notice/images/图文件名.png)
```

把图提交到 `public/images/`，工作流会随站点一起部署它。**为什么图片不放进 Secret**：
GitHub 的 Secret 有 48 KB 硬上限，一张截图 base64 之后轻松几十上百 KB。
代价是**图片会进 Git 历史**（公告正文不会）——图片本来就是公开内容，没有额外风险，
但要知道它**是**在历史里的。

相对路径（`images/xxx.png`）**不行**：客户端会按 `file://` 解析，必然裂图。

## 停用公告

- **停一条**：把那条的 `enabled` 改成 `false`。
- **全停**：把顶层的 `enabled` 改成 `false`。

改完再跑一次工作流。客户端下次启动就会把它当作「没有公告」。

不要为了让公告消失而删 Secret 或删仓库——那只会让客户端取到 404，
表现是「公告弹窗里显示取不到公告」，反而更像坏了。
