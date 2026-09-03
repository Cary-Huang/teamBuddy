# 贡献指南

感谢你愿意帮助 TeamBuddy 变得更好。贡献可以是缺陷报告、产品建议、文档改进、测试或代码。

## 开始之前

- 搜索现有 Issue，避免重复报告。
- 对于较大的功能或架构变更，先创建 Issue 说明动机、边界和兼容性影响。
- 安全漏洞不应在公开 Issue 中披露，请参阅 [SECURITY.md](SECURITY.md)。

## 开发流程

1. Fork 仓库并从 `main` 创建短周期分支。
2. 执行 `pnpm install --frozen-lockfile` 安装依赖。
3. 保持改动聚焦，行为变更需要新增或更新测试。
4. 提交前至少运行 `pnpm test` 和 `pnpm typecheck`。
5. 创建 Pull Request，说明问题、解决方案、验证方式与可能风险。

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
