/*
# Create gesture_samples table (single-tenant, no sign-in)

1. New Tables
- `gesture_samples`
  - `id` (uuid, primary key, generated automatically)
  - `label` (text, the word this hand shape means, e.g. "hello")
  - `features` (real array, the 63 normalized hand-position numbers captured from the camera)
  - `created_at` (timestamp, defaults to now)

2. Security
- Row level security enabled on `gesture_samples`.
- Only the `anon` and `authenticated` roles get access, because the app has no sign-in screen.
- Policies allow read, add, and delete. Anyone using the app can teach it signs, and can remove samples.
- No camera footage is stored; only numeric hand-position data is saved.

3. Notes
- Table is created with IF NOT EXISTS and policies are dropped before re-creation, so this migration is safe to re-run.
*/

CREATE TABLE IF NOT EXISTS gesture_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  features real[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gesture_samples_label_idx ON gesture_samples (label);

ALTER TABLE gesture_samples ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON gesture_samples TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_gesture_samples" ON gesture_samples;
CREATE POLICY "anon_select_gesture_samples" ON gesture_samples FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_gesture_samples" ON gesture_samples;
CREATE POLICY "anon_insert_gesture_samples" ON gesture_samples FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_gesture_samples" ON gesture_samples;
CREATE POLICY "anon_delete_gesture_samples" ON gesture_samples FOR DELETE
  TO anon, authenticated USING (true);
