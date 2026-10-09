DELETE FROM schedule_slots WHERE source = 'demo';
DELETE FROM outages WHERE source = 'demo';
DELETE FROM grid_status WHERE source_id IN (SELECT id FROM sources WHERE name IN ('Interruptions Energy CN UA', 'Mock Source'));
DELETE FROM incidents WHERE source_id IN (SELECT id FROM sources WHERE name IN ('Interruptions Energy CN UA', 'Mock Source'));
DELETE FROM sources WHERE name IN ('Interruptions Energy CN UA', 'Mock Source');
DELETE FROM contacts WHERE label = 'Call-center' AND region = 'Chernihiv Oblast';
DELETE FROM contacts WHERE label IN ('Telegram Channel', 'Telegram Bot') AND region = 'Chernihiv Oblast';
