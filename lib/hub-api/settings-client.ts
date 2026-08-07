/**
 * Browser-side client for the unified Hub settings API (`/api/v1/*`).
 *
 * The hub IS the source of truth, so these are same-origin fetches — the Clerk
 * session cookie rides along automatically (no bearer token needed). Every
 * endpoint wraps its payload in `{ data }`; `req()` unwraps it and turns RFC
 * 7807 problem-details into thrown Errors with a readable message.
 *
 * This is what makes the single settings page possible: Studio, Comment
 * Convert and the Multiplier all read the same brand / connections / defaults
 * that the user edits here.
 */
import { clientApiPath } from "@/lib/client-api-path";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(clientApiPath(path), {
    credentials: "include",
    headers:
      init?.body != null
        ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
        : init?.headers,
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    | { data?: unknown; detail?: string; title?: string }
    | null;
  if (!res.ok) {
    const detail = body?.detail || body?.title || res.statusText;
    throw new Error(detail || `Request failed (${res.status})`);
  }
  return (body?.data ?? body) as T;
}

export type Brand = {
  id: string;
  name: string;
  industry: string | null;
  businessType: string | null;
  businessDescription: string | null;
  valueProps: string | null;
  boundaries: string | null;
  audienceTags: string[];
  briefCombinedText: string | null;
  copyContext: string | null;
  copyFeedback: string | null;
  defaultCaptionCta: string | null;
  goals: string[];
  funnelNotes: string | null;
};

export type AudiencePersona = {
  id: string;
  label: string;
  primaryAudience: string | null;
  audienceDetails: string | null;
  voiceAndTone: string | null;
  audiencePains: string | null;
  believerPersona: string | null;
  skepticPersona: string | null;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  cta: string | null;
  priceCents: number | null;
  displayOrder: number;
};

export type SocialConnection = {
  id: string;
  platform: string;
  externalUserId: string | null;
  externalUsername: string | null;
  externalDisplayName: string | null;
  externalAvatarUrl: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
};

export type ReferenceSource = {
  id: string;
  content: string;
  sourceLabel: string | null;
  createdAt: string;
};

export const hubApi = {
  // ---- Brands -----------------------------------------------------------
  listBrands: () => req<Brand[]>("/api/v1/brands"),
  createBrand: (name: string) =>
    req<Brand>("/api/v1/brands", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateBrand: (id: string, patch: Partial<Brand>) =>
    req<Brand>(`/api/v1/brands/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // ---- Audience personas ------------------------------------------------
  listPersonas: (brandId: string) =>
    req<AudiencePersona[]>(`/api/v1/brands/${brandId}/audience-personas`),
  createPersona: (brandId: string, p: Partial<AudiencePersona>) =>
    req<AudiencePersona>(`/api/v1/brands/${brandId}/audience-personas`, {
      method: "POST",
      body: JSON.stringify(p),
    }),
  updatePersona: (
    brandId: string,
    personaId: string,
    p: Partial<AudiencePersona>,
  ) =>
    req<AudiencePersona>(
      `/api/v1/brands/${brandId}/audience-personas/${personaId}`,
      { method: "PATCH", body: JSON.stringify(p) },
    ),
  deletePersona: (brandId: string, personaId: string) =>
    req<void>(`/api/v1/brands/${brandId}/audience-personas/${personaId}`, {
      method: "DELETE",
    }),

  // ---- Products / offers ------------------------------------------------
  listProducts: (brandId: string) =>
    req<Product[]>(`/api/v1/brands/${brandId}/products`),
  createProduct: (brandId: string, p: Partial<Product>) =>
    req<Product>(`/api/v1/brands/${brandId}/products`, {
      method: "POST",
      body: JSON.stringify(p),
    }),
  updateProduct: (brandId: string, productId: string, p: Partial<Product>) =>
    req<Product>(`/api/v1/brands/${brandId}/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(p),
    }),
  deleteProduct: (brandId: string, productId: string) =>
    req<void>(`/api/v1/brands/${brandId}/products/${productId}`, {
      method: "DELETE",
    }),

  // ---- Connections ------------------------------------------------------
  listConnections: () =>
    req<SocialConnection[]>("/api/v1/social-connections"),
  updateConnectionProfile: (
    platform: string,
    patch: {
      externalUsername?: string | null;
      externalDisplayName?: string | null;
      externalAvatarUrl?: string | null;
      externalUserId?: string | null;
    },
  ) =>
    req<SocialConnection>(`/api/v1/social-connections/${platform}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  refreshConnectionProfile: (platform: string) =>
    req<SocialConnection>(
      `/api/v1/social-connections/${platform}/refresh-profile`,
      { method: "POST" },
    ),
  deleteConnection: (platform: string) =>
    req<void>(`/api/v1/social-connections/${platform}`, { method: "DELETE" }),

  // ---- Reference sources ------------------------------------------------
  listReferenceSources: (brandId: string) =>
    req<ReferenceSource[]>(
      `/api/v1/reference-sources?brandId=${encodeURIComponent(brandId)}`,
    ),
  createReferenceSource: (
    brandId: string,
    content: string,
    sourceLabel?: string,
  ) =>
    req<ReferenceSource>("/api/v1/reference-sources", {
      method: "POST",
      body: JSON.stringify({ brandId, content, sourceLabel }),
    }),
};

// ---------------------------------------------------------------------------
// Comment Convert (cc.builddaily.app) — cross-origin.
//
// CC is a different origin, so (like Studio→hub) its session cookie isn't sent
// here. We forward the shared Clerk identity as a Bearer token. Clerk loads
// async, so we wait briefly for the session before reading the token.
// ---------------------------------------------------------------------------

const CC_BASE =
  process.env.NEXT_PUBLIC_CC_URL?.replace(/\/$/, "") ?? "https://cc.builddaily.app";

export type VoiceSettings = {
  savePostedRepliesToVoiceLibrary: boolean;
  dmTriggerKeywords: string[];
};

async function ccAuthHeader(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const w = window as {
      Clerk?: { session?: { getToken: () => Promise<string | null> } | null };
    };
    for (let i = 0; i < 50 && !(w.Clerk && w.Clerk.session); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const token = await w.Clerk?.session?.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function ccReq<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await ccAuthHeader();
  const res = await fetch(`${CC_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...auth,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Comment Convert request failed (${res.status})`);
  return (await res.json()) as T;
}

export const ccApi = {
  getVoiceSettings: () => ccReq<VoiceSettings>("/api/voice/settings"),
  saveVoiceSettings: (patch: Partial<VoiceSettings>) =>
    ccReq<VoiceSettings>("/api/voice/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
};
