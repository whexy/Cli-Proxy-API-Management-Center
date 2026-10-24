import { useMemo, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import {
  ledgerColumns,
  normalizeLedgerQuota,
  summarizeLedgerWindows,
  summaryColumns,
} from './ledgerModel';
import { LedgerSection } from './LedgerSection';
import { LedgerSummaryCard } from './LedgerSummaryCard';
import { maskEmails } from './maskEmail';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerProps {
  /** Filtered and sorted; sections keep this order within each provider. */
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
  canRefresh: boolean;
  resettingKey: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
}

export function QuotaLedger({
  entries,
  quotaFor,
  resolvedTheme,
  showEmails,
  canRefresh,
  resettingKey,
  onRefresh,
}: QuotaLedgerProps) {
  const { t, i18n } = useTranslation();
  const nowMs = useNow();
  const locale = i18n.resolvedLanguage;

  const groups = useMemo(() => {
    const byType = new Map<QuotaProviderType, QuotaFileEntry[]>();
    entries.forEach((entry) => {
      const group = byType.get(entry.type) ?? [];
      group.push(entry);
      byType.set(entry.type, group);
    });
    return QUOTA_TAB_ORDER.flatMap((type) => {
      const group = byType.get(type);
      if (!group) return [];
      const quotas = group.map(quotaFor);
      const ledgers = group.map((entry, index) =>
        normalizeLedgerQuota(entry.type, quotas[index], t)
      );
      const names = group.map((entry) => {
        const name = getQuotaDisplayName(entry.file);
        return showEmails ? name : maskEmails(name, [entry.file.email]);
      });
      return [{ type, entries: group, quotas, ledgers, names }];
    });
  }, [entries, quotaFor, showEmails, t]);

  const sections = useMemo(
    () =>
      groups.map((group) => {
        const totals = summarizeLedgerWindows(group.ledgers, nowMs);
        return { ...group, totals, columns: ledgerColumns(group.ledgers, totals[0]?.id ?? null) };
      }),
    [groups, nowMs]
  );

  return (
    <div className={styles.ledger}>
      <ul
        className={
          sections.length === 1
            ? `${styles.summaryStrip} ${styles.summaryStripSingle}`
            : styles.summaryStrip
        }
        style={{ '--summary-columns': summaryColumns(sections.length) } as CSSProperties}
      >
        {sections.map((section) => (
          <LedgerSummaryCard
            key={section.type}
            type={section.type}
            totals={section.totals}
            names={section.names}
            resolvedTheme={resolvedTheme}
            nowMs={nowMs}
            locale={locale}
          />
        ))}
      </ul>
      {sections.map((section) => (
        <LedgerSection
          key={section.type}
          type={section.type}
          entries={section.entries}
          quotas={section.quotas}
          ledgers={section.ledgers}
          columns={section.columns}
          names={section.names}
          canRefresh={canRefresh}
          resettingKey={resettingKey}
          nowMs={nowMs}
          locale={locale}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

const SKELETON_SUMMARY_COUNT = 3;
const SKELETON_ROW_COUNT = 4;

export function QuotaLedgerSkeleton() {
  return (
    <div className={styles.ledger} aria-hidden="true">
      <ul className={styles.summaryStrip}>
        {Array.from({ length: SKELETON_SUMMARY_COUNT }, (_, index) => (
          <li key={index} className={styles.summaryCard}>
            <Skeleton height={14} width="45%" rounded={4} />
            <Skeleton height={28} width="55%" rounded={6} />
            <Skeleton height={4} rounded={999} />
          </li>
        ))}
      </ul>
      <ul className={styles.rows}>
        {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
          <li key={index} className={styles.row}>
            <Skeleton height={14} width="80%" rounded={4} />
            <Skeleton height={28} rounded={6} />
            <Skeleton height={14} width={88} rounded={4} />
          </li>
        ))}
      </ul>
    </div>
  );
}
