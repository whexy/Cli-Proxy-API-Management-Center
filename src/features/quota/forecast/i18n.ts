/**
 * Registers the forecast strings with the app's i18next instance on import,
 * for the same reason as `ledger/i18n.ts`.
 */

import i18n from '@/i18n';
import { QUOTA_FORECAST_LOCALES } from './locales';

for (const [language, strings] of Object.entries(QUOTA_FORECAST_LOCALES)) {
  i18n.addResourceBundle(language, 'translation', { quota_forecast: strings }, true, false);
}
