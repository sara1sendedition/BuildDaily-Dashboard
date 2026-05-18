import { prisma } from "@/lib/prisma";
import { withUser } from "@/app/api/v1/_lib/with-user";
import { errors, json } from "@/app/api/v1/_lib/responses";

export const runtime = "nodejs";

/**
 * GET /api/v1/brands/[id]/copy-context
 *
 * Returns a single assembled string that drop-in replaces what Multiplier
 * (and the hub's settings page) used to read from localStorage via
 * `getCopyContextFromStorage()`. Assembled from:
 *   - brand.copyContext (explicit free-text brand voice notes)
 *   - brand.briefCombinedText (manual brief + doc summaries)
 *   - active audience personas
 *   - linked reference sources
 *
 * This is the "single source of truth" payoff: brand details entered once on
 * the hub feed every tool's prompts automatically.
 */
export const GET = withUser(async ({ user, params }) => {
  const brand = await prisma.brand.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      audiencePersonas: true,
      products: { orderBy: { displayOrder: "asc" } },
      referenceSources: { orderBy: { createdAt: "desc" }, take: 20 },
      brandDocuments: { where: { extractedText: { not: null } } },
    },
  });
  if (!brand) return errors.notFound("Brand", params.id);

  const parts: string[] = [];

  parts.push(`## Brand: ${brand.name}`);
  if (brand.industry) parts.push(`Industry: ${brand.industry}`);
  if (brand.businessType) parts.push(`Business type: ${brand.businessType}`);
  if (brand.businessDescription) parts.push(`\n${brand.businessDescription}`);

  if (brand.valueProps) {
    parts.push(`\n### What we offer / promise\n${brand.valueProps}`);
  }
  if (brand.boundaries) {
    parts.push(`\n### What we don't do / claim\n${brand.boundaries}`);
  }

  if (brand.products.length > 0) {
    parts.push(`\n### Products / offers`);
    for (const p of brand.products) {
      const line = [`- ${p.name}`, p.description, p.cta ? `CTA: ${p.cta}` : null]
        .filter(Boolean)
        .join(" — ");
      parts.push(line);
    }
  }

  if (brand.audiencePersonas.length > 0) {
    parts.push(`\n### Audience`);
    for (const p of brand.audiencePersonas) {
      parts.push(`\n**${p.label}**`);
      if (p.primaryAudience) parts.push(`Who: ${p.primaryAudience}`);
      if (p.audienceDetails) parts.push(`Detail: ${p.audienceDetails}`);
      if (p.voiceAndTone) parts.push(`Voice: ${p.voiceAndTone}`);
      if (p.audiencePains) parts.push(`Pains: ${p.audiencePains}`);
    }
  }

  if (brand.briefCombinedText) {
    parts.push(`\n### Brief notes\n${brand.briefCombinedText}`);
  }

  if (brand.copyContext) {
    parts.push(`\n### Free-form context\n${brand.copyContext}`);
  }

  if (brand.referenceSources.length > 0) {
    parts.push(`\n### Reference sources`);
    for (const r of brand.referenceSources) {
      const label = r.sourceLabel ? ` [${r.sourceLabel}]` : "";
      parts.push(`-${label} ${r.content}`);
    }
  }

  if (brand.brandDocuments.length > 0) {
    parts.push(`\n### Extracted from uploaded brand docs`);
    for (const d of brand.brandDocuments) {
      if (d.extractedText) {
        parts.push(`\n**${d.fileName}**\n${d.extractedText}`);
      }
    }
  }

  return json({
    data: {
      brandId: brand.id,
      assembled: parts.join("\n"),
      sources: {
        hasCopyContext: !!brand.copyContext,
        hasBriefCombinedText: !!brand.briefCombinedText,
        productCount: brand.products.length,
        personaCount: brand.audiencePersonas.length,
        referenceCount: brand.referenceSources.length,
        documentCount: brand.brandDocuments.length,
      },
    },
  });
});
