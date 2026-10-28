import { spawn } from "node:child_process";

export const UPDATE_EXIT = 75;
const CHECK_DELAY_MS = 30 * 1000;
const CHECK_EVERY_MS = 15 * 60 * 1000;

export function planUpdate(report, { disabled = false } = {}) {
  if (disabled) return "off";
  if (!report?.git || !report.upstream) return "unavailable";
  if (!report.reachable) return "offline";
  if (report.dirty) return "dirty";
  if (report.ahead > 0 && report.behind > 0) return "diverged";
  if (report.behind > 0) return "pull";
  return "current";
}

export function shouldSupervise(plan) {
  return plan === "current" || plan === "pull" || plan === "dirty" || plan === "diverged" || plan === "offline";
}

export function needsInstall(files) {
  return (files || []).some((file) => {
    const name = String(file).replaceAll("\\", "/");
    return name === "package.json" || name === "package-lock.json";
  });
}

export function updateMessage(plan) {
  if (plan === "dirty") return "[guildlink] This copy has local edits, so GuildLink is leaving it as it is.";
  if (plan === "diverged") return "[guildlink] This copy and the git remote have different commits, so GuildLink is leaving it as it is.";
  if (plan === "pull") return "[guildlink] Updating from git. GuildLink will start again.";
  if (plan === "current") return "[guildlink] GuildLink is up to date.";
  return "";
}

export async function canAutoUpdate(root, env = process.env) {
  if (env.GUILDLINK_UPDATE === "0" || (env.GUILDLINK_DEV === "1" && env.BETA_OPEN_PANEL === "1")) return false;
  const report = await inspectRepository(root);
  return shouldSupervise(planUpdate(report));
}

export async function inspectRepository(root, run = git) {
  const inside = await run(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    return { git: false, dirty: false, upstream: false, reachable: false, ahead: 0, behind: 0 };
  }
  const status = await run(root, ["status", "--porcelain"]);
  const upstream = await run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.code !== 0) {
    return { git: true, dirty: status.stdout.trim().length > 0, upstream: false, reachable: false, ahead: 0, behind: 0 };
  }
  const fetched = await run(root, ["fetch", "--quiet", "origin"]);
  let ahead = 0;
  let behind = 0;
  if (fetched.code === 0) {
    const counts = await run(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    const [left, right] = counts.stdout.trim().split(/\s+/).map((value) => Number(value) || 0);
    ahead = left;
    behind = right;
  }
  return {
    git: true,
    dirty: status.stdout.trim().length > 0,
    upstream: true,
    reachable: fetched.code === 0,
    ahead,
    behind,
  };
}

export async function applyUpdate(root, run = git, install = npmInstall) {
  const before = await run(root, ["rev-parse", "HEAD"]);
  const pull = await run(root, ["pull", "--ff-only"]);
  if (pull.code !== 0) return { ok: false, files: [], error: (pull.stderr || pull.stdout).trim() };
  const after = await run(root, ["rev-parse", "HEAD"]);
  const from = before.stdout.trim();
  const to = after.stdout.trim();
  let files = [];
  if (from && to && from !== to) {
    const diff = await run(root, ["diff", "--name-only", from, to]);
    files = diff.stdout.split(/\r?\n/).filter(Boolean);
  }
  if (needsInstall(files)) {
    const installed = await install(root);
    if (installed.code !== 0) return { ok: false, files, error: (installed.stderr || installed.stdout).trim() };
  }
  return { ok: true, files, error: "" };
}

export function watchForUpdates({ root, onUpdate, intervalMs = CHECK_EVERY_MS, firstDelayMs = CHECK_DELAY_MS, run }) {
  let running = false;
  let announced = "";
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const plan = planUpdate(await inspectRepository(root, run));
      const message = updateMessage(plan);
      if (plan === "pull") {
        if (message) console.log(message);
        onUpdate();
        return;
      }
      if (message && announced !== plan) {
        announced = plan;
        console.log(message);
      }
    } catch (error) {
      console.error(`[guildlink] Could not check git for updates. ${error.message}`);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export function superviseUpdates({ entry, root }) {
  const env = { ...process.env, GUILDLINK_SUPERVISOR: "1" };
  let child = null;
  let stopping = false;
  let generation = 0;

  const startChild = () => {
    const current = ++generation;
    child = spawn(process.execPath, [entry], { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (stopping || current !== generation) return;
      if (code === UPDATE_EXIT) {
        applyUpdate(root)
          .then((result) => {
            if (!result.ok) console.error(`[guildlink] The git update did not finish. ${result.error}`);
            else console.log("[guildlink] GuildLink updated. Starting again.");
          })
          .catch((error) => {
            console.error(`[guildlink] The git update did not finish. ${error.message}`);
          })
          .finally(() => {
            if (!stopping) startChild();
          });
        return;
      }
      process.exit(code ?? 0);
    });
  };

  console.log("[guildlink] GuildLink will update from git when the remote has new commits.");
  startChild();

  const stop = () => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode == null) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function git(root, args) {
  return runCommand("git", args, root, 20000);
}

function npmInstall(root) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return runCommand(command, ["install"], root, 5 * 60 * 1000);
}

function runCommand(command, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: 124, stdout, stderr: stderr || "timed out" });
    }, timeoutMs);
    child.on("error", (error) => finish({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

export function appRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
}
