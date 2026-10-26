import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { QUOTA_VIEWS, isQuotaView, type QuotaView } from './constants';
import './i18n';
import styles from './QuotaLedger.module.scss';

export function QuotaViewSelect({
  value,
  onChange,
}: {
  value: QuotaView;
  onChange: (view: QuotaView) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () => QUOTA_VIEWS.map((view) => ({ value: view, label: t(`quota_ledger.view_${view}`) })),
    [t]
  );
  return (
    <div className={styles.viewSelect}>
      <Select
        value={value}
        options={options}
        onChange={(next) => {
          if (isQuotaView(next)) onChange(next);
        }}
        ariaLabel={t('quota_ledger.view_label')}
        size="sm"
      />
    </div>
  );
}

export function ShowEmailsToggle({
  pressed,
  onChange,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={styles.emailToggle}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      {t('quota_ledger.show_emails')}
    </button>
  );
}
