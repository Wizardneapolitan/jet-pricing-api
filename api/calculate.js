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
  try {
    const { departure, arrival, pax, date } = req.body;
    
    if (!departure || !arrival) {
      return res.status(400).json({ error: 'Missing departure or arrival' });
    }
    
    const depCode = departure.trim().toUpperCase();
    const arrCode = arrival.trim().toUpperCase();
    
    // Cerca direttamente gli aeroporti specifici
    const { data: specificAirports, error: specificError } = await supabase
      .from('Airport 2')
      .select('id, ident, latitude, longitude')
      .or(`ident.eq.${depCode},ident.eq.${arrCode}`);
      
    if (specificError) {
      return res.status(500).json({ error: specificError.message });
    }
    
    // Debugging: controlliamo cosa abbiamo trovato
    console.log(`Direct search results:`, specificAirports);
    
    // Se troviamo esattamente i due aeroporti, usiamo questi
    if (specificAirports && specificAirports.length === 2) {
      // Crea una mappa dei due aeroporti
      const AIRPORTS = {};
      specificAirports.forEach(a => {
        if (a.ident && a.latitude && a.longitude) {
          const code = a.ident.trim().toUpperCase();
          AIRPORTS[code] = {
            lat: parseFloat(a.latitude),
            lon: parseFloat(a.longitude),
          };
        }
      });
      
      const dep = AIRPORTS[depCode];
      const arr = AIRPORTS[arrCode];
      
      // Se li abbiamo trovati direttamente, procedi
      if (dep && arr) {
        // Carica i jet
        const { data: jets, error: jetError } = await supabase.from('jet').select('*');
        
        if (jetError) {
          return res.status(500).json({ error: jetError.message });
        }
        
        // Se ci sono altri aeroporti necessari per i jet, carichiamoli
        const uniqueHomebases = [...new Set(jets.map(jet => 
          jet.homebase ? jet.homebase.trim().toUpperCase() : null
        ).filter(Boolean))];
        
        // Carica dati degli aeroporti di base
        const { data: baseAirports, error: baseError } = await supabase
          .from('Airport 2')
          .select('id, ident, latitude, longitude')
          .in('ident', uniqueHomebases);
          
        if (baseError) {
          return res.status(500).json({ error: baseError.message });
        }
        
        // Aggiungi gli aeroporti base alla mappa
        baseAirports.forEach(a => {
          if (a.ident && a.latitude && a.longitude) {
            const code = a.ident.trim().toUpperCase();
            if (!AIRPORTS[code]) {
              AIRPORTS[code] = {
                lat: parseFloat(a.latitude),
                lon: parseFloat(a.longitude),
              };
            }
          }
        });
        
        // Filtra jet nelle vicinanze (500km)
        const jetsNearby = jets.filter((jet) => {
          const homebase = jet.homebase ? jet.homebase.trim().toUpperCase() : null;
          if (!homebase) return false;
          
          const base = AIRPORTS[homebase];
          if (!base) return false;
          
          const d = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
          return d <= 500;
        });
        
        // Calcola la distanza tra aeroporti
        const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);
        
        // Elabora risultati per ogni jet
        const results = jetsNearby.map((jet) => {
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
    }
    
    // Se non abbiamo trovato esattamente i due aeroporti con ricerca diretta,
    // cerchiamo manualmente i codici ICAO precisi da tutti gli aeroporti
    // Usare la ricerca esatta
    const { data: limlAirport } = await supabase
      .from('Airport 2')
      .select('id, ident, latitude, longitude')
      .eq('ident', 'LIML')
      .limit(1);
      
    const { data: lfpbAirport } = await supabase
      .from('Airport 2')
      .select('id, ident, latitude, longitude')
      .eq('ident', 'LFPB')
      .limit(1);
    
    console.log('LIML search:', limlAirport);
    console.log('LFPB search:', lfpbAirport);
    
    // Se ancora non troviamo nulla, guarda con case insensitive
    if (!limlAirport?.length || !lfpbAirport?.length) {
      const { data: limlAirportCI } = await supabase
        .from('Airport 2')
        .select('id, ident, latitude, longitude')
        .ilike('ident', 'liml')
        .limit(1);
        
      const { data: lfpbAirportCI } = await supabase
        .from('Airport 2')
        .select('id, ident, latitude, longitude')
        .ilike('ident', 'lfpb')
        .limit(1);
      
      console.log('LIML case-insensitive search:', limlAirportCI);
      console.log('LFPB case-insensitive search:', lfpbAirportCI);
    }
    
    // Se arriviamo qui, non abbiamo trovato gli aeroporti
    return res.status(400).json({
      error: 'Unknown airport code',
      missing: {
        departure: depCode,
        arrival: arrCode,
        departure_found: false,
        arrival_found: false,
        specific_search_results: specificAirports?.length || 0
      }
    });
    
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
