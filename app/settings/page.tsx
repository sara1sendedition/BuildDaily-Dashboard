"use client";

/**
 * Unified BuildDaily settings.
 *
 * One page, backed by the shared `/api/v1/*` hub API + unified Postgres, so the
 * brand voice, audience, offers, connections and tool defaults entered here
 * feed every app in the suite (Multiplier, Video Studio, Comment Convert).
 * Studio and Comment Convert link their "Settings" here instead of keeping
 * their own separate settings — that's what makes the suite feel like one app.
 *
 * Phase A: everything with a `/api/v1` endpoint is wired live below. Two
 * stragglers are clearly labelled and land in Phase B:
 *   - "Default first comment" (no column/endpoint yet — still device-local).
 *   - Comment Convert voice/reply settings (still served by CC's own API).
 */

import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { ContentMultiplierHomeLink } from "@/app/components/ContentMultiplierMark";
import { CollapsibleSection } from "@/app/components/CollapsibleSection";
import {
  getDefaultFirstCommentFromStorage,
  MAX_DEFAULT_FIRST_COMMENT_CHARS,
  setDefaultFirstCommentToStorage,
} from "@/lib/default-first-comment";
import {
  hubApi,
  ccApi,
  type Brand,
  type AudiencePersona,
  type Product,
  type SocialConnection,
  type ReferenceSource,
  type VoiceSettings,
} from "@/lib/hub-api/settings-client";

const STUDIO_CONNECTIONS_URL =
  "https://studio.builddaily.app/settings/connections";
const CC_SETTINGS_URL = "https://cc.builddaily.app/voice";

const INDUSTRIES = [
  "d2c-saas",
  "b2b-saas",
  "coaching",
  "agency",
  "ecommerce",
  "creator-tools",
  "health-fitness",
  "education",
  "finance",
  "other",
];

const ALL_PLATFORMS = [
  "instagram",
  "youtube",
  "tiktok",
  "facebook",
  "threads",
  "linkedin",
  "x",
  "medium",
  "substack",
];

// ---------------------------------------------------------------------------
// Small shared UI helpers
// ---------------------------------------------------------------------------

const cardClass =
  "rounded-2xl border border-stone-200/80 bg-white/90 p-6 shadow-sm";
const inputClass =
  "w-full rounded-lg border border-stone-200 px-3 py-2 text-sm placeholder:text-stone-400";
const primaryBtn =
  "rounded-lg bg-palette-moss px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-palette-depth hover:text-stone-950 disabled:opacity-50";
