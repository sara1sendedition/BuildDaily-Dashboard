/** Public (non-secret) fields returned for a social connection. */
export const socialConnectionPublicSelect = {
  id: true,
  platform: true,
  externalUserId: true,
  externalUsername: true,
  externalDisplayName: true,
  externalAvatarUrl: true,
  tokenExpiresAt: true,
  scopes: true,
  createdAt: true,
  updatedAt: true,
} as const;
