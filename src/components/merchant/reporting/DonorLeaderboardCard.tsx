"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { LeaderboardCard } from "@/components/ui/leaderboard-card";
import type { TopDonorRow } from "@/lib/donors/donorAnalytics";

export const LEADERBOARD_RUN_OPTIONS = [
  { id: "this_week", label: "This Week" },
  { id: "mtd", label: "This Month" },
] as const;

export type LeaderboardRangeId = (typeof LEADERBOARD_RUN_OPTIONS)[number]["id"];

function isLeaderboardRangeId(value: string | undefined): value is LeaderboardRangeId {
  return LEADERBOARD_RUN_OPTIONS.some((o) => o.id === value);
}

// Reads/writes ?leaderboardRange=this_week|mtd — same searchParams-driven
// server re-fetch pattern TopDonorsCard already uses for its metric toggle
// (donors/page.tsx), rather than a client-side fetch/API route: the range
// switch triggers a full server re-render of the parent page with fresh
// loadTopDonors() data.
export function parseLeaderboardRange(value: string | undefined): LeaderboardRangeId {
  return isLeaderboardRangeId(value) ? value : "this_week";
}

export default function DonorLeaderboardCard({
  rows,
  range,
  fromDate,
  toDate,
}: {
  rows: TopDonorRow[];
  range: LeaderboardRangeId;
  fromDate: Date;
  toDate: Date;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setRange = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("leaderboardRange", id);
    router.push(`?${params.toString()}`);
  };

  const podiumRankings = rows.slice(0, 3).map((row, index) => ({
    userId: row.donorId,
    userName: row.name,
    rank: index + 1,
    value: row.metricValueCents,
  }));

  const rankings = rows.map((row, index) => ({
    userId: row.donorId,
    rank: index + 1,
    userName: row.name,
    byline: row.isRecurring
      ? "Recurring donor"
      : `${row.donationCount} donation${row.donationCount === 1 ? "" : "s"}`,
    value: row.metricValueCents,
    displayed: true,
  }));

  return (
    <LeaderboardCard
      title="Top Donors"
      fromDate={fromDate}
      toDate={toDate}
      podiumRankings={podiumRankings}
      rankings={rankings}
      runOptions={[...LEADERBOARD_RUN_OPTIONS]}
      selectedRunId={range}
      onRunChange={setRange}
    />
  );
}
