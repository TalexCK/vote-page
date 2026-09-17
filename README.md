# 投票

黑白 React / shadcn/ui 前端、FastAPI 后端、SQLite 持久化。前后端由同一服务提供，无需额外部署前端服务。

## Docker

```sh
cp .env.example .env
# 编辑 .env，填入管理员 Minecraft ID 和密钥
openssl rand -hex 32 # 将输出作为 JWT_SECRET

docker build -t mua-vote .
docker run -d --name mua-vote --restart unless-stopped \
  --env-file .env -p 127.0.0.1:8000:8000 \
  -v mua-vote-data:/data mua-vote
```

在 HTTPS 反向代理后访问；本地 HTTP 调试需设置 `COOKIE_SECURE=false`。根路径 `/` 为投票页面，`/management` 为可视化投票管理页面。两者均要求登录。Docker 命令将端口绑定到本机，避免绕过 HTTPS 代理直接访问。

## 环境变量

| 变量 | 含义 |
| --- | --- |
| `ADMIN_IDS` | 逗号分隔的 MUA Minecraft ID，不是 UUID；权限比较不区分大小写 |
| `SECRET_SALT` | 必填、非空；与 Java 插件使用的完整盐字符串一致，保留空格，不提供默认回退 |
| `JWT_SECRET` | 至少 32 字节的随机 JWT 签名密钥，与 `SECRET_SALT` 分开 |
| `COOKIE_SECURE` | 默认 `true`；仅本地 HTTP 调试设为 `false` |
| `DATABASE_PATH` | SQLite 文件路径，容器默认 `/data/votes.sqlite3` |
| `STATIC_DIR` | 前端构建路径，容器默认 `/app/static` |

`docker --env-file` 中的盐值不要再包一层引号；中间的空格属于盐的一部分。不要提交部署用的 `.env` 或私密盐到仓库。

### 发布投票

管理员登录 `/management`，直接在网页填写标题、起止时间并添加题目，无需编写 JSON。

- 支持单选、多选、填空题；可添加分类与分页条目、调整顺序、删除条目。
- 分类、分页和隐藏题的条件通过题目下拉框与选项标签勾选配置。
- 可以创建多个投票。**创建不会自动替换主页投票**；通过页面顶部的「主页投票」选择框指定主页显示哪一个，也可停用展示。起止时间仍独立控制是否开放。
- 已创建投票保留原始题目和答案，可查看各投票结果、复制为新投票。为避免已有答案与修改后的题目混淆，不原地修改已创建配置。
- 投票列表支持删除；确认后永久删除投票及全部选票。删除当前首页投票会同时停止展示，不自动切换到其他投票。
- 切换或停用不删除已有数据；切回同一投票仍使用原有答案及修改冷却时间。尚未选择主页投票时，玩家看到「暂无投票」。
- 配置、主页选择与答案均保存在 SQLite；已有数据库无需手动迁移。

### 数据格式（API 参考）

管理界面自动生成以下配置，无需手动填写：

```json
{
  "id": "vote-2026-01",
  "title": "投票",
  "starts_at": "2026-08-01T00:00:00+08:00",
  "ends_at": "2026-08-08T00:00:00+08:00",
  "questions": [
    {
      "id": "q1",
      "title": "选择一个方案",
      "type": "single",
      "required": true,
      "description": "请选择你支持的方案。",
      "options": [
        {"id": "a", "label": "方案 A"},
        {"id": "b", "label": "方案 B"}
      ]
    }
  ]
}
```

### 分页与分类

`questions` 数组可混合题目、分页标签和分类块；旧格式仍兼容：

```json
[
  {"id":"q1","title":"第一题","type":"single","required":true,"proposer":"PlayerOne","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]},
  {"type":"pagebreak"},
  {"id":"q2","title":"第二题","type":"single","required":false,"proposer":"PlayerOne","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]},
  {
    "type":"category",
    "title":"活动安排",
    "questions":[
      {"id":"q3","title":"活动时间","type":"multiple","required":true,"proposer":"PlayerTwo","options":[{"id":"sat","label":"星期六"},{"id":"sun","label":"星期日"}]},
      {"id":"q4","title":"活动地点","type":"single","required":true,"proposer":"PlayerTwo","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}
    ]
  },
  {"id":"q5","title":"其他建议","type":"single","required":false,"proposer":"PlayerOne","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}
]
```

将上面的数组填入配置的 `questions`。本例为四页：q1、q2、分类「活动安排」（q3/q4）、q5。

