import assert from "node:assert/strict";
import test from "node:test";
import { bitsAfterGrantPlan, linkAllowed, missingPermissionLabels, permissionGrantPlan } from "../src/categoryRules.js";

const BAN = 1n << 2n;
const ADMINISTRATOR = 1n << 3n;

test("administrator on a Discord role covers every category permission", () => {
  assert.deepEqual(missingPermissionLabels(ADMINISTRATOR, ["BanMembers", "ManageGuild"]), []);
  assert.deepEqual(missingPermissionLabels(BAN, ["BanMembers"]), []);
  assert.deepEqual(missingPermissionLabels(0n, ["BanMembers", "KickMembers"]), ["Ban Members", "Kick Members"]);
  assert.deepEqual(missingPermissionLabels("4", []), []);
});

test("guildlink adds a missing permission and removes only bits it recorded", () => {
  const kick = 1n << 1n;
  const ban = 1n << 2n;
  const added = permissionGrantPlan({
    currentBits: kick,
    requiredNames: ["BanMembers"],
    recordedNames: [],
  });
  assert.deepEqual(added.toAdd, ["BanMembers"]);
  assert.deepEqual(added.toRemove, []);
  const withBan = bitsAfterGrantPlan(kick, added);
  assert.equal((withBan & ban) === ban, true);
  assert.equal((withBan & kick) === kick, true);

  const removed = permissionGrantPlan({
    currentBits: withBan,
    requiredNames: [],
    recordedNames: added.keepRecorded,
  });
  assert.deepEqual(removed.toRemove, ["BanMembers"]);
  const after = bitsAfterGrantPlan(withBan, removed);
  assert.equal((after & ban) === ban, false);
  assert.equal((after & kick) === kick, true);

  const already = permissionGrantPlan({
    currentBits: ban,
    requiredNames: ["BanMembers"],
    recordedNames: [],
  });
  assert.deepEqual(already.toAdd, []);
  assert.deepEqual(already.keepRecorded, []);
  const cleared = permissionGrantPlan({
    currentBits: ban,
    requiredNames: [],
    recordedNames: already.keepRecorded,
  });
  assert.deepEqual(cleared.toRemove, []);
  assert.equal(bitsAfterGrantPlan(ban, cleared), ban);
});

test("an empty category limit links everywhere, and a ticked list stays on those categories", () => {
  assert.equal(linkAllowed(null, []), true);
  assert.equal(linkAllowed(4, []), true);
  assert.equal(linkAllowed(4, [4, 9]), true);
  assert.equal(linkAllowed(5, [4]), false);
  assert.equal(linkAllowed(null, [4]), false);
});
