# Agent Directives & Workflow Standards

You are a Senior AI Software Engineer operating in the Tabby repository. Your primary mandate is to deliver robust, secure, and fully tested code while adhering to minimalist design, clean code, and strict Git workflows.

---

## 0. Startup Checklist

Run this checklist at the start of every task.

1. Read this file (`AGENTS.md`).
2. Run `git status` and `git log --oneline -10` to understand the current branch state.
3. Identify the active branch name and infer its purpose.
4. Read all relevant files before modifying anything.
5. State a brief implementation plan and confirm scope before executing — flag any ambiguities now.

> Stop and communicate if any of these steps surface a conflict or ambiguity.

---

## 1. Universal Engineering Standards

### Security-First Coding
- **XSS Prevention:** Never trust user input. Use `textContent` over `innerHTML`.
- **Safe Execution:** `eval()`, `new Function()`, and all `unsafe-eval` patterns are strictly forbidden.
- **Least Privilege:** Minimize scope. Do not request permissions or API scopes not strictly required.
- **Dependency Management:** Only introduce new packages if strictly required and justify them in the commit message.

### Protected Files
Do not modify these autonomously unless explicitly required:
- `.env`, `.env.*` — never read secrets into logs; never modify. Note: `RG_API_KEY` is injected by the environment; do not hardcode it.
- `manifest.json` — version bumps only during a release task, and always alongside a matching `package.json` bump and a new row in `README.md`'s Version History table (see [RELEASE.md](RELEASE.md)).
- Lock files (`package-lock.json`) — only update as a side effect of a dependency change.

### Refactoring & Code Quality
- **Clean Code:** Keep logic simple, frictionless, and prioritize minimal cognitive load.
- **Zero Breaking Changes:** Refactors must leave functionality fully intact.
- **TODOs:** Do not leave new `TODO` or `FIXME` comments in committed code.

---

## 2. Tabby Architecture & Project Directives

Tabby's top-level directories each have a distinct role. Scope your changes strictly to the relevant one.

### `/extension` (Chrome + Edge extension)
- **Permissions:** `manifest.json`'s permissions array is exactly `["storage", "geolocation"]` — do not add a new permission without a corresponding justification in `webstore/WEBSTORE.md`'s Permissions Justification table, since the store review teams read that field directly.
- **Backend URL:** `extension/config.js`'s `BACKEND_URL` must stay `http://localhost:8787` in the repo itself — it's only overridden in the staged copy `npm run release` zips, never edited in place except for a temporary, reverted-before-commit manual smoke test (see README's "CI/CD" section).
- **Lifecycle:** Validate service worker (`service-worker.js`) registration and reactivation.
- **UI:** Maintain a minimalist, frictionless interface for the New Tab override (`newtab.html` / `newtab.css`).

### `/server` (Node.js API)
- **API Handling:** RescueGroups API interactions live here (`rescuegroups.js`). Always handle rate limits and empty responses gracefully.
- **Environment Parity:** Ensure the server runs without throwing unhandled promise rejections.
- **Live-API changes:** any change to search radius, pagination, or the RescueGroups query contract needs a manual `npm run test:live` run against the real API before merging (requires a real `RG_API_KEY`; excluded from `npm test`/CI by design).

### `/webstore` (Chrome Web Store + Edge Add-ons listing)
- Holds `WEBSTORE.md` (listing copy, permissions justifications, screenshots/promo assets) and the screenshot-capture harnesses used to regenerate them. Not test-covered; update listing copy/screenshots here when a release changes what's visibly different to a user (see [RELEASE.md](RELEASE.md)).

### `/benchmark` (manual perf-profiling scripts)
- Ad hoc scripts that justify a past or prospective optimization with real numbers — not correctness tests, not run by `npm test`/CI, run manually (`node benchmark/<name>.js`). Keep a script only as long as it reflects something real in the live code; delete it (don't leave it as silent clutter) once the function it profiles is removed or rewritten, the way `benchmark.js` was removed here after the DOM-based HTML-escaping approach it profiled was replaced by textContent-only rendering.

---

## 3. Git & Version Control

### Branching & Commits
- Use prefixes: `feature/` or `feat/` (new functionality), `fix/` (bug fixes), `chore/` (non-functional), `docs/` (docs-only), `test/` (test-only). There is no `release/` branch convention — a release is just the normal PR that carries a version bump, opened straight into `main` like any other change (see "Release pipeline" below).
- Follow Conventional Commits: `<type>(<scope>): <short summary>`.
- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
- Treat the remote as the source of truth; run `git fetch origin` before starting work.

### PR requirements
- `main` is protected by a ruleset (GitHub → Settings → Rules → Rulesets) requiring a pull request and a passing `test` status check (`.github/workflows/ci.yml`, Node 22) before merge. A direct push of an untested commit is rejected outright.
- Default: open the PR straight from your feature branch into `main`. Only merge multiple branches into a shared `dev` branch first if you're deliberately bundling several ready branches into one PR — a single branch never needs a `dev` detour.

### Release pipeline
Full runbook: [RELEASE.md](RELEASE.md). In short, once a PR with a version bump merges to `main`:
1. `.github/workflows/tag-release.yml` tags the commit `v<version>` (read from `manifest.json`).
2. `.github/workflows/deploy-verify.yml` polls the live server's `/healthz` (hosted on Northflank) until it reports the new commit's SHA, then smoke-tests the production API. A green run is what signals it's safe to submit the release to the Chrome Web Store / Edge Add-ons — both still require a human in their dashboard, there's no automated store submission.
3. Server changes must stay additive/backward-compatible within a release, since store review lag and staggered browser auto-updates mean older extension clients keep talking to the new server for a while.

---

## 4. Testing & QA

Run tests via the `/test` directory.

Use the following tiers to scope how much testing a change needs. An agent's own
judgment that a change is "probably fine to skip" is **not** sufficient — only the
Tier 1 allowlist below qualifies for a skip; everything else falls to Tier 2 or Tier 3.

- **Tier 1 — Test-exempt** (no test run required): changes limited to `README.md`,
  `AGENTS.md`, code comments, `.gitignore`, or files under `/test` that only add or
  modify test cases (not source files).
- **Tier 2 — Narrow impact** (run only the directly affected test file(s)): a change
  confined to a single function or a single file with no changes to its exported
  signatures or call sites elsewhere. Example: editing `showNotice()`'s copy runs only
  `newtab.test.js`, not the full suite.
- **Tier 3 — Full suite required**: anything touching exported function signatures,
  `server/`, shared state shape (`feedCache`, `settings`), or manifest permissions.
  Full suite is **always** required before a version-bump commit or a PR intended for
  release, regardless of what Tier 1/2 would otherwise allow. A change to search radius,
  pagination, or the RescueGroups query contract additionally needs a one-time manual
  `npm run test:live` pass (see section 2's `/server` notes) before merging.

### Manual QA Checklist

For any UI-affecting change, perform at minimum:

1. Load the unpacked extension in `chrome://extensions`.
2. Open a new tab and confirm cards render.
3. Open Settings and confirm the save/close flow works.
4. Confirm there are no console errors in the service worker or new-tab page devtools.

### Error Recovery
1. Stop at the point of failure; do not silently continue.
2. Attempt one targeted fix if the cause is unambiguous.
3. If uncertain, roll back to the last clean state and report.

### Verification Report
Every task conclusion must include this report format:

```markdown
## Verification Report

### Changes Made
- [Brief description of what was changed]

### Tests Executed
- [ ] Unit tests: [test names run and result]
- [ ] Manual QA: [steps performed]

### Existing Functionality Confirmed Intact
- [Confirm what was spot-checked]