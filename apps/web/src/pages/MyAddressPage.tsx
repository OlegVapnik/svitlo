import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Save, Search, ShieldCheck, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { Input } from '../components/ui/Input.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { OutageList } from '../components/outages/OutageList.js';
import { useMyAddress } from '../hooks/useMyAddress.js';
import { useMyQueues } from '../hooks/useMyQueues.js';
import { useRegion } from '../hooks/useRegion.js';
import { useOutages } from '../api/queries.js';
import { api, ApiError } from '../api/client.js';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import { isAccountNumber, normalizeAccountNumber } from '../lib/account.js';
import type { Outage, SubscriberPlace } from '@svitlo/shared';

/** Ключ особового рахунку в localStorage (его же чистит clearAddress). */
const ACCOUNT_KEY = 'myAccountNumber';

/** Состояние проверки рахунку: отдельные статусы вместо «одна строка с текстом». */
type AccountState =
  | { status: 'idle' }
  | { status: 'invalid' }
  | { status: 'loading' }
  | { status: 'found'; place: SubscriberPlace; used: boolean }
  | { status: 'notfound' }
  | { status: 'error' };

/**
 * «Моя адреса»: адрес живёт в localStorage (useMyAddress), отключения тянем запросом query=адрес.
 * «Збережено» — токен success (жёсткий emerald в тёмной теме давал слабый контраст).
 *
 * Особовий рахунок — способ сверить данные, а не «магическая кнопка»: справочник наполняется
 * данными оператора (apps/api/src/routes/places.ts), а за первичной проверкой ссылка ведёт
 * в кабинет оператора. Ничего не выдумываем: нет записи — так и говорим.
 */
