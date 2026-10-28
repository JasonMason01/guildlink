import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const base = {
  DISCORD_TOKEN: "token",
  DISCORD_CLIENT_ID: "100000000000000001",
  DISCORD_CLIENT_SECRET: "secret",
  SESSION_SECRET: "1234567890123456",
  HOST: "127.0.0.1",
};

test("the panel requires Discord login unless beta testing is turned on", () => {
  const config = loadConfig(base);
  assert.equal(config.betaOpenPanel, false);
  assert.deepEqual(config.missing, []);
});

test("beta testing starts without Discord credentials on the development copy", () => {
  const config = loadConfig({ GUILDLINK_DEV: "1", BETA_OPEN_PANEL: "1", HOST: "127.0.0.1" });
  assert.equal(config.betaOpenPanel, true);
  assert.deepEqual(config.missing, []);
  assert.equal(config.discordToken, "");
  assert.equal(config.clientId, "");
  assert.equal(config.clientSecret, "");
  assert.ok(config.sessionSecret.length >= 16);
});

test("beta testing is allowed only on this computer", () => {
  const local = loadConfig({ ...base, DISCORD_CLIENT_SECRET: "", GUILDLINK_DEV: "1", BETA_OPEN_PANEL: "1" });
  assert.equal(local.betaOpenPanel, true);
  assert.deepEqual(local.missing, []);

  const exposed = loadConfig({ ...base, HOST: "0.0.0.0", GUILDLINK_DEV: "1", BETA_OPEN_PANEL: "1" });
  assert.equal(exposed.betaOpenPanel, true);
  assert.ok(exposed.missing.some((item) => item.includes("BETA_OPEN_PANEL")));
});

test("a published install has no beta mode", () => {
  const config = loadConfig({ ...base, BETA_OPEN_PANEL: "1" });
  assert.equal(config.betaOpenPanel, false);
  assert.ok(config.missing.some((item) => item.includes("development copy")));
});
