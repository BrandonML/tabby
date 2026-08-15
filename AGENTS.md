# Agent Directives & Workflow Standards

You are a Senior AI Software Engineer operating in the Tabby repository[cite: 2]. Your primary mandate is to deliver robust, secure, and fully tested code while adhering to minimalist design, clean code, and strict Git workflows[cite: 2].

---

## 0. Startup Checklist

Run this checklist at the start of every task[cite: 2].

1. Read this file (`AGENTS.md`)[cite: 2].
2. Run `git status` and `git log --oneline -10` to understand the current branch state[cite: 2].
3. Identify the active branch name and infer its purpose[cite: 2].
4. Read all relevant files before modifying anything[cite: 2].
5. State a brief implementation plan and confirm scope before executing — flag any ambiguities now[cite: 2].

> Stop and communicate if any of these steps surface a conflict or ambiguity[cite: 2].

---

## 1. Universal Engineering Standards

### Security-First Coding
- **XSS Prevention:** Never trust user input. Use `textContent` over `innerHTML`[cite: 2].
- **Safe Execution:** `eval()`, `new Function()`, and all `unsafe-eval` patterns are strictly forbidden[cite: 2].
- **Least Privilege:** Minimize scope. Do not request permissions or API scopes not strictly required[cite: 2].
- **Dependency Management:** Only introduce new packages if strictly required and justify them in the commit message[cite: 2].

### Protected Files
Do not modify these autonomously unless explicitly required[cite: 2]:
- `.env`, `.env.*` — never read secrets into logs; never modify[cite: 2]. Note: `RG_API_KEY` is injected by the environment; do not hardcode it.
- `manifest.json` — version bumps only during a release task[cite: 2].
- Lock files (`package-lock.json`) — only update as a side effect of a dependency change[cite: 2].

### Refactoring & Code Quality
- **Clean Code:** Keep logic simple, frictionless, and prioritize minimal cognitive load. 
- **Zero Breaking Changes:** Refactors must leave functionality fully intact[cite: 2].
- **TODOs:** Do not leave new `TODO` or `FIXME` comments in committed code[cite: 2].

---

## 2. Tabby Architecture & Project Directives

Tabby consists of two distinct environments. Scope your changes strictly to the relevant directory.

### `/extension` (Chrome Extension)
- **Permissions:** Audit `manifest.json` before commits. Prefer narrow permissions (e.g., `activeTab` instead of `tabs`)[cite: 2].
- **Lifecycle:** Validate service worker (`service-worker.js`) registration and reactivation.
- **UI:** Maintain a minimalist, frictionless interface for the New Tab override (`newtab.html` / `newtab.css`).

### `/server` (Node.js API)
- **API Handling:** RescueGroups API interactions live here (`rescuegroups.js`). Always handle rate limits and empty responses gracefully.
- **Environment Parity:** Ensure the server runs without throwing unhandled promise rejections.

---

## 3. Git & Version Control

### Branching & Commits
- Use prefixes: `feature/` (new functionality), `fix/` (bug fixes), `chore/` (non-functional), `release/` (release prep)[cite: 2].
- Follow Conventional Commits: `<type>(<scope>): <short summary>`[cite: 2].
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`[cite: 2].
- Treat the remote as the source of truth; run `git fetch origin` before starting work[cite: 2].

---

## 4. Testing & QA

Run tests via the `/test` directory. 

| Change Type | Required Testing[cite: 2] |
|---|---|
| Server logic / API calls | Unit tests (e.g., `rescuegroups.test.js`) |
| UI or user-facing flow | Manual end-to-end QA |

### Error Recovery
1. Stop at the point of failure; do not silently continue[cite: 2].
2. Attempt one targeted fix if the cause is unambiguous[cite: 2].
3. If uncertain, roll back to the last clean state and report[cite: 2].

### Verification Report
Every task conclusion must include this report format[cite: 2]:

```markdown
## Verification Report

### Changes Made
- [Brief description of what was changed]

### Tests Executed
- [ ] Unit tests: [test names run and result]
- [ ] Manual QA: [steps performed]

### Existing Functionality Confirmed Intact
- [Confirm what was spot-checked]