export const MyAddressPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentRegion } = useRegion();
  const { address, setAddress, clearAddress } = useMyAddress();
  const { addQueue } = useMyQueues();
  const [inputVal, setInputVal] = useState(address || '');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [accountInput, setAccountInput] = useState(() => localStorage.getItem(ACCOUNT_KEY) || '');
  const [accountState, setAccountState] = useState<AccountState>({ status: 'idle' });

  const { data: outagesResponse, isLoading, isError, refetch } = useOutages({ query: address || undefined });

  const outages = address
    ? (outagesResponse?.data || []).map((item) => ({
        ...item,
        addressesRaw: item.addressesNormalized,
        sourceId: '',
        contentHash: '',
        firstSeenAt: item.startsAt,
        updatedAt: item.startsAt,
      })) as Outage[]
    : [];

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputVal.trim()) return;
    setAddress(inputVal.trim());
    setSavedSuccess(true);
    window.setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleClear = () => {
    clearAddress();
    setInputVal('');
    setAccountInput('');
    setAccountState({ status: 'idle' });
  };

  /** Проверка номера: валидация на клиенте, поиск в справочнике — на API (никогда не «на глазок»). */
  const checkAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const account = normalizeAccountNumber(accountInput);
    if (!isAccountNumber(account)) {
      setAccountState({ status: 'invalid' });
      return;
    }
    setAccountState({ status: 'loading' });
    try {
      const result = (await api.fetchPlace(account)) as { data: SubscriberPlace };
      localStorage.setItem(ACCOUNT_KEY, account);
      setAccountState({ status: 'found', place: result.data, used: false });
    } catch (error) {
      const notFound = error instanceof ApiError && error.status === 404;
      setAccountState({ status: notFound ? 'notfound' : 'error' });
    }
  };

  /** «Це моя адреса»: подставляем найденную вулицю та чергу в настройки (адрес + мои черги). */
  const useFoundPlace = () => {
    if (accountState.status !== 'found') return;
    const { street, queue, account } = accountState.place;
    setAddress(street);
    setInputVal(street);
    addQueue(queue);
    localStorage.setItem(ACCOUNT_KEY, account);
    localStorage.setItem('myQueueStreet', street);
    setSavedSuccess(true);
    window.setTimeout(() => setSavedSuccess(false), 2000);
    setAccountState({ status: 'found', place: accountState.place, used: true });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 pb-16 md:pb-6">
      <header className="space-y-0.5">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t('myAddress.title')}</h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{t('myAddress.description')}</p>
      </header>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="address-input" className="text-xs font-semibold text-foreground">
                {t('myAddress.inputLabel')}
              </label>
              <AddressCombobox
                id="address-input"
                value={inputVal}
                onChange={setInputVal}
                onSelect={(suggestion) => { setAddress(suggestion.name); setInputVal(suggestion.name); }}
                placeholder={t('myAddress.placeholder')}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" className="gap-1.5">
                <Save className="h-4 w-4" aria-hidden />
                {t('myAddress.save')}
              </Button>

              {address && (
                <Button type="button" variant="outline" size="sm" onClick={handleClear} className="gap-1.5 text-destructive">
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t('myAddress.clear')}
                </Button>
              )}

              {savedSuccess && (
                <span role="status" className="flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {t('myAddress.saved')}
                </span>
              )}
            </div>

            {currentRegion === 'chernihivska-oblast' && (
              <a
                href="https://cn.e-svitlo.com.ua/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline"
              >
                {t('myAddress.checkOnOperator')}
              </a>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Особовий рахунок: сверить, что приложение знает ту же вулицю/чергу. Справочник наполняется
          данными оператора; первичная проверка — по ссылке на кабинет оператора выше. */}
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="space-y-0.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              {t('myAddress.accountTitle')}
            </h2>
            <p className="text-xs text-muted-foreground">{t('myAddress.accountHint')}</p>
          </div>

          <form onSubmit={checkAccount} className="space-y-1.5">
            <label htmlFor="account-input" className="text-xs font-semibold text-foreground">{t('myAddress.accountLabel')}</label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="account-input"
                value={accountInput}
                onChange={(event) => setAccountInput(event.target.value)}
                placeholder={t('myAddress.accountPlaceholder')}
                inputMode="numeric"
                autoComplete="off"
                className="tabular h-11 min-w-0 flex-1"
              />
              <Button type="submit" size="sm" className="gap-1.5" disabled={accountState.status === 'loading'}>
                <Search className="h-4 w-4" aria-hidden />
                {accountState.status === 'loading' ? t('myAddress.accountChecking') : t('myAddress.accountCheck')}
              </Button>
            </div>
          </form>

          {accountState.status === 'invalid' && (
            <p role="alert" className="text-xs text-destructive">{t('myAddress.accountInvalid')}</p>
          )}
          {accountState.status === 'notfound' && (
            <p role="status" className="text-xs text-muted-foreground">{t('myAddress.accountNotFound')}</p>
          )}
          {accountState.status === 'error' && (
            <p role="alert" className="text-xs text-destructive">{t('myAddress.accountError')}</p>
          )}
          {accountState.status === 'found' && (
            <div className="space-y-2 rounded-2xl border border-border bg-muted/40 p-3">
              <p className="tabular text-sm font-semibold text-foreground">
                {t('myAddress.accountFound', { street: accountState.place.street, queue: accountState.place.queue })}
              </p>
              {accountState.used ? (
                <span role="status" className="flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {t('myAddress.accountUsed')}
                </span>
              ) : (
                <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={useFoundPlace}>
                  <Home className="h-4 w-4" aria-hidden />
                  {t('myAddress.accountUse')}
                </Button>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('myAddress.accountPrivacy')}</p>
        </CardContent>
      </Card>

      {address ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground sm:text-base">
              {t('myAddress.outagesFor')}: <span className="text-primary">{address}</span>
            </h2>
            <span className="tabular text-xs text-muted-foreground">{t('myAddress.found')}: {outages.length}</span>
          </div>

          <OutageList
            outages={outages}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
          />
        </section>
      ) : (
        <EmptyState icon={Home} title={t('myAddress.emptyTitle')} description={t('myAddress.emptyDesc')} />
      )}
    </div>
  );
};