- `{"type":"pagebreak"}` 手动换页；连续、开头和末尾的分页标签不产生空白页。
- `{"type":"category","title":"分类名","questions":[...]}` 在分类前后自动分页，同一分类内的题目默认同页；内部仍可插入 `pagebreak`，各页保留分类标题。不支持分类嵌套。
- 分类必须包含真实题目；全场题目 ID 唯一，所有分类合计最多 100 题。
- 翻页不会提交或清空选择；最后统一提交全部有效答案，必填校验仅覆盖未跳过的分类。修改答案遵循同样的条件，结果展示仍包含全部题目。
- 玩家接口的 `questions` 保持扁平题目列表，`pages` 描述布局与条件；管理配置接口返回原始分类结构。

#### 条件分页与分类

`pagebreak` 和 `category` 均可添加 `condition`，用题目 ID 和选项的 **label 文本**（不是选项 ID）配置：

```json
{"type":"pagebreak","condition":{"question_id":"q1","option_labels":["A","B"]}}
```

```json
{
  "type":"category",
  "title":"活动安排",
  "condition":{"question_id":"q1","option_labels":["A"]},
  "questions":[
    {"id":"q2","title":"参加时间","type":"multiple","required":true,"proposer":"PlayerOne","options":[{"id":"sat","label":"星期六"},{"id":"sun","label":"星期日"}]}
  ]
}
```

- 选中指定标签中的 **任意一个** 即满足条件；多选题也采用任一命中规则。未答题视为不满足。
- 分页条件不满足时不能继续下一页，页面会提示需要选择的题目与标签；不会自动跳过下一页。末尾分页条件也会在提交时校验。
- 分类条件不满足时跳过整个分类（包括其内部分页），隐藏题目不要求必填，答案不计入提交与统计。返回前页修改选择后，会清除不再适用的分类答案。
- 条件只能引用配置中位于其前面的题目，分类不能引用自身内部题目；标签列表不能为空、不能重复，且标签必须存在于被引用题目中。若被引用题目所属分类已跳过，视为未作答。
- 不填写 `condition` 时保持原有行为。前后端均执行条件检查，不能通过直接提交绕过分页限制。

### 题目与提交规则

- `type` 为 `single`（单选）、`multiple`（多选）或 `text`（填空）；`required` 控制必填。
- 填空题使用空 `options`，可设置 `pattern`（最多 500 字符），如 `[0-9]{4}`。服务器使用 Python 兼容正则进行**整段匹配**，不是搜索子串；格式错误或匹配超时会拒绝提交。单次匹配限时 20ms，答案最多 2000 字符，纯空白按未填写处理。填空结果展示原文及提交者。
- `hidden: true` 表示默认隐藏。可额外设置 `condition`（与分类条件格式相同），选中前面题目的任一指定标签才显示；没有条件则始终隐藏。`hidden: false` 或省略时始终显示。
- 隐藏题不校验必填，也不保留答案。条件只能引用前面的单选或多选题，不能引用填空题；被隐藏/跳过的来源题视为未作答。
- `description` 为可选题目说明，最多 2000 字符，支持换行，在题目下方以浅色注释显示。旧配置的 `proposer` 仍兼容，并作为说明显示；复制新建时自动转换。
- 时间必须包含时区，开始时间含边界、结束时间不含边界；以服务器时间为准。
- 题目 ID 在投票内唯一，选项 ID 在题目内唯一。
- 选择只保存在页面中，只有点击提交才写入数据库。首次提交及每次修改提交成功后，须等待满 10 分钟才能再次修改；投票结束后不可修改，以服务器时间为准。
- 修改时预填自己的原答案，提交后完整替换旧答案（包括清空选填题），不增加该玩家的票数。每位玩家每场投票始终只有一份当前答案，ID 按大小写不敏感去重；冷却时间保存在数据库中，刷新、重新登录及服务重启均不会重置。
- 未结束时，仅管理员可调用结果接口；结束后所有已登录玩家可见。页面自动检测结束状态并切换。
- 每题票数为回答该题的玩家数；多选题各选项票数之和可能大于该题票数。结果包含每个选项的所有投票玩家 ID。
- 每次创建必须使用新的投票 `id`（网页自动生成），避免覆盖已有票据。管理页可查看所有投票和各自结果。玩家提交附带当前 `poll_id`；管理员切换主页投票后，旧页面提交会被拒绝，不会投到其他题目上。

