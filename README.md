<p align="center">
  <img src="images/commitaiflow-icon-scaled-256.png" alt="CommitAIFlow Logo" width="120"/>
</p>

# CommitAIFlow

**CommitAIFlow brings AI-driven commit best practices into your team workflow, ensuring history is clean, consistent, and collaboration is friction-free.**

---

CommitAIFlow uses AI to automatically **analyze code changes**,  
propose meaningful **atomic commit splits**, and generate **clear commit messages**.  
It helps developers keep a readable Git history while reducing the manual effort of writing and organizing commits.

## 📋 Feature List

| Feature | Status |
|---------|--------|
| Auto-check and start local Ollama service | ✅ |
| AI-generated commit messages | ✅ |
| Display Git commit flow (DAG) placeholder view | ✅ |
| VS Code integration (Command Palette, Status Bar) | ✅ |
| Auto-detect and suggest atomic commit splits |  |
| One-click splitting of changes into multiple commits |  |
| Generate clear, concise commit messages per change cluster |  |
| Run tests or lint automatically before commit |  |
| Dependency- and test-aware commit clustering |  |
| Support interactive fixes (`fixup!`, `autosquash`) |  |
| Integration with team tools for one-click stacked PRs |  |
| Customizable strategies (directory, file type, thresholds, templates) |  |
| Pre-push safety checks (scan for large files/secrets, prevent `--force`) |  |
| Optional local telemetry to improve default clustering quality |  |

---

## Development & Debugging

```bash
npm install
npm run compile
# Press F5 to launch VS Code Extension Host