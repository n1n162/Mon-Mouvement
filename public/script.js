// ===== GLOBALS =====
let schools = [];
let map;
let userPosition = null;
let userMarker = null;
let selectedDepartment = null;
let routePolylines = [];
let schoolsWithRoutes = [];
let currentSortKey = null;
let currentSortAsc = true;
let autocompleteDebounce = null;
let selectedSuggestionIndex = -1;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadDepartments();
  document.getElementById("geocodeBtn").addEventListener("click", () => getUserLocation()
  );
  setupAddressAutocomplete();
  setupCriterionToggle();
});

// ===== CRITERION TOGGLE =====
function setupCriterionToggle() {
  document.querySelectorAll('input[name="criterion"]').forEach(radio => {
    radio.addEventListener("change", updateCriterionUI);
  });
}

function updateCriterionUI() {
  const criterion = document.querySelector('input[name="criterion"]:checked').value;
  const input = document.getElementById("criterionValue");
  const icon = document.getElementById("criterionIcon");
  if (criterion === "distance") {
    input.placeholder = "Distance max (km)";
    input.max = 300;
    icon.className = "fas fa-road";
  } else {
    input.placeholder = "Temps de trajet max (min)";
    input.max = 180;
    icon.className = "fas fa-clock";
  }
}

// ===== DEPARTMENTS =====
function loadDepartments() {
  fetch('departements.json')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(data => {
      const actifs = data.filter(d => d.actif === true).sort((a, b) => a.code.localeCompare(b.code));
      const select = document.getElementById('departement');
      select.innerHTML = '<option value="">Choisissez votre département</option>';
      actifs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.code;
        opt.textContent = `${d.code} - ${d.nom}`;
        select.appendChild(opt);
      });
    })
    .catch(err => alert('Erreur chargement départements : ' + err.message));
}

document.getElementById("departement").addEventListener("change", function () {
  selectedDepartment = this.value;
  const deptName = this.options[this.selectedIndex].text;
  if (selectedDepartment) {
    document.getElementById("mapSection").style.display = "block";
    document.getElementById("mapInfo").textContent = `${deptName} - Chargement...`;
    loadSchoolsForDepartment(selectedDepartment, deptName);
    //getUserLocation();
  } else {
    document.getElementById("mapSection").style.display = "none";
    document.getElementById("searchSection").style.display = "none";
    document.getElementById("resultsSection").style.display = "none";
    if (map) { map.remove(); map = null; }
  }
});

function loadSchoolsForDepartment(code, name) {
  fetch(`schools_${code}.json`)
    .then(r => { if (!r.ok) throw new Error(`Fichier schools_${code}.json non trouvé`); return r.json(); })
    .then(data => {
      schools = data;
      const valid = schools.filter(s => s.latitude && s.longitude);
      document.getElementById("mapInfo").textContent =
        `${name} - ${schools.length} écoles (${valid.length} géolocalisées)`;
      initMapWithSchools(valid);
      document.getElementById("searchSection").style.display = "block";
    })
    .catch(err => {
      alert('Erreur chargement écoles : ' + err.message);
      document.getElementById("mapInfo").textContent = "Erreur chargement";
    });
}

// ===== USER POSITION =====
function setUserPosition(lat, lng, label) {
  userPosition = { lat, lng };
  const statusEl = document.getElementById("positionStatus");
  if (statusEl) statusEl.innerHTML =
    `<i class="fas fa-check-circle" style="color:#48bb78"></i> Position : ${label}`;
  const banner = document.getElementById("positionBanner");
  if (banner) banner.style.display = "none";

  if (userMarker && map) map.removeLayer(userMarker);
  if (map) {
    userMarker = L.marker([lat, lng], {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
      })
    }).addTo(map).bindPopup('<strong>📍 Votre position</strong><br>' + label).openPopup();
    map.setView([lat, lng], Math.max(map.getZoom(), 11));
  }
}

