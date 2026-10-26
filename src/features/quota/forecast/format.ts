import type { TFunction } from 'i18next';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/** Beyond this a weekday alone is ambiguous, so the date is spelled out. */
const WEEKDAY_RANGE_MS = 6 * DAY_MS;

/** `2d 18h`, `15h 49m`, `40m`. */
export function formatForecastDuration(ms: number, t: TFunction): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  if (minutes >= DAY_MS / MINUTE_MS) {
    const hours = Math.floor(minutes / 60);
    return t('quota_forecast.duration_days', { days: Math.floor(hours / 24), hours: hours % 24 });
  }
  if (minutes >= HOUR_MS / MINUTE_MS) {
    return t('quota_forecast.duration_hours', {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    });
  }
  return t('quota_forecast.duration_minutes', { minutes });
}

/** `Sun 4:40 PM` within the coming week, `Nov 3, 4:40 PM` past it. */
export function formatForecastInstant(ms: number, nowMs: number, locale?: string): string {
  const options: Intl.DateTimeFormatOptions =
    Math.abs(ms - nowMs) < WEEKDAY_RANGE_MS
      ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(ms);
}

/** `Tue 27, 10:00 AM`, for a point the reader picked on the chart. */
export function formatForecastPoint(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}

/** `Nov 9`. */
export function formatForecastDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ms);
}

/** `Fri 23`, an axis day. Intl orders English `23 Fri`, so each language sets the order. */
export function formatForecastDay(ms: number, t: TFunction, locale?: string): string {
  const date = new Date(ms);
  return t('quota_forecast.axis_day', {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
    day: date.getDate(),
  });
}

/** One decimal below ten points an hour, where it still changes the reading. */
export function formatForecastRate(perHour: number): string {
  if (perHour === 0) return '0';
  return perHour < 10 ? perHour.toFixed(1) : String(Math.round(perHour));
}
