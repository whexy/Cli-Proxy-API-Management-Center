const MASK = '•••';

const maskHead = (value: string): string => (value ? `${Array.from(value)[0]}${MASK}` : value);

/** `tom@1password.dev` → `t•••@1•••.dev`; the mask never reveals the hidden length. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return email;
  const [firstLabel, ...restLabels] = email.slice(at + 1).split('.');
  return [`${maskHead(email.slice(0, at))}@${maskHead(firstLabel)}`, ...restLabels].join('.');
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Without a known address the local part cannot be delimited inside a filename
 * like `claude-<hash>-tom@x.dev.json`, so the fallback stops at `-`: it may leave
 * part of a hyphenated local part visible, but never the provider prefix masked
 * as if it were the address.
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/**
 * Mask every email address inside `text`, such as an auth-file name.
 *
 * Known addresses (the credential's own email) are matched exactly first, so a
 * hyphenated local part is masked whole.
 */
export function maskEmails(
  text: string,
  knownEmails: readonly (string | undefined)[] = []
): string {
  let masked = text;
  for (const email of knownEmails) {
    const trimmed = email?.trim();
    if (!trimmed || !trimmed.includes('@')) continue;
    masked = masked.replace(new RegExp(escapeRegExp(trimmed), 'gi'), (match) => maskEmail(match));
  }
  return masked.replace(EMAIL_PATTERN, (match) => maskEmail(match));
}
