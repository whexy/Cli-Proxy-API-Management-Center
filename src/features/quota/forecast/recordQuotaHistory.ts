import type { TFunction } from 'i18next';
import { useAuthStore } from '@/stores';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { normalizeLedgerQuota } from '../ledger/ledgerModel';
import { historyCredentialKey, sampleWindows } from './history';
import { recordQuotaSamples } from './historyStore';

/** History belongs to the backend it was read through. */
export const currentQuotaHistoryScope = () => useAuthStore.getState().apiBase;

/** Record a freshly fetched quota state in the credential's history. */
export function recordQuotaState(
  entry: QuotaFileEntry,
  state: unknown,
  t: TFunction,
  atMs = Date.now()
) {
  const ledger = normalizeLedgerQuota(entry.type, state, t);
  if (!ledger || ledger.windows.length === 0) return;
  recordQuotaSamples([
    {
      scope: currentQuotaHistoryScope(),
      credential: historyCredentialKey(entry.type, getQuotaCacheKey(entry.file)),
      at: atMs,
      windows: sampleWindows(ledger),
    },
  ]);
}
