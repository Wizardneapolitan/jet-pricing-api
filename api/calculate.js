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

  // Se è già un codice ICAO, restituiscilo direttamente
  if (/^[A-Z]{4}$/.test(cityName)) {
    console.log(`Codice ICAO già fornito: ${cityName}`);
    return cityName;
  }

  console.log(`Cercando codice ICAO per: ${normalizedCity}`);

  try {
    let { data: majorAirports, error: majorError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'large_airport')
      .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
      .limit(1);

    if (!majorError && majorAirports && majorAirports.length > 0) {
      console.log(`Trovato aeroporto principale: ${majorAirports[0].ident} (${majorAirports[0].name})`);
      return majorAirports[0].ident;
    }

    let { data: mediumAirports, error: mediumError } = await supabase
      .from('Airport 2')
      .select('ident, name, type, municipality')
      .eq('type', 'medium_airport')
      .or(`municipality.ilike.%${normalizedCity}%,name.ilike.%${normalizedCity}%`)
      .limit(1);

    if (!mediumError && mediumAirports && mediumAirports.length > 0) {
      console.log(`Trovato aeroporto medio: ${mediumAirports[0].ident} (${mediumAirports[0].name})`);
      return mediumAirports[0].ident;
    }

    let { data: exactNameData, error: exactNameError } = await supabase
      .from('Airport 2')
      .select('ident, name')
      .ilike('name', normalizedCity)
      .limit(1);

    if (!exactNameError && exactNameData && exactNameData.length > 0) {
      console.log(`Trovato per nome esatto: ${exactNameData[0].ident} (${exactNameData[0].name})`);
      return exactNameData[0].ident;
    }

    let { data: exactMunicipalityData, error: exactMunicipalityError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .ilike('municipality', normalizedCity)
      .limit(1);

    if (!exactMunicipalityError && exactMunicipalityData && exactMunicipalityData.length > 0) {
      console.log(`Trovato per comune esatto: ${exactMunicipalityData[0].ident} (${exactMunicipalityData[0].name})`);
      return exactMunicipalityData[0].ident;
    }

    let { data: partialNameData, error: partialNameError } = await supabase
      .from('Airport 2')
      .select('ident, name')
      .ilike('name', `%${normalizedCity}%`)
      .limit(1);

    if (!partialNameError && partialNameData && partialNameData.length > 0) {
      console.log(`Trovato per nome parziale: ${partialNameData[0].ident} (${partialNameData[0].name})`);
      return partialNameData[0].ident;
    }

    let { data: partialMunicipalityData, error: partialMunicipalityError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .ilike('municipality', `%${normalizedCity}%`)
      .limit(1);

    if (!partialMunicipalityError && partialMunicipalityData && partialMunicipalityData.length > 0) {
      console.log(`Trovato per comune parziale: ${partialMunicipalityData[0].ident} (${partialMunicipalityData[0].name})`);
      return partialMunicipalityData[0].ident;
    }

    let { data: anyFieldData, error: anyFieldError } = await supabase
      .from('Airport 2')
      .select('ident, name, municipality')
      .or(`name.ilike.%${normalizedCity}%,municipality.ilike.%${normalizedCity}%,ident.ilike.%${normalizedCity}%,iso_region.ilike.%${normalizedCity}%`)
      .order('type')
      .limit(1);

    if (!anyFieldError && anyFieldData && anyFieldData.length > 0) {
      console.log(`Trovato in qualsiasi campo: ${anyFieldData[0].ident} (${anyFieldData[0].name})`);
      return anyFieldData[0].ident;
    }

    console.log(`Nessun aeroporto trovato per: ${normalizedCity}`);
    return null;

  } catch (error) {
    console.error(`Errore nella ricerca dell'aeroporto per ${cityName}:`, error);
    return null;
  }
}
export default async function handler(req, res) {
  try {
    console.log('Richiesta ricevuta:', req.body);

    let { departure, arrival, from, to, pax, date, time } = req.body;

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

    let formattedDate = date;
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
