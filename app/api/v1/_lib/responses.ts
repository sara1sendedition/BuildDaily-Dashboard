import { NextResponse } from "next/server";

/** Standard JSON success response. */
export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/** RFC 7807 problem-details response. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

export function problem(
  status: number,
  title: string,
  type: string,
  detail?: string,
): NextResponse {
  const body: ProblemDetails = { type, title, status };
  if (detail) body.detail = detail;
  return NextResponse.json(body, {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

/** Common error responses, RFC 7807 shape. */
export const errors = {
  unauthorized: (detail?: string) =>
    problem(401, "Unauthorized", "/errors/unauthorized", detail),
  forbidden: (detail?: string) =>
    problem(403, "Forbidden", "/errors/forbidden", detail),
  notFound: (resource: string, id?: string) =>
    problem(
      404,
      `${resource} not found`,
      `/errors/${resource.toLowerCase().replace(/\s+/g, "-")}-not-found`,
      id
        ? `${resource} with id ${id} does not exist or you don't have access to it`
        : undefined,
    ),
  badRequest: (detail: string) =>
    problem(400, "Bad request", "/errors/bad-request", detail),
  conflict: (detail: string) =>
    problem(409, "Conflict", "/errors/conflict", detail),
  internal: (detail?: string) =>
    problem(500, "Internal server error", "/errors/internal", detail),
};

/** Safe-parse JSON body with a helpful error response on failure. */
export async function readJson<T = unknown>(
  req: Request,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const data = (await req.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, response: errors.badRequest("Invalid JSON body") };
  }
}

/** Type-safe string getter from an unknown record. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
export function requiredStr(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequestError(`\`${field}\` is required and must be a string`);
  }
  return value;
}
export function optStrArr(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  throw new BadRequestError("expected string[] for this field");
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}
