import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";

const WATCHED = new Set([".js", ".css", ".svg", ".mjs"]);

export function isRestartSource(filename) {
  if (!filename) return true;
  const base = path.basename(String(filename));
  if (base === ".env") return true;
  if (base.startsWith(".")) return false;
  return WATCHED.has(path.extname(base).toLowerCase());
}

export function superviseBeta({ entry, root }) {
  const env = { ...process.env, GUILDLINK_WATCHER: "1" };
  let child = null;
  let stopping = false;
  let timer = null;
  let generation = 0;
  let restarting = false;
  const quietUntil = Date.now() + 1000;

  const startChild = () => {
    const current = ++generation;
    child = spawn(process.execPath, [entry], { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (stopping || current !== generation || restarting) return;
      if (code) console.error(`[guildlink] Beta stopped (${code}). Save a file in src to start it again.`);
    });
  };

  const recycle = () => {
    if (stopping || restarting) return;
    const running = child && child.exitCode == null && !child.killed;
    if (!running) {
      startChild();
      return;
    }
    restarting = true;
    const dying = child;
    dying.once("exit", () => {
      restarting = false;
      if (!stopping) setTimeout(startChild, 200);
    });
    dying.kill();
  };

  const schedule = (_event, filename) => {
    if (Date.now() < quietUntil || !isRestartSource(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(recycle, 300);
  };

  watch(path.join(root, "src"), { recursive: true }, schedule);
  try {
    watch(path.join(root, ".env"), schedule);
  } catch {
    // Beta can run before a .env file exists.
  }

  console.warn("[guildlink] Beta is watching for changes. The open panel reloads when GuildLink restarts.");
  startChild();

  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    if (child && child.exitCode == null) child.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
