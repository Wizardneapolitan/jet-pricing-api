// api/calculate.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
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

  // ✅ Step 1: carica aeroporti da Supabase
  const { data: airports, error: airportError } = await supabase
    .from('Airport 2')
    .select('ident, latitude, longitude');

  if (airportError) {
    return res.status(500).json({ error: airportError.message });
  }

  // ✅ Step 2: mappa dinamica ICAO -> coordinate
  const AIRPORTS = {};
  airports.forEach((a) => {
    AIRPORTS[a.ident] = { lat: a.latitude, lon: a.longitude };
  });

  const dep = AIRPORTS[departure];
  const arr = AIRPORTS[arrival];

  if (!dep || !arr) {
    return res.status(400).json({
      error: 'Unknown airport code',
      missing: {
        departure_found: !!dep,
        arrival_found: !!arr,
      },
    });
  }

  // ✅ Step 3: carica jet
  const { data: jets, error: jetError } = await supabase.from('jet').select('*');
  if (jetError) return res.status(500).json({ error: jetError.message });

  // ✅ Step 4: filtra per homebase vicino a partenza
  const jetsNearby = jets.filter((jet) => {
    const base = AIRPORTS[jet.homebase];
    if (!base) return false;
    const d = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
    return d <= 500;
  });

  // ✅ Step 5: calcola distanza, tempo e prezzo
  const results = jetsNearby.map((jet) => {
    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);
    const knots = jet.speed_knots || jet.speed || null;

    if (!knots || knots === 0) {
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

    const speed_kmh = knots * 1.852;
    const flightTime = distance / speed_kmh;
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
