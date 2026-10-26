import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { ResolvedTheme } from '@/types';
import { HOUR_MS } from '@/utils/time/durations';
import { ProviderMark } from '../ledger/LedgerParts';
import type { QuotaProviderType } from '../providers/types';
import { ForecastChart } from './ForecastChart';
import { FORECAST_HORIZON_MS, type ForecastSection } from './forecastModel';
import {
  formatForecastDate,
  formatForecastDuration,
  formatForecastInstant,
  formatForecastRate,
} from './format';
import type { ForecastSettings } from './settings';
import styles from './QuotaForecast.module.scss';

/** Coverage this close to the full lookback is labelled as the lookback itself. */
const FULL_COVERAGE_RATIO = 0.9;

export interface ForecastPanelProps {
  type: QuotaProviderType;
  section: ForecastSection;
  settings: ForecastSettings;
  spanStartMs: number;
  spanEndMs: number;
  nowMs: number;
  color: string;
  resolvedTheme: ResolvedTheme;
  locale?: string;
}

export function ForecastPanel({
  type,
  section,
  settings,
  spanStartMs,
  spanEndMs,
  nowMs,
  color,
  resolvedTheme,
  locale,
}: ForecastPanelProps) {
  const { t } = useTranslation();
  const provider = getTypeLabel(t, type);
  const projected = section.projection !== null;
  const notByHorizon = t('quota_forecast.not_by', {
    date: formatForecastDate(nowMs + FORECAST_HORIZON_MS, locale),
  });
  const when = (at: number) => formatForecastInstant(at, nowMs, locale);

  const poolEmpty =
    section.poolEmptyAt !== null
      ? section.poolEmptyAt <= nowMs
        ? t('quota_forecast.now')
        : when(section.poolEmptyAt)
      : projected
        ? notByHorizon
        : '--';

  const firstEmpty = section.firstEmpty
    ? section.firstEmpty.at <= nowMs
      ? t('quota_forecast.empty_now', { name: section.firstEmpty.name })
      : t('quota_forecast.in_duration', {
          name: section.firstEmpty.name,
          duration: formatForecastDuration(section.firstEmpty.at - nowMs, t),
        })
    : projected
      ? notByHorizon
      : '--';

  const lookbackMs = settings.lookbackHours * HOUR_MS;
  const lookbackLabel = t('quota_forecast.lookback_hours', { hours: settings.lookbackHours });
  const burn = section.burn;
  const burnLabel =
    burn?.source === 'window'
      ? t('quota_forecast.stat_burn_window')
      : t('quota_forecast.stat_burn', {
          duration:
            burn && burn.coveredMs < lookbackMs * FULL_COVERAGE_RATIO
              ? formatForecastDuration(burn.coveredMs, t)
              : lookbackLabel,
        });

  const stats = [
    { key: 'pool', label: t('quota_forecast.stat_pool_empty'), value: poolEmpty },
    { key: 'first', label: t('quota_forecast.stat_first_empty'), value: firstEmpty },
    {
      key: 'reset',
      label: t('quota_forecast.stat_next_reset'),
      value: section.nextReset
        ? t('quota_forecast.reset_value', {
            gain: Math.round(section.nextReset.gain),
            time: when(section.nextReset.at),
          })
        : '--',
    },
    {
      key: 'burn',
      label: burnLabel,
      hint:
        burn?.source === 'window'
          ? t('quota_forecast.burn_window_hint', { duration: lookbackLabel })
          : undefined,
      value: burn
        ? t('quota_forecast.rate_value', { rate: formatForecastRate(burn.perHour) })
        : '--',
    },
  ];

  const poolNow = Math.round(section.poolNow);
  const summary = t('quota_forecast.chart_summary', {
    provider,
    value: poolNow,
    capacity: section.capacity,
  });

  return (
    <section
      className={styles.panel}
      aria-label={provider}
      style={{ '--series': color } as CSSProperties}
    >
      <header className={styles.panelHead}>
        <div className={styles.identity}>
          <div className={styles.titleRow}>
            <ProviderMark type={type} resolvedTheme={resolvedTheme} />
            <h3 className={styles.providerName}>{provider}</h3>
            <span className={styles.providerMeta}>
              {t('quota_forecast.accounts_count', { count: section.names.length })}
              <span aria-hidden="true"> · </span>
              {section.windowLabel}
            </span>
          </div>
          <div className={styles.hero}>
            <span className={styles.heroValue}>{poolNow}%</span>
            <span className={styles.heroCapacity}>
              {t('quota_ledger.of_capacity', { percent: section.capacity })}
            </span>
          </div>
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.key} className={styles.stat} title={stat.hint}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <ForecastChart
        section={section}
        mode={settings.mode}
        spanStartMs={spanStartMs}
        spanEndMs={spanEndMs}
        nowMs={nowMs}
        color={color}
        showAccounts={settings.showAccounts}
        summary={summary}
        locale={locale}
      />

      <footer className={styles.legend}>
        <span className={styles.legendName}>{t('quota_forecast.pool')}</span>
        <span className={styles.legendItem} title={t('quota_forecast.recorded_hint')}>
          <span className={styles.lineKey} aria-hidden="true" />
          {t('quota_forecast.recorded')}
        </span>
        {projected && (
          <span className={styles.legendItem} title={t('quota_forecast.projected_hint')}>
            <span className={`${styles.lineKey} ${styles.lineKeyDashed}`} aria-hidden="true" />
            {t('quota_forecast.projected')}
          </span>
        )}
        {settings.mode === 'remaining' && settings.showAccounts && section.names.length > 1 && (
          <span className={styles.legendItem}>
            <span className={`${styles.lineKey} ${styles.lineKeyThin}`} aria-hidden="true" />
            {t('quota_forecast.accounts')}
          </span>
        )}
      </footer>
    </section>
  );
}
