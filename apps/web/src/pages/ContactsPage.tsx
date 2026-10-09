import React from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, Mail, Globe, Send, MessageCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card.js';
import { useContacts } from '../api/queries.js';
import type { Contact } from '@energy-monitor/shared';

export const ContactsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data: contactsResponse, isLoading } = useContacts();

  const contacts: Contact[] = contactsResponse?.data?.length ? contactsResponse.data : [
    {
      id: '1',
      type: 'phone',
      label: 'Кол-центр (безкоштовно по Україні)',
      value: '0800210310',
      region: 'Чернігівська область',
    },
    {
      id: '2',
      type: 'phone',
      label: 'Міський телефон Чернігів',
      value: '0462772901',
      region: 'Чернігів',
    },
    {
      id: '3',
      type: 'telegram',
      label: 'Telegram-канал з новинами',
      value: 'https://t.me/chernigivoblenergo',
      region: null,
    },
    {
      id: '4',
      type: 'telegram',
      label: 'Telegram-бот для перевірки черги',
      value: 'https://t.me/ChernigivOEbot',
      region: null,
    },
    {
      id: '5',
      type: 'viber',
      label: 'Viber-бот АТ «Чернігівобленерго»',
      value: 'https://chernihivoblenergo.com.ua/in_viber',
      region: null,
    },
    {
      id: '6',
      type: 'link',
      label: 'Офіційний сайт',
      value: 'https://chernihivoblenergo.com.ua',
      region: null,
    },
    {
      id: '7',
      type: 'link',
      label: 'Онлайн-звернення споживачів',
      value: 'https://chernihivoblenergo.com.ua/feedback_new',
      region: null,
    },
  ];

  const getContactIcon = (type: string) => {
    switch (type) {
      case 'phone':
        return <Phone className="w-5 h-5 text-blue-500" />;
      case 'email':
        return <Mail className="w-5 h-5 text-emerald-500" />;
      case 'telegram':
        return <Send className="w-5 h-5 text-sky-500" />;
      case 'viber':
        return <MessageCircle className="w-5 h-5 text-purple-500" />;
      default:
        return <Globe className="w-5 h-5 text-primary" />;
    }
  };

  const formatPhone = (phone: string) => {
    if (phone.startsWith('0800')) {
      return `0 (800) ${phone.slice(4, 7)}-${phone.slice(7)}`;
    }
    if (phone.startsWith('0462')) {
      return `0 (462) ${phone.slice(4, 7)}-${phone.slice(7)}`;
    }
    return phone;
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {t('contacts.title', 'Контакти підтримки')}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          Офіційні канали зв'язку АТ «Чернігівобленерго» для довідок та аварійних повідомлень
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {contacts.map((contact) => {
          const isPhone = contact.type === 'phone';
          const isEmail = contact.type === 'email';
          const href = isPhone
            ? `tel:${contact.value}`
            : isEmail
            ? `mailto:${contact.value}`
            : contact.value;

          return (
            <Card
              key={contact.id}
              className="hover:border-primary/50 transition-all cursor-pointer group"
            >
              <CardContent className="p-4">
                <a
                  href={href}
                  target={isPhone || isEmail ? '_self' : '_blank'}
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 w-full"
                >
                  <div className="p-2.5 rounded-xl bg-muted/60 shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                    {getContactIcon(contact.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground font-medium">
                      {contact.label}
                    </div>
                    <div className="text-sm sm:text-base font-semibold text-foreground truncate mt-0.5 group-hover:text-primary transition-colors">
                      {isPhone ? formatPhone(contact.value) : contact.value}
                    </div>
                    {contact.region && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {contact.region}
                      </div>
                    )}
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
                </a>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};