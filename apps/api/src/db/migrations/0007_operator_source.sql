-- Джерело даних оператора: публічний веб-API «Зареєстровані перерви в електропостачанні»
-- (https://chernihivoblenergo.com.ua/power_outages). Без персональних даних і без капчі.
-- Ідемпотентно: вставляємо лише якщо такого URL ще немає.
INSERT INTO sources (name, url, type, is_active)
SELECT 'Чернігівобленерго (веб-API)', 'https://chernihivoblenergo.com.ua/power_outages', 'api', true
WHERE NOT EXISTS (
  SELECT 1 FROM sources WHERE url = 'https://chernihivoblenergo.com.ua/power_outages'
);
