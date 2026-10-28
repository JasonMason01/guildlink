import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export function tokenBox(secret) {
  const key = scryptSync(secret, "guildlink.oauth.v1", 32);
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]).toString("base64url");
    },
    open(sealed) {
      const buf = Buffer.from(sealed, "base64url");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const encrypted = buf.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    },
  };
}
