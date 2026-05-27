import {
  assertOk,
  MetaGraphError,
  readGraphJsonBody,
  type MetaGraphErrorBody,
} from "./errors";
import { stripEmDashes } from "@/lib/strip-em-dash";

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

async function postCommentOnObject(
  version: string,
  objectId: string,
  accessToken: string,
  message: string,
  label: string
): Promise<void> {
  const u = new URL(`${graphBase(version)}/${objectId}/comments`);
  u.searchParams.set("access_token", accessToken);
  const res = await fetch(u.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ message }).toString(),
  });
  const data = (await readGraphJsonBody(res)) as MetaGraphErrorBody & {
    id?: string;
  };
  try {
    assertOk(res, data);
  } catch (e) {
    const detail =
      e instanceof MetaGraphError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Unknown error";
    throw new Error(`${label}: ${detail}`);
  }
  if (typeof data.id !== "string" || !data.id) {
    throw new Error(`${label}: comment created but no id returned.`);
  }
}

export type PostFirstCommentsInput = {
  version: string;
  accessToken: string;
  /** Trimmed non-empty text required by caller. */
  message: string;
  postToInstagram: boolean;
  postToFacebook: boolean;
  instagramMediaId?: string;
  /** Page feed post id (carousel / photo). */
  facebookPostId?: string;
  /** Page video id (reel / short on Facebook). */
  facebookVideoId?: string;
  /** When true, skip posting (e.g. native Meta scheduled publish — post not live yet). */
  defer?: boolean;
};

export type PostFirstCommentsResult = {
  errors: string[];
  deferred?: boolean;
};

/**
 * Best-effort first comment after media publish. Failures are collected in
 * `errors` — callers should not fail the overall publish.
 */
export async function postFirstCommentsAfterPublish(
  input: PostFirstCommentsInput
): Promise<PostFirstCommentsResult> {
  if (input.defer) {
    return { errors: [], deferred: true };
  }

  const {
    version,
    accessToken,
    message,
    postToInstagram,
    postToFacebook,
    instagramMediaId,
    facebookPostId,
    facebookVideoId,
  } = input;

  const errors: string[] = [];

  if (postToInstagram && instagramMediaId) {
    try {
      await postCommentOnObject(
        version,
        instagramMediaId,
        accessToken,
        message,
        "Instagram first comment"
      );
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Instagram first comment failed.");
    }
  }

  if (postToFacebook) {
    const fbTarget = facebookPostId ?? facebookVideoId;
    if (fbTarget) {
      try {
        await postCommentOnObject(
          version,
          fbTarget,
          accessToken,
          message,
          "Facebook first comment"
        );
      } catch (e) {
        errors.push(
          e instanceof Error ? e.message : "Facebook first comment failed."
        );
      }
    }
  }

  return { errors };
}

export function parseFirstComment(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = stripEmDashes(raw.trim());
  return t.length > 0 ? t : undefined;
}

/** Best-effort first comment; returns API response fields for JSON bodies. */
export async function tryPostFirstCommentsAfterPublish(input: {
  env: { version: string; token: string; pageId: string } | null;
  firstComment?: string;
  postToInstagram: boolean;
  postToFacebook: boolean;
  instagramMediaId?: string;
  facebookPostId?: string;
  facebookVideoId?: string;
  defer?: boolean;
}): Promise<{
  firstCommentErrors?: string[];
  firstCommentDeferred?: boolean;
}> {
  const message = parseFirstComment(input.firstComment);
  if (!message || !input.env) return {};

  const r = await postFirstCommentsAfterPublish({
    version: input.env.version,
    accessToken: input.env.token,
    message,
    postToInstagram: input.postToInstagram,
    postToFacebook: input.postToFacebook,
    instagramMediaId: input.instagramMediaId,
    facebookPostId: input.facebookPostId,
    facebookVideoId: input.facebookVideoId,
    defer: input.defer,
  });

  if (r.deferred) return { firstCommentDeferred: true };
  if (r.errors.length > 0) {
    for (const e of r.errors) console.warn("[first-comment]", e);
    return { firstCommentErrors: r.errors };
  }
  return {};
}
