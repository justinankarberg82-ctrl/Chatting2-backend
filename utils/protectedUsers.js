const PROTECTED_USERNAMES = ['Justin'];

export function isProtectedUsername(username) {
  if (!username) return false;
  const u = String(username).trim().toLowerCase();
  return PROTECTED_USERNAMES.some((p) => p.toLowerCase() === u);
}

export function canAccessProtectedUsers(actorUsername) {
  return isProtectedUsername(actorUsername);
}

export function filterUsersForAdmin(users, actorUsername) {
  if (canAccessProtectedUsers(actorUsername)) return users;
  return (users || []).filter((u) => !isProtectedUsername(u?.username));
}
