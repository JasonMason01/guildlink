import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { tokenBox } from "../src/secretBox.js";
import { clearGuildCache, sessionCookie } from "../src/web/auth.js";
import { createApp } from "../src/web/routes.js";

test("the panel sign-in page explains access and other pages require a session", async () => {
  const db = openDatabase(":memory:");
  const app = createApp({
    db,
    client: { guilds: { cache: new Map() } },
    config: {
      clientId: "100000000000000001",
      clientSecret: "test-client-secret",
      redirectUri: "http://127.0.0.1:3000/auth/callback",
      secureCookies: false,
      trustProxy: false,
    },
    botState: { ready: false, error: null },
    box: tokenBox("test-session-secret"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    const login = await fetch(`http://127.0.0.1:${port}/login`);
    assert.equal(login.status, 200);
    const html = await login.text();
    assert.match(html, /GuildLink/);
    assert.match(html, /Administrator on the main server can change every server/);
    assert.match(html, /Administrator on a linked server can change only the servers they administer/);

    const home = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
    assert.equal(home.status, 303);
    assert.equal(home.headers.get("location"), "/login");

    const preview = await fetch(`http://127.0.0.1:${port}/beta/view`, { method: "POST", redirect: "manual" });
    assert.equal(preview.status, 303);
    assert.equal(preview.headers.get("location"), "/");

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, bot: false });
  } finally {
    server.close();
    db.close();
  }
});

test("beta mode opens the panel without Discord login on this computer", async () => {
  const guild = {
    id: "100000000000000001",
    name: "Main Server",
    ownerId: "200000000000000001",
    members: { me: null, fetchMe: async () => null },
    roles: { cache: new Map() },
    iconURL() {
      return null;
    },
  };
  const police = {
    id: "100000000000000002",
    name: "Los Santos Police",
    ownerId: "200000000000000001",
    members: { me: null, fetchMe: async () => null },
    roles: { cache: new Map() },
    iconURL() {
      return null;
    },
  };
  const db = openDatabase(":memory:");
  const app = createApp({
    db,
    client: { guilds: { cache: new Map([[guild.id, guild], [police.id, police]]) } },
    config: {
      clientId: "100000000000000001",
      clientSecret: "",
      redirectUri: "http://127.0.0.1:3000/auth/callback",
      secureCookies: false,
      trustProxy: false,
      betaOpenPanel: true,
    },
    botState: { ready: true, error: null },
    box: tokenBox("test-session-secret"),
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  try {
    const home = await fetch(`${origin}/`, { redirect: "manual" });
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Beta testing/);
    assert.match(html, /Beta tester/);
    assert.match(html, /View as a linked server/);
    assert.match(html, /This install runs one community/);
    assert.match(html, /Set up this community/);
    assert.doesNotMatch(html, /Your communities/);
    assert.doesNotMatch(html, /Log out/);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
    assert.ok(csrf);

    const login = await fetch(`${origin}/login`, { redirect: "manual" });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get("location"), "/");

    const created = await fetch(`${origin}/communities`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf,
        name: "State of San Andreas",
        masterGuildId: guild.id,
      }),
    });
    assert.equal(created.status, 303);
    assert.match(created.headers.get("location"), /^\/c\/\d+$/);

    const community = await fetch(`${origin}${created.headers.get("location")}`);
    assert.equal(community.status, 200);
    const communityHtml = await community.text();
    assert.match(communityHtml, /Beta testing/);
    assert.match(communityHtml, /Save settings/);
    assert.match(communityHtml, /View as a linked server/);
    assert.match(communityHtml, /Main Server/);
    assert.match(communityHtml, /Community created/);
    assert.doesNotMatch(communityHtml, /All communities/);

    const communityId = Number(created.headers.get("location").split("/").pop());
    db.addLinkedGuild({
      communityId,
      guildId: police.id,
      addedBy: "beta",
      masterGuildId: guild.id,
    });
    const viewCsrf = communityHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
    const asLinked = await fetch(`${origin}/beta/view`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: viewCsrf, view: "linked" }),
    });
    assert.equal(asLinked.status, 303);
    assert.equal(asLinked.headers.get("location"), "/");
    const linkedPage = await fetch(`${origin}/c/${communityId}`);
    assert.equal(linkedPage.status, 200);
    const linkedHtml = await linkedPage.text();
    assert.match(linkedHtml, /Choose a server you administer/);
    assert.match(linkedHtml, /Los Santos Police/);
    assert.match(linkedHtml, /View as the main server/);
    assert.doesNotMatch(linkedHtml, /Save settings/);
    assert.doesNotMatch(linkedHtml, new RegExp(`href="/c/${communityId}/roles"`));
    const hidden = await fetch(`${origin}/c/${communityId}/bans`, { redirect: "manual" });
    assert.equal(hidden.status, 303);
    assert.equal(hidden.headers.get("location"), `/c/${communityId}`);

    const backCsrf = linkedHtml.match(/name="csrf" value="([^"]+)"/)?.[1];
    const asMain = await fetch(`${origin}/beta/view`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf: backCsrf, view: "main" }),
    });
    assert.equal(asMain.status, 303);
    const restored = await fetch(`${origin}/c/${communityId}`);
    assert.match(await restored.text(), /Save settings/);

    const homeAgain = await fetch(`${origin}/`, { redirect: "manual" });
    assert.equal(homeAgain.status, 303);
    assert.equal(homeAgain.headers.get("location"), created.headers.get("location"));

    const second = await fetch(`${origin}/communities`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf,
        name: "Another community",
        masterGuildId: guild.id,
      }),
    });
    assert.equal(second.status, 303);
    const refused = await fetch(`${origin}/c/${created.headers.get("location").split("/").pop()}`);
    assert.match(await refused.text(), /already has a community/);
  } finally {
    server.close();
    db.close();
  }
});

