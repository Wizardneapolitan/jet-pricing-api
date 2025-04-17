import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

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
  const { departure, arrival, pax } = req.body;

  if (!departure || !arrival) {
    return res.status(400).json({ error: 'Missing departure or arrival' });
  }

  // ✅ Step 1: carica gli aeroporti da Supabase (Airport 2)
  const { data: airports, error: airportError } = await supabase
    .from('Airport 2')
    .select('*');
  if (airportError) {
    return res.status(500).json({ error: airportError.message });
  }

  // ✅ Step 2: crea mappa codice aeroporto → coordinate
  const AIRPORTS = {};
  airports.forEach((a) => {
    AIRPORTS[a.ident] = { lat: a.latitude, lon: a.longitude };
  });

  const dep = AIRPORTS[departure];
  const arr = AIRPORTS[arrival];

  if (!dep || !arr) {
    return res.status(400).json({ error: 'Unknown airport code' });
  }

  // ✅ Step 3: carica i jet da Supabase
  const { data: jets, error: jetError } = await supabase.from('jet').select('*');
  if (jetError) {
    return res.status(500).json({ error: jetError.message });
  }

  // ✅ Step 4: filtra jet entro 500km dall’home base
  const jetsNearby = jets.filter((jet) => {
    const base = AIRPORTS[jet.home_base];
    if (!base) return false;
    const d = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
    return d <= 500;
  });

  // ✅ Step 5: calcolo prezzi
  const results = jetsNearby.map((jet) => {
    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);
    const flightTime = distance / jet.speed_knots;
    const price = jet.hourly_rate * flightTime * 2;
    return {
      jet_id: jet.id,
      model: jet.name,
      home_base: jet.home_base,
      distance_km: Math.round(distance),
      flight_time_h: flightTime.toFixed(2),
      price: Math.round(price),
    };
  });

  results.sort((a, b) => a.price - b.price);

  return res.status(200).json({ jets: results });
}

