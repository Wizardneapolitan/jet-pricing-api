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

// Funzione ottimizzata per convertire nomi di città/aeroporti in codici ICAO
// 100% dinamica - Nessuna mappa statica
async function getCityToICAO(cityName) {
  if (!cityName) return null;
  
  // Normalizza il testo di input
  const normalizedCity = cityName.toLowerCase().trim();
  
  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    return cityName;
  }
  
  console.log(`Cercando codice ICAO per: ${normalizedCity}`);
  
  try {
    // APPROCCIO SEMPLIFICATO: cerca prima aeroporti principali nella municipalità
    let { data: largeAirports, error: largeError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'large_airport')
      .ilike('municipality', `%${normalizedCity}%`)
      .limit(1);
    
    console.log('Risultato ricerca aeroporti principali per municipalità:', largeAirports);
    
    if (!largeError && largeAirports && largeAirports.length > 0) {
      console.log(`Trovato aeroporto principale per municipalità: ${largeAirports[0].ident}`);
      return largeAirports[0].ident;
    }
    
    // Poi cerca aeroporti principali nel nome
    let { data: largeNameAirports, error: largeNameError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'large_airport')
      .ilike('name', `%${normalizedCity}%`)
      .limit(1);
    
    console.log('Risultato ricerca aeroporti principali per nome:', largeNameAirports);
    
    if (!largeNameError && largeNameAirports && largeNameAirports.length > 0) {
      console.log(`Trovato aeroporto principale per nome: ${largeNameAirports[0].ident}`);
      return largeNameAirports[0].ident;
    }
    
    // Poi cerca aeroporti medi nella municipalità
    let { data: mediumAirports, error: mediumError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'medium_airport')
      .ilike('municipality', `%${normalizedCity}%`)
      .limit(1);
    
    console.log('Risultato ricerca aeroporti medi per municipalità:', mediumAirports);
    
    if (!mediumError && mediumAirports && mediumAirports.length > 0) {
      console.log(`Trovato aeroporto medio per municipalità: ${mediumAirports[0].ident}`);
      return mediumAirports[0].ident;
    }
    
    // Poi cerca aeroporti medi nel nome
    let { data: mediumNameAirports, error: mediumNameError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'medium_airport')
      .ilike('name', `%${normalizedCity}%`)
      .limit(1);
    
    console.log('Risultato ricerca aeroporti medi per nome:', mediumNameAirports);
    
    if (!mediumNameError && mediumNameAirports && mediumNameAirports.length > 0) {
      console.log(`Trovato aeroporto medio per nome: ${mediumNameAirports[0].ident}`);
      return mediumNameAirports[0].ident;
    }
    
    // Ricerca generica: qualsiasi tipo di aeroporto ma ordinato per tipo
    let { data: anyAirport, error: anyError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .ilike('municipality', `%${normalizedCity}%`)
      .order('type')
      .limit(1);
    
    console.log('Risultato ricerca generica per municipalità:', anyAirport);
    
    if (!anyError && anyAirport && anyAirport.length > 0) {
      console.log(`Trovato aeroporto generico: ${anyAirport[0].ident}`);
      return anyAirport[0].ident;
    }
    
    // Ultima risorsa: cerca per nome in qualsiasi tipo
    let { data: lastResort, error: lastResortError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .ilike('name', `%${normalizedCity}%`)
      .order('type')
      .limit(1);
    
    console.log('Risultato ultima risorsa:', lastResort);
    
    if (!lastResortError && lastResort && lastResort.length > 0) {
      console.log(`Trovato in ultima risorsa: ${lastResort[0].ident}`);
      return lastResort[0].ident;
    }
    
    // Nessun risultato trovato
    console.log(`Nessun aeroporto trovato per: ${normalizedCity}`);
    return null;
  } catch (error) {
    console.error(`Errore nella ricerca dell'aeroporto per ${normalizedCity}:`, error);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    console.log('Richiesta ricevuta:', JSON.stringify(req.body, null, 2));
    
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
    
    // Converti nomi delle città in codici ICAO
    console.log(`Conversione città a ICAO: ${departureInput}, ${arrivalInput}`);
    const depCode = await getCityToICAO(departureInput);
    const arrCode = await getCityToICAO(arrivalInput);
    
    console.log(`Risultato conversione: ${departureInput} -> ${depCode}, ${arrivalInput} -> ${arrCode}`);
    
    if (!depCode || !arrCode) {
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

    // Fetch departure and arrival airport info
    const { data: specificAirports, error: specificError } = await supabase
      .from('Airport 2')
      .select('id, ident, name, latitude, longitude')
      .in('ident', [depCode, arrCode]);

    console.log('Risultato ricerca aeroporti specifici:', specificAirports);
    console.log('Errore ricerca aeroporti specifici:', specificError);

    if (specificError) {
      console.error('Errore nella ricerca degli aeroporti specifici:', specificError);
      return res.status(500).json({ error: specificError.message });
    }

    if (!specificAirports || specificAirports.length < 2) {
      console.error('Aeroporti non trovati:', { depCode, arrCode, results: specificAirports?.length || 0 });
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
