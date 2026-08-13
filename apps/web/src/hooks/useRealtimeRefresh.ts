import { useEffect, useRef, useState } from 'react';

export type RealtimeEvent = {
  type: 'dispatch' | 'run' | 'release' | 'poll' | 'action';
  projectId?: number;
  projectSlug?: string;
  repository?: string;
  source: 'forge' | 'github-webhook' | 'github-poll';
  action?: string;
  at: string;
};

export function useRealtimeRefresh(onRefresh: () => void | Promise<void>, projectId?: number) {
  const refreshRef = useRef(onRefresh);
  const timerRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(false);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const onUpdate = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as RealtimeEvent;
        if (projectId && payload.projectId && payload.projectId !== projectId) return;
      } catch {
        // An unreadable event should still cause a safe refresh.
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void refreshRef.current(), 350);
    };

    source.addEventListener('update', onUpdate);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      source.removeEventListener('update', onUpdate);
      source.close();
      setConnected(false);
    };
  }, [projectId]);

  return connected;
}
