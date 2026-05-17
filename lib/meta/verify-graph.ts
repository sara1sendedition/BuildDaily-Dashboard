import { readGraphJsonBody, type MetaGraphErrorBody } from "./errors";

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

export type MetaVerifyOk = {
  ok: true;
  pageName: string;
  instagramBusinessAccountId?: string;
  instagramUsername?: string;
};

export type MetaVerifyFail = {
  ok: false;
  message: string;
  fbtrace_id?: string;
};

export type MetaVerifyResult = MetaVerifyOk | MetaVerifyFail;

/**
 * Read-only Graph calls: Page node + optional IG user. Does not create posts or uploads.
 */
export async function verifyMetaGraphConnection(input: {
  version: string;
  pageId: string;
  token: string;
}): Promise<MetaVerifyResult> {
  const pageUrl = new URL(`${graphBase(input.version)}/${input.pageId}`);
  pageUrl.searchParams.set(
    "fields",
    "name,instagram_business_account{id,username}"
  );
  pageUrl.searchParams.set("access_token", input.token);

  let res: Response;
  try {
    res = await fetch(pageUrl.toString());
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Network error calling Graph API.",
    };
  }

  let data: MetaGraphErrorBody & Record<string, unknown>;
  try {
    data = (await readGraphJsonBody(res)) as MetaGraphErrorBody &
      Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Could not parse Graph API response.",
    };
  }

  if (data.error) {
    return {
      ok: false,
      message: String(data.error.message ?? "Graph API error"),
      fbtrace_id: data.error.fbtrace_id,
    };
  }

  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : "Facebook Page";
  const igba = data.instagram_business_account as
    | { id?: string; username?: string }
    | undefined;
  let igId = typeof igba?.id === "string" ? igba.id : undefined;
  let igUser =
    typeof igba?.username === "string" ? igba.username.trim() : undefined;

  if (igId && !igUser) {
    const igUrl = new URL(`${graphBase(input.version)}/${igId}`);
    igUrl.searchParams.set("fields", "username");
    igUrl.searchParams.set("access_token", input.token);
    try {
      const igRes = await fetch(igUrl.toString());
      const igData = (await readGraphJsonBody(igRes)) as MetaGraphErrorBody & {
        username?: string;
      };
      if (!igData.error && typeof igData.username === "string") {
        igUser = igData.username.trim();
      }
    } catch {
      /* username optional */
    }
  }

  return {
    ok: true,
    pageName: name,
    instagramBusinessAccountId: igId,
    instagramUsername: igUser,
  };
}
