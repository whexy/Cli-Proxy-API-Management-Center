import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaProviderType } from '../providers/types';
import type { LedgerWindowTotal } from './ledgerModel';
import { LedgerBar, LedgerReset, ProviderMark } from './LedgerParts';
import styles from './QuotaLedger.module.scss';

const formatSum = (total: LedgerWindowTotal) =>
  total.remainingSum === null ? '--' : `${total.remainingSum}%`;

function WindowLine({ total, children }: { total: LedgerWindowTotal; children?: ReactNode }) {
  return (
    <>
      <span className={styles.summaryLineLabel} title={total.label}>
        {total.label}
      </span>
      <span className={styles.summaryLineValue}>{formatSum(total)}</span>
      {children}
    </>
  );
}

export interface LedgerSummaryCardProps {
  type: QuotaProviderType;
  /** Most constrained first; see summarizeLedgerWindows. */
  totals: LedgerWindowTotal[];
  /** Display names of the provider's credentials, in segment order. */
  names: string[];
  resolvedTheme: ResolvedTheme;
  nowMs: number;
  locale?: string;
}

export function LedgerSummaryCard({
  type,
  totals,
  names,
  resolvedTheme,
  nowMs,
  locale,
}: LedgerSummaryCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const moreId = useId();
  const [primary, next, ...rest] = totals;
  const segments = primary?.segments ?? names.map(() => null);

  return (
    <li className={styles.summaryCard}>
      <div className={styles.summaryHead}>
        <ProviderMark type={type} resolvedTheme={resolvedTheme} />
        <span className={styles.summaryName}>{getTypeLabel(t, type)}</span>
        <span className={styles.summaryCount}>
          {t('quota_ledger.credentials', { count: names.length })}
        </span>
      </div>

      <div className={styles.summaryWindow} title={primary?.label}>
        {primary?.label}
      </div>
      <div className={styles.summaryFigure}>
        <span className={styles.summaryValue}>{primary ? formatSum(primary) : '--'}</span>
        {primary && primary.reporting > 0 && (
          <span className={styles.summaryCapacity}>
            {t('quota_ledger.of_capacity', { percent: primary.reporting * 100 })}
          </span>
        )}
      </div>
      <div className={styles.segments}>
        {segments.map((percent, index) => (
          <LedgerBar
            key={index}
            percent={percent}
            className={styles.segment}
            title={`${names[index]} · ${percent === null ? '--' : `${percent}%`}`}
          />
        ))}
      </div>
      {primary && <LedgerReset at={primary.nextResetAt} nowMs={nowMs} locale={locale} />}

      {next && (
        <div className={styles.summaryMore}>
          <div className={styles.summaryLine}>
            <WindowLine total={next}>
              {rest.length > 0 && (
                <button
                  type="button"
                  className={styles.moreToggle}
                  aria-expanded={expanded}
                  aria-controls={moreId}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? t('quota_ledger.hide_windows') : t('quota_ledger.show_windows')}
                </button>
              )}
            </WindowLine>
          </div>
          {rest.length > 0 && (
            <ul id={moreId} className={styles.summaryMoreList} hidden={!expanded}>
              {rest.map((total) => (
                <li key={total.id} className={styles.summaryLine}>
                  <WindowLine total={total} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
