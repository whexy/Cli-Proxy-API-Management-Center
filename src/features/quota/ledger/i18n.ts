/**
 * Registers the ledger strings with the app's i18next instance on import.
 *
 * They live here rather than in `src/i18n/locales/*.json` so this view adds no
 * hunks to those files; a deep merge leaves every existing key untouched.
 */

import i18n from '@/i18n';
import { QUOTA_LEDGER_LOCALES } from './locales';

for (const [language, strings] of Object.entries(QUOTA_LEDGER_LOCALES)) {
  i18n.addResourceBundle(language, 'translation', { quota_ledger: strings }, true, false);
}
