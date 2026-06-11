"use client";

import { useEffect, useState } from "react";

export function useInboxUnread(intervalMs = 60000) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/v1/inbox/unread-count");
        if (!res.ok) return;
        const data = await res.json();
        setUnread(Number(data?.data?.unreadCount ?? 0));
      } catch {
        // ignore
      }
    }
    load();
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return unread;
}
