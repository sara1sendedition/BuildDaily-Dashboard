"use client";

import { ToolCard, type ToolCardProps } from "@/app/components/hub/ToolCard";

type Props = {
  cards: ToolCardProps[];
};

export function ToolLauncherGrid({ cards }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <ToolCard key={card.title} {...card} />
      ))}
    </div>
  );
}
