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

// Wrapper per tutte le query Supabase
async function safeSupabaseQuery(queryFn, context) {
  try {
    const result = await queryFn();
    if (result.error) {
      console.error(`Supabase error in ${context}:`, result.error);
      return { data: null, error: result.error };
    }
    return result;
  } catch (error) {
    console.error(`Unexpected error in ${context}:`, error);
    return { data: null, error };
  }
}

// Validazione input migliorata per multileg
function validateFlightRequest(body) {
  const errors = [];
  
  const tripType = body.tripType || 'oneway';
  
  if (tripType === 'multileg') {
    // Validazione per multileg
    if (!body.legs || !Array.isArray(body.legs)) {
      errors.push('Per multileg è richiesto un array "legs"');
      return errors;
    }
    
    if (body.legs.length < 2) {
      errors.push('Multileg richiede almeno 2 tratte');
    }
    
    if (body.legs.length > 10) {
      errors.push('Massimo 10 tratte per multileg');
    }
    
    // Valida ogni tratta
    body.legs.forEach((leg, index) => {
      if (!leg.from || !leg.to) {
        errors.push(`Tratta ${index + 1}: mancano from/to`);
      }
      
      if (leg.date) {
        const legDate = new Date(leg.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (isNaN(legDate.getTime())) {
          errors.push(`Tratta ${index + 1}: formato data non valido`);
        } else if (legDate < today) {
          errors.push(`Tratta ${index + 1}: data non può essere nel passato`);
        }
        
        // Controlla ordine cronologico delle date
        if (index > 0 && body.legs[index - 1].date) {
          const prevDate = new Date(body.legs[index - 1].date);
          if (legDate <= prevDate) {
            errors.push(`Tratta ${index + 1}: data deve essere successiva alla tratta precedente`);
          }
        }
      }
    });
    
  } else {
    // Validazione per oneway/roundtrip
    const departureInput = body.departure || body.from || '';
    const arrivalInput = body.arrival || body.to || '';
    
    if (!departureInput || !arrivalInput) {
      errors.push('Mancano dati di partenza o arrivo');
    }
    
    // Valida date
    if (body.date) {
      const requestDate = new Date(body.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (isNaN(requestDate.getTime())) {
        errors.push('Formato data non valido');
      } else if (requestDate < today) {
        errors.push('Data non può essere nel passato');
      }
    }
    
    // Valida data di ritorno se presente
    if (body.returnDate) {
      const returnDate = new Date(body.returnDate);
      const departureDate = new Date(body.date);
      
      if (isNaN(returnDate.getTime())) {
        errors.push('Formato data di ritorno non valido');
      } else if (body.date && returnDate <= departureDate) {
        errors.push('Data di ritorno deve essere successiva alla partenza');
      }
    }
  }
  
  // Valida pax (numero ragionevole)
  if (body.pax && (body.pax < 1 || body.pax > 50)) {
    errors.push('Numero passeggeri deve essere tra 1 e 50');
  }
  
  // Valida tipo viaggio
  if (!['oneway', 'roundtrip', 'multileg'].includes(tripType)) {
    errors.push('Tipo viaggio deve essere "oneway", "roundtrip" o "multileg"');
  }
  
  return errors;
}

// Funzione migliorata per cercare aeroporti con scoring
async function getCityToICAOImproved(cityName, countryHint = null) {
  if (!cityName) return null;

  const normalizedCity = normalizeInput(cityName);
  
  // Controlla cache
  const cacheKey = `${normalizedCity}_${countryHint || ''}`;
  const cached = airportCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_EXPIRY) {
    console.log(`Cache hit per: ${normalizedCity}`);
    return cached.data;
  }

  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    const result = { code: cityName, confidence: 100 };
    airportCache.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  }

  console.log(`Cercando codice ICAO per: ${normalizedCity}`);

  const searchResults = [];
  
  // Query prioritizzate per tipo aeroporto
  const airportTypes = [
    { type: 'large_airport', weight: 100 },
    { type: 'medium_airport', weight: 80 },
    { type: 'small_airport', weight: 60 }
  ];

  try {
    for (const airportType of airportTypes) {
      const queryResult = await safeSupabaseQuery(
        () => supabase
          .from('Airport 2')
          .select('ident, name, type, municipality, iso_country')
          .eq('type', airportType.type)
          .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
          .limit(5),
        `search_${airportType.type}`
      );

      if (queryResult.data) {
        queryResult.data.forEach(airport => {
          let confidence = airportType.weight;
          
          // Bonus per match esatto
          if (normalizeInput(airport.municipality) === normalizedCity) {
            confidence += 20;
          }
          if (normalizeInput(airport.name).includes(normalizedCity)) {
            confidence += 15;
          }
          
          // Bonus per paese hint
          if (countryHint && airport.iso_country === countryHint) {
            confidence += 10;
          }
          
          searchResults.push({
            code: airport.ident,
            name: airport.name,
            municipality: airport.municipality,
            type: airport.type,
            confidence: confidence
          });
        });
      }
    }

    // Se non trovato, ricerca generica
    if (searchResults.length === 0) {
      const generalQuery = await safeSupabaseQuery(
        () => supabase
          .from('Airport 2')
          .select('ident, name, municipality, type')
          .or(`name.ilike.%${normalizedCity}%,municipality.ilike.%${normalizedCity}%,ident.ilike.%${normalizedCity}%`)
          .order('type')
          .limit(3),
        'general_search'
      );

      if (generalQuery.data) {
        generalQuery.data.forEach(airport => {
          searchResults.push({
            code: airport.ident,
            name: airport.name,
            municipality: airport.municipality,
            type: airport.type,
            confidence: 40
          });
        });
      }
    }

    // Ordina per confidence e restituisci il migliore
    searchResults.sort((a, b) => b.confidence - a.confidence);
    
    if (searchResults.length > 0) {
      const best = searchResults[0];
      console.log(`Trovato aeroporto: ${best.code} (${best.name}) - Confidence: ${best.confidence}`);
      
      const result = { 
        code: best.code, 
        name: best.name,
        municipality: best.municipality,
        confidence: best.confidence 
      };
      
      // Salva in cache
      airportCache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    }

    console.log(`Nessun aeroporto trovato per: ${normalizedCity}`);
    return null;

  } catch (error) {
    console.error(`Errore nella ricerca dell'aeroporto per ${cityName}:`, error);
    return null;
  }
}

