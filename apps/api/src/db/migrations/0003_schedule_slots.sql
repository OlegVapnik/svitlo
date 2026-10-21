CREATE TABLE IF NOT EXISTS schedule_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue text NOT NULL,
  date date NOT NULL,
  time_from text NOT NULL,
  time_to text NOT NULL,
  state_code smallint NOT NULL CHECK (state_code BETWEEN 1 AND 3),
  state_name text NOT NULL,
  state_color text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_slots_queue_date_time_from_uq UNIQUE (queue, date, time_from)
);
CREATE INDEX IF NOT EXISTS schedule_slots_queue_date_idx ON schedule_slots (queue, date);
