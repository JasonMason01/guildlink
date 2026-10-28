import assert from "node:assert/strict";
import test from "node:test";
import { accessSummary, isGuildAdmin, resolveAccess, canEditLinkedGuild } from "../src/permissions.js";

test("main-server admin can change every linked server", () => {
  const access = resolveAccess({
    userGuilds: [{ id: "main", owner: false, permissions: "8" }],
    masterGuildId: "main",
    linkedGuildIds: ["police", "courts", "medical"],
  });
  assert.equal(access.level, "main");
  assert.equal(access.canManageCommunity, true);
  assert.deepEqual(access.editableGuildIds, ["police", "courts", "medical"]);
});

test("main-server owner is an admin even when the permission bits are empty", () => {
  const access = resolveAccess({
    userGuilds: [{ id: "main", owner: true, permissions: "0" }],
    masterGuildId: "main",
    linkedGuildIds: ["police"],
  });
  assert.equal(access.isMainAdmin, true);
  assert.deepEqual(access.editableGuildIds, ["police"]);
});

test("a linked-server admin only gets the servers they administer", () => {
  const access = resolveAccess({
    userGuilds: [
      { id: "main", owner: false, permissions: "32" },
      { id: "police", owner: false, permissions: "8" },
      { id: "courts", owner: false, permissions: "1040" },
      { id: "medical", owner: true, permissions: "0" },
      { id: "outside", owner: true, permissions: "8" },
    ],
    masterGuildId: "main",
    linkedGuildIds: ["police", "courts", "medical"],
  });
  assert.equal(access.level, "linked");
  assert.equal(access.canManageCommunity, false);
  assert.deepEqual(access.editableGuildIds, ["police", "medical"]);
  assert.equal(canEditLinkedGuild(access, "police"), true);
  assert.equal(canEditLinkedGuild(access, "courts"), false);
  assert.equal(canEditLinkedGuild(access, "main"), false);
});

test("manage server without administrator does not grant access", () => {
  assert.equal(isGuildAdmin({ id: "a", owner: false, permissions: "32" }), false);
  const access = resolveAccess({
    userGuilds: [
      { id: "main", owner: false, permissions: "32" },
      { id: "police", owner: false, permissions: "268435456" },
    ],
    masterGuildId: "main",
    linkedGuildIds: ["police"],
  });
  assert.equal(access.level, "none");
  assert.deepEqual(access.editableGuildIds, []);
});

test("administrator combined with other bits still counts", () => {
  assert.equal(isGuildAdmin({ id: "a", owner: false, permissions: String(8 | 32 | 16) }), true);
});

test("access copy names the scope", () => {
  const main = accessSummary(
    { isMainAdmin: true, editableGuildIds: ["police", "courts"] },
    { master: "San Andreas Government" }
  );
  assert.match(main, /every server/);
  assert.match(main, /San Andreas Government/);

  const one = accessSummary(
    { isMainAdmin: false, editableGuildIds: ["courts"] },
    { courts: "Blaine County Courts" }
  );
  assert.match(one, /Blaine County Courts/);
  assert.match(one, /that server only/);

  const two = accessSummary(
    { isMainAdmin: false, editableGuildIds: ["police", "medical"] },
    { police: "Los Santos Police", medical: "San Andreas Medical" }
  );
  assert.match(two, /Los Santos Police and San Andreas Medical/);
  assert.match(two, /those servers only/);
});
