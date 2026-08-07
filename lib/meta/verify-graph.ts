import { readGraphJsonBody, type MetaGraphErrorBody } from "./errors";

function graphBase(version: string): string {
  return `https://graph.facebook.com/${version}`;
}

export type MetaVerifyOk = {
  ok: true;
  pageName: string;
  pageAvatarUrl?: string;
  instagramBusinessAccountId?: string;
  instagramUsername?: string;
  instagramAvatarUrl?: string;
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
    "name,picture.type(large){url},instagram_business_account{id,username,profile_picture_url}",
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
  const picture = data.picture as { data?: { url?: string } } | undefined;
  const pageAvatarUrl =
    typeof picture?.data?.url === "string" ? picture.data.url : undefined;

  const igba = data.instagram_business_account as
    | { id?: string; username?: string; profile_picture_url?: string }
    | undefined;
  let igId = typeof igba?.id === "string" ? igba.id : undefined;
  let igUser =
    typeof igba?.username === "string" ? igba.username.trim() : undefined;
  let igAvatar =
    typeof igba?.profile_picture_url === "string"
      ? igba.profile_picture_url
      : undefined;

  if (igId && (!igUser || !igAvatar)) {
    const igUrl = new URL(`${graphBase(input.version)}/${igId}`);
    igUrl.searchParams.set("fields", "username,profile_picture_url");
    igUrl.searchParams.set("access_token", input.token);
    try {
      const igRes = await fetch(igUrl.toString());
      const igData = (await readGraphJsonBody(igRes)) as MetaGraphErrorBody & {
        username?: string;
        profile_picture_url?: string;
      };
      if (!igData.error) {
        if (!igUser && typeof igData.username === "string") {
          igUser = igData.username.trim();
        }
        if (!igAvatar && typeof igData.profile_picture_url === "string") {
          igAvatar = igData.profile_picture_url;
        }
      }
    } catch {
      /* username / avatar optional */
    }
  }

  return {
    ok: true,
    pageName: name,
    pageAvatarUrl,
    instagramBusinessAccountId: igId,
    instagramUsername: igUser,
    instagramAvatarUrl: igAvatar,
  };
}
