import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { formatForecastDate } from './format';
import {
  BURN_LOOKBACK_HOURS,
  FORECAST_MODES,
  FUTURE_USAGE,
  type ForecastSettings,
  type FutureUsage,
} from './settings';
import styles from './QuotaForecast.module.scss';

interface SegmentedOption<T> {
  value: T;
  label: string;
}

/** Single choice among a few options, as a radio group with arrow-key movement. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    buttonsRef.current[next]?.focus();
  };
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface ForecastToolbarProps {
  settings: ForecastSettings;
  onChange: (patch: Partial<ForecastSettings>) => void;
  spanStartMs: number;
  spanEndMs: number;
  offsetWeeks: number;
  onOffsetChange: (offsetWeeks: number) => void;
  locale?: string;
}

export function ForecastToolbar({
  settings,
  onChange,
  spanStartMs,
  spanEndMs,
  offsetWeeks,
  onOffsetChange,
  locale,
}: ForecastToolbarProps) {
  const { t } = useTranslation();

  const modeOptions = useMemo(
    () => FORECAST_MODES.map((mode) => ({ value: mode, label: t(`quota_forecast.mode_${mode}`) })),
    [t]
  );
  const lookbackOptions = useMemo(
    () =>
      BURN_LOOKBACK_HOURS.map((hours) => ({
        value: hours,
        label: t('quota_forecast.lookback_hours', { hours }),
      })),
    [t]
  );
  const usageOptions = useMemo(
    () =>
      FUTURE_USAGE.map((usage) => ({ value: usage, label: t(`quota_forecast.future_${usage}`) })),
    [t]
  );

  // The span ends at midnight; the last day shown is the one before.
  const lastDayMs = spanEndMs - 1;

  return (
    <div className={styles.toolbar}>
      <div className={styles.controls}>
        <Segmented
          value={settings.mode}
          options={modeOptions}
          onChange={(mode) => onChange({ mode })}
          ariaLabel={t('quota_forecast.chart_label')}
        />
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">
            {t('quota_forecast.burn_label')}
          </span>
          <Segmented
            value={settings.lookbackHours}
            options={lookbackOptions}
            onChange={(lookbackHours) => onChange({ lookbackHours })}
            ariaLabel={t('quota_forecast.burn_label')}
          />
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">
            {t('quota_forecast.future_label')}
          </span>
          <div className={styles.usageSelect}>
            <Select
              value={settings.futureUsage}
              options={usageOptions}
              onChange={(next) => {
                if ((FUTURE_USAGE as readonly string[]).includes(next)) {
                  onChange({ futureUsage: next as FutureUsage });
                }
              }}
              ariaLabel={t('quota_forecast.future_label')}
              size="sm"
            />
          </div>
        </div>
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={settings.showAccounts}
          onClick={() => onChange({ showAccounts: !settings.showAccounts })}
        >
          {t('quota_forecast.accounts')}
        </button>
      </div>

      <div className={styles.range}>
        <span className={styles.rangeLabel}>
          {t('quota_forecast.range', {
            from: formatForecastDate(spanStartMs, locale),
            to: formatForecastDate(lastDayMs, locale),
          })}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t('quota_forecast.range_previous')}
          title={t('quota_forecast.range_previous')}
          onClick={() => onOffsetChange(offsetWeeks - 1)}
        >
          <IconChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.todayButton}
          disabled={offsetWeeks === 0}
          onClick={() => onOffsetChange(0)}
        >
          {t('quota_forecast.today')}
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.iconNext}`}
          aria-label={t('quota_forecast.range_next')}
          title={t('quota_forecast.range_next')}
          onClick={() => onOffsetChange(offsetWeeks + 1)}
        >
          <IconChevronLeft size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
