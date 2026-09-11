# Release runbook

Steps to ship a change from `dev` to `main`, which auto-deploys the server to Northflank, and on to the Chrome Web Store / Edge Add-ons.

## 1. One-time setup (only needs doing once, ever)

- [ ] `main` has a ruleset requiring the `test` status check (from `.github/workflows/ci.yml`) to pass before merging, and requiring changes to go through a pull request. See GitHub → repo → Settings → Rules → Rulesets.

## 2. Pre-merge

- [ ] Open a pull request from `dev` into `main` — don't merge locally and push. Going through a PR is what lets the ruleset above actually gate the merge on CI passing (a direct push of an untested commit is rejected outright, since it can never satisfy the required check).
- [ ] Wait for the `test` check to go green. If it's red, stop — do not merge.
- [ ] Merge the PR.

## 3. Post-merge (fully automated — just watch)

- [ ] `.github/workflows/tag-release.yml` tags the commit `v<version>` (read from `manifest.json`). Check the repo's Tags page.
- [ ] `.github/workflows/deploy-verify.yml` polls the live server's `/healthz` until it reports this exact commit's SHA (`NF_DEPLOYMENT_SHA`, injected by Northflank), then smoke-tests `/api/nearby-cats`, `/api/photo-thumb`, and `/api/photo-share` against production. **A green run is the signal that it's safe to proceed to store submission.** If it goes red or times out, stop and check the `tabby` service's build/deploy status directly on Northflank before doing anything else.

## 4. Store submission (manual — both stores require a human in their dashboard)

- [ ] Build the release zip: `npm run release <version> https://p01--tabby--bklqdgzwx4md.code.run`
- [ ] Upload `dist/v<version>.zip` to the Chrome Web Store dashboard, submit for review.
- [ ] Upload the same zip to the Edge Add-ons dashboard, submit for review.
- [ ] Update listing copy/screenshots if the release changes what's visibly different to a user.

## Why store review lag isn't a problem

Northflank deploys in minutes; CWS/EWS review takes hours, and browsers don't auto-update installed extensions instantly even after approval — so there's always a window where some users are on an older extension version talking to the new server. This is safe as long as every server change is **additive**: never remove or change an existing endpoint/field an older client version depends on in the same release that ships a client relying on the removal. A new endpoint an old client never calls is always safe to ship ahead of the client that uses it.
