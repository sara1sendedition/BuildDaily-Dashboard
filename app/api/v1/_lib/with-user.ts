import type { NextRequest } from "next/server";
import {
  requireUser,
  UnauthorizedError,
  type AuthedUser,
} from "@/lib/auth/require-user";
import { BadRequestError, errors } from "@/app/api/v1/_lib/responses";

/**
 * Args passed to a wrapped route handler.
 *  - `req`: the incoming request
 *  - `user`: the authenticated AuthedUser (Clerk + users-table row)
 *  - `params`: route params (e.g. { id: "..." } from app/api/v1/brands/[id]/route.ts)
 */
export type HandlerArgs = {
  req: NextRequest;
  user: AuthedUser;
  params: Record<string, string>;
};

type Handler = (args: HandlerArgs) => Promise<Response> | Response;

/**
 * Wraps a Route Handler so it:
 *  - Requires a signed-in Clerk user (otherwise 401)
 *  - Auto-upserts the row in our `users` table on first sight
 *  - Passes the resolved AuthedUser to the handler
 *  - Awaits params (Next 15 ships them as Promise in dynamic routes)
 *  - Catches UnauthorizedError + BadRequestError + unknown errors,
 *    returns RFC 7807 problem-details responses
 */
export function withUser(handler: Handler) {
  return async (
    req: NextRequest,
    ctx?: {
      params?:
        | Promise<Record<string, string>>
        | Record<string, string>;
    },
  ): Promise<Response> => {
    try {
      const user = await requireUser();

      let params: Record<string, string> = {};
      const rawParams = ctx?.params;
      if (rawParams) {
        if (
          typeof (rawParams as Promise<unknown>).then === "function"
        ) {
          params = await (rawParams as Promise<Record<string, string>>);
        } else {
          params = rawParams as Record<string, string>;
        }
      }

      return await handler({ req, user, params });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return errors.unauthorized(err.message);
      }
      if (err instanceof BadRequestError) {
        return errors.badRequest(err.message);
      }
      console.error("[api/v1] unhandled error:", err);
      return errors.internal(
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  };
}
