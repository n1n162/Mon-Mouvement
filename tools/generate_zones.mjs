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
const outputFile = inputFile ? inputFile.replace(`zones_${dept}.json`, `zones_${dept}.geojson`) : `../public/zones_${dept}.geojson`;

if (!inputFile) {
  console.error(`❌ Fichier zones_${dept}.json introuvable (cherché dans ./ et ../public/)`);
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
    console.warn(`⚠️  Impossible de télécharger schools_${dept}.json : ${e.message}`);
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

// ===== CHARGE LES COMMUNES GEO avec retry =====
async function fetchWithRetry(url, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { timeout: 30000 });
      if (res.ok) return res;
      if (res.status === 500 && i < retries - 1) {
        console.log(`\n  ⚠️  Erreur 500, retry ${i + 1}/${retries} dans ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (i < retries - 1) {
        console.log(`\n  ⚠️  Erreur réseau, retry ${i + 1}/${retries}...`);
        await new Promise(r => setTimeout(r, delay));
      } else throw e;
    }
  }
}

async function loadAllCommunes(codeDept) {
  console.log(`\n🗺️  Chargement des communes du département ${codeDept}...`);

  // Essaie d'abord sans contours pour récupérer les codes
  const listUrl = `https://geo.api.gouv.fr/communes?codeDepartement=${codeDept}&fields=nom,code&format=json`;
  const listRes = await fetchWithRetry(listUrl);
  const communeList = await listRes.json();
  console.log(`✅ ${communeList.length} communes listées`);

  // Charge les contours commune par commune (plus fiable)
  console.log(`📐 Chargement des contours un par un...`);
  const allCommunes = [];

  for (let i = 0; i < communeList.length; i++) {
    const c = communeList[i];
    const url = `https://geo.api.gouv.fr/communes/${c.code}?fields=nom,code,contour&geometry=contour&format=json`;
    try {
      const res = await fetch(url, { timeout: 10000 });
      if (res.ok) {
        const data = await res.json();
        if (data.contour) allCommunes.push(data);
      }
    } catch (e) {
      // Silencieux pour les erreurs individuelles
    }

    if ((i + 1) % 50 === 0 || i === communeList.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${communeList.length} communes traitées (${allCommunes.length} contours)`);
    }

    // Petite pause toutes les 10 communes pour ne pas saturer l'API
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n✅ ${allCommunes.length} contours chargés`);
  return allCommunes;
}

async function main() {
  const schoolIndex = await loadSchoolCommunes(dept);
  const allCommunes = await loadAllCommunes(dept);

  const geoIndex = {};
  for (const c of allCommunes) {
    geoIndex[normalize(c.nom)] = c;
  }

  const features = [];
  let totalFound = 0, totalMissed = 0;
  const correctedZones = [];

  for (const zone of zones) {
    console.log(`\n🔄 Zone : ${zone.nom} (${zone.communes.length} communes)`);
    const communePolygons = [];
    const missed = [];
    const correctedCommunes = [];

    for (const nom of zone.communes) {
      const realName = matchCommune(nom, schoolIndex);
      const commune = geoIndex[normalize(realName)] || geoIndex[normalize(nom)];

      if (commune && commune.contour) {
        try {
          communePolygons.push(turf.feature(commune.contour));
          correctedCommunes.push(realName);
          process.stdout.write('.');
        } catch (e) {
          missed.push(nom);
          correctedCommunes.push(realName);
          process.stdout.write('x');
        }
      } else {
        missed.push(nom);
        correctedCommunes.push(realName);
        process.stdout.write('?');
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

    let merged;
    try {
      merged = turf.union(turf.featureCollection(communePolygons));
    } catch (e) {
      console.log(`\n  ⚠️  Fusion échouée: ${e.message}`);
      merged = {
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: communePolygons.flatMap(p =>
            p.geometry.type === 'Polygon' ? [p.geometry.coordinates] : p.geometry.coordinates
          )
        }
      };
    }

    features.push({
      type: 'Feature',
      properties: {
        id: zone.id,
        nom: zone.nom,
        couleur: zone.couleur,
        nb_communes: communePolygons.length,
        nb_manquantes: missed.length
      },
      geometry: merged.geometry
    });

    console.log(`\n  ✅ ${communePolygons.length}/${zone.communes.length} communes fusionnées`);
  }

  fs.writeFileSync(inputFile, JSON.stringify(correctedZones, null, 2), 'utf8');
  console.log(`\n📝 ${inputFile} mis à jour`);

  const geojson = { type: 'FeatureCollection', features };
  const output = JSON.stringify(geojson);
  fs.writeFileSync(outputFile, output);

  console.log(`\n🎉 ${outputFile} généré !`);
  console.log(`   ${features.length} zones | ${totalFound} communes trouvées | ${totalMissed} manquantes`);
  console.log(`   📦 Taille : ${(output.length / 1024).toFixed(0)} Ko`);
  if (totalMissed > 0) {
    console.log(`\n💡 Communes manquantes — corrige dans ${inputFile} et relance`);
  }
  console.log(`\n👉 Upload ${outputFile} et ${inputFile} dans public/ sur ta branche V2`);
}

main().catch(console.error);
