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

// Funzione migliorata per convertire città in codici ICAO
async function getCityToICAO(cityName) {
  if (!cityName) return null;
  
  // Normalizza il testo della città
  const normalizedCity = cityName.toLowerCase().trim();
  
  // Se sembra già un codice ICAO (4 lettere maiuscole), restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    return cityName;
  }
  
  try {
    console.log(`Cercando aeroporto per: ${normalizedCity}`);
    
    // Cerca aeroporti in diversi modi possibili
    // 1. Cerca per nome dell'aeroporto
    // 2. Cerca per nome della città/comune
    // 3. Cerca per regione
    // Questo approccio è molto più flessibile e potente
    const { data: airportData, error: airportError } = await supabase
      .from('Airport 2')
      .select('*')
      .or(`name.ilike.%${normalizedCity}%,municipality.ilike.%${normalizedCity}%`)
      .order('type', { ascending: true })
      .limit(5);
    
    if (airportError) {
      console.error('Errore nella ricerca degli aeroporti:', airportError);
      throw airportError;
    }
    
    console.log(`Risultati della ricerca per ${normalizedCity}:`, airportData?.length || 0);
    
    if (airportData && airportData.length > 0) {
      // Restituisci il primo risultato trovato
      console.log(`Aeroporto trovato: ${airportData[0].name} (${airportData[0].ident})`);
      return airportData[0].ident.trim().toUpperCase();
    }
    
    // Ricerca secondaria: parola chiave più ampia
    const { data: secondaryData, error: secondaryError } = await supabase
      .from('Airport 2')
      .select('*')
      .or(`region.ilike.%${normalizedCity}%,iso_country.eq.${normalizedCity}`)
      .order('type', { ascending: true })
      .limit(1);
      
    if (secondaryError) {
      console.error('Errore nella ricerca secondaria:', secondaryError);
    } else if (secondaryData && secondaryData.length > 0) {
      console.log(`Aeroporto trovato in ricerca secondaria: ${secondaryData[0].name} (${secondaryData[0].ident})`);
      return secondaryData[0].ident.trim().toUpperCase();
    }
    
    // Fallback: mappa statica per aeroporti comuni
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
      'monaco': 'EDDM'
    };
    
    // Controlla se la città è nella mappa di fallback
    for (const [key, value] of Object.entries(fallbackMap)) {
      if (normalizedCity.includes(key)) {
        console.log(`Aeroporto trovato nel fallback map: ${key} -> ${value}`);
        return value;
      }
    }
    
    // Ultima possibilità: cerca un aeroporto qualsiasi nel paese/regione
    const countryCode = normalizedCity.length === 2 ? normalizedCity.toUpperCase() : null;
    if (countryCode) {
      const { data: countryData } = await supabase
        .from('Airport 2')
        .select('*')
        .eq('iso_country', countryCode)
        .eq('type', 'large_airport')
        .limit(1);
        
      if (countryData && countryData.length > 0) {
        console.log(`Aeroporto trovato per paese ${countryCode}: ${countryData[0].name} (${countryData[0].ident})`);
        return countryData[0].ident.trim().toUpperCase();
      }
    }
    
    // Se tutto fallisce, restituisci null e lascia che l'API gestisca l'errore
    console.warn(`Nessun aeroporto trovato per ${cityName}`);
    return null;
  } catch (err) {
    console.error('Errore nella conversione da città a ICAO:', err);
    return null;
  }
}

// Funzione per validare e formattare la data
function validateAndFormatDate(dateString) {
  if (!dateString) return null;
  
  let date;
  
  // Prova a interpretare la data in vari formati
  try {
    // Formato ISO YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      date = new Date(dateString);
    } 
    // Formato europeo DD/MM/YYYY o DD-MM-YYYY
    else if (/^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4}$/.test(dateString)) {
      const parts = dateString.split(/[-\/\.]/);
      date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    // Formato americano MM/DD/YYYY
    else if (/^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4}$/.test(dateString)) {
      date = new Date(dateString);
    }
    // Formato testuale (es. "28 luglio 2024")
    else {
      date = new Date(dateString);
    }
    
    // Verifica se la data è valida
    if (isNaN(date.getTime())) {
      console.warn('Data non valida:', dateString);
      return null;
    }
    
    // Formatta in YYYY-MM-DD
    return date.toISOString().split('T')[0];
  } catch (err) {
    console.error('Errore nel parsing della data:', err);
    return null;
  }
}

