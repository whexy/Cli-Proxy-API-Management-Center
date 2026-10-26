import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/hooks/useNow';
import { useAuthStore } from '@/stores';
import type { ResolvedTheme } from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { HOUR_MS } from '@/utils/time/durations';
import { QUOTA_TAB_ORDER } from '../constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { ledgerCredentialName } from '../ledger/credentialName';
import { normalizeLedgerQuota } from '../ledger/ledgerModel';
import { ForecastPanel } from './ForecastPanel';
import { ForecastToolbar } from './ForecastToolbar';
import { buildForecastSection, forecastSpan } from './forecastModel';
import { historyCredentialKey, type QuotaSample } from './history';
import { FUTURE_USAGE_FACTOR, MAX_BURN_LOOKBACK_HOURS, useForecastSettings } from './settings';
import { useQuotaHistory } from './useQuotaHistory';
import './i18n';
import styles from './QuotaForecast.module.scss';

const SKELETON_PANEL_COUNT = 2;

export interface QuotaForecastProps {
  /** The tab's credentials; each provider's enabled ones form its pool. */
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  showEmails: boolean;
}

export function QuotaForecast({
  entries,
  quotaFor,
  resolvedTheme,
  showEmails,
}: QuotaForecastProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const nowMs = useNow();
  const [settings, updateSettings] = useForecastSettings();
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const { startMs: spanStartMs, endMs: spanEndMs } = forecastSpan(offsetWeeks, nowMs);

  const scope = useAuthStore((state) => state.apiBase);
  const samples = useQuotaHistory(scope, spanStartMs - MAX_BURN_LOOKBACK_HOURS * HOUR_MS);
  const samplesByCredential = useMemo(() => {
    const byCredential = new Map<string, QuotaSample[]>();
    samples.forEach((sample) => {
      const list = byCredential.get(sample.credential) ?? [];
      list.push(sample);
      byCredential.set(sample.credential, list);
    });
    return byCredential;
  }, [samples]);

  const panels = useMemo(
    () =>
      QUOTA_TAB_ORDER.flatMap((type) => {
        const group = entries.filter((entry) => entry.type === type && !entry.file.disabled);
        if (group.length === 0) return [];
        const section = buildForecastSection(
          group.map((entry) => ({
            name: ledgerCredentialName(entry.file, showEmails),
            ledger: normalizeLedgerQuota(entry.type, quotaFor(entry), t),
            samples:
              samplesByCredential.get(
                historyCredentialKey(entry.type, getQuotaCacheKey(entry.file))
              ) ?? [],
          })),
          {
            nowMs,
            spanStartMs,
            spanEndMs,
            lookbackHours: settings.lookbackHours,
            usageFactor: FUTURE_USAGE_FACTOR[settings.futureUsage],
          }
        );
        return section ? [{ type, section }] : [];
      }),
    [
      entries,
      nowMs,
      quotaFor,
      samplesByCredential,
      settings.futureUsage,
      settings.lookbackHours,
      showEmails,
      spanEndMs,
      spanStartMs,
      t,
    ]
  );

  const waiting =
    panels.length === 0 &&
    entries.some((entry) => {
      const status = (quotaFor(entry) as { status?: string } | undefined)?.status;
      return !entry.file.disabled && (status === undefined || status === 'loading');
    });

  return (
    <div className={styles.forecast}>
      <ForecastToolbar
        settings={settings}
        onChange={updateSettings}
        spanStartMs={spanStartMs}
        spanEndMs={spanEndMs}
        offsetWeeks={offsetWeeks}
        onOffsetChange={setOffsetWeeks}
        locale={locale}
      />
      {waiting ? (
        <QuotaForecastSkeleton panels={SKELETON_PANEL_COUNT} />
      ) : panels.length === 0 ? (
        <EmptyState
          title={t('quota_forecast.empty_title')}
          description={t('quota_forecast.empty_desc')}
        />
      ) : (
        panels.map(({ type, section }) => {
          const colors = TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
          const color =
            resolvedTheme === 'dark' && colors.dark ? colors.dark.text : colors.light.text;
          return (
            <ForecastPanel
              key={type}
              type={type}
              section={section}
              settings={settings}
              spanStartMs={spanStartMs}
              spanEndMs={spanEndMs}
              nowMs={nowMs}
              color={color}
              resolvedTheme={resolvedTheme}
              locale={locale}
            />
          );
        })
      )}
    </div>
  );
}

export function QuotaForecastSkeleton({ panels = SKELETON_PANEL_COUNT }: { panels?: number }) {
  return (
    <div className={styles.forecast} aria-hidden="true">
      {Array.from({ length: panels }, (_, index) => (
        <div key={index} className={styles.panel}>
          <Skeleton height={16} width="22%" rounded={4} />
          <Skeleton height={44} width="18%" rounded={6} />
          <Skeleton height={260} rounded={10} />
        </div>
      ))}
    </div>
  );
}
