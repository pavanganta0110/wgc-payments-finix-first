"use client";

import { useRouter, useSearchParams } from "next/navigation";
import PillFilterInput from "@/components/merchant/PillFilterInput";

export default function DonorsFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-3 mb-4">
      <PillFilterInput
        label="Search"
        value={q}
        width="w-64"
        placeholder="Search by name or email"
        onApply={(v) => setParam("q", v)}
      />
    </div>
  );
}
