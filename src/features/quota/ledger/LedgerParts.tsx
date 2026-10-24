import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import { ledgerLevel } from './ledgerModel';
import './i18n';
import styles from './QuotaLedger.module.scss';

const LEVEL_CLASS = {
  high: styles.levelHigh,
  medium: styles.levelMedium,
  low: styles.levelLow,
} as const;

/** Remaining-percent bar; an unknown figure leaves the track empty. */
export function LedgerBar({
  percent,
  className,
  title,
}: {
  percent: number | null;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={className ? `${styles.bar} ${className}` : styles.bar}
      title={title}
      aria-hidden="true"
    >
      {percent !== null && (
        <span
          className={`${styles.barFill} ${LEVEL_CLASS[ledgerLevel(percent)]}`}
          style={{ width: `${percent}%` }}
        />
      )}
    </span>
  );
}

/** `in 1 day · 09/12, 23:00`, or the no-reset note. */
export function LedgerReset({
  at,
  nowMs,
  locale,
}: {
  at: number | null;
  nowMs: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  if (at === null) {
    return <span className={styles.reset}>{t('quota_ledger.no_reset')}</span>;
  }
  const relative = formatRelativeInstant(at, nowMs, locale);
  const absolute = formatInstantShort(at);
  return (
    <span className={styles.reset} title={`${relative} · ${absolute}`}>
      <span className={styles.resetRelative}>{relative}</span>
      <span className={styles.resetDot} aria-hidden="true">
        ·
      </span>
      <span className={styles.resetAbsolute}>{absolute}</span>
    </span>
  );
}

export function ProviderMark({
  type,
  resolvedTheme,
}: {
  type: string;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  return (
    <span
      className={styles.mark}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
      aria-hidden="true"
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.markIcon} />
      ) : (
        <span className={styles.markFallback}>
          {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
