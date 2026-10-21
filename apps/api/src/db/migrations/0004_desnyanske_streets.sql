CREATE OR REPLACE FUNCTION energy_normalize_address(input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(
    regexp_replace(translate(lower(unaccent(coalesce(input, ''))), 'ыэёїи', 'иееіі'), '[[:punct:]]+', ' ', 'g'),
    '^(вулиця|вул|улица|ул|проспект|просп|провулок|пров|переулок|пер|село|с\.?)[[:space:]]+', '', 'i'
  ))
$$;

WITH settlement AS (
  INSERT INTO addresses (type, name_uk, name_ru, name_normalized, city, source)
  VALUES ('settlement', 'Деснянське', 'Деснянское', energy_normalize_address('Деснянське'), 'Деснянське', 'curated')
  RETURNING id
), streets(name_uk, name_ru) AS (
  VALUES
    ('Зарічна', 'Заречная'),
    ('Шевченка', 'Шевченко'),
    ('Центральна', 'Центральная'),
    ('Миру', 'Мира'),
    ('Садова', 'Садовая'),
    ('Молодіжна', 'Молодёжная'),
    ('Лісова', 'Лесная'),
    ('Набережна', 'Набережная'),
    ('Шкільна', 'Школьная'),
    ('Перемоги', 'Победы'),
    ('Сонячна', 'Солнечная'),
    ('Квіткова', 'Цветочная'),
    ('Козацька', 'Казацкая'),
    ('Нова', 'Новая'),
    ('Старий шлях', 'Старый путь'),
    ('Польова', 'Полевая'),
    ('Вишнева', 'Вишнёвая'),
    ('Калинова', 'Калиновая'),
    ('Паркова', 'Парковая'),
    ('Дружби', 'Дружбы')
)
INSERT INTO addresses (type, name_uk, name_ru, name_normalized, parent_id, city, source)
SELECT 'street', streets.name_uk, streets.name_ru, energy_normalize_address(streets.name_uk), settlement.id, 'Деснянське', 'curated'
FROM streets CROSS JOIN settlement
ON CONFLICT DO NOTHING;
