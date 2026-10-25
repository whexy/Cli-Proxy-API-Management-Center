const MASK = '•••';

const maskHead = (value: string): string => (value ? `${Array.from(value)[0]}${MASK}` : value);

/** `tom@1password.dev` → `t•••@1•••.dev`; the mask never reveals the hidden length. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return email;
  const [firstLabel, ...restLabels] = email.slice(at + 1).split('.');
  return [`${maskHead(email.slice(0, at))}@${maskHead(firstLabel)}`, ...restLabels].join('.');
}
