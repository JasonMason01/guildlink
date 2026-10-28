import path from "node:path";
import { fileURLToPath } from "node:url";
import { superviseBeta } from "./betaWatch.js";
import { attachBot } from "./bot/lifecycle.js";
import { botState, client } from "./bot/client.js";
import { createMockClient } from "./bot/mockDiscord.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { tokenBox } from "./secretBox.js";
import { canAutoUpdate, superviseUpdates, UPDATE_EXIT, watchForUpdates } from "./update.js";
import { createApp } from "./web/routes.js";

const config = loadConfig();
if (config.missing.length > 0) {
  console.error(`[guildlink] Missing environment: ${config.missing.join(", ")}`);
  console.error("[guildlink] Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const entry = fileURLToPath(import.meta.url);

if (config.betaOpenPanel && process.env.GUILDLINK_WATCHER !== "1") {
  superviseBeta({ entry, root });
} else if (process.env.GUILDLINK_SUPERVISOR !== "1" && (await canAutoUpdate(root))) {
  superviseUpdates({ entry, root });
} else {
  start(config, root);
}

function start(config, root) {
  const db = openDatabase(config.databasePath);
  const box = tokenBox(config.sessionSecret);
  const discord = config.betaOpenPanel && !config.discordToken ? createMockClient() : client;
  if (config.betaOpenPanel) discord.betaRefresh = true;
  attachBot({ client: discord, db, botState, config });

  const started = Date.now();
  const app = createApp({
    db,
    client: discord,
    config,
    botState,
    box,
    started: config.betaOpenPanel ? started : null,
  });
  if (config.betaOpenPanel) {
    console.warn("[guildlink] BETA_OPEN_PANEL is on. Discord login is disabled. This is for local testing only.");
  }

  const server = app.listen(config.port, config.host, () => {
    const shownHost = config.host === "127.0.0.1" || config.host === "0.0.0.0" ? "localhost" : config.host;
    console.log(`[guildlink] Panel at http://${shownHost}:${config.port}`);
  });

  if (discord.mock) {
    botState.ready = true;
    botState.error = null;
    console.warn("[guildlink] Using sample servers because BETA_OPEN_PANEL is on and DISCORD_TOKEN is empty. Nothing is sent to Discord.");
  } else {
    discord.login(config.discordToken).catch((error) => {
      botState.ready = false;
      botState.error = /disallowed intents/i.test(error.message)
        ? "Turn on the Server Members intent in the Discord Developer Portal, then restart GuildLink."
        : "The bot could not log in. Check DISCORD_TOKEN.";
      console.error(`[guildlink] ${botState.error} (${error.message})`);
    });
  }

  let closing = false;
  function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    console.log(code === UPDATE_EXIT ? "[guildlink] Updating from git. GuildLink will start again." : "[guildlink] Shutting down.");
    server.close();
    if (typeof discord.destroy === "function") discord.destroy();
    db.close();
    process.exit(code);
  }

  if (process.env.GUILDLINK_SUPERVISOR === "1") watchForUpdates({ root, onUpdate: () => shutdown(UPDATE_EXIT) });
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}
