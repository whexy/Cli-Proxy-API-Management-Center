import type { AuthFileItem } from '@/types';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { maskEmail } from './maskEmail';

/** Names the account, not the file: the section heading already names the provider. */
export function ledgerCredentialName(file: AuthFileItem, showEmails: boolean): string {
  const email = file.email?.trim();
  if (email) return showEmails ? email : maskEmail(email);
  return normalizeRecentRequestAuthIndex(file.authIndex) ?? file.name;
}
