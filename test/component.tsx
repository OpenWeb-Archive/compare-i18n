import { useTranslation, Trans } from 'react-i18next';

export default function MyComponent() {
  const { t } = useTranslation();

  t('My test');

  return (
    <Trans i18nKey="userMessagesUnread" count={count}>
      Hello <strong title={t('nameTitle')}>{{name}}</strong>, you have {{count}} unread message. <Link to="/msgs">Go to messages</Link>.
    </Trans>
  );
}
