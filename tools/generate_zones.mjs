// generate_zones.mjs
// Usage : node generate_zones.mjs 38
//         node generate_zones.mjs 59

import fetch from 'node-fetch';
import * as turf from '@turf/turf';
import fs from 'fs';

const dept = process.argv[2];
if (!dept) {
  console.error('❌ Merci de préciser un département : node generate_zones.mjs 38');
  process.exit(1);
}

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/n1n162/Mon-Mouvement/refs/heads/V2/public';

const inputFile = fs.existsSync(`zones_${dept}.json`) ? `zones_${dept}.json`
  : fs.existsSync(`../public/zones_${dept}.json`) ? `../public/zones_${dept}.json`
  : null;
const outputFile = inputFile
  ? inputFile.replace(`zones_${dept}.json`, `zones_${dept}.geojson`)
  : `../public/zones_${dept}.geojson`;

if (!inputFile) {
  console.error(`❌ Fichier zones_${dept}.json introuvable`);
  process.exit(1);
}
console.log(`📂 Fichier source : ${inputFile}`);
const zones = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// ===== NORMALISATION =====
function normalize(str) {
  return str.toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'\s]+/g, ' ')
    .trim();
}

// ===== CHARGE SCHOOLS =====
async function loadSchoolCommunes(dept) {
  const localFile = fs.existsSync(`schools_${dept}.json`) ? `schools_${dept}.json`
    : fs.existsSync(`../public/schools_${dept}.json`) ? `../public/schools_${dept}.json`
    : null;

  if (localFile) {
    console.log(`📚 Chargement local : ${localFile}`);
    const schools = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    return buildSchoolIndex(schools);
  }
  const url = `${GITHUB_RAW_BASE}/schools_${dept}.json`;
  console.log(`📥 Téléchargement depuis GitHub : schools_${dept}.json...`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const schools = await res.json();
    console.log(`✅ ${schools.length} écoles téléchargées`);
    return buildSchoolIndex(schools);
  } catch (e) {
    console.warn(`⚠️  Impossible : ${e.message}`);
    return null;
  }
}

function buildSchoolIndex(schools) {
  const communes = [...new Set(schools.map(s => s.nom_commune).filter(Boolean))];
  console.log(`🔗 ${communes.length} communes uniques indexées`);
  const index = {};
  communes.forEach(c => { index[normalize(c)] = c; });
  return index;
}

function matchCommune(nom, schoolIndex) {
  if (!schoolIndex) return nom;
  return schoolIndex[normalize(nom)] || nom;
}

// ===== CHARGE LE GEOJSON COMPLET DU DÉPARTEMENT =====
// Utilise le découpage communal de data.gouv.fr (inclut toutes les communes et communes déléguées)
async function loadAllCommunes(codeDept) {
  console.log(`\n🗺️  Téléchargement du GeoJSON complet du département ${codeDept}...`);

  const url = `https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements/${codeDept.padStart(2,'0')}-${getDeptName(codeDept)}/communes-${codeDept.padStart(2,'0')}-${getDeptName(codeDept)}.geojson`;

  let features = [];
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();
    features = geojson.features;
    console.log(`✅ ${features.length} communes dans le GeoJSON (gregoiredavid)`);
  } catch (e) {
    console.warn(`⚠️  Source gregoiredavid échouée : ${e.message}`);
  }

  // Rien à faire ici — les communes manquantes seront cherchées
  // automatiquement par nom dans l'API lors du traitement des zones

  console.log(`✅ Total : ${features.length} communes`);
  return features;
}

