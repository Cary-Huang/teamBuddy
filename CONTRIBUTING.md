# 贡献指南

感谢你愿意帮助 TeamBuddy 变得更好。贡献可以是缺陷报告、产品建议、文档改进、测试或代码。

## 开始之前

- 搜索现有 Issue，避免重复报告。
- 对于较大的功能或架构变更，先创建 Issue 说明动机、边界和兼容性影响。
- 安全漏洞不应在公开 Issue 中披露，请参阅 [SECURITY.md](SECURITY.md)。

## 开发流程

1. 内部贡献者运行 `pnpm workflow:start feature <name>` 或 `pnpm workflow:start fix <name>` 创建短周期分支；外部贡献者从 fork 的 `main` 创建同样命名的分支。
2. 执行 `pnpm install --frozen-lockfile` 安装依赖。
3. 保持改动聚焦，行为变更需要新增或更新测试。
4. 提交前运行 `pnpm verify`。
5. 内部贡献者运行 `pnpm workflow:ship` 完成校验和 push，GitHub 会自动创建 Pull Request；外部贡献者从 fork 手动创建 Pull Request。
6. 补全 PR 的问题、方案、验证方式与风险，等待 CI 和 review 通过后 Squash merge。

完整分支、CI、部署和回滚流程见 [交付工作流](docs/engineering/delivery-workflow.md)。

## 代码约定

- 使用 TypeScript，优先明确类型和显式错误处理。
- 遵循现有 monorepo 边界：公共 DTO 与事件放在 `packages/contracts`，排期核心放在 `packages/scheduler`。
- 不要提交 `.env`、密码、Token、内部地址、客户数据或其他敏感信息。
- 提交信息建议使用 `feat:`、`fix:`、`docs:`、`test:` 或 `chore:` 等清晰前缀。

## Pull Request 检查清单

- [ ] 改动范围与 PR 描述一致。
- [ ] 相关测试已添加或更新。
- [ ] `pnpm test` 和 `pnpm typecheck` 已通过。
- [ ] 文档和示例配置已同步。
- [ ] 未包含凭据或其他敏感数据。
