import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { QuotaSample } from './history';
import {
  getSessionQuotaSamples,
  mergeQuotaSamples,
  readQuotaSamples,
  subscribeQuotaHistory,
} from './historyStore';

interface StoredSamples {
  scope: string;
  fromMs: number;
  samples: QuotaSample[];
}

/** Every sample of `scope` from `fromMs` on, stored or taken since the page opened. */
export function useQuotaHistory(scope: string, fromMs: number): QuotaSample[] {
  const session = useSyncExternalStore(
    subscribeQuotaHistory,
    getSessionQuotaSamples,
    getSessionQuotaSamples
  );
  const [stored, setStored] = useState<StoredSamples | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readQuotaSamples(scope, fromMs).then((samples) => {
      if (!cancelled) setStored({ scope, fromMs, samples });
    });
    return () => {
      cancelled = true;
    };
  }, [scope, fromMs]);

  return useMemo(() => {
    const storedSamples =
      stored && stored.scope === scope && stored.fromMs === fromMs ? stored.samples : [];
    return mergeQuotaSamples(
      storedSamples,
      session.filter((sample) => sample.scope === scope && sample.at >= fromMs)
    );
  }, [fromMs, scope, session, stored]);
}
