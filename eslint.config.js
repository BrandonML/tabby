import js from "@eslint/js";
import globals from "globals";

// Security rules called out explicitly in AGENTS.md's "Security-First
// Coding" section -- not part of eslint:recommended, so listed here to
// actually enforce what that document already claims is required.
const securityRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error"
};

// Applies everywhere: a leading underscore marks a parameter that's
// intentionally unused (e.g. matching a callback signature the caller
// controls, like fetch(url, options) or chrome.tabs.remove(id)).
const unusedVarsRule = {
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  { rules: unusedVarsRule },
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, chrome: "readonly" }
    },
    rules: securityRules
  },
  {
    files: ["server/**/*.js", "scripts/**/*.js", "benchmark/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: securityRules
  },
  {
    files: ["test/**/*.js", "test-live/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    },
    rules: securityRules
  }
];
