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

// Debug helper
async function debugSupabaseQuery(queryName, queryFn) {
  try {
    console.log(`Esecuzione query: ${queryName}`);
    const result = await queryFn();
    console.log(`Risultato ${queryName}:`, result);
    return result;
  } catch (error) {
    console.error(`Errore in ${queryName}:`, error);
    return { data: null, error };
  }
}

// Mappa statica per debugging - da rimuovere in produzione
const DEBUG_CITY_MAPPING = {
  'milano': 'LIML',
  'paris': 'LFPG',
  'roma': 'LIRF'
};

async function getCityToICAO(cityName) {
  if (!cityName) return null;
  
  // Normalizza il testo di input
  const normalizedCity = cityName.toLowerCase().trim();
  
  console.log(`Tentativo di trovare codice ICAO per: ${normalizedCity}`);
  
  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    return cityName;
  }
  
  // SOLO PER DEBUG: usa la mappa statica temporanea
  if (DEBUG_CITY_MAPPING[normalizedCity]) {
    console.log(`DEBUG: Usata mappa statica per ${normalizedCity} -> ${DEBUG_CITY_MAPPING[normalizedCity]}`);
    return DEBUG_CITY_MAPPING[normalizedCity];
  }
  
  try {
    // Verifica la connessione al database
    const { data: dbTest, error: dbError } = await debugSupabaseQuery("test-connection", 
      () => supabase.from('Airport 2').select('count').limit(1)
    );
    
    if (dbError) {
      console.error("Errore nella connessione al database:", dbError);
      return null;
    }
    
    // Query più semplice possibile
    const { data: simpleResult, error: simpleError } = await debugSupabaseQuery(
      "simple-airport-query",
      () => supabase
        .from('Airport 2')
        .select('ident, name, type, municipality')
        .limit(1)
    );
    
    if (simpleError) {
      console.error("Errore nella query semplice:", simpleError);
      return null;
    }
    
    // Metodo 1: Corrispondenza esatta del nome della città
    const { data: exactMatch, error: exactError } = await debugSupabaseQuery(
      "exact-city-match",
      () => supabase
        .from('Airport 2')
        .select('ident, name, type, municipality')
        .eq('municipality', normalizedCity)
        .order('type')
        .limit(1)
    );
    
    if (!exactError && exactMatch && exactMatch.length > 0) {
      console.log(`Trovata corrispondenza esatta: ${exactMatch[0].ident}`);
      return exactMatch[0].ident;
    }
    
    // Metodo 2: Aeroporti di grandi dimensioni con nome di città parziale
    const { data: largeAirport, error: largeError } = await debugSupabaseQuery(
      "large-airport-search",
      () => supabase
        .from('Airport 2')
        .select('ident, name, type, municipality')
        .eq('type', 'large_airport')
        .like('municipality', `%${normalizedCity}%`)
        .limit(1)
    );
    
    if (!largeError && largeAirport && largeAirport.length > 0) {
      console.log(`Trovato aeroporto principale: ${largeAirport[0].ident}`);
      return largeAirport[0].ident;
    }
    
    // Metodo 3: Qualsiasi aeroporto con nome di città parziale
    const { data: anyMatch, error: anyMatchError } = await debugSupabaseQuery(
      "any-airport-match",
      () => supabase
        .from('Airport 2')
        .select('ident, name, type, municipality')
        .like('municipality', `%${normalizedCity}%`)
        .order('type')
        .limit(1)
    );
    
    if (!anyMatchError && anyMatch && anyMatch.length > 0) {
      console.log(`Trovata corrispondenza generica: ${anyMatch[0].ident}`);
      return anyMatch[0].ident;
    }
    
    // Nessuna corrispondenza trovata
    console.log(`Nessun risultato trovato per ${normalizedCity}`);
    return null;
  } catch (error) {
    console.error(`Errore critico nella ricerca dell'aeroporto per ${normalizedCity}:`, error);
    return null;
  }
}

