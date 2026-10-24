import { useCallback, useState } from 'react';
import { readQuotaUiState, writeQuotaUiState } from '../uiState';
import { DEFAULT_QUOTA_VIEW, type QuotaView } from './constants';

/** View and email visibility, persisted with the page's other UI preferences. */
export function useQuotaViewPreferences() {
  const [view, setViewState] = useState<QuotaView>(
    () => readQuotaUiState()?.view ?? DEFAULT_QUOTA_VIEW
  );
  const [showEmails, setShowEmailsState] = useState(() => readQuotaUiState()?.showEmails ?? false);

  const setView = useCallback((next: QuotaView) => {
    setViewState(next);
    writeQuotaUiState({ view: next });
  }, []);

  const setShowEmails = useCallback((next: boolean) => {
    setShowEmailsState(next);
    writeQuotaUiState({ showEmails: next });
  }, []);

  return { view, setView, showEmails, setShowEmails };
}
