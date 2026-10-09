import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, Save, Trash2, Search, ZapOff, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Card, CardContent } from '../components/ui/Card.js';
import { OutageList } from '../components/outages/OutageList.js';
import { useMyAddress } from '../hooks/useMyAddress.js';
import { useOutages } from '../api/queries.js';
import { AddressCombobox } from '../components/search/AddressCombobox.js';
import type { Outage } from '@energy-monitor/shared';

export const MyAddressPage: React.FC = () => {
  const { t } = useTranslation();
  const { address, setAddress, clearAddress } = useMyAddress();
  const [inputVal, setInputVal] = useState(address || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Fetch outages filtered by the saved address
  const { data: outagesResponse, isLoading, isError, refetch } = useOutages({
    query: address || undefined,
  });

  const outages = address ? (outagesResponse?.data || []).map((item) => ({
    ...item,
    addressesRaw: item.addressesNormalized,
    sourceId: '',
    contentHash: '',
    firstSeenAt: item.startsAt,
    updatedAt: item.startsAt,
  })) as Outage[] : [];

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      setAddress(inputVal.trim());
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    }
  };

  const handleClear = () => {
    clearAddress();
    setInputVal('');
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-16 md:pb-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
          {t('myAddress.title', 'Мій адрес')}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
          {t(
            'myAddress.description',
            'Збережіть свою адресу, щоб миттєво бачити актуальні відключення саме для вашого будинку',
          )}
        </p>
      </div>

      {/* Address Input Form */}
      <Card>
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleSave} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="address-input" className="text-xs font-semibold text-foreground">
                Ваша адреса (вулиця, номер будинку, населений пункт)
              </label>
              <AddressCombobox
                id="address-input"
                value={inputVal}
                onChange={setInputVal}
                onSelect={(suggestion) => { setAddress(suggestion.name); setInputVal(suggestion.name); }}
                placeholder="Наприклад: Деснянська"
              />
            </div>

            <a href="https://cn.e-svitlo.com.ua/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline">Перевірити на сайті оператора</a>
            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" size="sm" className="gap-1.5 text-xs">
                <Save className="w-3.5 h-3.5" />
                <span>Зберегти адресу</span>
              </Button>

              {address && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Видалити</span>
                </Button>
              )}

              {savedSuccess && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Збережено!
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Outage status for address */}
      {address ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Відключення за адресою: <span className="text-primary font-bold">{address}</span>
            </h2>
            <span className="text-xs text-muted-foreground">
              Знайдено: {outages.length}
            </span>
          </div>

          <OutageList
            outages={outages}
            isLoading={isLoading}
            isError={isError}
            onRetry={() => refetch()}
          />
        </div>
      ) : (
        <div className="p-8 rounded-2xl border border-dashed border-border bg-card/50 text-center space-y-2">
          <Home className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="font-semibold text-sm text-foreground">Адреса ще не вказана</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Введіть назву населеного пункту та вулиці вище, щоб відслідковувати відключення автоматично
          </p>
        </div>
      )}
    </div>
  );
};