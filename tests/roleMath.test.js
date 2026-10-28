import assert from "node:assert/strict";
import test from "node:test";
import { desiredGuildRoleIds, heldNamedRoleIds, roleDelta } from "../src/roleMath.js";
import { banReason } from "../src/text.js";

const mod = { id: 1, parentGuildId: "government", parentRoleId: "moderator" };
const police = { id: 2, parentGuildId: "police", parentRoleId: "cadet" };

test("a member with the parent role receives that named role's destination", () => {
  const held = new Map([["government", new Set(["moderator"])]]);
  const active = heldNamedRoleIds(held, [mod, police], {
    communityGuildIds: ["government", "police", "courts"],
  });
  const desired = desiredGuildRoleIds(active, [
    { namedRoleId: 1, guildId: "police", roleId: "staff", parentGuildId: "government" },
    { namedRoleId: 2, guildId: "courts", roleId: "clerk", parentGuildId: "police" },
  ], "police");
  assert.deepEqual([...desired], ["staff"]);
});

test("a member without the parent role receives nothing", () => {
  const held = new Map([["police", new Set(["local"])]]);
  const active = heldNamedRoleIds(held, [police], { communityGuildIds: ["police", "courts"] });
  const desired = desiredGuildRoleIds(active, [
    { namedRoleId: 2, guildId: "courts", roleId: "clerk", parentGuildId: "police" },
  ], "courts");
  assert.deepEqual([...desired], []);
});

test("overlapping destinations stay while any named role still applies", () => {
  const active = new Set([2]);
  const desired = desiredGuildRoleIds(active, [
    { namedRoleId: 1, guildId: "courts", roleId: "clerk" },
    { namedRoleId: 2, guildId: "courts", roleId: "clerk" },
  ], "courts");
  const delta = roleDelta({
    currentRoleIds: ["clerk", "citizen"],
    desiredRoleIds: desired,
    managedRoleIds: ["clerk"],
  });
  assert.deepEqual([...desired], ["clerk"]);
  assert.deepEqual(delta.toRemove, []);
});

test("removing the parent role removes only the granted role", () => {
  const delta = roleDelta({
    currentRoleIds: ["staff", "cadet"],
    desiredRoleIds: [],
    managedRoleIds: ["staff"],
  });
  assert.deepEqual(delta.toAdd, []);
  assert.deepEqual(delta.toRemove, ["staff"]);
});

test("an unreadable parent is left out of the held set", () => {
  const held = new Map([["police", new Set(["cadet"])]]);
  const active = heldNamedRoleIds(held, [police], {
    unreadableGuildIds: ["police"],
    communityGuildIds: ["police"],
  });
  assert.equal(active.size, 0);
});

test("a copied ban note leaves the main-server reason out", () => {
  const secret = `Fail RP ${"x".repeat(600)}`;
  const reason = banReason("San Andreas Government", secret);
  assert.equal(reason, "[GuildLink] Banned from San Andreas Government");
  assert.equal(reason.includes("Fail RP"), false);
  const long = banReason("S".repeat(600));
  assert.equal(long.length, 512);
  assert.ok(long.endsWith("..."));
});