function getUserLocation() {
  if (!navigator.geolocation) { showPositionWarning(); return; }
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        const label = data.display_name;
        document.getElementById("adresse").value = label;
        setUserPosition(lat, lng, label);
      } catch {
        setUserPosition(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    },
    () => showPositionWarning(),
    { timeout: 8000 }
  );
}

function showPositionWarning() {
  const banner = document.getElementById("positionBanner");
  if (banner) banner.style.display = "block";
  const hint = document.getElementById("mapClickHint");
  if (hint) hint.style.display = "block";
  const statusEl = document.getElementById("positionStatus");
  if (statusEl) statusEl.innerHTML =
    `<i class="fas fa-info-circle" style="color:#e67e22"></i> Saisissez une adresse ou cliquez sur la carte.`;
}

async function geocodeAddress(address) {
  if (!address.trim()) return;
  closeSuggestions();
  const statusEl = document.getElementById("positionStatus");
  if (statusEl) statusEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Recherche...`;
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`
    );
    const data = await res.json();
    if (data.features?.length > 0) {
      const f = data.features[0];
      const [lng, lat] = f.geometry.coordinates;
      const label = f.properties.label;
      document.getElementById("adresse").value = label;
      setUserPosition(lat, lng, label);
    } else {
      if (statusEl) statusEl.innerHTML =
        `<i class="fas fa-times-circle" style="color:#e53e3e"></i> Adresse introuvable.`;
    }
  } catch {
    if (statusEl) statusEl.innerHTML =
      `<i class="fas fa-times-circle" style="color:#e53e3e"></i> Erreur de recherche.`;
  }
}

// ===== ADDRESS AUTOCOMPLETE =====
function closeSuggestions() {
  const list = document.getElementById("adresseSuggestions");
  if (list) list.style.display = "none";
  selectedSuggestionIndex = -1;
}

