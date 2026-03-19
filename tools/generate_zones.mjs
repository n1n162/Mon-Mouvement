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

// Cherche zones_XX.json dans tools/ ou public/
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

// ===== CHARGE SCHOOLS DEPUIS GITHUB =====
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

// ===== CHARGE LES COMMUNES EN 2 ÉTAPES =====
async function loadAllCommunes(codeDept) {
  console.log(`\n🗺️  Chargement des communes du département ${codeDept}...`);

  // Étape 1 : liste des codes communes (léger)
  const listUrl = `https://geo.api.gouv.fr/communes?codeDepartement=${codeDept}&fields=nom,code&format=json`;
  const listRes = await fetch(listUrl);
  if (!listRes.ok) throw new Error(`Erreur API liste : ${listRes.status}`);
  const communeList = await listRes.json();
  console.log(`✅ ${communeList.length} communes listées`);

  // Étape 2 : contours par batch de 50 codes
  console.log(`📐 Chargement des contours par batches...`);
  const allCommunes = [];
  const batchSize = 50;

  for (let i = 0; i < communeList.length; i += batchSize) {
    const batch = communeList.slice(i, i + batchSize);
    const codes = batch.map(c => c.code).join(',');
    const url = `https://geo.api.gouv.fr/communes?code=${codes}&fields=nom,code,contour&format=json&geometry=contour`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allCommunes.push(...data);
      process.stdout.write(`\r  ${allCommunes.length}/${communeList.length} contours chargés`);
    } catch (e) {
      console.warn(`\n  ⚠️  Erreur batch ${i}-${i+batchSize}: ${e.message}`);
    }

    // Petite pause pour ne pas surcharger l'API
    await new Promise(r => setTimeout(r, 100));
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

  // Réécrire zones_XX.json avec les noms corrigés
  fs.writeFileSync(inputFile, JSON.stringify(correctedZones, null, 2), 'utf8');
  console.log(`\n📝 ${inputFile} mis à jour avec les noms exacts`);

  const geojson = { type: 'FeatureCollection', features };
  const output = JSON.stringify(geojson);
  fs.writeFileSync(outputFile, output);

  console.log(`\n🎉 ${outputFile} généré !`);
  console.log(`   ${features.length} zones | ${totalFound} communes trouvées | ${totalMissed} manquantes`);
  console.log(`   📦 Taille : ${(output.length / 1024).toFixed(0)} Ko`);
  if (totalMissed > 0) {
    console.log(`\n💡 Communes toujours manquantes — corrige dans ${inputFile} et relance`);
  }
  console.log(`\n👉 Upload ${outputFile} et ${inputFile} dans public/ sur ta branche V2`);
}

main().catch(console.error);
