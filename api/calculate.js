// api/calculate.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const AIRPORTS = {
  LIML: { lat: 45.4451, lon: 9.2767 },   // Milano Linate
  LFPB: { lat: 48.9694, lon: 2.4414 },   // Paris Le Bourget
  // Aggiungi altri aeroporti qui o caricali da DB/Supabase
};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  const { departure, arrival, pax, date } = req.body;

  if (!departure || !arrival) {
    return res.status(400).json({ error: 'Missing departure or arrival' });
  }

  const dep = AIRPORTS[departure];
  const arr = AIRPORTS[arrival];
  if (!dep || !arr) {
    return res.status(400).json({ error: 'Unknown airport code' });
  }

  // Step 1: Ottieni tutti i jet da Supabase
  const { data: jets, error } = await supabase.from('jets').select('*');
  if (error) return res.status(500).json({ error: error.message });

  // Step 2: Filtra jet con home base entro 500km dalla partenza
  const jetsNearby = jets.filter((jet) => {
    const base = AIRPORTS[jet.home_base];
    if (!base) return false;
    const d = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
    return d <= 500;
  });

  // Step 3: Calcola distanza e prezzo per ciascun jet
  const results = jetsNearby.map((jet) => {
    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);
    const flightTime = distance / jet.speed; // in ore
    const price = jet.hourly_rate * flightTime * 2; // x2 per ritorno home base
    return {
      jet_id: jet.id,
      model: jet.model,
      home_base: jet.home_base,
      distance_km: Math.round(distance),
      flight_time_h: flightTime.toFixed(2),
      price: Math.round(price),
    };
  });

  results.sort((a, b) => a.price - b.price);

  return res.status(200).json({ jets: results });
}
