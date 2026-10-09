import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Save, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { OutageList } from '../components/outages/OutageList.js';
import { useMyAddress } from '../hooks/useMyAddress.js';
import { useOutages } from '../api/queries.js';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import type { Outage } from '@energy-monitor/shared';

/**
 * «Моя адреса»: адрес живёт в localStorage (useMyAddress), отключения тянем запросом query=адрес.
 * «Збережено» — токен success (жёсткий emerald в тёмной теме давал слабый контраст).
 */
export const MyAddressPage: React.FC = () => {
  const { t } = useTranslation();
  const { address, setAddress, clearAddress } = useMyAddress();
  const [inputVal, setInputVal] = useState(address || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

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

            <a
              href="https://cn.e-svitlo.com.ua/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center text-xs font-semibold text-primary hover:underline"
            >
              {t('myAddress.checkOnOperator')}
            </a>
          </form>
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
