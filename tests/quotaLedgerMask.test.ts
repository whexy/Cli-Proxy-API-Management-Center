import { describe, expect, test } from 'bun:test';
import { maskEmail, maskEmails } from '@/features/quota/ledger/maskEmail';

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

describe('maskEmails', () => {
  test('masks the address inside an auth-file name, not the provider prefix', () => {
    expect(maskEmails('claude-tom@1password.dev.json')).toBe('claude-t•••@1•••.dev.json');
    expect(maskEmails('claude-8f3a1c-mia@acme.io.json')).toBe('claude-8f3a1c-m•••@a•••.io.json');
  });

  test('masks a known address whole, including a hyphenated local part', () => {
    expect(maskEmails('codex-john-doe@gmail.com-plus.json', ['john-doe@gmail.com'])).toBe(
      'codex-j•••@g•••.com-plus.json'
    );
    expect(maskEmails('xai-Zoe@Grok.fan.json', ['zoe@grok.fan'])).toBe('xai-Z•••@G•••.fan.json');
  });

  test('masks addresses appended to a display name', () => {
    expect(maskEmails('devin.json · ana@team.io', [undefined])).toBe('devin.json · a•••@t•••.io');
  });

  test('leaves names without an address unchanged', () => {
    expect(maskEmails('kimi-0a1b2c.json', ['', 'not-an-email'])).toBe('kimi-0a1b2c.json');
  });
});
