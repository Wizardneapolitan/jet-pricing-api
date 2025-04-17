// api/calculate.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const AIRPORTS = {
  LIML: { lat: 45.4451, lon: 9.2767 },   // Milano Linate
  LFPB: { lat: 48.9694, lon: 2.4414 },   // Paris Le Bourget
};

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
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

  // ✅ Step 1: Fetch all jets
  const { data: jets, error } = await supabase.from('jet').select('*');
  if (error) return res.status(500).json({ error: error.message });

  // ✅ Step 2: Filter jets by proximity of home base (500km)
  const jetsNearby = jets.filter((jet) => {
    const base = AIRPORTS[jet.homebase];
    if (!base) return false;
    const d = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
    return d <= 500;
  });

  // ✅ Step 3: Calculate flight time and price
  const results = jetsNearby.map((jet) => {
    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);
    const speed = jet.speed_knots || jet.speed || null;

    if (!speed || speed === 0) {
      return {
        jet_id: jet.id,
        model: jet.name || null,
        home_base: jet.homebase,
        distance_km: Math.round(distance),
        flight_time_h: null,
        price: null,
        warning: 'Missing or invalid speed',
      };
    }

    const flightTime = distance / speed;
    const price = jet.hourly_rate * flightTime * 2;

    return {
      jet_id: jet.id,
      model: jet.name || null,
      home_base: jet.homebase,
      distance_km: Math.round(distance),
      flight_time_h: flightTime.toFixed(2),
      price: Math.round(price),
    };
  });

  results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  return res.status(200).json({ jets: results });
}
