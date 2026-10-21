-- Контакти АТ «Чернігівобленерго» з відкритих джерел оператора (сторінки /power_outages
-- та довідкових розділів сайту). Персональних даних немає — лише публічні канали зв'язку.
--
-- Навіщо в міграції: таблиця contacts була порожня (0005 прибрав тестові рядки), а веб-сторінка
-- «Контакти» тримала свою копію в коді (FALLBACK_CONTACTS) — два джерела правди для одного факту.
-- Тепер джерело одне: тут, а сторінка читає GET /api/v1/contacts.
--
-- Ідемпотентно: ключ — (type, value), повторний запуск нічого не дублює.
INSERT INTO contacts (type, label, value, region)
SELECT seed.type, seed.label, seed.value, seed.region
FROM (VALUES
  ('phone',    'Кол-центр (безкоштовно по Україні)', '0800210310',                                   'Чернігівська область'),
  ('phone',    'Міський телефон Чернігів',           '0462772901',                                   'Чернігів'),
  ('telegram', 'Telegram-канал з новинами',          'https://t.me/chernigivoblenergo',              NULL),
  ('telegram', 'Telegram-бот для перевірки черги',   'https://t.me/ChernigivOEbot',                  NULL),
  ('viber',    'Viber-бот АТ «Чернігівобленерго»',   'https://chernihivoblenergo.com.ua/in_viber',    NULL),
  ('link',     'Офіційний сайт',                     'https://chernihivoblenergo.com.ua',             NULL),
  ('link',     'Онлайн-звернення споживачів',        'https://chernihivoblenergo.com.ua/feedback_new', NULL)
) AS seed(type, label, value, region)
WHERE NOT EXISTS (
  SELECT 1 FROM contacts c WHERE c.type = seed.type AND c.value = seed.value
);