function setupAddressAutocomplete() {
  const input = document.getElementById("adresse");
  const list = document.getElementById("adresseSuggestions");
  if (!input || !list) return;

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(autocompleteDebounce);
    if (query.length < 3) { closeSuggestions(); return; }

    autocompleteDebounce = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=6&autocomplete=1`
        );
        const data = await res.json();
        if (!data.features?.length) { closeSuggestions(); return; }

        list.innerHTML = data.features.map(f => {
          const p = f.properties;
          const icon = p.type === 'housenumber' ? 'fa-home'
            : p.type === 'street' ? 'fa-road'
            : p.type === 'municipality' ? 'fa-city' : 'fa-map-marker-alt';
          const [lng, lat] = f.geometry.coordinates;
          return `<li data-lat="${lat}" data-lng="${lng}" data-label="${p.label.replace(/"/g, '&quot;')}">
            <i class="fas ${icon}"></i> <span>${p.label}</span>
            ${p.context ? `<small style="color:#9ca3af;margin-left:4px;">${p.context}</small>` : ''}
          </li>`;
        }).join('');
        list.style.display = "block";
        selectedSuggestionIndex = -1;

        list.querySelectorAll("li").forEach(li => {
          li.addEventListener("click", () => {
            input.value = li.querySelector('span').textContent;
            setUserPosition(parseFloat(li.dataset.lat), parseFloat(li.dataset.lng), li.dataset.label);
            closeSuggestions();
          });
        });
      } catch { closeSuggestions(); }
    }, 200); // 200ms au lieu de 300ms, l'API gouv est rapide
  });

  input.addEventListener("keydown", e => {
    const items = list.querySelectorAll("li");
    const visible = list.style.display !== "none" && items.length > 0;
    if (e.key === "Enter" && !visible) { e.preventDefault(); geocodeAddress(input.value); return; }
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
      items.forEach((li, i) => li.classList.toggle("active", i === selectedSuggestionIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
      items.forEach((li, i) => li.classList.toggle("active", i === selectedSuggestionIndex));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedSuggestionIndex >= 0) items[selectedSuggestionIndex].click();
      else geocodeAddress(input.value);
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  document.addEventListener("click", e => {
    if (!input.contains(e.target) && !list.contains(e.target)) closeSuggestions();
  });
}

// ===== MAP =====
function initMapWithSchools(validSchools) {
  if (map) map.remove();

  const center = validSchools.length > 0
    ? [
        validSchools.reduce((s, sc) => s + parseFloat(sc.latitude), 0) / validSchools.length,
        validSchools.reduce((s, sc) => s + parseFloat(sc.longitude), 0) / validSchools.length
      ]
    : [45.1885, 5.7245];

  map = L.map("map", { 
    tap: false,
    tapTolerance: 15
  }).setView(center, 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
  }).addTo(map);

  if (validSchools.length > 1) {
    map.fitBounds(
      L.latLngBounds(validSchools.map(s => [parseFloat(s.latitude), parseFloat(s.longitude)])),
      { padding: [20, 20] }
    );
  }

  displaySchoolMarkers(validSchools, false);
  initZones();

    
}

function displaySchoolMarkers(schoolsToShow, filtered) {
  map.eachLayer(layer => { 
    if (layer instanceof L.Marker && (!userMarker || layer !== userMarker)) {
      map.removeLayer(layer); 
    }
  });

  const iconUrl = filtered
    ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
    : 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';

  schoolsToShow.forEach((school) => {
    const lat = parseFloat(school.latitude);
    const lng = parseFloat(school.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const marker = L.marker([lat, lng], {
      icon: L.icon({
        iconUrl,
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
      })
    }).addTo(map);

    let routeIndex = -1;
    if (filtered && schoolsWithRoutes.length > 0) {
      routeIndex = schoolsWithRoutes.findIndex(s => 
        s.identifiant_de_l_etablissement === school.identifiant_de_l_etablissement
      );
    }

    // POPUP ULTRA-MINI : NOM + ITINÉRAIRE
    const popupContent = `
      <div style="width:200px;font-family:'Poppins',sans-serif;font-size:13px;">
        <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:10px 14px;border-radius:8px;margin:-10px -14px 12px -14px;text-align:center;">
          <strong>${school.nom_etablissement}</strong>
          ${filtered && school.distanceKm ? `<br><small style="opacity:0.9;">${school.distanceKm}km • ${school.durationMin}min</small>` : ''}
        </div>
        ${filtered && routeIndex >= 0 ? `
        <div style="text-align:center;">
          <button onclick="showRouteToSchool(${routeIndex});return false;" style="background:#ef4444;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-weight:600;width:100%;font-size:12px;">🛣️ Itinéraire</button>
        </div>` : ''}
      </div>
    `;

    marker.bindPopup(popupContent, {
      maxWidth: 210,
      className: 'school-popup mini-map-popup',
      closeButton: true,
      autoClose: true
    });

    marker.on('click', function() {
      this.openPopup();
    });
  });

  if (userMarker && map) userMarker.addTo(map);
}



// ===== HAVERSINE =====
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===== ORS API =====
async function getMatrixData(source, destinations, eviterPeage) {
  const res = await fetch('/api/matrix/ors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [source, ...destinations],
      profile: 'driving-car',
      avoid_highways: eviterPeage
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getRouteGeometry(source, destination, eviterPeage) {
  const res = await fetch('/api/route/ors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source, destination,
      profile: 'driving-car',
      avoid_highways: eviterPeage
    })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function extractRouteCoordinates(routeData) {
  if (routeData.routes?.[0]?.geometry) {
    const g = routeData.routes[0].geometry;
    if (typeof g === 'string') return decodePolyline(g);
  }
  if (routeData.features?.[0]?.geometry?.type === 'LineString') {
    return routeData.features[0].geometry.coordinates.map(c => [c[1], c[0]]);
  }
  return null;
}

// ===== ROUTE DISPLAY =====
async function showRouteToSchool(schoolIndex) {
  const school = schoolsWithRoutes[schoolIndex];
  if (!school) return;
  const eviterPeage = document.getElementById("eviterPeage").checked;
  try {
    const routeData = await getRouteGeometry(
      [userPosition.lng, userPosition.lat],
      [parseFloat(school.longitude), parseFloat(school.latitude)],
      eviterPeage
    );
    const coords = extractRouteCoordinates(routeData);
    if (coords) {
      clearAllRoutes();
      const polyline = L.polyline(coords, { color: '#e53e3e', weight: 4, opacity: 0.8 }).addTo(map);
      polyline.bindPopup(
        `<strong>🛣️ ${school.nom_etablissement}</strong><br>${school.distanceKm} km &bull; ${school.durationMin} min`
      );
      routePolylines.push(polyline);
      const bounds = L.latLngBounds(coords);
      bounds.extend([userPosition.lat, userPosition.lng]);
      map.fitBounds(bounds, { padding: [20, 20] });
      const mapEl = document.getElementById("map");
      mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (err) {
    alert("Erreur affichage route : " + err.message);
  }
}

function clearAllRoutes() {
  routePolylines.forEach(p => { if (map.hasLayer(p)) map.removeLayer(p); });
  routePolylines = [];
}

// ===== FORM SUBMISSION =====
document.getElementById("filterForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!selectedDepartment) { alert("Veuillez sélectionner un département."); return; }
  if (!userPosition) {
    document.getElementById("positionBanner").style.display = "block";
    document.getElementById("adresse").focus();
    alert("Définissez votre position : saisissez une adresse ou cliquez sur la carte.");
    return;
  }

  const type = document.getElementById("type").value;
  const statut = document.getElementById("statut").value;
  const educationPrioritaire = document.getElementById("educationPrioritaire").value;
  const criterion = document.querySelector('input[name="criterion"]:checked').value;
  const criterionValue = parseFloat(document.getElementById("criterionValue").value);
  const eviterPeage = document.getElementById("eviterPeage").checked;

  if (isNaN(criterionValue) || criterionValue <= 0) {
    alert(`Merci d'indiquer une valeur valide pour le ${criterion === 'distance' ? 'kilométrage' : 'temps de trajet'}.`);
    return;
  }

  document.getElementById("resultsSection").style.display = "block";

  // Filtres statiques
  let step = schools.filter(s => s.latitude && s.longitude);
  if (type) step = step.filter(s => s.type === type);
  if (statut) step = step.filter(s => s.statut_public_prive === statut);
  if (educationPrioritaire === "hors") {
    step = step.filter(s =>
      s.appartenance_education_prioritaire !== "REP" &&
      s.appartenance_education_prioritaire !== "REP+"
    );
  } else if (educationPrioritaire) {
    step = step.filter(s => s.appartenance_education_prioritaire === educationPrioritaire);
  }

  // Pré-filtre haversine pour limiter les appels API ORS
  // Pour distance : on garde une marge de 30% (routes plus longues qu'à vol d'oiseau)
  // Pour temps : on estime ~2 km/min en moyenne (120 km/h), marge très large
  const haversineRadius = criterion === 'distance' ? criterionValue * 1.3 : criterionValue * 2.5;
  console.log(`🔭 Rayon haversine = ${haversineRadius.toFixed(1)} km (critère=${criterion}, valeur=${criterionValue})`);

  const stepBefore = step.length;
  step.sort((a, b) => {
    const da = haversine(userPosition.lat, userPosition.lng, parseFloat(a.latitude), parseFloat(a.longitude));
    const db = haversine(userPosition.lat, userPosition.lng, parseFloat(b.latitude), parseFloat(b.longitude));
    return da - db;
  });
  const preFiltered = step.slice(0, 300);
  console.log(`🔽 Envoi à ORS : ${preFiltered.length} écoles`);

  if (!preFiltered.length) {
    document.getElementById("results").innerHTML =
      `<p><i class='fas fa-exclamation-triangle'></i> Aucune école dans un rayon de ${haversineRadius.toFixed(0)} km à vol d'oiseau avec ces filtres.</p>`;
    displaySchoolMarkers([], true);
    return;
  }

  try {
    const source = [userPosition.lng, userPosition.lat];
    const destinations = preFiltered.map(s => [parseFloat(s.longitude), parseFloat(s.latitude)]);
    const matrix = await getMatrixData(source, destinations, eviterPeage);

    const detailed = preFiltered.map((school, i) => ({
      ...school,
      durationMin: Math.floor(matrix.durations[0][i] / 60),
      distanceKm: (matrix.distances[0][i] / 1000).toFixed(2)
    }));

    // Filtre final selon le critère choisi
    console.log(`🔍 Filtre: critère=${criterion}, limite=${criterionValue}`);
    detailed.forEach(s => {
      const val = criterion === 'distance' ? parseFloat(s.distanceKm) : s.durationMin;
      const raw = criterion === 'distance' ? s.distanceKm : s.durationMin;
      console.log(`  ${s.nom_etablissement}: ${s.distanceKm}km, ${s.durationMin}min → valeur comparée=${raw} <= ${criterionValue} ? ${val <= criterionValue ? '✅' : '❌'}`);
    });

    const filtered = detailed.filter(school =>
      criterion === 'distance'
        ? parseFloat(school.distanceKm) <= criterionValue
        : school.durationMin <= criterionValue
    );

    const critLabel = criterion === 'distance'
      ? `≤ ${criterionValue} km`
      : `≤ ${criterionValue} min de trajet`;
    console.log(`✅ ${filtered.length} écoles correspondent au critère (${critLabel})`);

    // Résumé affiché avant le tableau (classe résumé-résultats pour persistance lors du tri)
    const summaryHTML = `<div class="results-summary" style="background:#ebf8ff;border:1px solid #90cdf4;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:13px;color:#2c5282;">
      <i class="fas fa-info-circle"></i>
      <strong>${filtered.length} école(s) trouvée(s)</strong> avec un trajet ${critLabel}
      &mdash; ${preFiltered.length} école(s) évaluée(s) par ORS dans un rayon de ${haversineRadius.toFixed(0)} km à vol d&#39;oiseau
    </div>`;
    document.getElementById("results").innerHTML = summaryHTML;

    // Déterminer le tri initial selon le critère choisi
    currentSortKey = (criterion === 'distance') ? 'distance' : 'time';
    currentSortAsc = true;

    // Trier immédiatement
    let sorted = [...filtered];
    if (currentSortKey === 'distance') {
      sorted.sort((a, b) => parseFloat(a.distanceKm) - parseFloat(b.distanceKm));
    } else {
      sorted.sort((a, b) => a.durationMin - b.durationMin);
    }

    schoolsWithRoutes = sorted;

    clearAllRoutes();
    displayResults(sorted, currentSortKey, currentSortAsc);
    displaySchoolMarkers(filtered, true);

    if (filtered.length > 0) {
      const allPoints = filtered
        .filter(s => s.latitude && s.longitude)
        .map(s => [parseFloat(s.latitude), parseFloat(s.longitude)]);
      allPoints.push([userPosition.lat, userPosition.lng]);
      map.fitBounds(L.latLngBounds(allPoints), { padding: [20, 20] });
    }
  } catch (err) {
    alert("Erreur de calcul (service ORS) : " + err.message);
  }
});