test("the audit page lists recorded changes and a linked admin sees only their servers", async () => {
  const masterId = "100000000000000041";
  const policeId = "100000000000000042";
  const courtsId = "100000000000000043";
  const linkedUser = "200000000000000041";
  const mainUser = "200000000000000042";
  const outsider = "200000000000000043";
  const communityWide = "Recorded a community-wide settings change.";
  const policeLine = "Gave Staff on Los Santos Police.";
  const courtsLine = "Gave Bailiff on Blaine County Courts.";
  const db = openDatabase(":memory:");
  const community = db.createCommunity({
    name: "State of San Andreas",
    masterGuildId: masterId,
    createdBy: mainUser,
  });
  db.addLinkedGuild({
    communityId: community.id,
    guildId: policeId,
    addedBy: mainUser,
    masterGuildId: masterId,
  });
  db.addLinkedGuild({
    communityId: community.id,
    guildId: courtsId,
    addedBy: mainUser,
    masterGuildId: masterId,
  });
  db.addLog({ communityId: community.id, kind: "config", detail: communityWide });
  db.addLog({ communityId: community.id, kind: "role", guildId: policeId, detail: policeLine });
  db.addLog({ communityId: community.id, kind: "role", guildId: courtsId, detail: courtsLine });

  const box = tokenBox("test-session-secret");
  const sessions = [
    ["linked-session", linkedUser, "linked-token", "csrf-linked"],
    ["main-session", mainUser, "main-token", "csrf-main"],
    ["outsider-session", outsider, "outsider-token", "csrf-outsider"],
  ];
  for (const [id, userId, token, csrf] of sessions) {
    db.createSession({
      id,
      userId,
      username: userId,
      globalName: "Tester",
      avatar: null,
      accessToken: box.seal(token),
      refreshToken: box.seal(`${token}-refresh`),
      tokenExpiresAt: Date.now() + 60 * 60 * 1000,
      csrf,
    });
  }

  const guildsByToken = {
    "Bearer linked-token": [{ id: courtsId, name: "Blaine County Courts", owner: false, permissions: "8" }],
    "Bearer main-token": [
      { id: masterId, name: "San Andreas Government", owner: true, permissions: "8" },
      { id: policeId, name: "Los Santos Police", owner: false, permissions: "8" },
      { id: courtsId, name: "Blaine County Courts", owner: false, permissions: "8" },
    ],
    "Bearer outsider-token": [{ id: courtsId, name: "Blaine County Courts", owner: false, permissions: "0" }],
  };
  function panelGuild(id, name) {
    return {
      id,
      name,
      ownerId: mainUser,
      members: { me: null, fetchMe: async () => null },
      roles: { cache: new Map() },
      iconURL() {
        return null;
      },
    };
  }
  const client = {
    guilds: {
      cache: new Map([
        [masterId, panelGuild(masterId, "San Andreas Government")],
        [policeId, panelGuild(policeId, "Los Santos Police")],
        [courtsId, panelGuild(courtsId, "Blaine County Courts")],
      ]),
    },
  };
  const app = createApp({
    db,
    client,
    config: {
      clientId: "100000000000000001",
      clientSecret: "test-client-secret",
      redirectUri: "http://127.0.0.1:3000/auth/callback",
      secureCookies: false,
      trustProxy: false,
    },
    botState: { ready: true, error: null },
    box,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : String(url);
    if (href.includes("discord.com/api/users/@me/guilds")) {
      const auth = options?.headers?.Authorization || options?.headers?.authorization || "";
      return new Response(JSON.stringify(guildsByToken[auth] || []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(url, options);
  };
  const cookie = (sessionId) => `${sessionCookie()}=${encodeURIComponent(sessionId)}`;

  try {
    const anonymous = await fetch(`${origin}/c/${community.id}/audit`, { redirect: "manual" });
    assert.equal(anonymous.status, 303);
    assert.equal(anonymous.headers.get("location"), "/login");

    const missing = await fetch(`${origin}/c/999/audit`, { headers: { cookie: cookie("linked-session") } });
    assert.equal(missing.status, 404);
    assert.doesNotMatch(await missing.text(), /Gave Bailiff on Blaine County Courts/);

    const deniedHome = await fetch(`${origin}/c/${community.id}`, { headers: { cookie: cookie("outsider-session") } });
    const deniedAudit = await fetch(`${origin}/c/${community.id}/audit`, { headers: { cookie: cookie("outsider-session") } });
    assert.equal(deniedHome.status, 404);
    assert.equal(deniedAudit.status, 404);
    const deniedHtml = await deniedAudit.text();
    assert.doesNotMatch(deniedHtml, new RegExp(policeLine));
    assert.doesNotMatch(deniedHtml, new RegExp(courtsLine));
    assert.doesNotMatch(deniedHtml, new RegExp(communityWide));

    const linkedHome = await fetch(`${origin}/c/${community.id}`, { headers: { cookie: cookie("linked-session") } });
    assert.equal(linkedHome.status, 200);
    const linkedHomeHtml = await linkedHome.text();
    assert.match(linkedHomeHtml, /Choose a server you administer/);
    assert.match(linkedHomeHtml, /Blaine County Courts/);
    assert.match(linkedHomeHtml, new RegExp(`href="/c/${community.id}/guilds/${courtsId}/roles"`));
    assert.doesNotMatch(linkedHomeHtml, /Los Santos Police/);
    assert.doesNotMatch(linkedHomeHtml, new RegExp(`href="/c/${community.id}/audit"`));
    assert.doesNotMatch(linkedHomeHtml, new RegExp(`href="/c/${community.id}/roles"`));
    assert.doesNotMatch(linkedHomeHtml, new RegExp(`href="/c/${community.id}/bans"`));
    assert.doesNotMatch(linkedHomeHtml, new RegExp(courtsLine));
    assert.doesNotMatch(linkedHomeHtml, new RegExp(policeLine));
    assert.doesNotMatch(linkedHomeHtml, new RegExp(communityWide));
    assert.doesNotMatch(linkedHomeHtml, /Add a server/);
    assert.doesNotMatch(linkedHomeHtml, /Delete community/);

    for (const path of ["audit", "roles", "servers", "categories", "bans", "audit/channel"]) {
      const hidden = await fetch(`${origin}/c/${community.id}/${path}`, {
        headers: { cookie: cookie("linked-session") },
        redirect: "manual",
      });
      assert.equal(hidden.status, 303, path);
      assert.equal(hidden.headers.get("location"), `/c/${community.id}`, path);
    }

    const linkedGuild = await fetch(`${origin}/c/${community.id}/guilds/${courtsId}/roles`, {
      headers: { cookie: cookie("linked-session") },
    });
    assert.equal(linkedGuild.status, 200);
    const linkedGuildHtml = await linkedGuild.text();
    assert.match(linkedGuildHtml, /Blaine County Courts/);
    assert.match(linkedGuildHtml, /Back to your servers/);
    assert.doesNotMatch(linkedGuildHtml, /Los Santos Police/);
    assert.doesNotMatch(linkedGuildHtml, /Remove server/);
    assert.doesNotMatch(linkedGuildHtml, new RegExp(policeLine));

    const otherGuild = await fetch(`${origin}/c/${community.id}/guilds/${policeId}/roles`, {
      headers: { cookie: cookie("linked-session") },
    });
    assert.equal(otherGuild.status, 403);
    assert.doesNotMatch(await otherGuild.text(), /Los Santos Police/);

    const mainHome = await fetch(`${origin}/c/${community.id}`, { headers: { cookie: cookie("main-session") } });
    const mainHomeHtml = await mainHome.text();
    assert.equal(mainHome.status, 200);
    assert.doesNotMatch(mainHomeHtml, new RegExp(courtsLine));
    assert.doesNotMatch(mainHomeHtml, new RegExp(policeLine));
    assert.doesNotMatch(mainHomeHtml, new RegExp(communityWide));

    const mainAudit = await fetch(`${origin}/c/${community.id}/audit`, { headers: { cookie: cookie("main-session") } });
    assert.equal(mainAudit.status, 200);
    const mainAuditHtml = await mainAudit.text();
    assert.match(mainAuditHtml, new RegExp(courtsLine));
    assert.match(mainAuditHtml, new RegExp(policeLine));
    assert.match(mainAuditHtml, new RegExp(communityWide));
  } finally {
    globalThis.fetch = originalFetch;
    clearGuildCache(linkedUser);
    clearGuildCache(mainUser);
    clearGuildCache(outsider);
    server.close();
    db.close();
  }
});

test("the discord command module loads", async () => {
  const commands = await import("../src/bot/commands.js");
  assert.equal(typeof commands.registerCommands, "function");
  assert.equal(typeof commands.handleCommand, "function");
});
