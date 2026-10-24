export const QUOTA_VIEWS = ['ledger', 'cards'] as const;

export type QuotaView = (typeof QUOTA_VIEWS)[number];

export const DEFAULT_QUOTA_VIEW: QuotaView = 'ledger';

const QUOTA_VIEW_SET = new Set<string>(QUOTA_VIEWS);

export const isQuotaView = (value: unknown): value is QuotaView =>
  typeof value === 'string' && QUOTA_VIEW_SET.has(value);