// ===== RESET =====
document.getElementById("resetBtn").addEventListener("click", () => {
  document.getElementById("filterForm").reset();
  document.getElementById("resultsSection").style.display = "none";
  schoolsWithRoutes = [];
  clearAllRoutes();
  updateCriterionUI();
  if (schools.length > 0) {
    displaySchoolMarkers(schools.filter(s => s.latitude && s.longitude), false);
    if (userMarker && map) userMarker.addTo(map);
  }
});

// AJOUTE CETTE FONCTION avant displayResults()
function showSchoolDetails(school, index) {
  const modal = document.createElement('div');
  modal.id = 'schoolModal';
  modal.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);
    z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;
  `;

  modal.innerHTML = `
    <div style="background:white;border-radius:16px;max-width:500px;max-height:90vh;width:90%;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:20px;border-radius:16px 16px 0 0;position:relative;">
        <h2 style="margin:0;font-size:1.4rem;">${school.nom_etablissement}</h2>
        ${school.distanceKm ? `<p style="margin:5px 0 0 0;font-size:0.9rem;opacity:0.9;">📏 ${school.distanceKm}km • ⏱️ ${school.durationMin}min</p>` : ''}
        <button onclick="document.getElementById('schoolModal').remove()" style="position:absolute;top:15px;right:15px;background:none;border:none;color:white;font-size:1.5rem;cursor:pointer;">×</button>
      </div>

      <div style="padding:24px;">
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:12px 16px;margin-bottom:20px;font-size:13px;">
          <span style="font-weight:600;color:#555;">RNE</span><span>${school.identifiant_de_l_etablissement}</span>
          <span style="font-weight:600;color:#555;">Statut</span><span>${school.statut_public_prive}</span>
          <span style="font-weight:600;color:#555;">Type</span><span>${school.type}</span>
          <span style="font-weight:600;color:#555;">Circonscription</span><span>${school.nom_circonscription || '-'}</span>
        </div>

        <div style="background:#f8f9fa;padding:16px;border-radius:12px;margin-bottom:20px;font-size:13px;">
          <i class="fas fa-map-marker-alt" style="color:#667eea;margin-right:8px;"></i>
          <strong>Adresse :</strong><br>${school.adresse_1 || ''}${school.adresse_2 ? ', ' + school.adresse_2 : ''}, ${school.code_postal} ${school.nom_commune}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;font-size:12px;">
          ${school.nombre_d_eleves ? `<span style="background:#dbeafe;color:#1e40af;padding:8px 12px;border-radius:8px;font-weight:500;"><i class="fas fa-users"></i> ${school.nombre_d_eleves} élèves</span>` : ''}
          ${school.ulis ? `<span style="background:#ecfdf5;color:#059669;padding:8px 12px;border-radius:8px;font-weight:500;"><i class="fas fa-universal-access"></i> ULIS ${school.ulis}</span>` : ''}
          ${school.appartenance_education_prioritaire ? `<span style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;font-weight:500;"><i class="fas fa-star"></i> ${school.appartenance_education_prioritaire}</span>` : ''}
        </div>

        <div style="display:grid;gap:12px;font-size:13px;">
          ${school.telephone ? `<div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-phone" style="color:#10b981;width:20px;"></i><a href="tel:${school.telephone.replace(/\s/g, '')}" style="color:#10b981;font-weight:500;">${school.telephone}</a></div>` : ''}
          ${school.web ? `<div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-globe" style="color:#3b82f6;width:20px;"></i><a href="${school.web.startsWith('http') ? school.web : 'https://'+school.web}" target="_blank" style="color:#3b82f6;font-weight:500;">Site web</a></div>` : ''}
          ${school.mail ? `<div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-envelope" style="color:#ec4899;width:20px;"></i><a href="mailto:${school.mail}" style="color:#ec4899;font-weight:500;">${school.mail}</a></div>` : ''}
        </div>

        ${school.date_maj_ligne ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;text-align:right;"><i class="fas fa-calendar-alt"></i> ${school.date_maj_ligne}</div>` : ''}

        ${schoolsWithRoutes.length > 0 ? `
        <div style="margin-top:20px;padding:16px;background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%);border-radius:12px;border-left:4px solid #3b82f6;">
          <div style="text-align:center;font-weight:600;color:#1e40af;margin-bottom:12px;">
            <i class="fas fa-road"></i> Actions rapides
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button onclick="showRouteToSchool(${index});document.getElementById('schoolModal').remove();return false;" style="background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);color:white;border:none;padding:12px;border-radius:8px;cursor:pointer;font-weight:600;">🛣️ Itinéraire</button>
            <button onclick="clearAllRoutes();return false;" style="background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1;padding:12px;border-radius:8px;cursor:pointer;font-weight:600;">🗑️ Effacer</button>
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Fermeture au clic extérieur
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}


// ===== RESULTS TABLE =====
function displayResults(results, sortKey = currentSortKey, sortAsc = currentSortAsc) {
  currentSortKey = sortKey;
  currentSortAsc = sortAsc;

  const div = document.getElementById("results");
  const existingSummary = div.querySelector('.results-summary');
  const summaryHTML = existingSummary ? existingSummary.outerHTML : '';

  if (!results.length) {
    div.innerHTML = summaryHTML + "<p class='no-results'><i class='fas fa-search'></i><br>Aucun résultat trouvé.</p>";
    return;
  }

  let sorted = [...results];
  if (sortKey === 'distance') {
    sorted.sort((a, b) => sortAsc
      ? parseFloat(a.distanceKm) - parseFloat(b.distanceKm)
      : parseFloat(b.distanceKm) - parseFloat(a.distanceKm));
  } else if (sortKey === 'time') {
    sorted.sort((a, b) => sortAsc
      ? a.durationMin - b.durationMin
      : b.durationMin - a.durationMin);
  }
  schoolsWithRoutes = sorted;

  const arrow = key => currentSortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  div.innerHTML = summaryHTML + `
    <div class="results-table-wrapper">
      <table class="results-table">
        <thead>
          <tr>
            <th class="col-rne">RNE</th>
            <th class="col-name">Nom école</th>
            <th class="col-statut">Statut</th>
            <th class="col-type">Type</th>
            <th class="col-addr">Adresse</th>
            <th class="col-km sortable" onclick="sortResults('distance')">Distance ${arrow('distance')}</th>
            <th class="col-min sortable" onclick="sortResults('time')">Temps ${arrow('time')}</th>
            <th class="col-route">Itinéraire</th>
            <th class="col-details" style="width:8%;">Détails</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((s, i) => `
            <tr>
              <td data-label="RNE">${s.identifiant_de_l_etablissement}</td>
              <td data-label="Nom école">${s.nom_etablissement}</td>
              <td data-label="Statut">${s.statut_public_prive}</td>
              <td data-label="Type">${s.type}</td>
              <td data-label="Adresse">${s.adresse_1 || ''}${s.adresse_2 ? ', ' + s.adresse_2 : ''}, ${s.code_postal} ${s.nom_commune}</td>
              <td data-label="Distance" class="num">${s.distanceKm} km</td>
              <td data-label="Temps" class="num">${s.durationMin} min</td>
              <td data-label="Itinéraire"><button onclick="showRouteToSchool(${i})" class="route-btn">🛣️ Voir</button></td>
              <td class="col-details" onclick="showSchoolDetails(${JSON.stringify(sorted[i]).replace(/"/g, '&quot;')}, ${i});event.stopPropagation();"><i class="fas fa-info-circle" style="color:#667eea;cursor:pointer;"></i></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}


function sortResults(key) {
  if (currentSortKey === key) currentSortAsc = !currentSortAsc;
  else { currentSortKey = key; currentSortAsc = true; }
  displayResults(schoolsWithRoutes, currentSortKey, currentSortAsc);
}


// ===== ZONES DE VOEUX =====
let zonesLayer = null;
let zonesVisible = false;
let zonesData = [];

// Charge les zones et crée le bouton dans l'interface
async function initZones() {
  try {
    const res = await fetch('zones_38.json');
    zonesData = await res.json();
    createZonesToggleButton();
  } catch (err) {
    console.warn('Zones non disponibles :', err.message);
  }
}

// Crée le bouton "Afficher les zones" sous la carte
function createZonesToggleButton() {
  // Évite les doublons
  if (document.getElementById('zonesToggleBtn')) return;

  const mapSection = document.getElementById('mapSection');
  if (!mapSection) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'zonesWrapper';
  wrapper.style.cssText = 'margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;';

  const btn = document.createElement('button');
  btn.id = 'zonesToggleBtn';
  btn.innerHTML = '🗺️ Afficher les zones de vœux';
  btn.style.cssText = `
    background: #667eea;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: background 0.2s;
  `;
  btn.addEventListener('click', toggleZones);

  wrapper.appendChild(btn);
  mapSection.appendChild(wrapper);
}

// Affiche ou masque les zones
async function toggleZones() {
  const btn = document.getElementById('zonesToggleBtn');
  if (!map) return;

  if (zonesVisible) {
    // Masquer
    if (zonesLayer) {
      map.removeLayer(zonesLayer);
      zonesLayer = null;
    }
    removeLegend();
    zonesVisible = false;
    btn.innerHTML = '🗺️ Afficher les zones de vœux';
    btn.style.background = '#667eea';
  } else {
    // Afficher
    btn.innerHTML = '⏳ Chargement...';
    btn.disabled = true;
    await drawZones();
    zonesVisible = true;
    btn.innerHTML = '🙈 Masquer les zones';
    btn.style.background = '#e53e3e';
    btn.disabled = false;
  }
}

// Récupère les contours GeoJSON d'une commune via l'API gouvernementale
async function getCommuneGeoJSON(nomCommune, codeInseeHint = null) {
  try {
    // Recherche par nom dans le département 38
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(nomCommune)}&codeDepartement=38&fields=nom,code,contour&format=json&geometry=contour`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.length > 0 && data[0].contour) {
      return data[0].contour;
    }
  } catch (e) {
    console.warn(`Contour introuvable pour : ${nomCommune}`);
  }
  return null;
}

