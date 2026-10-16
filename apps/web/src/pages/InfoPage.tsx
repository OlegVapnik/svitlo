import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Globe, MessageCircle, Newspaper, Phone, PhoneCall, Send, Link2 } from 'lucide-react';
import { useNews, useContacts } from '../api/queries.js';
import { NewsPage } from './NewsPage';
import { StatusDot } from '../components/ui/StatusDot.js';
import { cn } from '../lib/cn.js';

/**
 * Раздел «Інфо»: новости и контакты обленерго.
 *
 * Два бывших раздела (/news и /contacts) стали сегментами одного экрана. Отдельными
 * пунктами они выглядели двумя разными приложениями, хотя отвечают на один вопрос:
 * «что происходит у оператора и куда звонить, если света нет».
 *
 * Контакты подняты выше новостей по важности: во время отключения человек ищет телефон,
 * а не ленту публикаций. Поэтому на телефоне первым идёт сегмент контактов.
 */
export const InfoPage: React.FC = () => {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  const requested = params.get('tab');
  const segment = requested === 'news' ? 'news' : 'contacts';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          <Newspaper className="mr-1.5 inline h-5 w-5 align-text-bottom text-primary" aria-hidden />
          {t('nav.info')}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('info.subtitle')}</p>
      </header>

      <div role="tablist" aria-label={t('nav.info')} className="inline-flex rounded-full border border-border bg-card p-0.5">
        {(['contacts', 'news'] as const).map((id) => {
          const active = segment === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams(id === 'contacts' ? {} : { tab: id }, { replace: true })}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {id === 'contacts' ? <PhoneCall className="h-4 w-4" aria-hidden /> : <Newspaper className="h-4 w-4" aria-hidden />}
              {id === 'contacts' ? t('nav.infoContacts') : t('nav.news')}
            </button>
          );
        })}
      </div>

      {segment === 'contacts' ? <ContactsGrid /> : <NewsPage embedded />}
    </div>
  );
};

/** Иконка по типу контакта — телефон отличается от ссылки и бота не только подписью. */
const TYPE_ICON: Record<string, typeof Phone> = {
  phone: Phone,
  telegram: Send,
  viber: MessageCircle,
  link: Link2,
};

/**
 * Телефоны вынесены в «кнопки действия» отдельно от прочих ссылок.
 *
 * Почему: номер — единственный контакт, который работает без интернета, и человек в
 * отключении набирает его с заблокированным экраном. Текстовый ряд «Кол-центр 0800…»,
 * который нужно ещё и распознавать пальцем, в такой момент бесполезен.
 */
const ContactsGrid: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useContacts();
  const contacts = data?.data ?? [];

  const phones = contacts.filter((item) => item.type === 'phone');
  const links = contacts.filter((item) => item.type !== 'phone');

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-card" aria-hidden />;
  }

  // Пустое состояние честное: «оператор не отдал контакты» и «контактов нет» — разные вещи.
  if (isError || contacts.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        {isError ? t('info.contactsError') : t('info.contactsEmpty')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {phones.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {phones.map((item) => (
            <a
              key={item.id}
              href={`tel:${item.value.replace(/[^\d+]/gu, '')}`}
              className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 transition-colors hover:bg-primary/12"
            >
              <PhoneCall className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">{item.label}</span>
                <span className="font-timer text-sm text-primary">{item.value}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {links.map((item) => {
          const Icon = TYPE_ICON[item.type] ?? Globe;
          return (
            <li key={item.id}>
              <a
                href={item.value}
                target="_blank"
                rel="noreferrer noopener"
                className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 transition-colors hover:bg-card-raised"
              >
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">{item.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.value}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusDot state="on" size="sm" />
        {t('info.contactsPublicNote')}
      </p>
    </div>
  );
};