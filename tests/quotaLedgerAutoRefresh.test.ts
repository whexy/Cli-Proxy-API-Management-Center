import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { QUOTA_AUTO_REFRESH_MS } from '@/features/quota/ledger/constants';
import { isQuotaRefreshDue } from '@/features/quota/ledger/useQuotaAutoRefresh';

describe('quota auto refresh', () => {
  const started = 1_000_000;

  test('is due a minute after the last refresh started', () => {
    expect(isQuotaRefreshDue(started, started + QUOTA_AUTO_REFRESH_MS - 1, 'visible')).toBe(false);
    expect(isQuotaRefreshDue(started, started + QUOTA_AUTO_REFRESH_MS, 'visible')).toBe(true);
  });

  test('waits while the tab is hidden', () => {
    expect(isQuotaRefreshDue(started, started + 5 * QUOTA_AUTO_REFRESH_MS, 'hidden')).toBe(false);
  });

  test('is due at once when no refresh has started', () => {
    expect(isQuotaRefreshDue(0, Date.now(), 'visible')).toBe(true);
  });
});

describe('ledger row refresh action', () => {
  const source = readFileSync('src/features/quota/ledger/LedgerSection.tsx', 'utf8');
  const action = source.slice(
    source.indexOf('className={styles.refreshAction}'),
    source.indexOf('</button>', source.indexOf('className={styles.refreshAction}'))
  );

  test('is an icon named for assistive technology', () => {
    expect(action).toContain("aria-label={t('auth_files.quota_refresh_single')}");
    expect(action).toContain('<IconRefreshCw');
    // Nothing follows the icon inside the button.
    expect(action.slice(action.lastIndexOf('/>') + 2).trim()).toBe('');
  });
});
