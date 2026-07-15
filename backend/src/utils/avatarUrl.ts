export function publicApiBaseUrl(): string {
  return (
    process.env.PUBLIC_API_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
    'https://ballknowledge-production.up.railway.app'
  ).replace(/\/$/, '');
}

/** Public absolute URL for a user's avatar, or undefined if they have none. */
export function avatarPublicUrl(userId: string, hasAvatar: boolean): string | undefined {
  if (!hasAvatar) return undefined;
  const base = publicApiBaseUrl();
  return `${base}/avatars/${userId}`;
}
