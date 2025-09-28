<p align="center">
  <img src="images/commitaiflow-icon-scaled-256.png" alt="CommitAIFlow Logo" width="120"/>
</p>

# CommitAIFlow

**CommitAIFlow brings AI-driven commit best practices into your team workflow, ensuring history is clean, consistent, and collaboration is friction-free.**

CommitAIFlow 将 AI 驱动的提交最佳实践引入团队工作流，确保提交历史干净、一致，协作无阻。

---

CommitAIFlow uses AI to automatically **analyze code changes**, propose meaningful **atomic commit splits**, and generate **clear commit messages**.  
It helps developers keep a readable Git history while reducing the manual effort of writing and organizing commits.

CommitAIFlow 使用 AI 自动 分析代码变更，提出有意义的 原子化提交拆分，并生成 清晰的提交信息。
它帮助开发者保持可读的 Git 历史，同时减少编写和整理提交所需的人工工作量。

## 📋 Feature List

| Feature | 中文功能翻译 | Status |
|---------|--------------|--------|
| Auto-check and start local Ollama service | 自动检查并启动本地 Ollama 服务 | ✅ |
| AI-generated commit messages | AI 生成提交信息 | ✅ |
| Display Git commit flow (DAG) placeholder view | 显示 Git 提交流程（DAG）占位视图 | ✅ |
| VS Code integration (Command Palette, Status Bar) | VS Code 集成（命令面板、状态栏） | ✅ |
| Auto-detect and suggest atomic commit splits | 自动检测并建议原子化提交拆分 |  |
| One-click splitting of changes into multiple commits | 一键将改动拆分为多个提交 |  |
| Generate clear, concise commit messages per change cluster | 为每组改动生成清晰简洁的提交信息 |  |
| Run tests or lint automatically before commit | 提交前自动运行测试或代码检查 |  |
| Dependency- and test-aware commit clustering | 基于依赖和测试感知的提交聚类 |  |
| Support interactive fixes (`fixup!`, `autosquash`) | 支持交互式修复（`fixup!`、`autosquash`） |  |
| Integration with team tools for one-click stacked PRs | 集成团队工具，一键生成堆叠式 PR |  |
| Customizable strategies (directory, file type, thresholds, templates) | 可自定义策略（目录、文件类型、阈值、模板） |  |
| Pre-push safety checks (scan for large files/secrets, prevent `--force`) | 推送前安全检查（扫描大文件/密钥，防止 `--force`） |  |
| Optional local telemetry to improve default clustering quality | 可选本地遥测以改进默认聚类质量 |  |

---

## Development & Debugging

```bash
npm install
npm run compile
# Press F5 to launch VS Code Extension Host