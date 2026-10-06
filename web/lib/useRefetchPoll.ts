"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 2000;
const DEADLINE_MS = 30000;

export type RefetchStatus = { text: string; critical: boolean } | null;

/**
 * Queue a price refresh, then poll until the newest fetch timestamp passes
 * `baseline` (refresh the route) or 30 s elapse (say so). The spinner always
 * stops: request/poll failures land in `status` instead of hanging.
 */
export function useRefetchPoll(
  request: () => Promise<unknown>,
  poll: () => Promise<string | null>,
  baseline: string | null,
) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<RefetchStatus>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // re-arm after a StrictMode remount
    return () => { alive.current = false; };
  }, []);

  async function refetch() {
    setRefreshing(true);
    setStatus(null);
    try {
      await request();
      const deadline = Date.now() + DEADLINE_MS;
      while (alive.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        const newest = await poll();
        if (newest && (!baseline || newest > baseline)) {
          router.refresh();
          return;
        }
        if (Date.now() > deadline) {
          setStatus({ text: "No new prices after 30 s. The fetcher may be busy; showing the last synced data.", critical: false });
          return;
        }
      }
    } catch {
      if (alive.current) setStatus({ text: "Price refresh failed. Nothing was changed; try again.", critical: true });
    } finally {
      if (alive.current) setRefreshing(false);
    }
  }

  return { refreshing, status, refetch };
}
