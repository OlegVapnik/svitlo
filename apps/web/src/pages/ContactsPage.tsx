import React from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, Mail, Globe, Send, MessageCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card.js';
import { Badge } from '../components/ui/Badge.js';
import { Skeleton } from '../components/ui/Skeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorState } from '../components/common/ErrorState.js';
import { useContacts } from '../api/queries.js';
import type { Contact } from '@svitlo/shared';

/**
 * Джерело даних одне — GET /api/v1/contacts (таблиця contacts, наповнюється міграцією
 * 0010_operator_contacts.sql). Раніше тут лежав FALLBACK_CONTACTS — друга копія тих самих
 * даних у коді, яка розходилася з БД і маскувала порожню таблицю (skills/outage-data-core).
 *
 * Цвета иконок — токены (success/info/primary): жёсткие blue-500/emerald-500 в тёмной теме
 * давали слабый контраст (skills/frontend-ui-change).
 */

function contactIcon(type: string) {
  if (type === 'phone') return <Phone className="h-5 w-5" aria-hidden />;
  if (type === 'email') return <Mail className="h-5 w-5" aria-hidden />;
  if (type === 'telegram') return <Send className="h-5 w-5" aria-hidden />;
  if (type === 'viber') return <MessageCircle className="h-5 w-5" aria-hidden />;
  return <Globe className="h-5 w-5" aria-hidden />;
}

function contactTone(type: string) {
  if (type === 'phone' || type === 'email') return 'bg-success/10 text-success';
  if (type === 'telegram' || type === 'viber') return 'bg-info/10 text-info';
  return 'bg-primary/10 text-primary';
}

function formatPhone(phone: string) {
  if (phone.startsWith('0800')) return `0 (800) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  if (phone.startsWith('0462')) return `0 (462) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  return phone;
}

export const ContactsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: contactsResponse, isLoading, isError, refetch } = useContacts();
  const contacts: Contact[] = contactsResponse?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('contacts.title')}</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('contacts.subtitle')}</p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : contacts.length === 0 ? (
        <EmptyState icon={Phone} title={t('contacts.emptyTitle')} description={t('contacts.emptyDesc')} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {contacts.map((contact) => {
            const isPhone = contact.type === 'phone';
            const isEmail = contact.type === 'email';
            const href = isPhone ? `tel:${contact.value}` : isEmail ? `mailto:${contact.value}` : contact.value;
            return (
              <Card key={contact.id} className="transition-colors hover:border-primary/50">
                <CardContent className="p-4 sm:p-5">
                  <a
                    href={href}
                    target={isPhone || isEmail ? '_self' : '_blank'}
                    rel="noopener noreferrer"
                    className="flex w-full items-start gap-3"
                  >
                    <span className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${contactTone(contact.type)}`}>
                      {contactIcon(contact.type)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-muted-foreground">{contact.label}</span>
                      <span className="mt-0.5 block truncate text-sm font-semibold text-foreground sm:text-base">
                        {isPhone ? formatPhone(contact.value) : contact.value}
                      </span>
                      {contact.region && <span className="mt-0.5 block text-[11px] text-muted-foreground">{contact.region}</span>}
                    </span>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </a>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-2xl border border-info/40 bg-info/5 p-4">
        <Badge variant="info">{t('contacts.hotline')}</Badge>
        <p className="text-xs text-muted-foreground">{t('contacts.sourceNote')}</p>
      </div>
    </div>
  );
};
