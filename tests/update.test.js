import assert from "node:assert/strict";
import test from "node:test";
import { applyUpdate, inspectRepository, needsInstall, planUpdate, shouldSupervise, updateMessage } from "../src/update.js";

const clean = { git: true, dirty: false, upstream: true, reachable: true, ahead: 0, behind: 0 };

test("git updates fast-forward a clean copy and leave local edits alone", () => {
  assert.equal(planUpdate({ git: false }), "unavailable");
  assert.equal(planUpdate({ ...clean, upstream: false }), "unavailable");
  assert.equal(planUpdate({ ...clean, reachable: false, behind: 2 }), "offline");
  assert.equal(planUpdate({ ...clean, dirty: true, behind: 2 }), "dirty");
  assert.equal(planUpdate({ ...clean, ahead: 1, behind: 1 }), "diverged");
  assert.equal(planUpdate({ ...clean, behind: 2 }), "pull");
  assert.equal(planUpdate({ ...clean, ahead: 4 }), "current");
  assert.equal(planUpdate({ ...clean, behind: 2 }, { disabled: true }), "off");
  assert.equal(shouldSupervise("pull"), true);
  assert.equal(shouldSupervise("dirty"), true);
  assert.equal(shouldSupervise("unavailable"), false);
  assert.match(updateMessage("dirty"), /local edits/);
  assert.match(updateMessage("pull"), /Updating from git/);
});

test("dependency installs run when the lockfile changes", () => {
  assert.equal(needsInstall(["src/index.js", "src/web/render.js"]), false);
  assert.equal(needsInstall(["package-lock.json"]), true);
  assert.equal(needsInstall(["package.json"]), true);
});

test("a repository check reads the branch and how far behind it is", async () => {
  const commands = [];
  const report = await inspectRepository("/guildlink", async (_root, args) => {
    commands.push(args.join(" "));
    if (args.includes("--is-inside-work-tree")) return { code: 0, stdout: "true\n", stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: "", stderr: "" };
    if (args.includes("@{u}") && args[0] === "rev-parse") return { code: 0, stdout: "origin/main\n", stderr: "" };
    if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-list") return { code: 0, stdout: "0\t3\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  assert.equal(planUpdate(report), "pull");
  assert.deepEqual(commands.map((command) => command.split(" ")[0]), ["rev-parse", "status", "rev-parse", "fetch", "rev-list"]);
});

test("applying an update pulls and installs when dependencies changed", async () => {
  const commands = [];
  let installed = false;
  const result = await applyUpdate(
    "/guildlink",
    async (_root, args) => {
      commands.push(args.join(" "));
      if (args[0] === "rev-parse" && commands.filter((item) => item.startsWith("rev-parse")).length === 1) {
        return { code: 0, stdout: "aaa\n", stderr: "" };
      }
      if (args[0] === "pull") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") return { code: 0, stdout: "bbb\n", stderr: "" };
      if (args[0] === "diff") return { code: 0, stdout: "package-lock.json\nsrc/index.js\n", stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    },
    async () => {
      installed = true;
      return { code: 0, stdout: "", stderr: "" };
    }
  );
  assert.equal(result.ok, true);
  assert.equal(installed, true);
  assert.match(commands.join("\n"), /pull --ff-only/);
});
