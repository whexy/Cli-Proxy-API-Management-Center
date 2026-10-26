import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { CHART_HEIGHT, buildChartGeometry, instantAtX, readoutAt } from './chartGeometry';
import type { ForecastSection } from './forecastModel';
import {
  formatForecastDay,
  formatForecastInstant,
  formatForecastPoint,
  formatForecastRate,
} from './format';
import type { ForecastMode } from './settings';
import styles from './QuotaForecast.module.scss';

const DEFAULT_WIDTH = 960;
const MIN_WIDTH = 320;
/** Room the tooltip needs right of the crosshair before it flips to the left. */
const TOOLTIP_SPACE = 240;
/** Keep an edge label this far from the plot edge before re-anchoring it. */
const EDGE_LABEL_SPACE = 90;

export interface ForecastChartProps {
  section: ForecastSection;
  mode: ForecastMode;
  spanStartMs: number;
  spanEndMs: number;
  nowMs: number;
  /** Series colour for the provider. */
  color: string;
  showAccounts: boolean;
  /** Accessible summary of what the chart shows. */
  summary: string;
  locale?: string;
}

export function ForecastChart({
  section,
  mode,
  spanStartMs,
  spanEndMs,
  nowMs,
  color,
  showAccounts,
  summary,
  locale,
}: ForecastChartProps) {
  const { t } = useTranslation();
  const gradientId = useId();
  const clipId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [hoverAt, setHoverAt] = useState<number | null>(null);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setWidth(Math.max(MIN_WIDTH, Math.round(node.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(
    () =>
      buildChartGeometry({
        section,
        mode,
        spanStartMs,
        spanEndMs,
        nowMs,
        width,
        showAccounts,
      }),
    [mode, nowMs, section, showAccounts, spanEndMs, spanStartMs, width]
  );
  const { plot } = geometry;
  const xOf = (at: number) =>
    plot.left + ((at - spanStartMs) / (spanEndMs - spanStartMs)) * (plot.right - plot.left);
  const yOf = (value: number) =>
    plot.bottom -
    (Math.min(Math.max(value, 0), geometry.yMax) / geometry.yMax) * (plot.bottom - plot.top);

  const formatValue = (value: number) =>
    mode === 'remaining'
      ? `${Math.round(value)}%`
      : t('quota_forecast.rate_value', { rate: formatForecastRate(value) });

  const readout = hoverAt === null ? null : readoutAt(section, mode, hoverAt, nowMs);
  const hoverX = hoverAt === null ? null : xOf(hoverAt);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverAt(instantAtX(event.clientX - rect.left, plot, spanStartMs, spanEndMs, nowMs));
  };

  const clampToSpan = (at: number) => Math.min(spanEndMs, Math.max(spanStartMs, at));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DAY_MS : HOUR_MS;
    const from = hoverAt ?? clampToSpan(nowMs);
    let next: number | null;
    if (event.key === 'ArrowLeft') next = clampToSpan(from - step);
    else if (event.key === 'ArrowRight') next = clampToSpan(from + step);
    else if (event.key === 'Home') next = spanStartMs;
    else if (event.key === 'End') next = spanEndMs;
    else if (event.key === 'Escape') next = null;
    else return;
    event.preventDefault();
    setHoverAt(next);
  };

  const showAccountReadout = mode === 'remaining' && showAccounts && section.names.length > 1;
  const emptyAnchor = (x: number) =>
    x > plot.right - EDGE_LABEL_SPACE
      ? 'end'
      : x < plot.left + EDGE_LABEL_SPACE
        ? 'start'
        : 'middle';

  return (
    <div
      ref={wrapRef}
      className={styles.chart}
      style={{ '--series': color } as CSSProperties}
      tabIndex={0}
      role="group"
      aria-label={summary}
      onFocus={() => setHoverAt((current) => current ?? clampToSpan(nowMs))}
      onBlur={() => setHoverAt(null)}
      onKeyDown={handleKeyDown}
    >
      <svg
        className={styles.chartSvg}
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverAt(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect
              x={plot.left}
              y={plot.top - 2}
              width={plot.right - plot.left}
              height={plot.bottom - plot.top + 4}
            />
          </clipPath>
        </defs>

        <g className={styles.gridLines}>
          {geometry.yTicks.map((tick) => (
            <line key={tick.value} x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />
          ))}
          {geometry.days.map((day) =>
            day.lineX === null ? null : (
              <line key={day.at} x1={day.lineX} x2={day.lineX} y1={plot.top} y2={plot.bottom} />
            )
          )}
        </g>

        <g className={styles.axisText}>
          {geometry.yTicks.map((tick) => (
            <text key={tick.value} x={plot.left - 10} y={tick.y} textAnchor="end" dy="0.32em">
              {formatValue(tick.value)}
            </text>
          ))}
          {geometry.days.map((day) =>
            day.labelled ? (
              <text key={day.at} x={day.labelX} y={CHART_HEIGHT - 8} textAnchor="middle">
                {formatForecastDay(day.at, t, locale)}
              </text>
            ) : null
          )}
        </g>

        <g clipPath={`url(#${clipId})`}>
          <path d={geometry.recordedArea} fill={`url(#${gradientId})`} />
          <path d={geometry.projectedArea} fill={`url(#${gradientId})`} opacity={0.55} />
          {geometry.accountLines.map((line, index) => (
            <g key={index} className={styles.accountLine}>
              <path d={line.recorded} />
              <path d={line.projected} className={styles.dashed} />
            </g>
          ))}
          <path d={geometry.recordedLine} className={styles.seriesLine} />
          <path d={geometry.projectedLine} className={`${styles.seriesLine} ${styles.dashed}`} />
        </g>

        <g className={styles.markText}>
          {geometry.jumps.map((jump) => (
            <text key={`${jump.x}:${jump.y}`} x={jump.x} y={jump.y} textAnchor="middle">
              +{jump.gain}%
            </text>
          ))}
        </g>

        {geometry.now && (
          <g>
            <line
              className={styles.nowLine}
              x1={geometry.now.x}
              x2={geometry.now.x}
              y1={plot.top - 6}
              y2={plot.bottom}
            />
            <text
              className={styles.markText}
              x={geometry.now.x}
              y={plot.top - 12}
              textAnchor="middle"
            >
              {t('quota_forecast.now')}
            </text>
            {geometry.now.y !== null && (
              <circle className={styles.nowDot} cx={geometry.now.x} cy={geometry.now.y} r={4} />
            )}
          </g>
        )}

        {geometry.empty && (
          <g>
            <text
              className={styles.emptyText}
              x={geometry.empty.x}
              y={geometry.empty.y - 14}
              textAnchor={emptyAnchor(geometry.empty.x)}
            >
              {t('quota_forecast.empty_at', {
                time: formatForecastInstant(geometry.empty.at, nowMs, locale),
              })}
            </text>
            <circle className={styles.emptyDot} cx={geometry.empty.x} cy={geometry.empty.y} r={5} />
          </g>
        )}

        {hoverX !== null && readout && (
          <g pointerEvents="none">
            <line
              className={styles.crosshair}
              x1={hoverX}
              x2={hoverX}
              y1={plot.top}
              y2={plot.bottom}
            />
            {readout.value !== null && (
              <circle className={styles.nowDot} cx={hoverX} cy={yOf(readout.value)} r={4} />
            )}
          </g>
        )}
      </svg>

      {hoverX !== null && readout && hoverAt !== null && (
        <div
          className={styles.tooltip}
          role="status"
          style={{
            left: hoverX + (hoverX + TOOLTIP_SPACE > width ? -12 : 12),
            top: plot.top,
            transform: hoverX + TOOLTIP_SPACE > width ? 'translateX(-100%)' : undefined,
          }}
        >
          <div className={styles.tooltipHead}>
            <span>{formatForecastPoint(hoverAt, locale)}</span>
            <span>
              {readout.kind === 'recorded'
                ? t('quota_forecast.recorded')
                : t('quota_forecast.projected')}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span
              className={
                readout.kind === 'projected'
                  ? `${styles.lineKey} ${styles.lineKeyDashed}`
                  : styles.lineKey
              }
              aria-hidden="true"
            />
            <span className={styles.tooltipValue}>
              {readout.value === null ? '--' : formatValue(readout.value)}
            </span>
            <span className={styles.tooltipName}>{t('quota_forecast.pool')}</span>
          </div>
          {/* Top band first, as the accounts stack on the chart. */}
          {showAccountReadout &&
            section.names
              .map((name, index) => ({ name, value: readout.accounts[index], index }))
              .reverse()
              .map(({ name, value, index }) => {
                return (
                  <div key={index} className={styles.tooltipRow}>
                    <span
                      className={`${styles.lineKey} ${styles.lineKeyThin}`}
                      aria-hidden="true"
                    />
                    <span className={styles.tooltipValue}>
                      {value === null ? '--' : `${Math.round(value)}%`}
                    </span>
                    <span className={styles.tooltipName}>{name}</span>
                  </div>
                );
              })}
        </div>
      )}
    </div>
  );
}
