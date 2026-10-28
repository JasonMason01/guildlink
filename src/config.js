import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const REQUIRED = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET"];
const BETA_SESSION_SECRET = "guildlink.beta.local";

export function loadConfig(env = process.env) {
  const port = positiveInt(env.PORT, 3000);
  const host = env.HOST || "127.0.0.1";
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, "");
  const redirectUri = env.DISCORD_REDIRECT_URI || `${publicUrl}/auth/callback`;
  const databasePath =
    env.DATABASE_PATH ||
    path.join(env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "guildlink", "guildlink.db");
  const developmentCopy = env.GUILDLINK_DEV === "1";
  const betaRequested = env.BETA_OPEN_PANEL === "1";
  const betaOpenPanel = developmentCopy && betaRequested;
  const sessionSecret = filled(env.SESSION_SECRET);

  const required = betaOpenPanel ? [] : REQUIRED;
  const missing = required.filter((key) => !filled(env[key]));
  if (sessionSecret && sessionSecret.length < 16) {
    missing.push("SESSION_SECRET (at least 16 characters)");
  }
  if (betaRequested && !developmentCopy) {
    missing.push("BETA_OPEN_PANEL is only available on the development copy");
  }
  if (betaOpenPanel && !isLoopbackHost(host)) {
    missing.push("BETA_OPEN_PANEL can only be used when HOST is 127.0.0.1");
  }

  return {
    discordToken: filled(env.DISCORD_TOKEN),
    clientId: filled(env.DISCORD_CLIENT_ID),
    clientSecret: filled(env.DISCORD_CLIENT_SECRET),
    sessionSecret: sessionSecret || (betaOpenPanel ? BETA_SESSION_SECRET : ""),
    port,
    host,
    publicUrl,
    redirectUri,
    databasePath,
    trustProxy: env.TRUST_PROXY === "1",
    secureCookies: publicUrl.startsWith("https://") || redirectUri.startsWith("https://"),
    betaOpenPanel,
    missing,
  };
}

function filled(value) {
  return String(value ?? "").trim();
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}
