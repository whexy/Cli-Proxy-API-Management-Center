import { useCallback, useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores';
import { QUOTA_PAGE_SIZE } from '../constants';
import type { QuotaFileEntry } from '../logic';
import { chunk } from './ledgerModel';

/**
 * Load any number of entries through the batch loader, a page-size batch at a
 * time.
 *
 * The batch loader requests every target at once; the cards view relies on
 * pagination to cap that at QUOTA_PAGE_SIZE upstream calls, and the ledger,
 * which is not paginated, keeps the same cap this way. Stops when the page
 * unmounts or the connection session changes.
 */
export function useChunkedQuotaLoad(loadQuota: (targets: QuotaFileEntry[]) => Promise<void>) {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return useCallback(
    async (targets: QuotaFileEntry[]) => {
      const session = useQuotaStore.getState().cacheGeneration;
      for (const batch of chunk(targets, QUOTA_PAGE_SIZE)) {
        if (!mountedRef.current || useQuotaStore.getState().cacheGeneration !== session) return;
        await loadQuota(batch);
      }
    },
    [loadQuota]
  );
}