// Funzione per validare e formattare l'orario
function validateAndFormatTime(timeString) {
  if (!timeString) return null;
  
  try {
    // Formato HH:MM o HH.MM
    const timeRegex = /^(\d{1,2})[:.]\d{2}$/;
    if (timeRegex.test(timeString)) {
      // Verifica se l'ora è in un range valido
      const hour = parseInt(timeString.split(/[:.]/)[0]);
      if (hour >= 0 && hour <= 23) {
        // Formatta in HH:MM standardizzato
        return timeString.replace('.', ':').padStart(5, '0');
      }
    }
    
    console.warn('Formato orario non valido:', timeString);
    return null;
  } catch (err) {
    console.error('Errore nel parsing dell\'orario:', err);
    return null;
  }
}

export default async function handler(req, res) {
  try {
    console.log('Richiesta ricevuta:', req.body);
    
    // Estrai i dati dalla richiesta
    let { departure, arrival, from, to, pax, date, time } = req.body;
    
    // Supporto per entrambi i formati di input
    // Il payload JSON può contenere departure/arrival o from/to
    const departureInput = departure || from;
    const arrivalInput = arrival || to;
    
    // Verifica i dati di input
    if (!departureInput || !arrivalInput) {
      return res.status(400).json({ 
        error: 'Mancano dati di partenza o arrivo',
        required_format: {
          from: "Nome città o codice ICAO (es. 'Milano' o 'LIML')",
          to: "Nome città o codice ICAO (es. 'Ibiza' o 'LEIB')",
          date: "Data in formato YYYY-MM-DD (opzionale)",
          time: "Orario in formato HH:MM (opzionale)",
          pax: "Numero passeggeri (opzionale, default: 4)"
        }
      });
    }
    
    // Converti le città in codici ICAO, se necessario
    const departureICAO = await getCityToICAO(departureInput);
    const arrivalICAO = await getCityToICAO(arrivalInput);
    
    if (!departureICAO || !arrivalICAO) {
      return res.status(400).json({ 
        error: 'Impossibile risolvere i nomi delle città in codici aeroportuali',
        provided: {
          departure: departureInput,
          arrival: arrivalInput
        },
        suggestion: "Prova a specificare il nome di una città più grande nelle vicinanze"
      });
    }
    
    // Validazione e formattazione di data e ora
    const validatedDate = validateAndFormatDate(date);
    const validatedTime = validateAndFormatTime(time);
    
    // Converti pax in numero se fornito, altrimenti usa il default
    const validatedPax = pax ? parseInt(pax) : 4;
    
    console.log(`Convertito: ${departureInput} -> ${departureICAO}, ${arrivalInput} -> ${arrivalICAO}`);
    console.log(`Data: ${date} -> ${validatedDate}, Orario: ${time} -> ${validatedTime}, Pax: ${validatedPax}`);

    // Il resto del codice rimane invariato
    const depCode = departureICAO.trim().toUpperCase();
    const arrCode = arrivalICAO.trim().toUpperCase();

    // Fetch departure and arrival airport info
    const { data: specificAirports, error: specificError } = await supabase
      .from('Airport 2')
      .select('id, ident, name, latitude, longitude')
      .or(`ident.eq.${depCode},ident.eq.${arrCode}`);

    if (specificError) {
      return res.status(500).json({ error: specificError.message });
    }

    if (!specificAirports || specificAirports.length < 2) {
      return res.status(400).json({
        error: 'Codice aeroporto sconosciuto',
        missing: {
          departure: depCode,
          arrival: arrCode,
          specific_search_results: specificAirports?.length || 0,
          suggestion: "Prova a cercare un aeroporto più grande nella stessa area"
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

    // Aggiungi i dati di input validati alla risposta
    return res.status(200).json({
      input: {
        departure: departureInput,
        arrival: arrivalInput,
        departure_icao: departureICAO,
        departure_name: dep.name,
        arrival_icao: arrivalICAO,
        arrival_name: arr.name,
        date: validatedDate,
        time: validatedTime,
        pax: validatedPax
      },
      jets: results
    });

  } catch (error) {
    console.error('Errore imprevisto:', error);
    return res.status(500).json({ error: 'Errore interno del server', details: error.message });
  }
}