export default async function handler(req, res) {
  console.log('==== NUOVA RICHIESTA ====');
  console.log('Body completo:', JSON.stringify(req.body, null, 2));
  
  try {
    // Estrai i dati dalla richiesta
    let { departure, arrival, from, to, pax, date, time } = req.body;
    
    // Supporto per entrambi i formati di input
    const departureInput = departure || from || '';
    const arrivalInput = arrival || to || '';
    
    console.log(`Input: partenza=${departureInput}, arrivo=${arrivalInput}`);
    
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
    
    // Converti nomi delle città in codici ICAO
    console.log(`Inizia conversione città a ICAO: ${departureInput}, ${arrivalInput}`);
    
    const depCode = await getCityToICAO(departureInput);
    console.log(`Codice partenza: ${departureInput} -> ${depCode}`);
    
    const arrCode = await getCityToICAO(arrivalInput);
    console.log(`Codice arrivo: ${arrivalInput} -> ${arrCode}`);
    
    if (!depCode || !arrCode) {
      console.log('ERRORE: Codice aeroporto non trovato');
      return res.status(400).json({
        error: 'Codice aeroporto sconosciuto',
        missing: {
          departure: departureInput,
          arrival: arrivalInput,
          departure_code: depCode,
          arrival_code: arrCode
        }
      });
    }

    // Verifica che gli ICAO esistano nel database
    console.log(`Verifica codici ICAO: ${depCode}, ${arrCode}`);
    
    // Usa il debugger helper
    const { data: specificAirports, error: specificError } = await debugSupabaseQuery(
      "fetch-specific-airports", 
      () => supabase
        .from('Airport 2')
        .select('id, ident, name, latitude, longitude')
        .in('ident', [depCode, arrCode])
    );

    if (specificError) {
      console.error('Errore nella ricerca degli aeroporti specifici:', specificError);
      return res.status(500).json({ 
        error: 'Errore database', 
        details: specificError.message 
      });
    }

    if (!specificAirports || specificAirports.length < 2) {
      console.error('Aeroporti non trovati nei risultati:', { depCode, arrCode, results: specificAirports?.length || 0 });
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
    const { data: jets, error: jetError } = await debugSupabaseQuery(
      "fetch-jets",
      () => supabase.from('jet').select('*')
    );
    
    if (jetError) {
      return res.status(500).json({ error: jetError.message });
    }

    const uniqueHomebases = [...new Set(jets.map(j => j.homebase?.trim().toUpperCase()).filter(Boolean))];
    console.log(`Trovate ${uniqueHomebases.length} hombase uniche`);

    // Fetch home base airports
    const { data: baseAirports, error: baseError } = await debugSupabaseQuery(
      "fetch-homebases",
      () => supabase
        .from('Airport 2')
        .select('id, ident, latitude, longitude')
        .in('ident', uniqueHomebases)
    );

    if (baseError) {
      return res.status(500).json({ error: baseError.message });
    }

    baseAirports.forEach(a => {
      const code = a.ident.trim().toUpperCase();
      AIRPORTS[code] = {
        lat: parseFloat(a.latitude),
        lon: parseFloat(a.longitude),
      };
    });

    // Processa data e formatta in YYYY-MM-DD
    let formattedDate = date;
    if (date) {
      try {
        const currentYear = 2025; // Anno corrente
        let dateObj;
        
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Già in formato ISO
          dateObj = new Date(date);
        } else if (date.match(/\d{1,2}\s+\w+/)) {
          // Formato "15 luglio", aggiungi anno corrente
          const withYear = `${date} ${currentYear}`;
          dateObj = new Date(withYear);
        } else {
          dateObj = new Date(date);
        }
        
        if (!isNaN(dateObj.getTime())) {
          // Assicurati che l'anno sia corrente se non è specificato
          if (dateObj.getFullYear() < currentYear) {
            dateObj.setFullYear(currentYear);
          }
          
          formattedDate = dateObj.toISOString().split('T')[0];
        }
      } catch (error) {
        console.error('Errore nella formattazione della data:', error);
      }
    }

    // Filter jets with homebase within 500km
    const jetsNearby = jets.filter((jet) => {
      const home = jet.homebase?.trim().toUpperCase();
      const base = AIRPORTS[home];
      if (!base) return false;
      const dist = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
      return dist <= 500;
    });

    console.log(`Trovati ${jetsNearby.length} jet nelle vicinanze`);

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
    console.log('Preparazione risposta finale');
    return res.status(200).json({
      input: {
        departure: departureInput,
        arrival: arrivalInput,
        departure_icao: depCode,
        departure_name: dep.name,
        arrival_icao: arrCode,
        arrival_name: arr.name,
        date: formattedDate || null,
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
