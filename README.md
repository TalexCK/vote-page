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

在 HTTPS 反向代理后访问；本地 HTTP 调试需设置 `COOKIE_SECURE=false`。根路径 `/` 为投票页面，`/management` 为管理员结果页面。两者均要求登录。Docker 命令将端口绑定到本机，避免绕过 HTTPS 代理直接访问。

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

管理员登录 `/management`，在 JSON 输入框填写配置后点击发布。配置保存在 SQLite，不再通过环境变量传入。首次部署未发布时，玩家页面显示「暂无投票」。发布成功后立即以新配置作为当前投票，具体开放时间仍由配置控制。

### 投票 JSON

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
      "proposer": "PlayerOne",
      "options": [
        {"id": "a", "label": "方案 A"},
        {"id": "b", "label": "方案 B"}
      ]
    }
  ]
}
```

- `type` 为 `single`（单选）或 `multiple`（多选）；`required` 控制必填。
- `proposer` 为提出者的 MUA Minecraft ID，始终展示。
- 时间必须包含时区，开始时间含边界、结束时间不含边界；以服务器时间为准。
- 题目 ID 在投票内唯一，选项 ID 在题目内唯一。
- 选择只保存在页面中，只有点击提交才写入数据库。每位玩家每场投票仅可提交一次，不可修改，玩家 ID 按大小写不敏感去重。
- 未结束时，仅管理员可调用结果接口；结束后所有已登录玩家可见。页面自动检测结束状态并切换。
- 每题票数为回答该题的玩家数；多选题各选项票数之和可能大于该题票数。结果包含每个选项的所有投票玩家 ID。
- 每次发布必须使用新的投票 `id`，避免覆盖已有票据。旧配置和数据保留在数据库中，不提供历史投票界面。玩家提交附带当前 `poll_id`；管理员发布新投票后，旧页面提交会被拒绝，不会投到新题目上。
- 备份 `/data`；容器移除后命名卷仍保留。

## Secret 算法与插件

Java 插件位于相邻目录 `../shtcsercet`，玩家在服务器执行 `/secret` 获取自己的 Secret，可点击复制。网站不再接受旧版 RSA / `shtc-` 格式。

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