// Noms de départements pour l'URL gregoiredavid
function getDeptName(code) {
  const names = {
    '01': 'ain', '02': 'aisne', '03': 'allier', '04': 'alpes-de-haute-provence',
    '05': 'hautes-alpes', '06': 'alpes-maritimes', '07': 'ardeche', '08': 'ardennes',
    '09': 'ariege', '10': 'aube', '11': 'aude', '12': 'aveyron',
    '13': 'bouches-du-rhone', '14': 'calvados', '15': 'cantal', '16': 'charente',
    '17': 'charente-maritime', '18': 'cher', '19': 'correze', '21': 'cote-d-or',
    '22': 'cotes-d-armor', '23': 'creuse', '24': 'dordogne', '25': 'doubs',
    '26': 'drome', '27': 'eure', '28': 'eure-et-loir', '29': 'finistere',
    '30': 'gard', '31': 'haute-garonne', '32': 'gers', '33': 'gironde',
    '34': 'herault', '35': 'ille-et-vilaine', '36': 'indre', '37': 'indre-et-loire',
    '38': 'isere', '39': 'jura', '40': 'landes', '41': 'loir-et-cher',
    '42': 'loire', '43': 'haute-loire', '44': 'loire-atlantique', '45': 'loiret',
    '46': 'lot', '47': 'lot-et-garonne', '48': 'lozere', '49': 'maine-et-loire',
    '50': 'manche', '51': 'marne', '52': 'haute-marne', '53': 'mayenne',
    '54': 'meurthe-et-moselle', '55': 'meuse', '56': 'morbihan', '57': 'moselle',
    '58': 'nievre', '59': 'nord', '60': 'oise', '61': 'orne',
    '62': 'pas-de-calais', '63': 'puy-de-dome', '64': 'pyrenees-atlantiques',
    '65': 'hautes-pyrenees', '66': 'pyrenees-orientales', '67': 'bas-rhin',
    '68': 'haut-rhin', '69': 'rhone', '70': 'haute-saone', '71': 'saone-et-loire',
    '72': 'sarthe', '73': 'savoie', '74': 'haute-savoie', '75': 'paris',
    '76': 'seine-maritime', '77': 'seine-et-marne', '78': 'yvelines',
    '79': 'deux-sevres', '80': 'somme', '81': 'tarn', '82': 'tarn-et-garonne',
    '83': 'var', '84': 'vaucluse', '85': 'vendee', '86': 'vienne',
    '87': 'haute-vienne', '88': 'vosges', '89': 'yonne', '90': 'territoire-de-belfort',
    '91': 'essonne', '92': 'hauts-de-seine', '93': 'seine-saint-denis',
    '94': 'val-de-marne', '95': 'val-d-oise'
  };
  return names[code.padStart(2,'0')] || code;
}

// Charge une commune par son code INSEE (pour les communes récentes)
async function fetchCommuneByCode(code) {
  try {
    const url = `https://geo.api.gouv.fr/communes/${code}?fields=nom,code,contour&format=json&geometry=contour`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.contour) return null;
    return { type: 'Feature', properties: { nom: data.nom, code: data.code }, geometry: data.contour };
  } catch (e) { return null; }
}

// Fallback : API geo.gouv.fr
async function loadFromGeoAPI(codeDept) {
  console.log(`🔄 Fallback : API geo.gouv.fr...`);
  const url = `https://geo.api.gouv.fr/communes?codeDepartement=${codeDept}&fields=nom,code,contour&format=json&geometry=contour`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log(`✅ ${data.length} communes via API`);
    return data.filter(c => c.contour).map(c => ({
      type: 'Feature',
      properties: { nom: c.nom, code: c.code },
      geometry: c.contour
    }));
  } catch(e) {
    console.warn(`⚠️  API geo.gouv.fr échouée: ${e.message}`);
    return [];
  }
}

