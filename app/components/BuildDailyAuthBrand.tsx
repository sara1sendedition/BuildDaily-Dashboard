"use client";

import Link from "next/link";
import { clientApiPath } from "@/lib/client-api-path";

/** Shared auth-page brand mark (BD logo + wordmark). */
export function BuildDailyAuthBrand({
  href = "/",
}: {
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 text-[var(--bd-green-800)] no-underline"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={clientApiPath("/content-multiplier-logo.png?v=2")}
        alt=""
        width={36}
        height={36}
        className="rounded-[7px]"
      />
      <span className="text-xl font-bold tracking-tight">BuildDaily</span>
    </Link>
  );
}
