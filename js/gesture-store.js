// Saves and loads the hand-shape examples the user recorded for each word, using the Supabase table gesture_samples.
// Only numeric hand positions are stored, never camera video.
import { createClient } from '@supabase/supabase-js';

const FEATURE_COUNT = 63;
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = url && anonKey ? createClient(url, anonKey) : null;

export function isStoreConfigured() {
  return supabase !== null;
}

export async function loadSamples() {
  const { data, error } = await supabase.from('gesture_samples').select('label, features');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('Unexpected response while loading signs.');

  return data.filter(
    (row) =>
      typeof row.label === 'string' &&
      Array.isArray(row.features) &&
      row.features.length === FEATURE_COUNT,
  );
}

export async function addSamples(label, featureList) {
  const rows = featureList.map((features) => ({ label, features }));
  const { error } = await supabase.from('gesture_samples').insert(rows);
  if (error) throw new Error(error.message);
}

export async function deleteSamples(label) {
  const { error } = await supabase.from('gesture_samples').delete().eq('label', label);
  if (error) throw new Error(error.message);
}
