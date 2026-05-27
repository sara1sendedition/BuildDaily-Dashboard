"use client";

import { SyncScheduleBunnyFromQueue } from "@/app/components/SyncScheduleBunnyFromQueue";
import { CarouselWorkspaceProvider } from "@/context/carousel-workspace-context";
import { ScheduleProvider } from "@/context/schedule-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CarouselWorkspaceProvider>
      <ScheduleProvider>
        <SyncScheduleBunnyFromQueue />
        {children}
      </ScheduleProvider>
    </CarouselWorkspaceProvider>
  );
}