// Dessine toutes les zones sur la carte
async function drawZones() {
  zonesLayer = L.layerGroup().addTo(map);
  const legendItems = [];

  for (const zone of zonesData) {
    const communeFeatures = [];

    for (const nomCommune of zone.communes) {
      const contour = await getCommuneGeoJSON(nomCommune);
      if (contour) {
        communeFeatures.push({
          type: 'Feature',
          properties: { nom: nomCommune, zone: zone.nom },
          geometry: contour
        });
      }
    }

    if (communeFeatures.length === 0) continue;

    const geoJsonLayer = L.geoJSON(
      { type: 'FeatureCollection', features: communeFeatures },
      {
        style: {
          color: zone.couleur,
          weight: 1.5,
          opacity: 0.8,
          fillColor: zone.couleur,
          fillOpacity: 0.25
        },
        onEachFeature: (feature, layer) => {
          layer.bindPopup(`
            <div style="font-family:'Poppins',sans-serif;min-width:160px;">
              <div style="background:${zone.couleur};color:white;padding:8px 12px;border-radius:6px;margin:-10px -14px 10px -14px;text-align:center;font-weight:600;">
                ${zone.nom}
              </div>
              <div style="font-size:12px;color:#555;">
                📍 ${feature.properties.nom}
              </div>
            </div>
          `);
          layer.on('mouseover', function () {
            this.setStyle({ fillOpacity: 0.5, weight: 2.5 });
          });
          layer.on('mouseout', function () {
            this.setStyle({ fillOpacity: 0.25, weight: 1.5 });
          });
        }
      }
    );

    geoJsonLayer.addTo(zonesLayer);
    legendItems.push({ nom: zone.nom, couleur: zone.couleur });
  }

  addLegend(legendItems);
}

// Ajoute une légende Leaflet en bas à droite
function addLegend(items) {
  removeLegend(); // évite les doublons

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const div = L.DomUtil.create('div', 'zones-legend');
    div.style.cssText = `
      background: white;
      padding: 10px 14px;
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      font-family: 'Poppins', sans-serif;
      font-size: 11px;
      max-height: 280px;
      overflow-y: auto;
      line-height: 1.8;
    `;
    div.innerHTML = `<strong style="font-size:12px;">Zones de vœux</strong><br>` +
      items.map(item => `
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${item.couleur};opacity:0.8;flex-shrink:0;"></span>
          <span>${item.nom}</span>
        </div>
      `).join('');
    return div;
  };

  legend.addTo(map);
  map._zonesLegend = legend;
}

// Supprime la légende
function removeLegend() {
  if (map._zonesLegend) {
    map.removeControl(map._zonesLegend);
    map._zonesLegend = null;
  }
}
