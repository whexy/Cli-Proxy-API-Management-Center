import { describe, expect, test } from 'bun:test';
import { ledgerCredentialName } from '@/features/quota/ledger/credentialName';
import { maskEmail } from '@/features/quota/ledger/maskEmail';

describe('maskEmail', () => {
  test('keeps the first character of the local part and of the first domain label', () => {
    expect(maskEmail('tom@1password.dev')).toBe('t•••@1•••.dev');
    expect(maskEmail('a@b.co.uk')).toBe('a•••@b•••.co.uk');
  });

  test('leaves strings that are not addresses alone', () => {
    expect(maskEmail('no-at-sign')).toBe('no-at-sign');
    expect(maskEmail('@example.com')).toBe('@example.com');
    expect(maskEmail('trailing@')).toBe('trailing@');
  });
});

describe('ledgerCredentialName', () => {
  const meta = {
    name: 'meta-tom_1password.dev-a1f4163ac0042caa.json',
    type: 'meta',
    email: 'tom@1password.dev',
    authIndex: '5be1d0c9e2f7a3b4',
  };

  test('shows only the email, masked unless emails are shown', () => {
    expect(ledgerCredentialName(meta, false)).toBe('t•••@1•••.dev');
    expect(ledgerCredentialName(meta, true)).toBe('tom@1password.dev');
  });

  test('shows the auth index when the account has no email', () => {
    const free = { name: 'opencode-free.json', email: '  ', authIndex: '70c754523128b440' };
    expect(ledgerCredentialName(free, false)).toBe('70c754523128b440');
    expect(ledgerCredentialName({ ...free, authIndex: 7 }, true)).toBe('7');
  });

  test('falls back to the file name without an email or auth index', () => {
    expect(ledgerCredentialName({ name: 'kimi-0a1b2c.json', authIndex: null }, false)).toBe(
      'kimi-0a1b2c.json'
    );
  });
});
