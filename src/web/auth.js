import { randomBytes, timingSafeEqual } from "node:crypto";

const API = "https://discord.com/api";
const SESSION_COOKIE = "gl_session";
const STATE_COOKIE = "gl_oauth_state";
const SESSION_SECONDS = 60 * 60 * 24 * 14;
const states = new Map();
const guildCache = new Map();

export function readCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  const existing = res.getHeader("Set-Cookie");
  const cookie = parts.join("; ");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  const list = Array.isArray(existing) ? existing : [existing];
  res.setHeader("Set-Cookie", [...list, cookie]);
}

export function clearCookie(res, name, secure) {
  setCookie(res, name, "", { maxAge: 0, secure });
}

export function sameSecret(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue ?? ""));
  const right = Buffer.from(String(rightValue ?? ""));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newId() {
  return randomBytes(32).toString("base64url");
}

export function rememberState(state) {
  const now = Date.now();
  for (const [key, expires] of states) {
    if (expires < now) states.delete(key);
  }
  states.set(state, now + 10 * 60 * 1000);
}

export function takeState(state) {
  const expires = states.get(state);
  states.delete(state);
  return Boolean(expires && expires > Date.now());
}

export function sessionCookie() {
  return SESSION_COOKIE;
}

export function stateCookie() {
  return STATE_COOKIE;
}

export function sessionSeconds() {
  return SESSION_SECONDS;
}

export function authorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "identify guilds",
    state,
  });
  return `${API}/oauth2/authorize?${params}`;
}

export async function exchangeCode(config, code) {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshTokens(config, refreshToken) {
  return tokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export async function fetchDiscordUser(accessToken) {
  return discordGet("/users/@me", accessToken);
}

export async function fetchUserGuilds(accessToken, userId) {
  const cached = guildCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.guilds;

  const guilds = [];
  let after = "";
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ limit: "200" });
    if (after) params.set("after", after);
    const batch = await discordGet(`/users/@me/guilds?${params}`, accessToken);
    guilds.push(...batch);
    if (!Array.isArray(batch) || batch.length < 200) break;
    after = batch[batch.length - 1].id;
  }
  guildCache.set(userId, { guilds, expires: Date.now() + 30_000 });
  return guilds;
}

export function clearGuildCache(userId) {
  guildCache.delete(userId);
}

export function avatarUrl(user) {
  if (!user?.avatar || !user.id) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

async function tokenRequest(config, fields) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...fields,
  });
  const response = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = new Error(`Discord rejected the sign-in request (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function discordGet(pathname, accessToken) {
  const response = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = new Error(`Discord request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