async function main() {
  const schoolIndex = await loadSchoolCommunes(dept);
  const features = await loadAllCommunes(dept);

  // Index par nom normalisé
  const geoIndex = {};
  for (const f of features) {
    const nom = f.properties.nom || f.properties.NOM_COM || f.properties.libelle;
    if (nom) geoIndex[normalize(nom)] = f;
  }

  console.log(`🔍 ${Object.keys(geoIndex).length} communes indexées pour la recherche`);

  const resultFeatures = [];
  let totalFound = 0, totalMissed = 0;
  const correctedZones = [];

  for (const zone of zones) {
    console.log(`\n🔄 Zone : ${zone.nom} (${zone.communes.length} communes)`);
    const communePolygons = [];
    const missed = [];
    const correctedCommunes = [];

    for (const nom of zone.communes) {
      const realName = matchCommune(nom, schoolIndex);
      const stripArticle = s => normalize(s).replace(/^(le|la|les|l) /, '');
      const feature = geoIndex[normalize(realName)]
        || geoIndex[normalize(nom)]
        || Object.values(geoIndex).find(f => {
            const fn = normalize(f.properties.nom || f.properties.NOM_COM || '');
            return stripArticle(fn) === stripArticle(realName)
                || stripArticle(fn) === stripArticle(nom);
          });

      if (feature && feature.geometry && feature.geometry.type) {
        try {
          const turfFeature = turf.feature(feature.geometry);
          if (turfFeature && turfFeature.geometry) {
            communePolygons.push(turfFeature);
            correctedCommunes.push(realName);
            process.stdout.write('.');
          } else {
            missed.push(nom);
            correctedCommunes.push(realName);
            process.stdout.write('x');
          }
        } catch (e) {
          missed.push(nom);
          correctedCommunes.push(realName);
          process.stdout.write('x');
        }
      } else {
        // Commune non trouvée dans le GeoJSON local
        // → recherche automatique par nom dans l'API geo.gouv.fr
        let found = false;
        const namesToTry = [realName, nom].filter((v, i, a) => a.indexOf(v) === i);
        for (const tryName of namesToTry) {
          try {
            const apiUrl = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(tryName)}&codeDepartement=${dept}&fields=nom,code&format=json&limit=3`;
            const apiRes = await fetch(apiUrl);
            if (!apiRes.ok) continue;
            const apiData = await apiRes.json();
            if (!apiData.length) continue;
            // Prendre la commune dont le nom normalisé correspond le mieux
            const stripArticle = s => normalize(s).replace(/^(le|la|les|l) /, '');
            const match = apiData.find(c =>
              normalize(c.nom) === normalize(tryName) ||
              stripArticle(normalize(c.nom)) === stripArticle(normalize(tryName))
            ) || apiData[0];
            const byCode = await fetchCommuneByCode(match.code);
            if (byCode) {
              const tf = turf.feature(byCode.geometry);
              communePolygons.push(tf);
              geoIndex[normalize(byCode.properties.nom)] = byCode;
              correctedCommunes.push(byCode.properties.nom); // nom officiel
              process.stdout.write('+');
              found = true;
              break;
            }
          } catch(e) { /* continue */ }
        }
        if (!found) {
          missed.push(nom);
          correctedCommunes.push(realName);
          process.stdout.write('?');
        }
      }
    }
    totalFound += communePolygons.length;
    totalMissed += missed.length;

    if (missed.length > 0) {
      console.log(`\n  ⚠️  Non trouvées (${missed.length}): ${missed.join(', ')}`);
    }

    correctedZones.push({ ...zone, communes: correctedCommunes });

    if (communePolygons.length === 0) {
      console.log(`  ❌ Zone ignorée`);
      continue;
    }

    // Filtrer les polygones valides avant la fusion
    const validPolygons = communePolygons.filter(p => p && p.geometry && p.geometry.type);
    if (validPolygons.length === 0) {
      console.log(`  ❌ Aucun polygone valide`);
      continue;
    }

    let merged;
    try {
      merged = turf.union(turf.featureCollection(validPolygons));
    } catch (e) {
      console.log(`\n  ⚠️  Fusion échouée: ${e.message}`);
      merged = {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: validPolygons.flatMap(p =>
            p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates
          )
        }
      };
    }

    resultFeatures.push({
      type: 'Feature',
      properties: {
        id: zone.id,
        nom: zone.nom,
        couleur: zone.couleur,
        nb_communes: validPolygons.length,
        nb_manquantes: missed.length
      },
      geometry: merged.geometry
    });

    console.log(`\n  ✅ ${validPolygons.length}/${zone.communes.length} communes fusionnées`);
  }

  fs.writeFileSync(inputFile, JSON.stringify(correctedZones, null, 2), 'utf8');
  console.log(`\n📝 ${inputFile} mis à jour`);

  const geojson = { type: 'FeatureCollection', features: resultFeatures };
  const output = JSON.stringify(geojson);
  fs.writeFileSync(outputFile, output);

  console.log(`\n🎉 ${outputFile} généré !`);
  console.log(`   ${resultFeatures.length} zones | ${totalFound} communes trouvées | ${totalMissed} manquantes`);
  console.log(`   📦 Taille : ${(output.length / 1024).toFixed(0)} Ko`);
  if (totalMissed > 0) {
    console.log(`\n💡 Communes manquantes — corrige dans ${inputFile} et relance`);
  }
  console.log(`\n👉 Upload ${outputFile} et ${inputFile} dans public/ sur ta branche V2`);
}

main().catch(console.error);
