// Guards against the release safety net quietly falling behind the code.
// Issue #79 added /api/validate-cats, and the extension fails open when it
// breaks (stale cards just keep getting served) -- so nothing user-visible
// would have flagged it dying in production, and deploy-verify.yml's smoke
// test didn't know the route existed. These checks make that class of gap a
// red build instead of something a reviewer has to remember: every server
// route needs a production smoke check and a mention in the docs that
// describe it, and every live-API test file has to actually be wired into
// `npm run test:live` (CI never runs those, so an orphaned one would rot).
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

// Every route literal in server/index.js: "/healthz" and "/api/<name>".
const serverRoutes = [...new Set([...read("server/index.js").matchAll(/"(\/(?:healthz|api\/[a-z][a-z-]*))"/g)].map((match) => match[1]))].sort();

describe("release safety net covers every server route", () => {
  it("finds the routes this test is meant to guard (so a regex or refactor can't make it vacuous)", () => {
    for (const route of ["/healthz", "/api/nearby-cats", "/api/validate-cats", "/api/photo-thumb", "/api/photo-share"]) {
      assert.ok(serverRoutes.includes(route), `expected server/index.js to define ${route}; found ${serverRoutes.join(", ")}`);
    }
  });

  it("smoke-tests every route against production in deploy-verify.yml", () => {
    const workflow = read(".github/workflows/deploy-verify.yml");
    const smokeStep = workflow.slice(workflow.indexOf("Smoke test the live API"));
    assert.ok(smokeStep.length < workflow.length, "deploy-verify.yml should have a 'Smoke test the live API' step");
    for (const route of serverRoutes) {
      assert.ok(smokeStep.includes(route), `deploy-verify.yml's smoke test never calls ${route} -- add a check for it (or a production regression there would go unnoticed)`);
    }
  });

  for (const doc of ["RELEASE.md", "README.md"]) {
    it(`is described in ${doc}`, () => {
      const text = read(doc);
      for (const route of serverRoutes) {
        assert.ok(text.includes(route), `${doc} never mentions ${route} -- update it (AGENTS.md's "Documentation & Asset Currency")`);
      }
    });
  }
});

describe("live-API tests can't be orphaned", () => {
  const liveFiles = fs.readdirSync(path.join(ROOT, "test-live")).filter((name) => name.endsWith(".js"));
  const script = JSON.parse(read("package.json")).scripts["test:live"];

  it("finds live test files to check", () => {
    assert.ok(liveFiles.length >= 2, `expected the live test files, found: ${liveFiles.join(", ")}`);
  });

  for (const file of liveFiles) {
    it(`npm run test:live runs test-live/${file}`, () => {
      assert.ok(script.includes(`test-live/${file}`), `package.json's test:live script doesn't list test-live/${file}, so it would never run`);
    });

    // CI never executes these, so an import error or crash on load would only
    // surface on a maintainer's machine mid-release. Without a key each one
    // must exit 0 with a skip message.
    it(`test-live/${file} loads cleanly and skips (exit 0) without an RG_API_KEY`, () => {
      const result = spawnSync(process.execPath, [path.join(ROOT, "test-live", file)], {
        env: { ...process.env, RG_API_KEY: "" },
        encoding: "utf8",
        timeout: 30_000
      });
      assert.strictEqual(result.status, 0, `exit ${result.status}: ${result.stderr}`);
      assert.match(result.stdout, /Skipping/);
    });
  }
});
