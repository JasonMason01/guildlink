export function botInviteUrl(clientId) {
  const permissions = (1n << 2n) | (1n << 3n) | (1n << 28n);
  const params = new URLSearchParams({
    client_id: clientId,
    permissions: permissions.toString(),
    scope: "bot applications.commands",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}
