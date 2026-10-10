-- Довідник «особовий рахунок → вулиця + черга»: за номером рахунку користувач перевіряє,
-- чи збігається його адреса/черга з даними застосунку.
--
-- Звідки дані: публічне API оператора (POST /api/list_acc) рахунок НЕ повертає (лише населений пункт,
-- вулицю, будинки й час), а авторизований кабінет ми не парсимо — це обхід захисту (hard stop, AGENTS).
-- Тому довідник наповнюється з даних оператора через адмін-маршрут PUT /api/v1/admin/places.
--
-- Персональні дані (ПІБ, адреса квартири) тут НЕ зберігаються: тільки номер, вулиця і черга.
CREATE TABLE IF NOT EXISTS subscriber_places (
  account text PRIMARY KEY CHECK (account ~ '^\d{9,12}$'),
  street text NOT NULL CHECK (char_length(street) >= 2),
  queue text NOT NULL CHECK (queue ~ '^\d+(\/\d+)?$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
