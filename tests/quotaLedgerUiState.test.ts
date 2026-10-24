import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_QUOTA_VIEW } from '@/features/quota/ledger/constants';
import { readQuotaUiState, writeQuotaUiState } from '@/features/quota/uiState';

const KEY = 'quotaPage.uiState';
const originalWindow = (globalThis as { window?: unknown }).window;

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as unknown as { window: unknown }).window = {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('quota view preferences', () => {
  test('open on the ledger by default', () => {
    expect(DEFAULT_QUOTA_VIEW).toBe('ledger');
    expect(readQuotaUiState()?.view).toBeUndefined();
  });

  test('persist alongside the tab and sort preferences', () => {
    writeQuotaUiState({ tab: 'claude', sortMode: 'soonest' });
    writeQuotaUiState({ view: 'cards' });
    writeQuotaUiState({ showEmails: true });

    expect(readQuotaUiState()).toEqual({
      tab: 'claude',
      sortMode: 'soonest',
      view: 'cards',
      showEmails: true,
    });
  });

  test('drop values outside the contract', () => {
    store.set(KEY, JSON.stringify({ view: 'table', showEmails: 'yes' }));
    const state = readQuotaUiState();
    expect(state?.view).toBeUndefined();
    expect(state?.showEmails).toBeUndefined();
  });
});
