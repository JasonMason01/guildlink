const SNOWFLAKE = /^[0-9]{17,20}$/;

export function isSnowflake(value) {
  return typeof value === "string" && SNOWFLAKE.test(value);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function banReason(masterName) {
  const name = String(masterName || "the main server").replace(/\s+/g, " ").trim() || "the main server";
  const full = `[GuildLink] Banned from ${name}`;
  if (full.length <= 512) return full;
  return `${full.slice(0, 509)}...`;
}

export function roleColor(color) {
  const n = Number(color);
  if (!Number.isInteger(n) || n <= 0) return "#8b978c";
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function safeHex(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#8b978c";
}

export function safeIconUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.hostname === "cdn.discordapp.com") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

export function monogram(name) {
  const letter = [...String(name || "?")][0] || "?";
  return letter.toLocaleUpperCase();
}

export function clip(value, max) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