const ghostBtn =
  "rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-stone-500">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function SaveStatus({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "saving") return <span className="text-xs text-stone-400">Saving…</span>;
  if (state === "saved") return <span className="text-xs text-palette-depth">Saved ✓</span>;
  if (state === "error") return <span className="text-xs text-red-600">Couldn’t save</span>;
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const { user } = useUser();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let brands = await hubApi.listBrands();
        if (brands.length === 0) {
          const created = await hubApi.createBrand("My Brand");
          brands = [created];
        }
        if (!cancelled) setBrand(brands[0]);
      } catch (e) {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : "Failed to load settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-20">
      <ContentMultiplierHomeLink className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-palette-depth hover:text-stone-900" />

      <h1 className="mb-8 text-2xl font-bold text-stone-900">Settings</h1>

      {loading ? (
        <p className="text-sm text-stone-500">Loading your settings…</p>
      ) : loadError ? (
        <div className={`${cardClass} border-red-200`}>
          <p className="text-sm text-red-700">{loadError}</p>
          <p className="mt-2 text-xs text-stone-500">
            If you just signed in, refresh the page. If it persists, the hub API
            may be redeploying.
          </p>
        </div>
      ) : brand ? (
        <div className="space-y-8">
          <AccountSection
            email={user?.primaryEmailAddress?.emailAddress ?? null}
            name={user?.fullName ?? null}
          />
          <BrandSection brand={brand} onChange={setBrand} />
          <PersonasSection brandId={brand.id} />
          <ProductsSection brandId={brand.id} />
          <ConnectionsSection />
          <CopyDefaultsSection brand={brand} onChange={setBrand} />
          <ReferenceSourcesSection brandId={brand.id} />
          <CommentsSection />
        </div>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Account (Clerk identity — single login across the suite)
// ---------------------------------------------------------------------------

function AccountSection({
  email,
  name,
}: {
  email: string | null;
  name: string | null;
}) {
  return (
    <section className={cardClass}>
      <h2 className="text-lg font-semibold text-stone-900">Account</h2>
      <p className="mt-1 text-sm text-stone-600">
        One login for every BuildDaily app. Manage your name, email, avatar, and
        password from here.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <UserButton />
        <div className="text-sm">
          <div className="font-medium text-stone-900">{name ?? "Your account"}</div>
          {email ? <div className="text-stone-500">{email}</div> : null}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Brand & business — the source of truth every tool reads
// ---------------------------------------------------------------------------

function BrandSection({
  brand,
  onChange,
}: {
  brand: Brand;
  onChange: (b: Brand) => void;
}) {
  const [draft, setDraft] = useState<Brand>(brand);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => setDraft(brand), [brand]);

  const set = (patch: Partial<Brand>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useCallback(async () => {
    setStatus("saving");
    try {
      const saved = await hubApi.updateBrand(brand.id, {
        name: draft.name,
        industry: draft.industry,
        businessType: draft.businessType,
        businessDescription: draft.businessDescription,
        valueProps: draft.valueProps,
        boundaries: draft.boundaries,
        briefCombinedText: draft.briefCombinedText,
        goals: draft.goals,
        funnelNotes: draft.funnelNotes,
      });
      onChange(saved);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }, [brand.id, draft, onChange]);

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Brand & business</h2>
        <SaveStatus state={status} />
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Entered once here, used everywhere — captions, slides, replies all pull
        from this.
      </p>

      <div className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name">
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Industry">
            <select
              className={inputClass}
              value={draft.industry ?? ""}
              onChange={(e) => set({ industry: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {INDUSTRIES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Kind of business" hint='e.g. "coaching", "SaaS", "gym"'>
          <input
            className={inputClass}
            value={draft.businessType ?? ""}
            onChange={(e) => set({ businessType: e.target.value || null })}
          />
        </Field>

        <Field label="What you do">
          <textarea
            rows={3}
            className={inputClass}
            value={draft.businessDescription ?? ""}
            onChange={(e) =>
              set({ businessDescription: e.target.value || null })
            }
          />
        </Field>

        <Field label="What you offer / promise (value props)">
          <textarea
            rows={3}
            className={inputClass}
            value={draft.valueProps ?? ""}
            onChange={(e) => set({ valueProps: e.target.value || null })}
          />
        </Field>

        <Field
          label="Boundaries"
          hint="What you don't claim or won't say"
        >
          <textarea
            rows={2}
            className={inputClass}
            value={draft.boundaries ?? ""}
            onChange={(e) => set({ boundaries: e.target.value || null })}
          />
        </Field>

        <Field
          label="Goals"
          hint="One per line — what your content is trying to drive"
        >
          <textarea
            rows={3}
            className={inputClass}
            value={(draft.goals ?? []).join("\n")}
            onChange={(e) =>
              set({
                goals: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>

        <Field label="Funnel notes" hint="How your offers connect / next steps">
          <textarea
            rows={2}
            className={inputClass}
            value={draft.funnelNotes ?? ""}
            onChange={(e) => set({ funnelNotes: e.target.value || null })}
          />
        </Field>

        <Field label="Brief notes" hint="Positioning, messaging rules, anything else">
          <textarea
            rows={3}
            className={inputClass}
            value={draft.briefCombinedText ?? ""}
            onChange={(e) =>
              set({ briefCombinedText: e.target.value || null })
            }
          />
        </Field>
      </div>

      <div className="mt-5">
        <button type="button" className={primaryBtn} onClick={save}>
          Save brand details
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Audience personas
// ---------------------------------------------------------------------------

const EMPTY_PERSONA: Partial<AudiencePersona> = {
  label: "",
  primaryAudience: "",
  audienceDetails: "",
  voiceAndTone: "",
  audiencePains: "",
  believerPersona: "",
  skepticPersona: "",
};

function PersonasSection({ brandId }: { brandId: string }) {
  const [personas, setPersonas] = useState<AudiencePersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Partial<AudiencePersona> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hubApi
      .listPersonas(brandId)
      .then((p) => !cancelled && setPersonas(p))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const add = async () => {
    if (!adding?.label?.trim()) return;
    setBusy(true);
    try {
      const created = await hubApi.createPersona(brandId, adding);
      setPersonas((p) => [...p, created]);
      setAdding(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setPersonas((p) => p.filter((x) => x.id !== id));
    try {
      await hubApi.deletePersona(brandId, id);
    } catch {
      // best-effort; a reload re-syncs
    }
  };

  return (
    <CollapsibleSection title="Audience">
      <p className="text-sm text-stone-600">
        Who you serve, how they talk, what they struggle with. Add as many
        personas as you need.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-stone-500">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {personas.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-stone-200 bg-stone-50/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-semibold text-stone-900">{p.label}</div>
                  {p.primaryAudience ? (
                    <div className="text-stone-600">{p.primaryAudience}</div>
                  ) : null}
                  {p.voiceAndTone ? (
                    <div className="mt-1 text-xs text-stone-500">
                      Voice: {p.voiceAndTone}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-stone-500 hover:text-red-600"
                  onClick={() => remove(p.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {personas.length === 0 ? (
            <p className="text-sm text-stone-500">No personas yet.</p>
          ) : null}
        </div>
      )}

      {adding ? (
        <div className="mt-4 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
          <Field label="Label" hint='e.g. "Busy founder"'>
            <input
              className={inputClass}
              value={adding.label ?? ""}
              onChange={(e) => setAdding({ ...adding, label: e.target.value })}
            />
          </Field>
          <Field label="Who you serve (one sentence)">
            <input
              className={inputClass}
              value={adding.primaryAudience ?? ""}
              onChange={(e) =>
                setAdding({ ...adding, primaryAudience: e.target.value })
              }
            />
          </Field>
          <Field label="Details" hint="Demographics, where they hang out">
            <textarea
              rows={2}
              className={inputClass}
              value={adding.audienceDetails ?? ""}
              onChange={(e) =>
                setAdding({ ...adding, audienceDetails: e.target.value })
              }
            />
          </Field>
          <Field label="Language & tone">
            <input
              className={inputClass}
              value={adding.voiceAndTone ?? ""}
              onChange={(e) =>
                setAdding({ ...adding, voiceAndTone: e.target.value })
              }
            />
          </Field>
          <Field label="Pains & desires">
            <textarea
              rows={2}
              className={inputClass}
              value={adding.audiencePains ?? ""}
              onChange={(e) =>
                setAdding({ ...adding, audiencePains: e.target.value })
              }
            />
          </Field>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || !adding.label?.trim()}
              onClick={add}
            >
              Add persona
            </button>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => setAdding(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${ghostBtn} mt-4`}
          onClick={() => setAdding({ ...EMPTY_PERSONA })}
        >
          + Add persona
        </button>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Products / offers
// ---------------------------------------------------------------------------

function ProductsSection({ brandId }: { brandId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<Partial<Product> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hubApi
      .listProducts(brandId)
      .then((p) => !cancelled && setProducts(p))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const add = async () => {
    if (!adding?.name?.trim()) return;
    setBusy(true);
    try {
      const created = await hubApi.createProduct(brandId, adding);
      setProducts((p) => [...p, created]);
      setAdding(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setProducts((p) => p.filter((x) => x.id !== id));
    try {
      await hubApi.deleteProduct(brandId, id);
    } catch {
      // best-effort
    }
  };

  return (
    <CollapsibleSection title="Products & offers">
      <p className="text-sm text-stone-600">
        Your offers, links, and CTAs. Comment Convert and the Multiplier use
        these so replies and captions point people to the right thing.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-stone-500">Loading…</p>
      ) : (
        <div className="mt-4 space-y-3">
          {products.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4"
            >
              <div className="text-sm">
                <div className="font-semibold text-stone-900">{p.name}</div>
                {p.description ? (
                  <div className="text-stone-600">{p.description}</div>
                ) : null}
                <div className="mt-1 text-xs text-stone-500">
                  {p.cta ? `CTA: ${p.cta}` : null}
                  {p.cta && p.url ? " · " : null}
                  {p.url ? p.url : null}
                </div>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-stone-500 hover:text-red-600"
                onClick={() => remove(p.id)}
              >
                Remove
              </button>
            </div>
          ))}
          {products.length === 0 ? (
            <p className="text-sm text-stone-500">No offers yet.</p>
          ) : null}
        </div>
      )}

      {adding ? (
        <div className="mt-4 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
          <Field label="Name">
            <input
              className={inputClass}
              value={adding.name ?? ""}
              onChange={(e) => setAdding({ ...adding, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              className={inputClass}
              value={adding.description ?? ""}
              onChange={(e) =>
                setAdding({ ...adding, description: e.target.value })
              }
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link / URL">
              <input
                className={inputClass}
                value={adding.url ?? ""}
                onChange={(e) => setAdding({ ...adding, url: e.target.value })}
              />
            </Field>
            <Field label="CTA" hint='e.g. "Start free trial"'>
              <input
                className={inputClass}
                value={adding.cta ?? ""}
                onChange={(e) => setAdding({ ...adding, cta: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || !adding.name?.trim()}
              onClick={add}
            >
              Add offer
            </button>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => setAdding(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${ghostBtn} mt-4`}
          onClick={() => setAdding({ name: "" })}
        >
          + Add offer
        </button>
      )}
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Connections — one place to see every connected account
// ---------------------------------------------------------------------------

function ConnectionAvatar({
  platform,
  avatarUrl,
  label,
}: {
  platform: string;
  avatarUrl: string | null;
  label: string;
}) {
  const initial = (label || platform).slice(0, 1).toUpperCase();
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote platform CDN URLs
      <img
        src={avatarUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-stone-200"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-600"
      aria-hidden
    >
      {initial}
    </span>
  );
}

/** Refresh TikTok avatar/nickname via same-origin Hub API (no CORS). */
async function enrichTikTokProfile(
  conn: SocialConnection,
): Promise<SocialConnection> {
  if (conn.platform !== "tiktok") return conn;
  // Username alone is often unavailable without extra scopes — don't keep
  // refreshing (and risk token rotation) just for a missing @handle.
  const needsEnrich = !conn.externalAvatarUrl || !conn.externalDisplayName;
  if (!needsEnrich) return conn;

  try {
    return await hubApi.refreshConnectionProfile("tiktok");
  } catch {
    return conn;
  }
}

function ConnectionsSection() {
  const [conns, setConns] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await hubApi.listConnections();
        if (cancelled) return;
        setConns(list);
        setLoading(false);

        const tiktok = list.find((c) => c.platform === "tiktok");
        if (
          tiktok &&
          (!tiktok.externalAvatarUrl || !tiktok.externalDisplayName)
        ) {
          const enriched = await enrichTikTokProfile(tiktok);
          if (cancelled) return;
          if (
            enriched.externalAvatarUrl !== tiktok.externalAvatarUrl ||
            enriched.externalDisplayName !== tiktok.externalDisplayName ||
            enriched.externalUsername !== tiktok.externalUsername
          ) {
            setConns((prev) =>
              prev.map((c) => (c.platform === "tiktok" ? enriched : c)),
            );
          }
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byPlatform = new Map(conns.map((c) => [c.platform, c]));

  const disconnect = async (platform: string) => {
    setConns((c) => c.filter((x) => x.platform !== platform));
    try {
      await hubApi.deleteConnection(platform);
    } catch {
      // best-effort
    }
  };

  return (
    <section className={cardClass}>
      <h2 className="text-lg font-semibold text-stone-900">Connections</h2>
      <p className="mt-1 text-sm text-stone-600">
        Connect an account once and every app uses it — no more linking
        Instagram separately in each tool.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-stone-500">Loading…</p>
      ) : (
        <div className="mt-4 divide-y divide-stone-100">
          {ALL_PLATFORMS.map((platform) => {
            const conn = byPlatform.get(platform);
            const nickname =
              conn?.externalDisplayName?.trim() ||
              conn?.externalUsername?.trim() ||
              null;
            const handle = conn?.externalUsername?.trim() || null;
            return (
              <div
                key={platform}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {conn ? (
                    <ConnectionAvatar
                      platform={platform}
                      avatarUrl={conn.externalAvatarUrl}
                      label={nickname ?? platform}
                    />
                  ) : (
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[10px] font-semibold uppercase text-stone-400"
                      aria-hidden
                    >
                      {platform.slice(0, 2)}
                    </span>
                  )}
                  <div className="min-w-0 text-sm">
                    <div className="font-medium capitalize text-stone-900">
                      {platform}
                    </div>
                    {conn && (nickname || handle) ? (
                      <div className="truncate text-stone-500">
                        {conn.externalDisplayName?.trim() ||
                          (handle ? `@${handle}` : nickname)}
                        {conn.externalDisplayName?.trim() && handle ? (
                          <span className="text-stone-400"> @{handle}</span>
                        ) : null}
                      </div>
                    ) : conn ? (
                      <div className="text-stone-400">Connected</div>
                    ) : null}
                  </div>
                </div>
                {conn ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-stone-500 hover:text-red-600"
                    onClick={() => disconnect(platform)}
                  >
                    Disconnect
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-stone-400">
                    Not connected
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-500">
        Need to connect a new account?{" "}
        <a
          href={STUDIO_CONNECTIONS_URL}
          className="font-medium text-palette-depth underline"
        >
          Connect in Video Studio
        </a>{" "}
        — it shares this same list. (One-click connect moves here in the next
        pass.)
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Copy & AI defaults
// ---------------------------------------------------------------------------

function CopyDefaultsSection({
  brand,
  onChange,
}: {
  brand: Brand;
  onChange: (b: Brand) => void;
}) {
  const [copyContext, setCopyContext] = useState(brand.copyContext ?? "");
  const [copyFeedback, setCopyFeedback] = useState(brand.copyFeedback ?? "");
  const [captionCta, setCaptionCta] = useState(brand.defaultCaptionCta ?? "");
  const [firstComment, setFirstComment] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    setFirstComment(getDefaultFirstCommentFromStorage());
  }, []);

  const save = useCallback(async () => {
    setStatus("saving");
    try {
      const saved = await hubApi.updateBrand(brand.id, {
        copyContext: copyContext || null,
        copyFeedback: copyFeedback || null,
        defaultCaptionCta: captionCta || null,
      });
      onChange(saved);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }, [brand.id, copyContext, copyFeedback, captionCta, onChange]);

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Copy & AI defaults</h2>
        <SaveStatus state={status} />
      </div>

      <div className="mt-5 space-y-5">
        <Field
          label="Default caption CTA"
          hint="Added to the end of generated captions, before hashtags"
        >
          <textarea
            rows={2}
            className={inputClass}
            value={captionCta}
            placeholder='e.g. "Train with us — link in bio"'
            onChange={(e) => setCaptionCta(e.target.value)}
          />
        </Field>

        <Field
          label="Free-form context for copy"
          hint="Brand voice, facts, anything the model should know"
        >
          <textarea
            rows={6}
            className={inputClass}
            value={copyContext}
            onChange={(e) => setCopyContext(e.target.value)}
          />
        </Field>

        <Field
          label="Notes for the next AI run"
          hint='e.g. "shorter hook", "less hype"'
        >
          <textarea
            rows={4}
            className={inputClass}
            value={copyFeedback}
            onChange={(e) => setCopyFeedback(e.target.value)}
          />
        </Field>

        <button type="button" className={primaryBtn} onClick={save}>
          Save copy defaults
        </button>

        <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
          <Field
            label="Default first comment"
            hint="Pre-fills the first comment on scheduled posts"
          >
            <textarea
              rows={2}
              className={inputClass}
              value={firstComment}
              onChange={(e) => {
                const v = e.target.value.slice(
                  0,
                  MAX_DEFAULT_FIRST_COMMENT_CHARS,
                );
                setFirstComment(v);
                setDefaultFirstCommentToStorage(v);
              }}
            />
          </Field>
          <p className="mt-1 text-xs text-stone-400">
            Saved on this device for now — moving into your account in the next
            pass.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reference sources
// ---------------------------------------------------------------------------

function ReferenceSourcesSection({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<ReferenceSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hubApi
      .listReferenceSources(brandId)
      .then((s) => !cancelled && setSources(s))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const add = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      const created = await hubApi.createReferenceSource(
        brandId,
        content.trim(),
        label.trim() || undefined,
      );
      setSources((s) => [created, ...s]);
      setLabel("");
      setContent("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleSection title="Reference sources">
      <p className="text-sm text-stone-600">
        Excerpts from coaches, articles, or your notes. The model uses these to
        expand a caption when a clip is short.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-stone-500">Loading…</p>
      ) : (
        <div className="mt-4 space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-lg border border-stone-200 bg-stone-50/60 p-3 text-sm"
            >
              {s.sourceLabel ? (
                <div className="text-xs font-medium text-stone-500">
                  {s.sourceLabel}
                </div>
              ) : null}
              <div className="text-stone-700">{s.content}</div>
            </div>
          ))}
          {sources.length === 0 ? (
            <p className="text-sm text-stone-500">No reference sources yet.</p>
          ) : null}
        </div>
      )}

      <div className="mt-4 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
        <Field label="Label (optional)">
          <input
            className={inputClass}
            value={label}
            placeholder='e.g. "Coach notes"'
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Source text">
          <textarea
            rows={4}
            className={inputClass}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !content.trim()}
          onClick={add}
        >
          Add source
        </button>
      </div>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------------
// Comment Convert — links out until Phase B wires it to /api/v1
// ---------------------------------------------------------------------------

function CommentsSection() {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    let cancelled = false;
    ccApi
      .getVoiceSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setKeywordsText((s.dmTriggerKeywords ?? []).join(", "));
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t load your Comment Convert settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (patch: Partial<VoiceSettings>) => {
    setStatus("saving");
    try {
      const s = await ccApi.saveVoiceSettings(patch);
      setSettings(s);
      setKeywordsText((s.dmTriggerKeywords ?? []).join(", "));
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  }, []);

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-900">Comments</h2>
        <SaveStatus state={status} />
      </div>
      <p className="mt-1 text-sm text-stone-600">
        How Comment Convert handles your incoming comments and learns your reply
        voice.
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-stone-500">Loading…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-red-700">
          {error}{" "}
          <a href={CC_SETTINGS_URL} className="font-medium underline">
            Open Comment Convert →
          </a>
        </p>
      ) : settings ? (
        <div className="mt-5 space-y-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-stone-300"
              checked={settings.savePostedRepliesToVoiceLibrary}
              onChange={(e) =>
                save({ savePostedRepliesToVoiceLibrary: e.target.checked })
              }
            />
            <span className="text-sm">
              <span className="font-medium text-stone-800">
                Save my posted replies to the voice library
              </span>
              <span className="mt-0.5 block text-xs text-stone-500">
                When on, replies you publish are saved as voice samples so future
                drafts sound more like you.
              </span>
            </span>
          </label>

          <Field
            label="DM trigger keywords"
            hint="Comma-separated. A comment that is only one of these words (e.g. “drill”) is treated as a DM trigger, not a real comment to reply to."
          >
            <input
              className={inputClass}
              value={keywordsText}
              placeholder="drill, link, guide"
              onChange={(e) => setKeywordsText(e.target.value)}
              onBlur={() =>
                save({
                  dmTriggerKeywords: keywordsText
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>
      ) : null}

      <a href={CC_SETTINGS_URL} className={`${ghostBtn} mt-5 inline-block`}>
        Open voice library in Comment Convert →
      </a>
    </section>
  );
}
