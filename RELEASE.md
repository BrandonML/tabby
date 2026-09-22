# Release runbook

Steps to ship a change to `main`, which auto-deploys the server to Northflank, and on to the Chrome Web Store / Edge Add-ons.

## 1. One-time setup (only needs doing once, ever)

- [ ] `main` has a ruleset requiring the `test` status check (from `.github/workflows/ci.yml`) to pass before merging, and requiring changes to go through a pull request. See GitHub → repo → Settings → Rules → Rulesets.

## 2. Pre-merge

- [ ] Default: open a pull request straight from the feature branch into `main` — don't merge locally and push. Going through a PR is what lets the ruleset above actually gate the merge on CI passing (a direct push of an untested commit is rejected outright, since it can never satisfy the required check). The ruleset gates on the *target* branch (`main`) requiring a PR + a green `test` check — it doesn't care what the source branch is named, so there's no need to create a `dev` branch just to have one.
- [ ] Exception: if several feature branches are ready to ship together, merge them all into a shared `dev` branch first, then open one PR from `dev` into `main`. Use this only when bundling multiple branches — a single feature branch goes straight to `main`.
- [ ] Bump `manifest.json`/`package.json` to the new version and add a row to [README.md](README.md)'s Version History table, as a commit on the same branch/PR — this is what `tag-release.yml` reads post-merge, so it needs to land in the same merge as the change it describes rather than as a follow-up.
- [ ] Documentation currency check (see AGENTS.md's "Documentation & Asset Currency"): does this release make README.md, this file, or `webstore/WEBSTORE.md` (copy or screenshots/promo assets) inaccurate? Fix small stuff directly in this PR. For a larger asset-generation task (e.g. regenerating screenshots), don't block the release on it — file a tracking issue instead and note it in the PR description, the way [issue #66](https://github.com/BrandonML/tabby/issues/66) tracks the icon-menu change making the screenshot harness stale.
- [ ] Wait for the `test` check to go green. If it's red, stop — do not merge.
- [ ] Merge the PR.

## 3. Post-merge (fully automated — just watch)

- [ ] `.github/workflows/tag-release.yml` tags the commit `v<version>` (read from `manifest.json`). Check the repo's Tags page.
- [ ] `.github/workflows/deploy-verify.yml` polls the live server's `/healthz` until it reports this exact commit's SHA (`NF_DEPLOYMENT_SHA`, injected by Northflank), then smoke-tests `/api/nearby-cats`, `/api/photo-thumb`, and `/api/photo-share` against production. **A green run is the signal that it's safe to proceed to store submission.** If it goes red or times out, stop and check the `tabby` service's build/deploy status directly on Northflank before doing anything else.

## 4. Store submission (manual — both stores require a human in their dashboard)

- [ ] Build the release zip: `npm run release <version> https://p01--tabby--bklqdgzwx4md.code.run`
- [ ] Double-check [webstore/WEBSTORE.md](webstore/WEBSTORE.md)'s listing copy and screenshots match what's about to ship — this should already be handled by the §2 documentation currency check, this is just the last look before it's public.
- [ ] Upload `dist/v<version>.zip` to the Chrome Web Store dashboard, submit for review.
- [ ] Upload the same zip to the Edge Add-ons dashboard, submit for review.

## If a release fails

- **`test` check red pre-merge:** don't merge. Fix on the same branch/PR and wait for green — there's nothing to roll back since nothing shipped yet.
- **`deploy-verify.yml` red or times out post-merge:** the code already merged to `main` and Northflank already tried to build/deploy it — **do not proceed to Store submission (section 4)** until this is resolved, since it means production isn't confirmed to be running what you think it's running.
  1. Check the `tabby` service's build/deploy logs directly on Northflank first — most failures are a bad build (syntax error, missing env var) or a crash on boot, both visible there immediately.
  2. If the build succeeded but `/healthz` never reported the new SHA, check that the `tabby` service still has `NF_DEPLOYMENT_SHA` wired up as a runtime env var — without it `/healthz` always reports `sha: null` and `deploy-verify.yml` will time out even on a perfectly healthy deploy.
  3. If the merged commit itself is the problem, fix forward: open a normal PR (a plain revert via `git revert` is the fastest fix-forward option) through the usual pre-merge flow above. There's no separate "rollback" mechanism — merging the revert triggers the same Northflank auto-build and `deploy-verify.yml` run as any other change, which is what confirms the rollback actually took effect.
  4. Only re-attempt store submission once `deploy-verify.yml` is green against the commit you actually intend to ship.

## Why store review lag isn't a problem

Northflank deploys in minutes; CWS/EWS review takes hours, and browsers don't auto-update installed extensions instantly even after approval — so there's always a window where some users are on an older extension version talking to the new server. This is safe as long as every server change is **additive**: never remove or change an existing endpoint/field an older client version depends on in the same release that ships a client relying on the removal. A new endpoint an old client never calls is always safe to ship ahead of the client that uses it.