// Calcola costo repositioning
function calculateRepositioningCost(jet, hours, type = 'parking') {
  const parkingCostPerDay = jet.parking_cost_per_day || 500;
  const repositioningHours = 2;
  
  if (type === 'parking') {
    const days = Math.ceil(hours / 24);
    return (parkingCostPerDay * days) + (jet.hourly_rate * repositioningHours);
  }
  
  // Per multileg: costo di attesa tra voli
  if (type === 'waiting') {
    const waitingCostPerHour = jet.hourly_rate * 0.3; // 30% del costo orario
    return waitingCostPerHour * hours;
  }
  
  return 0;
}

// Formatta data
function formatDate(dateInput) {
  if (!dateInput) return null;
  
  try {
    const currentYear = new Date().getFullYear();
    let dateObj;

    if (dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
      dateObj = new Date(dateInput);
    } else if (dateInput.match(/\d{1,2}\s+\w+/)) {
      const withYear = `${dateInput} ${currentYear}`;
      dateObj = new Date(withYear);
    } else {
      dateObj = new Date(dateInput);
    }

    if (!isNaN(dateObj.getTime())) {
      if (dateObj.getFullYear() < currentYear) {
        dateObj.setFullYear(currentYear);
      }
      return dateObj.toISOString().split('T')[0];
    }
  } catch (error) {
    console.error('Errore nella formattazione della data:', error);
  }
  
  return null;
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

// Processamento multileg
async function processMultilegRequest(legs, jets, AIRPORTS) {
  const resolvedLegs = [];
  
  // Risolvi tutti gli aeroporti per le tratte
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    
    console.log(`Processando tratta ${i + 1}: ${leg.from} -> ${leg.to}`);
    
    const fromResult = await getCityToICAOImproved(leg.from);
    const toResult = await getCityToICAOImproved(leg.to);
    
    if (!fromResult || !toResult) {
      throw new Error(`Aeroporto non trovato per tratta ${i + 1}: ${leg.from} -> ${leg.to}`);
    }
    
    resolvedLegs.push({
      leg_number: i + 1,
      from: leg.from,
      to: leg.to,
      from_icao: fromResult.code,
      to_icao: toResult.code,
      from_name: fromResult.name,
      to_name: toResult.name,
      date: formatDate(leg.date),
      time: leg.time || null,
      confidence: {
        from: fromResult.confidence,
        to: toResult.confidence
      }
    });
  }
  
  // Calcola distanze e tempi per ogni tratta
  const legDetails = resolvedLegs.map(leg => {
    const fromAirport = AIRPORTS[leg.from_icao];
    const toAirport = AIRPORTS[leg.to_icao];
    
    if (!fromAirport || !toAirport) {
      throw new Error(`Coordinate aeroporto mancanti per ${leg.from_icao} o ${leg.to_icao}`);
    }
    
    const distance = getDistanceKm(
      fromAirport.lat, fromAirport.lon,
      toAirport.lat, toAirport.lon
    );
    
    return {
      ...leg,
      distance_km: Math.round(distance),
      from_coords: { lat: fromAirport.lat, lon: fromAirport.lon },
      to_coords: { lat: toAirport.lat, lon: toAirport.lon }
    };
  });
  
  // Trova jet compatibili per tutto il tour
  const suitableJets = [];
  
  jets.forEach(jet => {
    const knots = jet.speed_knots || jet.speed || null;
    if (!knots || knots === 0) return;
    
    const speed_kmh = knots * 1.852;
    let totalCost = 0;
    let totalDistance = 0;
    let totalFlightTime = 0;
    const legCosts = [];
    
    // Calcola costi per ogni tratta
    legDetails.forEach((leg, index) => {
      const flightTime = leg.distance_km / speed_kmh;
      const legCost = jet.hourly_rate * flightTime;
      
      totalDistance += leg.distance_km;
      totalFlightTime += flightTime;
      totalCost += legCost;
      
      // Costo di attesa tra voli (se non è l'ultima tratta)
      let waitingCost = 0;
      if (index < legDetails.length - 1) {
        const currentDate = new Date(leg.date);
        const nextDate = new Date(legDetails[index + 1].date);
        const waitingHours = (nextDate - currentDate) / (1000 * 60 * 60);
        
        if (waitingHours > 2) { // Se l'attesa è più di 2 ore
          waitingCost = calculateRepositioningCost(jet, waitingHours, 'waiting');
          totalCost += waitingCost;
        }
      }
      
      const hours = Math.floor(flightTime);
      const minutes = Math.round((flightTime - hours) * 60);
      const formatted = `${hours > 0 ? hours + 'h ' : ''}${minutes}min`;
      
      legCosts.push({
        leg_number: leg.leg_number,
        distance_km: leg.distance_km,
        flight_time_h: flightTime.toFixed(2),
        flight_time_pretty: formatted,
        flight_cost: Math.round(legCost),
        waiting_cost: Math.round(waitingCost),
        departure_time: leg.time,
        estimated_arrival: leg.time ? calculateArrivalTime(leg.time, flightTime) : null
      });
    });
    
    // Verifica se il jet può coprire tutte le distanze
    const maxLegDistance = Math.max(...legDetails.map(l => l.distance_km));
    const jetRange = jet.range_km || 3000; // Default range se non specificato
    
    if (maxLegDistance > jetRange) {
      return; // Jet non può coprire una delle tratte
    }
    
    // Costo finale di riposizionamento (ritorno alla base)
    const homebase = jet.homebase?.trim().toUpperCase();
    const baseAirport = AIRPORTS[homebase];
    const lastLeg = legDetails[legDetails.length - 1];
    const lastAirport = AIRPORTS[lastLeg.to_icao];
    
    let finalRepositioningCost = 0;
    if (baseAirport && lastAirport) {
      const returnDistance = getDistanceKm(
        lastAirport.lat, lastAirport.lon,
        baseAirport.lat, baseAirport.lon
      );
      const returnFlightTime = returnDistance / speed_kmh;
      finalRepositioningCost = jet.hourly_rate * returnFlightTime;
      totalCost += finalRepositioningCost;
    }
    
    const totalHours = Math.floor(totalFlightTime);
    const totalMinutes = Math.round((totalFlightTime - totalHours) * 60);
    const totalFormatted = `${totalHours > 0 ? totalHours + 'h ' : ''}${totalMinutes}min`;
    
    suitableJets.push({
      jet_id: jet.id,
      model: jet.name || null,
      category: jet.category || null,
      seats: jet.seats || null,
      operator: jet.operator || null,
      logo: jet.logo_url || null,
      image: jet.image_url || null,
      home_base: jet.homebase,
      range_km: jetRange,
      total_distance_km: Math.round(totalDistance),
      total_flight_time_h: totalFlightTime.toFixed(2),
      total_flight_time_pretty: totalFormatted,
      total_price: Math.round(totalCost),
      final_repositioning_cost: Math.round(finalRepositioningCost),
      legs: legCosts,
      can_complete_tour: maxLegDistance <= jetRange
    });
  });
  
  // Ordina per prezzo
  suitableJets.sort((a, b) => a.total_price - b.total_price);
  
  return {
    legs: legDetails,
    jets: suitableJets
  };
}

