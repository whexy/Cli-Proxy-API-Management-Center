import { useId, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { getTypeLabel } from '@/features/authFiles/constants';
import { isDisabledAuthFile, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { bindQuotaClasses, type QuotaClassMap } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import type { QuotaProviderType } from '../providers/types';
import type { LedgerColumn, LedgerQuota, LedgerWindow } from './ledgerModel';
import { LedgerBar, LedgerReset } from './LedgerParts';
import bodyStyles from '../components/QuotaBody.module.scss';
import styles from './QuotaLedger.module.scss';

/** Wider sections always stack; see the breakpoints in QuotaLedger.module.scss. */
const MAX_INLINE_COLUMNS = 8;

/* Bound on first use: only rows without percentage windows render a body. */
let bodyClasses: QuotaClassMap | null = null;
const getBodyClasses = (): QuotaClassMap => {
  bodyClasses ??= bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');
  return bodyClasses;
};

function LedgerCell({
  window,
  nowMs,
  locale,
}: {
  window: LedgerWindow | undefined;
  nowMs: number;
  locale?: string;
}) {
  if (!window) return <div className={styles.cell} />;
  const percent = window.remainingPercent === null ? null : Math.round(window.remainingPercent);
  return (
    <div className={styles.cell}>
      <div className={styles.cellHead}>
        <span className={styles.cellLabel} title={window.label}>
          {window.label}
        </span>
        <span
          className={
            percent === null ? `${styles.cellPercent} ${styles.cellUnknown}` : styles.cellPercent
          }
        >
          {percent === null ? '--' : `${percent}%`}
        </span>
      </div>
      <LedgerBar percent={percent} />
      <LedgerReset at={window.resetAt} nowMs={nowMs} locale={locale} />
    </div>
  );
}

interface LedgerRowProps {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  ledger: LedgerQuota | null;
  columns: LedgerColumn[];
  name: string;
  canRefresh: boolean;
  resetting: boolean;
  nowMs: number;
  locale?: string;
  onRefresh: () => void;
}

function LedgerRow({
  entry,
  quota,
  ledger,
  columns,
  name,
  canRefresh,
  resetting,
  nowMs,
  locale,
  onRefresh,
}: LedgerRowProps) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const disabled = isDisabledAuthFile(entry.file);
  const errorMessage =
    status === 'error'
      ? t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })
      : null;

  const action =
    !disabled && status !== 'idle' ? (
      <button
        type="button"
        className={styles.refreshAction}
        onClick={onRefresh}
        disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
        title={t('auth_files.quota_refresh_hint')}
      >
        <IconRefreshCw
          size={13}
          aria-hidden="true"
          className={loading || resetting ? styles.spinning : undefined}
        />
        {status === 'error' ? t('quota_ledger.retry') : t('auth_files.quota_refresh_single')}
      </button>
    ) : null;

  // Rows without a state show one cell per window column.
  let state: ReactNode = null;
  if (disabled) {
    state = <div className={styles.state}>{t('quota_ledger.disabled')}</div>;
  } else if (ledger && ledger.windows.length === 0 && quota) {
    state = (
      <div className={`${styles.state} ${styles.fallback}`}>
        <adapter.Body quota={quota} classes={getBodyClasses()} />
      </div>
    );
  } else if (!ledger && status === 'idle') {
    state = (
      <button
        type="button"
        className={styles.loadAction}
        onClick={onRefresh}
        disabled={!canRefresh}
      >
        <IconRefreshCw size={14} aria-hidden="true" />
        {t('quota_ledger.load_quota')}
      </button>
    );
  } else if (!ledger && loading) {
    state = (
      <div className={`${styles.state} ${styles.stateSkeleton}`} aria-busy="true">
        <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
        {(columns.length > 0 ? columns : [null]).map((column, index) => (
          <div key={column?.id ?? index} className={styles.skeletonCell} aria-hidden="true">
            <Skeleton height={12} width="70%" rounded={4} />
            <Skeleton height={4} rounded={999} />
          </div>
        ))}
      </div>
    );
  } else if (!ledger) {
    state = <div className={`${styles.state} ${styles.stateError}`}>{errorMessage}</div>;
  }

  const byId = new Map(ledger?.windows.map((window) => [window.id, window]));

  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        {ledger?.plan && <span className={styles.plan}>{ledger.plan}</span>}
        {/* Claude keeps its last observation through a failed read; say it is stale. */}
        {ledger && errorMessage && (
          <span className={styles.rowError} title={errorMessage}>
            {errorMessage}
          </span>
        )}
      </div>
      {state ? (
        // A state spans every window column and the action column, so a long
        // message is not squeezed into one window's width.
        <div className={styles.stateRow}>
          {state}
          {action}
        </div>
      ) : (
        <>
          <div className={styles.cells}>
            {columns.map((column) => (
              <LedgerCell
                key={column.id}
                window={byId.get(column.id)}
                nowMs={nowMs}
                locale={locale}
              />
            ))}
          </div>
          <div className={styles.action}>{action}</div>
        </>
      )}
    </li>
  );
}

export interface LedgerSectionProps {
  type: QuotaProviderType;
  entries: QuotaFileEntry[];
  quotas: (QuotaCardState | undefined)[];
  ledgers: (LedgerQuota | null)[];
  columns: LedgerColumn[];
  names: string[];
  canRefresh: boolean;
  resettingKey: string | null;
  nowMs: number;
  locale?: string;
  onRefresh: (entry: QuotaFileEntry) => void;
}

export function LedgerSection({
  type,
  entries,
  quotas,
  ledgers,
  columns,
  names,
  canRefresh,
  resettingKey,
  nowMs,
  locale,
  onRefresh,
}: LedgerSectionProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const tableStyle = { '--ledger-columns': Math.max(1, columns.length) } as CSSProperties;

  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      data-columns={columns.length > MAX_INLINE_COLUMNS ? 'many' : Math.max(1, columns.length)}
    >
      <h2 className={styles.sectionHeading} id={headingId}>
        {getTypeLabel(t, type)}
        <span className={styles.sectionCount}>{entries.length}</span>
      </h2>
      <ul className={styles.rows} style={tableStyle}>
        {entries.map((entry, index) => {
          const key = getQuotaCacheKey(entry.file);
          return (
            <LedgerRow
              key={key}
              entry={entry}
              quota={quotas[index]}
              ledger={ledgers[index]}
              columns={columns}
              name={names[index]}
              canRefresh={canRefresh && !isDisabledAuthFile(entry.file)}
              resetting={resettingKey === key}
              nowMs={nowMs}
              locale={locale}
              onRefresh={() => onRefresh(entry)}
            />
          );
        })}
      </ul>
    </section>
  );
}