### 管理 API

所有管理接口仅管理员可用：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/management/polls` | 列出所有投票及 `active_poll_id` |
| `POST /api/management/polls` | `{config: ...}` 创建投票，不切换主页 |
| `GET /api/management/poll?poll_id=...` | 读取原始配置，用于复制；查询参数须 URL 编码 |
| `POST /api/management/delete-poll` | `{poll_id: "..."}` 永久删除投票和选票 |
| `POST /api/management/active-poll` | `{poll_id: "..."}` 切换主页；`null` 停用 |
| `GET /api/management/results?poll_id=...` | 查看指定投票结果，无需先切换主页 |

旧 `POST /api/management/poll` 仍兼容「创建并激活」行为；网页使用新的多投票接口。读取配置与结果也提供 `/management/polls/{id}`、`/management/polls/{id}/results` 路径形式；网页使用查询参数形式，兼容历史 ID 中包含 `/` 等字符的投票。

请备份 `/data`；容器移除后命名卷仍保留。

## Secret 算法与插件

Java 插件位于相邻目录 `../shtcsecret`，玩家在服务器执行 `/secret` 获取自己的 Secret，可点击复制。网站不再接受旧版 RSA / `shtc-` 格式。

```python
secret = hashlib.sha256((minecraft_id + os.environ['SECRET_SALT']).encode('utf-8')).hexdigest()[:32]
```

- 使用小写十六进制 SHA-256 的前 32 个字符，不是原始摘要的前 32 字节；不添加前缀。
- ID 取插件的 `Player.getName()`，保留大小写、不补位。网站登录时须输入相同大小写的 ID。
- `.env.example` 的盐与新插件的默认盐一致。生产建议两端通过 `SECRET_SALT` 使用新的私密随机值；改盐后玩家需重新获取 Secret。
- 网站启动时缺少或使用空盐会报错，不回退到默认盐。
- 迁移时移除 `SECRET_PRIVATE_KEY`，添加 `SECRET_SALT`，同时更换 `JWT_SECRET` 以使旧登录会话失效。

**盐是身份认证密钥，不是可以公开的普通哈希盐。知道盐即可生成任意玩家（包括管理员）的 Secret。默认盐已存在于源码和示例中，不应作为公开部署的安全凭据。** 请用服务器环境变量覆盖默认盐并限制访问；Secret 是长期凭据，泄露后在更换盐前可被重复使用。JWT 不会消除这些风险。

JWT 放在 HttpOnly、SameSite=Strict Cookie 中，12 小时有效，不存入 localStorage；生产默认 Secure Cookie。所有写接口要求 JSON，跨站请求被拒绝。登录按直接连接 IP 限制为每 5 分钟 20 次，限制存于 SQLite；不信任转发 IP 头，因此反向代理后的客户端会共享代理 IP 的限额。公开部署建议由可信代理补充限流，并按实际网络拓扑调整应用限流。

## GitHub Actions / GHCR

`.github/workflows/docker.yml` 自动构建并推送镜像到 `ghcr.io/<owner>/<repo>`（名称转小写）：

- 先运行后端和前端测试，通过后构建 Docker 镜像。
- 分支 push：发布分支名和完整提交 SHA 标签；默认分支同时发布 `latest`。
- `v*` 标签 push：发布对应版本标签和提交 SHA 标签。
- pull request：只构建，不登录、不推送。
- 支持 Actions 页面手动运行。

使用 GitHub 自带的 `GITHUB_TOKEN` 和 `packages: write` 权限，不需要额外密码。首次发布的包可能是私有的，可在 GitHub Package 设置中调整可见性。仓库/组织需允许 Actions 写入 Packages。工作流不会将部署密钥或 `.env` 写入镜像。

```sh
docker pull ghcr.io/<owner>/<repo>:latest
```

本地环境未启动 Docker daemon 时无法验证镜像构建；实际构建/推送由 GitHub Actions 执行。

## 本地开发与验证

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/pytest -q backend
# .env 中设置 COOKIE_SECURE=false
.venv/bin/uvicorn app:create_app --factory --app-dir backend --env-file .env --reload

cd frontend
npm ci
npm test
npm run dev
# 发布构建
npm run build
```

Vite 将 `/api` 代理到 `127.0.0.1:8000`。生产由 FastAPI 提供 `frontend/dist`，支持直接打开 `/management`。测试使用固定算法向量和测试盐，不读取部署密钥。
