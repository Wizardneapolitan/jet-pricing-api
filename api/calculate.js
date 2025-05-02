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

// Funzione per convertire il nome della città in codice ICAO
async function getCityToICAO(cityName) {
  if (!cityName) return null;
  
  // Normalizza il nome della città
  const normalizedCity = cityName.toLowerCase().trim();
  
  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    return cityName;
  }
  
  console.log(`Cercando codice ICAO per: ${normalizedCity}`);
  
  // Mappa di fallback per le città più comuni
  // Questa viene usata solo se la ricerca in Supabase fallisce
  const fallbackMap = {
    'milano': 'LIML',
    'roma': 'LIRF',
    'napoli': 'LIRN',
    'torino': 'LIMF',
    'venezia': 'LIPZ',
    'firenze': 'LIRQ',
    'catania': 'LICC',
    'palermo': 'LICJ',
    'ibiza': 'LEIB',
    'nizza': 'LFMN',
    'cannes': 'LFMN', // Cannes usa l'aeroporto di Nizza
    'malaga': 'LEMG',
    'lugano': 'LSZA',
    'barcellona': 'LEBL',
    'madrid': 'LEMD',
    'londra': 'EGLL',
    'parigi': 'LFPG',
    'berlino': 'EDDB',
    'amsterdam': 'EHAM',
    'monaco': 'EDDM',
    'salerno': 'LIRI'
  };
  
  try {
    // Prova a cercare nel database per nome città/comune
    const { data: municipalityData, error: municipalityError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality, region')
      .ilike('municipality', `%${normalizedCity}%`)
      .limit(1);
    
    if (!municipalityError && municipalityData && municipalityData.length > 0) {
      console.log(`Aeroporto trovato cercando per comune: ${municipalityData[0].ident}`);
      return municipalityData[0].ident.trim().toUpperCase();
    }
    
    // Prova a cercare nel database per nome aeroporto
    const { data: nameData, error: nameError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality, region')
      .ilike('name', `%${normalizedCity}%`)
      .limit(1);
    
    if (!nameError && nameData && nameData.length > 0) {
      console.log(`Aeroporto trovato cercando per nome: ${nameData[0].ident}`);
      return nameData[0].ident.trim().toUpperCase();
    }
    
    // Cerca nella mappa di fallback
    for (const [key, value] of Object.entries(fallbackMap)) {
      if (normalizedCity.includes(key)) {
        console.log(`Aeroporto trovato nella mappa di fallback: ${key} -> ${value}`);
        return value;
      }
    }
    
    console.log(`Nessun aeroporto trovato per: ${normalizedCity}`);
    return null;
  } catch (error) {
    console.error(`Errore nella ricerca dell'aeroporto per ${normalizedCity}:`, error);
    
    // In caso di errore, prova con la mappa di fallback
    for (const [key, value] of Object.entries(fallbackMap)) {
      if (normalizedCity.includes(key)) {
        console.log(`Fallback dopo errore: ${key} -> ${value}`);
        return value;
      }
    }
    
    return null;
  }
}

export default async function handler(req, res) {
  try {
    console.log('Richiesta ricevuta:', req.body);
    
    // Estrai i dati dalla richiesta
    let { departure, arrival, from, to, pax, date, time } = req.body;
    
    // Supporto per entrambi i formati di input
    const departureInput = departure || from || '';
    const arrivalInput = arrival || to || '';
    
    if (!departureInput || !arrivalInput) {
      return res.status(400).json({ 
        error: 'Mancano dati di partenza o arrivo',
        required_format: {
          from: "Nome città o codice ICAO (es. 'Milano' o 'LIML')",
          to: "Nome città o codice ICAO (es. 'Nizza' o 'LFMN')",
          date: "Data in formato YYYY-MM-DD (opzionale)",
          time: "Orario in formato HH:MM (opzionale)",
          pax: "Numero passeggeri (opzionale, default: 4)"
        }
      });
    }
    
    // Converti in codici ICAO se necessario
    const depCode = await getCityToICAO(departureInput) || departureInput.trim().toUpperCase();
    const arrCode = await getCityToICAO(arrivalInput) || arrivalInput.trim().toUpperCase();
    
    console.log(`Conversione completata: ${departureInput} -> ${depCode}, ${arrivalInput} -> ${arrCode}`);
    
    if (!depCode || !arrCode) {
      return res.status(400).json({
        error: 'Impossibile risolvere i nomi delle città in codici aeroportuali',
        provided: {
          departure: departureInput,
          arrival: arrivalInput
        },
        suggestion: "Prova a specificare il nome di una città più grande nelle vicinanze"
      });
    }

    // Fetch departure and arrival airport info
    const { data: specificAirports, error: specificError } = await supabase
      .from('Airport 2')
      .select('id, ident, name, latitude, longitude')
      .or(`ident.eq.${depCode},ident.eq.${arrCode}`);

    if (specificError) {
      console.error('Errore nella ricerca degli aeroporti specifici:', specificError);
      return res.status(500).json({ error: specificError.message });
    }

    if (!specificAirports || specificAirports.length < 2) {
      console.error('Aeroporti non trovati:', { depCode, arrCode, results: specificAirports });
      return res.status(400).json({
        error: 'Codice aeroporto sconosciuto',
        missing: {
          departure: depCode,
          arrival: arrCode,
          specific_search_results: specificAirports?.length || 0
        }
      });
    }

    const AIRPORTS = {};
    specificAirports.forEach(a => {
      const code = a.ident.trim().toUpperCase();
      AIRPORTS[code] = {
        name: a.name,
        lat: parseFloat(a.latitude),
        lon: parseFloat(a.longitude)
      };
    });

    const dep = AIRPORTS[depCode];
    const arr = AIRPORTS[arrCode];

    if (!dep || !arr) {
      return res.status(400).json({ error: 'Dati aeroporto mancanti nel mapping' });
    }

    // Fetch jets
    const { data: jets, error: jetError } = await supabase.from('jet').select('*');
    if (jetError) return res.status(500).json({ error: jetError.message });

    const uniqueHomebases = [...new Set(jets.map(j => j.homebase?.trim().toUpperCase()).filter(Boolean))];

    // Fetch home base airports
    const { data: baseAirports, error: baseError } = await supabase
      .from('Airport 2')
      .select('id, ident, latitude, longitude')
      .in('ident', uniqueHomebases);

    if (baseError) return res.status(500).json({ error: baseError.message });

    baseAirports.forEach(a => {
      const code = a.ident.trim().toUpperCase();
      AIRPORTS[code] = {
        lat: parseFloat(a.latitude),
        lon: parseFloat(a.longitude),
      };
    });

    // Filter jets with homebase within 500km
    const jetsNearby = jets.filter((jet) => {
      const home = jet.homebase?.trim().toUpperCase();
      const base = AIRPORTS[home];
      if (!base) return false;
      const dist = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
      return dist <= 500;
    });

    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);

    const results = jetsNearby.map((jet) => {
      const knots = jet.speed_knots || jet.speed || null;

      if (!knots || knots === 0) {
        return {
          jet_id: jet.id,
          model: jet.name || null,
          category: jet.category || null,
          seats: jet.seats || null,
          operator: jet.operator || null,
          logo: jet.logo_url || null,
          image: jet.image_url || null,
          home_base: jet.homebase,
          distance_km: Math.round(distance),
          flight_time_h: null,
          flight_time_pretty: null,
          price: null,
          warning: 'Velocità mancante o non valida',
        };
      }

      const speed_kmh = knots * 1.852;
      const flightTime = distance / speed_kmh;
      const totalCost = jet.hourly_rate * flightTime * 2;
      const hours = Math.floor(flightTime);
      const minutes = Math.round((flightTime - hours) * 60);
      const formatted = `${hours > 0 ? hours + 'h ' : ''}${minutes}min`;

      return {
        jet_id: jet.id,
        model: jet.name || null,
        category: jet.category || null,
        seats: jet.seats || null,
        operator: jet.operator || null,
        logo: jet.logo_url || null,
        image: jet.image_url || null,
        home_base: jet.homebase,
        distance_km: Math.round(distance),
        flight_time_h: flightTime.toFixed(2),
        flight_time_pretty: formatted,
        price: Math.round(totalCost),
      };
    });

    results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

    // Includi informazioni sugli aeroporti nella risposta
    return res.status(200).json({
      input: {
        departure: departureInput,
        arrival: arrivalInput,
        departure_icao: depCode,
        departure_name: dep.name,
        arrival_icao: arrCode,
        arrival_name: arr.name,
        date: date || null,
        time: time || null,
        pax: pax || 4
      },
      jets: results
    });

  } catch (error) {
    console.error('Errore imprevisto:', error);
    return res.status(500).json({ 
      error: 'Errore interno del server', 
      details: error.message,
      stack: error.stack
    });
  }
}
