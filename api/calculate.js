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
    // Approccio unificato: cerca in tutti i campi rilevanti, ma ordina per tipo di aeroporto
    // in modo che gli aeroporti principali abbiano priorità
    let { data: airportData, error: airportError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
      .order('type')  // I tipi sono alfabetici: large_airport viene prima di medium_airport e small_airport
      .limit(10);
    
    if (airportError) {
      console.error(`Errore nella ricerca dell'aeroporto per ${normalizedCity}:`, airportError);
      return null;
    }
    
    if (airportData && airportData.length > 0) {
      console.log(`Trovati ${airportData.length} aeroporti per ${normalizedCity}`);
      
      // Prima cerca aeroporti principali
      const largeAirports = airportData.filter(a => a.type === 'large_airport');
      if (largeAirports.length > 0) {
        console.log(`Trovato aeroporto principale: ${largeAirports[0].ident} (${largeAirports[0].name})`);
        return largeAirports[0].ident;
      }
      
      // Poi aeroporti medi
      const mediumAirports = airportData.filter(a => a.type === 'medium_airport');
      if (mediumAirports.length > 0) {
        console.log(`Trovato aeroporto medio: ${mediumAirports[0].ident} (${mediumAirports[0].name})`);
        return mediumAirports[0].ident;
      }
      
      // Infine qualsiasi altro aeroporto trovato
      console.log(`Nessun aeroporto principale o medio, uso: ${airportData[0].ident} (${airportData[0].name})`);
      return airportData[0].ident;
    }
    
    // Se non troviamo nulla con la prima ricerca, proviamo con una ricerca più ampia
    let { data: broadSearchData, error: broadSearchError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .or(`name.ilike.%${normalizedCity}%,municipality.ilike.%${normalizedCity}%,iso_region.ilike.%${normalizedCity}%`)
      .order('type')
      .limit(5);
    
    if (!broadSearchError && broadSearchData && broadSearchData.length > 0) {
      // Anche qui, priorità agli aeroporti principali e medi
      const betterAirports = broadSearchData.filter(a => 
        a.type === 'large_airport' || a.type === 'medium_airport'
      );
      
      if (betterAirports.length > 0) {
        console.log(`Trovato aeroporto nella ricerca ampia: ${betterAirports[0].ident} (${betterAirports[0].name})`);
        return betterAirports[0].ident;
      }
      
      console.log(`Trovato aeroporto nella ricerca ampia: ${broadSearchData[0].ident} (${broadSearchData[0].name})`);
      return broadSearchData[0].ident;
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
