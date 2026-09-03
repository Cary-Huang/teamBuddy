# TeamBuddy 交付工作流

## 目标与原则

TeamBuddy 使用短分支和受保护的 `main`：每次需求或缺陷修复都通过 Pull Request 合入；PR 必须通过自动校验；`main` 校验成功后生成不可变容器镜像并自动部署生产环境。

```text
Issue / 需求
    -> feature/* 或 fix/*
    -> 本地验证、提交
    -> push
    -> 自动创建 PR
    -> CI + Review
    -> Squash merge 到 main
    -> 发布 SHA 镜像到 GHCR
    -> self-hosted Runner 部署
    -> 健康检查
```

不直接向 `main` push，不在 Git 中保存环境文件、数据库凭据或 Token。生产镜像以完整 commit SHA 标记，确保部署和回滚可追溯。

## 日常迭代

开始需求或缺陷修复：

```bash
pnpm workflow:start feature capacity-dashboard
pnpm workflow:start fix duplicate-outbox-event
```

脚本会检查工作区必须干净，切换到 `main`，以 fast-forward 方式同步 `origin/main`，再创建标准分支。

完成代码和测试后提交：

```bash
git add <files>
git commit -m "feat: add capacity dashboard"
pnpm workflow:ship
```

`workflow:ship` 要求所有改动已提交，然后依次执行 lint、类型检查、单测和构建；全部通过后自动 push。首次 push 会触发 `.github/workflows/auto-pr.yml` 创建 PR，后续 push 更新同一个 PR。

推荐提交前缀：`feat:`、`fix:`、`docs:`、`test:`、`refactor:`、`chore:`。PR 合并策略使用 Squash merge，使 `main` 的每个提交对应一个可独立回滚的需求或修复。

## CI 门禁

`.github/workflows/ci.yml` 在标准分支 push 和 PR 上运行：

- `Quality`：格式检查、类型检查、单元测试、生产构建。
- `Database integration (api|worker)`：使用隔离的 PostgreSQL 运行数据库测试。
- `Container build (api|web|worker)`：验证三个生产 Dockerfile 可构建。

内部标准分支的 push CI 是自动 PR 的主要门禁。GitHub 对默认 `GITHUB_TOKEN` 创建的 PR 有额外安全限制：对应的 `pull_request` CI 需要维护者批准，但同一 commit 的 push CI 不受影响。配置下文的 `AUTO_PR_TOKEN` 后，两类 CI 都会直接运行。

建议为 `main` 配置 branch protection/ruleset：

1. Require a pull request before merging，至少 1 人审批。
2. Require status checks，选择上述 6 个稳定检查名。
3. Require conversation resolution 和 branch up to date。
4. 禁止 force push，限制直接 push，并启用合并后自动删除分支。

## GitHub 一次性设置

### 自动 PR

在 `Settings -> Actions -> General -> Workflow permissions` 保持默认只读权限，并启用 **Allow GitHub Actions to create and approve pull requests**。工作流自身只为自动 PR job 申请 `contents: read` 和 `pull-requests: write`。

默认 `GITHUB_TOKEN` 已足够自动创建 PR，但 GitHub 会要求维护者批准该 PR 触发的 `pull_request` workflow。若要消除这一步人工操作，在 Repository Actions secrets 中添加 `AUTO_PR_TOKEN`：使用细粒度 Personal Access Token，并仅授权本仓库的 `Contents: read` 与 `Pull requests: read and write`。工作流会优先使用该 secret；不要把 Token 写入仓库、环境示例或日志。团队规模扩大后可将它替换为 GitHub App installation token。

### 发布参数

创建 Repository variable：

- `NEXT_PUBLIC_API_BASE_URL`：浏览器访问的生产 API 地址，例如 `https://api.teambuddy.example.com`。

每次 `main` 的 CI 成功后，`.github/workflows/release.yml` 将 API、Web、Worker 镜像发布到 GHCR，同时写入 commit SHA 与 `main` 两种 tag。实际部署始终使用 SHA tag。

### 生产 Environment 与 Runner

1. 创建 GitHub Environment `production`，仅允许 `main` 部署；需要人工发布闸门时可添加 required reviewer。
2. 在能访问生产数据库的 Linux x64 主机安装 GitHub self-hosted Runner，并添加标签 `teambuddy-production`。
3. 主机需安装 Docker、Docker Compose v2 和 curl。不要让该 Runner 执行来自 PR 的 job。
4. 从 `.env.production.example` 创建真实环境文件，例如 `/opt/teambuddy/.env.production`，权限限制为 Runner 用户可读。
5. 在 `production` Environment 创建 variables：
   - `PRODUCTION_ENV_FILE=/opt/teambuddy/.env.production`
   - `PRODUCTION_URL=https://teambuddy.example.com`
   - `PRODUCTION_HEALTHCHECK_URL=http://127.0.0.1:3001/health`

数据库凭据只存在于 Runner 主机的受保护文件中，不进入 GitHub、日志或镜像。

## 部署与回滚

自动发布链路只接受通过 `main` CI 的 commit。发布 job 使用最小 `packages: write` 权限推送 GHCR；部署 job 使用 `packages: read`，拉取同一 SHA 的三个镜像并执行：

```bash
docker compose --project-name teambuddy --env-file <生产环境文件> -f compose.production.yml up --detach --remove-orphans
```

部署后最多等待 60 秒检查 API `/health`。失败时 workflow 会失败并保留容器状态用于诊断。

需要回滚时，在 GitHub Actions 中手动运行 `Release`，输入上一个健康版本的完整 commit SHA。该流程不会重新构建镜像，只把生产环境切回指定的已发布版本，并再次执行健康检查。

## 责任边界

- 开发者：Issue 边界、实现、测试、PR 描述与风险说明。
- Reviewer：正确性、回归风险、迁移与可运维性。
- CI：可重复验证和制品构建。
- GitHub Environment：生产部署授权与审计。
- self-hosted Runner：内网部署执行，不承接不可信 PR 代码。
