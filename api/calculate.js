import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Cache in memoria per aeroporti frequenti
const airportCache = new Map();
const CACHE_EXPIRY = 1000 * 60 * 60; // 1 ora

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

// Rimuove accenti e normalizza minuscolo
function normalizeInput(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function getCityToICAO(cityName) {
  if (!cityName) return null;

  const normalizedCity = normalizeInput(cityName);
  
  // Controlla cache
  const cached = airportCache.get(normalizedCity);
  if (cached && (Date.now() - cached.timestamp) < CACHE_EXPIRY) {
    console.log(`Cache hit per: ${normalizedCity}`);
    return cached.data;
  }

  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    const result = cityName;
    airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
    return result;
  }

  console.log(`Cercando codice ICAO per: ${normalizedCity}`);

  try {
    // 1. 🎯 Cerca con search_name (con gestione errori)
    try {
      const { data, error } = await supabase
        .from('Airport 2')
        .select('ident, name, search_name, city')
        .ilike('search_name', normalizedCity)
        .in('type', ['large_airport', 'medium_airport'])
        .order('type')
        .limit(1);

      if (!error && data && data.length > 0) {
        console.log(`Trovato con search_name: ${normalizedCity} -> ${data[0].ident} (${data[0].name})`);
        const result = data[0].ident;
        airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
        return result;
      }
    } catch (searchError) {
      console.log(`search_name query failed, usando fallback: ${searchError.message}`);
    }

    // 2. Fallback: logica originale per aeroporti principali
    let { data: majorAirports, error: majorError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'large_airport')
      .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
      .limit(1);

    if (!majorError && majorAirports && majorAirports.length > 0) {
      console.log(`Trovato aeroporto principale: ${majorAirports[0].ident} (${majorAirports[0].name})`);
      const result = majorAirports[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 3. Cerca aeroporti medi
    let { data: mediumAirports, error: mediumError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'medium_airport')
      .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
      .limit(1);

    if (!mediumError && mediumAirports && mediumAirports.length > 0) {
      console.log(`Trovato aeroporto medio: ${mediumAirports[0].ident} (${mediumAirports[0].name})`);
      const result = mediumAirports[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 4. Cerca per nome esatto
    let { data: exactNameData, error: exactNameError } = await supabase
      .from('Airport 2')
      .select('ident, name')
      .ilike('name', normalizedCity)
      .limit(1);

    if (!exactNameError && exactNameData && exactNameData.length > 0) {
      console.log(`Trovato per nome esatto: ${exactNameData[0].ident} (${exactNameData[0].name})`);
      const result = exactNameData[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 5. Cerca per comune esatto
    let { data: exactMunicipalityData, error: exactMunicipalityError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .ilike('municipality', normalizedCity)
      .limit(1);

    if (!exactMunicipalityError && exactMunicipalityData && exactMunicipalityData.length > 0) {
      console.log(`Trovato per comune esatto: ${exactMunicipalityData[0].ident} (${exactMunicipalityData[0].name})`);
      const result = exactMunicipalityData[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 6. Cerca per nome parziale
    let { data: partialNameData, error: partialNameError } = await supabase
      .from('Airport 2')
      .select('ident, name')
      .ilike('name', `%${normalizedCity}%`)
      .limit(1);

    if (!partialNameError && partialNameData && partialNameData.length > 0) {
      console.log(`Trovato per nome parziale: ${partialNameData[0].ident} (${partialNameData[0].name})`);
      const result = partialNameData[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 7. Cerca per comune parziale
    let { data: partialMunicipalityData, error: partialMunicipalityError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .ilike('municipality', `%${normalizedCity}%`)
      .limit(1);

    if (!partialMunicipalityError && partialMunicipalityData && partialMunicipalityData.length > 0) {
      console.log(`Trovato per comune parziale: ${partialMunicipalityData[0].ident} (${partialMunicipalityData[0].name})`);
      const result = partialMunicipalityData[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    // 8. Cerca in qualsiasi campo (ultima opzione)
    let { data: anyFieldData, error: anyFieldError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .or(`name.ilike.%${normalizedCity}%,municipality.ilike.%${normalizedCity}%,ident.ilike.%${normalizedCity}%,iso_region.ilike.%${normalizedCity}%`)
      .order('type')
      .limit(1);

    if (!anyFieldError && anyFieldData && anyFieldData.length > 0) {
      console.log(`Trovato in qualsiasi campo: ${anyFieldData[0].ident} (${anyFieldData[0].name})`);
      const result = anyFieldData[0].ident;
      airportCache.set(normalizedCity, { data: result, timestamp: Date.now() });
      return result;
    }

    console.log(`Nessun aeroporto trovato per: ${normalizedCity}`);
    return null;

  } catch (error) {
    console.error(`Errore nella ricerca dell'aeroporto per ${cityName}:`, error);
    return null;
  }
}

// Calcola orario di arrivo stimato
function calculateArrivalTime(departureTime, flightTimeHours) {
  if (!departureTime) return null;
  
  try {
    const [hours, minutes] = departureTime.split(':').map(Number);
    const depMinutes = hours * 60 + minutes;
    const flightMinutes = flightTimeHours * 60;
    const arrMinutes = depMinutes + flightMinutes;
    
    const arrHours = Math.floor(arrMinutes / 60) % 24;
    const arrMins = Math.round(arrMinutes % 60);
    
    return `${arrHours.toString().padStart(2, '0')}:${arrMins.toString().padStart(2, '0')}`;
  } catch (error) {
    return null;
  }
}

// Calcola costo repositioning per voli AR
function calculateRepositioningCost(jet, daysBetween) {
  const parkingCostPerDay = jet.parking_cost_per_day || 500; // Default €500/giorno
  const repositioningHours = 1; // Tempo stimato per riposizionamento
  
  return (parkingCostPerDay * daysBetween) + (jet.hourly_rate * repositioningHours * 0.5); // 50% del costo orario per riposizionamento
}

export default async function handler(req, res) {
  // Domain protection - CONTROLLI DI SICUREZZA
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  const origin = req.headers.origin || req.headers.referer;
  
  if (origin && !allowedOrigins.some(allowed => origin.startsWith(allowed.trim()))) {
    return res.status(403).json({ error: 'Access denied from this domain' });
  }

  // CORS headers
  if (allowedOrigins.some(allowed => origin?.startsWith(allowed.trim()))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    console.log('Richiesta ricevuta:', req.body);

    let { departure, arrival, from, to, pax, date, time, returnDate, returnTime, tripType = 'oneway' } = req.body;

    const departureInput = departure || from || '';
    const arrivalInput = arrival || to || '';

    if (!departureInput || !arrivalInput) {
      return res.status(400).json({
        error: 'Mancano dati di partenza o arrivo',
        required_format: {
          from: "Nome città o codice ICAO (es. 'milan' o 'LIML')",
          to: "Nome città o codice ICAO (es. 'malaga' o 'LEMG')",
          date: "Data in formato YYYY-MM-DD (opzionale)",
          returnDate: "Data di ritorno in formato YYYY-MM-DD (per A/R)",
          tripType: "'oneway' o 'roundtrip'",
          time: "Orario partenza in formato HH:MM (opzionale)",
          returnTime: "Orario ritorno in formato HH:MM (opzionale per A/R)",
          pax: "Numero passeggeri (opzionale, default: 4)"
        }
      });
    }

    // Validazione per roundtrip
    if (tripType === 'roundtrip' && !returnDate) {
      return res.status(400).json({
        error: 'Data di ritorno richiesta per voli A/R',
        tripType: tripType
      });
    }

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

    const { data: specificAirports, error: specificError } = await supabase
      .from('Airport 2')
      .select('id, ident, name, latitude, longitude')
      .or(`ident.eq.${depCode},ident.eq.${arrCode}`);

    if (specificError) {
      console.error('Errore nella ricerca degli aeroporti specifici:', specificError);
      return res.status(500).json({ error: specificError.message });
    }

    if (!specificAirports || specificAirports.length < 2) {
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

    const { data: jets, error: jetError } = await supabase.from('jet').select('*');
    if (jetError) return res.status(500).json({ error: jetError.message });

    const uniqueHomebases = [...new Set(jets.map(j => j.homebase?.trim().toUpperCase()).filter(Boolean))];

    const { data: baseAirports, error: baseError } = await supabase
      .from('Airport 2')
      .select('id, ident, latitude, longitude')
      .in('ident', uniqueHomebases);

    if (baseError) return res.status(500).json({ error: baseError.message });

    baseAirports.forEach(a => {
      AIRPORTS[a.ident.trim().toUpperCase()] = {
        lat: parseFloat(a.latitude),
        lon: parseFloat(a.longitude)
      };
    });

    // Formattazione date
    let formattedDate = date;
    let formattedReturnDate = returnDate;
    let daysBetween = 0;

    if (date) {
      try {
        const currentYear = 2025;
        let dateObj;

        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateObj = new Date(date);
        } else if (date.match(/\d{1,2}\s+\w+/)) {
          const withYear = `${date} ${currentYear}`;
          dateObj = new Date(withYear);
        } else {
          dateObj = new Date(date);
        }

        if (!isNaN(dateObj.getTime())) {
          if (dateObj.getFullYear() < currentYear) {
            dateObj.setFullYear(currentYear);
          }
          formattedDate = dateObj.toISOString().split('T')[0];
        }
      } catch (error) {
        console.error('Errore nella formattazione della data:', error);
      }
    }

    if (returnDate && tripType === 'roundtrip') {
      try {
        const returnDateObj = new Date(returnDate);
        if (!isNaN(returnDateObj.getTime())) {
          formattedReturnDate = returnDateObj.toISOString().split('T')[0];
          
          // Calcola giorni tra andata e ritorno
          const depDate = new Date(formattedDate);
          const retDate = new Date(formattedReturnDate);
          daysBetween = Math.ceil((retDate - depDate) / (1000 * 60 * 60 * 24));
        }
      } catch (error) {
        console.error('Errore nella formattazione della data di ritorno:', error);
      }
    }

    const jetsNearby = jets.filter((jet) => {
      const home = jet.homebase?.trim().toUpperCase();
      const base = AIRPORTS[home];
      if (!base) return false;
      const dist = getDistanceKm(dep.lat, dep.lon, base.lat, base.lon);
      return dist <= 500;
    });

    const distance = getDistanceKm(dep.lat, dep.lon, arr.lat, arr.lon);

    // Pre-calcola orario di ritorno per l'input (usando il primo jet come riferimento)
    const sampleJet = jetsNearby.find(j => j.speed_knots || j.speed);
    let inputReturnTime = returnTime;
    
    if (tripType === 'roundtrip' && !returnTime && sampleJet) {
      const sampleSpeed = (sampleJet.speed_knots || sampleJet.speed) * 1.852;
      const sampleFlightTime = distance / sampleSpeed;
      const departureTime = time || "12:00";
      
      if (daysBetween === 0) {
        // Same-day: calcola orario automatico
        const arrivalTime = calculateArrivalTime(departureTime, sampleFlightTime);
        if (arrivalTime) {
          const [arrHours, arrMinutes] = arrivalTime.split(':').map(Number);
          const totalMinutes = arrHours * 60 + arrMinutes + 60; // +1 ora
          const retHours = Math.floor(totalMinutes / 60) % 24;
          const retMinutes = totalMinutes % 60;
          inputReturnTime = `${retHours.toString().padStart(2, '0')}:${retMinutes.toString().padStart(2, '0')}`;
        } else {
          inputReturnTime = departureTime;
        }
      } else {
        inputReturnTime = departureTime;
      }
    }

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
          trip_type: tripType,
          outbound_price: null,
          return_price: null,
          total_price: null,
          warning: 'Velocità mancante o non valida',
        };
      }

      const speed_kmh = knots * 1.852;
      const flightTime = distance / speed_kmh;
      
      let outboundCost, returnCost = 0, repositioningCost = 0, totalCost;
      
      if (tripType === 'roundtrip') {
        if (daysBetween === 0) {
          // Same-day: andata x2 + 20% (jet aspetta)
          outboundCost = jet.hourly_rate * flightTime * 2;
          const sameDayTotal = outboundCost * 1.20; // +20%
          returnCost = sameDayTotal - outboundCost; // Il resto è considerato "return cost"
          repositioningCost = 0; // Nessun costo parcheggio
          totalCost = sameDayTotal;
        } else if (daysBetween === 1) {
          // Next-day: andata x2 + 20% + €1000 overnight
          outboundCost = jet.hourly_rate * flightTime * 2;
          const baseCost = outboundCost * 1.20; // +20%
          const overnightCost = 1000; // Costo pernottamento crew + jet
          returnCost = baseCost - outboundCost; // Il 20% di premium
          repositioningCost = overnightCost; // €1000 overnight
          totalCost = baseCost + overnightCost;
        } else {
          // Multi-day: due voli one-way indipendenti (x2 ciascuno)
          outboundCost = jet.hourly_rate * flightTime * 2; // One-way andata
          returnCost = jet.hourly_rate * flightTime * 2;   // One-way ritorno
          repositioningCost = 0; // Nessun costo aggiuntivo - trattati come voli separati
          totalCost = outboundCost + returnCost;
        }
      } else {
        // Solo andata: x2 perché il jet deve tornare alla base
        outboundCost = jet.hourly_rate * flightTime * 2;
        totalCost = outboundCost;
      }
      
      // Calcola orari con logica same-day
      const departureTime = time || "12:00";
      let returnDepartureTime = null;
      
      if (tripType === 'roundtrip') {
        if (returnTime) {
          // Orario di ritorno specificato esplicitamente
          returnDepartureTime = returnTime;
        } else if (daysBetween === 0) {
          // Same-day: calcola orario automatico (arrivo + 1 ora)
          const arrivalTime = calculateArrivalTime(departureTime, flightTime);
          if (arrivalTime) {
            const [arrHours, arrMinutes] = arrivalTime.split(':').map(Number);
            const totalMinutes = arrHours * 60 + arrMinutes + 60; // +1 ora
            const retHours = Math.floor(totalMinutes / 60) % 24;
            const retMinutes = totalMinutes % 60;
            returnDepartureTime = `${retHours.toString().padStart(2, '0')}:${retMinutes.toString().padStart(2, '0')}`;
          } else {
            returnDepartureTime = departureTime; // Fallback
          }
        } else {
          // Multi-day: usa stesso orario dell'andata
          returnDepartureTime = departureTime;
        }
      }
      
      const departureArrival = calculateArrivalTime(departureTime, flightTime);
      const returnArrival = returnDepartureTime 
        ? calculateArrivalTime(returnDepartureTime, flightTime) 
        : null;

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
        flight_time_h: flightTime.toFixed(2), // Sempre il tempo della singola tratta
        flight_time_pretty: formatted,        // Sempre il tempo della singola tratta
        trip_type: tripType,
        outbound_price: Math.round(outboundCost),
        return_price: tripType === 'roundtrip' ? Math.round(returnCost) : null,
        repositioning_cost: tripType === 'roundtrip' ? Math.round(repositioningCost) : null,
        total_price: Math.round(totalCost),
        days_between: tripType === 'roundtrip' ? daysBetween : null,
        departure_time: departureTime,
        departure_arrival: departureArrival,
        return_departure_time: returnDepartureTime,
        return_arrival: returnArrival,
      };
    });

    results.sort((a, b) => (a.total_price ?? Infinity) - (b.total_price ?? Infinity));

    return res.status(200).json({
      input: {
        departure: departureInput,
        arrival: arrivalInput,
        departure_icao: depCode,
        departure_name: dep.name,
        arrival_icao: arrCode,
        arrival_name: arr.name,
        date: formattedDate || null,
        return_date: formattedReturnDate || null,
        trip_type: tripType,
        time: time || "12:00",
        return_time: (tripType === 'roundtrip') ? inputReturnTime : null,
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
