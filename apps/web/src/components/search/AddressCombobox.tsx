import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../api/client';

type Suggestion = { id: string; type: 'district' | 'street' | 'settlement'; name: string; subtitle: string; matchedText: string; nameUk: string; nameRu: string | null; city: string | null };
type Props = { value: string; onChange: (value: string) => void; onSelect: (suggestion: Suggestion) => void; placeholder?: string; id?: string };

export function AddressCombobox({ value, onChange, onSelect, placeholder, id }: Props) {
  const generatedId = useId();
  const inputId = id ?? `address-combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = value.trim();
    setItems([]);
    setActive(-1);
    setSearched(false);
    if (query.length < 2) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.suggestAddresses(query, 8, controller.signal) as { data: Suggestion[] };
        setItems(response.data);
        setSearched(true);
        setOpen(true);
      } catch (error) {
        if (!controller.signal.aborted) { setItems([]); setSearched(true); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const choose = (item: Suggestion) => { onChange(item.name); onSelect(item); setOpen(false); setActive(-1); };
  const move = (delta: number) => setActive((index) => Math.max(0, Math.min(items.length - 1, index + delta)));

  return <div className="relative z-30" ref={rootRef}>
    <input
      id={inputId}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={active >= 0 ? `${listId}-option-${active}` : undefined}
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      onFocus={() => { if (items.length || loading || searched) setOpen(true); }}
      onChange={(event) => { onChange(event.target.value); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); move(1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
        else if (event.key === 'Enter' && open && active >= 0 && items[active]) { event.preventDefault(); choose(items[active]!); }
        else if (event.key === 'Escape') setOpen(false);
      }}
      className="h-11 w-full rounded-lg border-border bg-background px-3 text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
    />
    {/* Список — непрозрачная popover-поверхность из токенов. Никаких inline-цветов:
        bg-popover/border-border объявлены и в tailwind.config.ts, и в globals.css,
        иначе классы молча не срабатывают и текст пропадает на фоне страницы. */}
    {open && value.trim().length >= 2 && <div
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl"
      role="presentation"
    >
      {loading && <div className="px-4 py-3 text-sm text-muted-foreground" role="status">Шукаємо адресу…</div>}
      {!loading && searched && items.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">Нічого не знайдено</div>}
      {!loading && items.length > 0 && <ul id={listId} role="listbox" className="py-1">
        {items.map((item, index) => <li
          id={`${listId}-option-${index}`}
          key={item.id}
          role="option"
          aria-selected={active === index}
          onMouseEnter={() => setActive(index)}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => choose(item)}
          className={`flex min-h-11 cursor-pointer flex-col justify-center px-4 py-2 text-sm ${active === index ? 'bg-primary/10' : 'hover:bg-muted'}`}
        ><span className="font-medium">{highlight(item.name, item.matchedText)}</span><span className="text-xs text-muted-foreground">{item.subtitle}</span></li>)}
      </ul>}
    </div>}
  </div>;
}

function highlight(name: string, query: string) {
  const at = name.toLocaleLowerCase('uk-UA').indexOf(query.toLocaleLowerCase('uk-UA'));
  if (at < 0 || !query) return name;
  return <>{name.slice(0, at)}<mark className="rounded bg-primary/20 text-inherit">{name.slice(at, at + query.length)}</mark>{name.slice(at + query.length)}</>;
}