export default async function handler(req, res) {
  try {
    console.log('Richiesta ricevuta:', req.body);

    // Validazione input
    const validationErrors = validateFlightRequest(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: 'Errori di validazione',
        details: validationErrors,
        required_format: {
          oneway: {
            from: "Nome città o codice ICAO",
            to: "Nome città o codice ICAO", 
            date: "Data YYYY-MM-DD",
            tripType: "oneway"
          },
          roundtrip: {
            from: "Nome città o codice ICAO",
            to: "Nome città o codice ICAO",
            date: "Data YYYY-MM-DD",
            returnDate: "Data YYYY-MM-DD",
            tripType: "roundtrip"
          },
          multileg: {
            tripType: "multileg",
            legs: [
              {"from": "Milano", "to": "Parigi", "date": "2025-07-15", "time": "09:00"},
              {"from": "Parigi", "to": "Londra", "date": "2025-07-16", "time": "14:00"}
            ]
          }
        }
      });
    }

    const tripType = req.body.tripType || 'oneway';

    // Ottieni jet disponibili
    const jetQuery = await safeSupabaseQuery(
      () => supabase.from('jet').select('*'),
      'jets'
    );

    if (!jetQuery.data) {
      return res.status(500).json({ error: 'Errore nel recupero dei jet' });
    }

    const jets = jetQuery.data;

    // Ottieni tutti gli aeroporti necessari
    let allIcaoCodes = [];
    
    if (tripType === 'multileg') {
      // Per multileg, raccogliamo tutti i codici dalle tratte
      for (const leg of req.body.legs) {
        const fromResult = await getCityToICAOImproved(leg.from);
        const toResult = await getCityToICAOImproved(leg.to);
        if (fromResult) allIcaoCodes.push(fromResult.code);
        if (toResult) allIcaoCodes.push(toResult.code);
      }
    } else {
      // Per oneway/roundtrip
      const departureInput = req.body.departure || req.body.from || '';
      const arrivalInput = req.body.arrival || req.body.to || '';
      
      const depResult = await getCityToICAOImproved(departureInput);
      const arrResult = await getCityToICAOImproved(arrivalInput);
      
      if (!depResult || !arrResult) {
        return res.status(400).json({
          error: 'Aeroporto non trovato',
          missing: {
            departure: departureInput,
            arrival: arrivalInput,
            departure_found: !!depResult,
            arrival_found: !!arrResult
          }
        });
      }
      
      allIcaoCodes = [depResult.code, arrResult.code];
    }

    // Aggiungi le basi dei jet
    const uniqueHomebases = [...new Set(jets.map(j => j.homebase?.trim().toUpperCase()).filter(Boolean))];
    allIcaoCodes = [...new Set([...allIcaoCodes, ...uniqueHomebases])];

    // Ottieni coordinate di tutti gli aeroporti
    const airportQuery = await safeSupabaseQuery(
      () => supabase
        .from('Airport 2')
        .select('id, ident, name, latitude, longitude')
        .in('ident', allIcaoCodes),
      'all_airports'
    );

    if (!airportQuery.data) {
      return res.status(500).json({ error: 'Errore nel recupero degli aeroporti' });
    }

    const AIRPORTS = {};
    airportQuery.data.forEach(a => {
      const code = a.ident.trim().toUpperCase();
      AIRPORTS[code] = {
        name: a.name,
        lat: parseFloat(a.latitude),
        lon: parseFloat(a.longitude)
      };
    });

    // Processamento basato sul tipo di viaggio
    if (tripType === 'multileg') {
      const multilegResult = await processMultilegRequest(req.body.legs, jets, AIRPORTS);
      
      return res.status(200).json({
        trip_type: 'multileg',
        legs: multilegResult.legs,
        jets: multilegResult.jets,
        summary: {
          total_legs: multilegResult.legs.length,
          total_jets_found: multilegResult.jets.length,
          total_distance_km: multilegResult.jets[0]?.total_distance_km || 0
        }
      });
      
    } else {
      // Logica esistente per oneway/roundtrip
      const { 
        departure, arrival, from, to, pax = 4, 
        date, time, returnDate 
      } = req.body;

      const departureInput = departure || from || '';
      const arrivalInput = arrival || to || '';

      const depResult = await getCityToICAOImproved(departureInput);
      const arrResult = await getCityToICAOImproved(arrivalInput);
      
      const depCode = depResult.code;
      const arrCode = arrResult.code;
      const dep = AIRPORTS[depCode];
      const arr = AIRPORTS[arrCode];

      const formattedDate = formatDate(date);
      const formattedReturnDate = formatDate(returnDate);

      let daysBetween = 0;
      if (tripType === 'roundtrip' && formattedDate && formattedReturnDate) {
        const depDate = new Date(formattedDate);
        const retDate = new Date(formattedReturnDate);
        daysBetween = Math.ceil((retDate - depDate) / (1000 * 60 * 60 * 24));
      }

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
            trip_type: tripType,
            outbound_price: null,
            return_price: null,
            total_price: null,
            warning: 'Velocità mancante o non valida',
          };
        }

        const speed_kmh = knots * 1.852;
        const flightTime = distance / speed_kmh;
        const outboundCost = jet.hourly_rate * flightTime;
        
        let returnCost = 0;
        let repositioningCost = 0;
        
        if (tripType === 'roundtrip') {
          returnCost = jet.hourly_rate * flightTime;
          repositioningCost = calculateRepositioningCost(jet, daysBetween * 24, 'parking');
        }
        
        const totalCost = outboundCost + returnCost + repositioningCost;
        
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
          trip_type: tripType,
          outbound_price: Math.round(outboundCost),
          return_price: tripType === 'roundtrip' ? Math.round(returnCost) : null,
          repositioning_cost: tripType === 'roundtrip' ? Math.round(repositioningCost) : null,
          total_price: Math.round(totalCost),
          days_between: tripType === 'roundtrip' ? daysBetween : null,
          departure_time: time,
          estimated_arrival: time ? calculateArrivalTime(time, flightTime) : null
        };
      });

      results.sort((a, b) => (a.total_price ?? Infinity) - (b.total_price ?? Infinity));

      return res.status(200).json({
        input: {
          departure: departureInput,
          arrival: arrivalInput,
          departure_icao: depCode,
          departure_name: depResult.name,
          arrival_icao: arrCode,
          arrival_name: arrResult.name,
          date: formattedDate || null,
          return_date: formattedReturnDate || null,
          trip_type: tripType,
          time: time || null,
          pax: pax
        },
        search_confidence: {
          departure: depResult.confidence,
          arrival: arrResult.confidence
        },
        jets: results,
        summary: {
          total_jets_found: results.length,
          trip_type: tripType,
          distance_km: Math.round(distance)
        }
      });
    }

  } catch (error) {
    console.error('Errore imprevisto:', error);
    return res.status(500).json({
      error: 'Errore interno del server',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
