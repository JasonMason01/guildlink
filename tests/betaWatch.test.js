import assert from "node:assert/strict";
import test from "node:test";
import { isRestartSource } from "../src/betaWatch.js";

test("beta restarts when panel source changes", () => {
  assert.equal(isRestartSource("web\\routes.js"), true);
  assert.equal(isRestartSource("public/styles.css"), true);
  assert.equal(isRestartSource("public/panel.js"), true);
  assert.equal(isRestartSource(".env"), true);
  assert.equal(isRestartSource("guildlink.db"), false);
  assert.equal(isRestartSource(".env.example"), false);
  assert.equal(isRestartSource(null), true);
});
