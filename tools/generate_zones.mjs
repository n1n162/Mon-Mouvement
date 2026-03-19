// generate_zones.mjs
// Usage : node generate_zones.mjs 38
//         node generate_zones.mjs 59
// Les fichiers schools_XX.json sont téléchargés automatiquement depuis GitHub

import fetch from 'node-fetch';
import * as turf from '@turf/turf';
import fs from 'fs';

const dept = process.argv[2];
if (!dept) {
  console.error('❌ Merci de préciser un département : node generate_zones.mjs 38');
  process.exit(1);
}

// ===== CONFIGURATION =====
// Remplace par ton URL GitHub Raw
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/n1n162/Mon-Mouvement/refs/heads/V2/public';

const inputFile = fs.existsSync(`zones_${dept}.json`) ? `zones_${dept}.json` : `../public/zones_${dept}.json`;
const outputFile = fs.existsSync(`zones_${dept}.json`) ? `zones_${dept}.geojson` : `../public/zones_${dept}.geojson`;

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Fichier ${inputFile} introuvable dans le dossier courant.`);
  process.exit(1);
}

const zones = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// ===== NORMALISATION =====
function normalize(str) {
  return str.toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'\s]+/g, ' ')
    .trim();
}

// ===== TÉLÉCHARGE SCHOOLS DEPUIS GITHUB =====
async function loadSchoolCommunes(dept) {
  // Essaie d'abord en local
  const localFile = fs.existsSync(`schools_${dept}.json`) ? `schools_${dept}.json`
    : fs.existsSync(`public/schools_${dept}.json`) ? `public/schools_${dept}.json`
    : null;

  if (localFile) {
    console.log(`📚 Chargement local : ${localFile}`);
    const schools = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    return buildSchoolIndex(schools);
  }

  // Sinon télécharge depuis GitHub
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
    console.warn(`   Les noms de communes ne seront pas corrigés automatiquement`);
    return null;
  }
}

function buildSchoolIndex(schools) {
  const communes = [...new Set(schools.map(s => s.nom_commune).filter(Boolean))];
  console.log(`🔗 ${communes.length} communes uniques indexées depuis les écoles`);
  const index = {};
  communes.forEach(c => { index[normalize(c)] = c; });
  return index;
}

// Trouve la correspondance dans les noms réels des écoles
function matchCommune(nom, schoolIndex) {
  if (!schoolIndex) return nom;
  const key = normalize(nom);
  return schoolIndex[key] || nom;
}

// ===== CHARGE LES COMMUNES GEO =====
async function loadAllCommunes(codeDept) {
  console.log(`\n🗺️  Chargement des contours du département ${codeDept}...`);
  const url = `https://geo.api.gouv.fr/communes?codeDepartement=${codeDept}&fields=nom,code,contour&format=json&geometry=contour`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur API : ${res.status}`);
  const data = await res.json();
  console.log(`✅ ${data.length} communes chargées`);
  return data;
}

async function main() {
  const schoolIndex = await loadSchoolCommunes(dept);
  const allCommunes = await loadAllCommunes(dept);

  // Index geo par nom normalisé
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

  // Réécrire zones_XX.json avec les noms corrigés (correspondant exactement aux écoles)
  fs.writeFileSync(inputFile, JSON.stringify(correctedZones, null, 2), 'utf8');
  console.log(`\n📝 ${inputFile} mis à jour avec les noms exacts des écoles`);

  const geojson = { type: 'FeatureCollection', features };
  const output = JSON.stringify(geojson);
  fs.writeFileSync(outputFile, output);

  console.log(`\n🎉 ${outputFile} généré !`);
  console.log(`   ${features.length} zones | ${totalFound} communes trouvées | ${totalMissed} manquantes`);
  console.log(`   📦 Taille : ${(output.length / 1024).toFixed(0)} Ko`);
  if (totalMissed > 0) {
    console.log(`\n💡 Communes toujours manquantes — corrige dans ${inputFile} et relance`);
    console.log(`   Référence noms : https://geo.api.gouv.fr/communes?codeDepartement=${dept}`);
  }
  console.log(`\n👉 Upload ${outputFile} et ${inputFile} dans public/ sur ta branche V2`);
}

main().catch(console.error);
