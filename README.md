# TeamBuddy

TeamBuddy 是一个面向小团队负责人的开源项目排期工具。它将成员产能、项目优先级、里程碑、任务依赖和请假等信息整合到四周排期视图中，帮助团队更早发现资源冲突。

> 项目目前处于早期开发阶段，适合试用、参与设计与共同建设，暂不建议直接用于关键生产环境。

## 当前能力

- 管理团队成员、每日产能与不可用日期。
- 管理项目、优先级、标签、里程碑、任务和依赖关系。
- 基于约束生成可重现的四周排期草案。
- 通过 Outbox 事件由独立 Worker 异步重算排期。
- 提供固定演示数据，方便快速评估完整流程。

风险建议、正式重排确认、AI 能力、身份认证和消息提醒尚未包含。

## 技术栈

- Web：Next.js + React
- API：NestJS + Fastify
- Worker：Node.js + TypeScript
- 数据库：PostgreSQL + Drizzle ORM
- 合同与校验：Zod
- Monorepo：pnpm workspace + Turborepo
- 测试：Vitest + Playwright

## 快速开始

环境要求：

- Node.js 22.14 或更高版本
- pnpm 10.33
- Docker 与 Docker Compose

启动完整的本地演示环境：

```bash
git clone https://github.com/Cary-Huang/teamBuddy.git
cd teamBuddy
cp .env.example .env
docker compose -f docker-compose.pg15.yml -f docker-compose.yml up --build
```

启动后访问：

- Web：[http://localhost:3000](http://localhost:3000)
- API 健康检查：[http://localhost:3001/health](http://localhost:3001/health)

本地 Compose 默认会运行数据库 migration，并幂等地写入演示数据。演示数据包含 1 个团队、10 位成员、10 个项目和 300 个任务。生产部署请不要设置 `SEED_CORE_DEMO=true`，并必须通过安全的环境变量或密钥管理服务注入 `DATABASE_URL`。

停止并删除本地容器：

```bash
docker compose -f docker-compose.pg15.yml -f docker-compose.yml down
```

## 本地开发

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

如果应用在宿主机上运行，而 PostgreSQL 使用上述 Compose 服务，请将 `.env` 中的数据库主机从 `postgres:5432` 改为 `localhost:54329`。

常用命令：

```bash
pnpm test       # 单元测试
pnpm typecheck  # TypeScript 类型检查
pnpm build      # 构建所有应用与包
pnpm e2e:core   # 核心流程端到端测试，需先启动完整环境
```

## 项目结构

```text
apps/
  api/          HTTP API、应用服务与数据库迁移
  web/          项目管理与排期界面
  worker/       Outbox 事件消费与排期重算
packages/
  contracts/    API DTO 与版本化事件合同
  scheduler/    无数据库依赖的确定性排期算法
```

Web 只通过公开 `/v1` 合同访问 API；Web、API 和 Worker 可以独立部署。持久化按 `team`、`portfolio`、`work`、`planning` 和 `platform` schema 划分边界。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始之前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。如果发现安全问题，请按 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。

## 许可证

本项目基于 [MIT License](LICENSE) 开源。
