// check_communes.mjs
// Vérifie et corrige les noms de communes dans les fichiers schools_XX.json
// Usage : node check_communes.mjs        → tous les départements actifs
//         node check_communes.mjs 38 73  → départements spécifiques

import fetch from 'node-fetch';
import fs from 'fs';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/n1n162/Mon-Mouvement/refs/heads/V2/public';

// ===== NORMALISATION =====
function normalize(str) {
  return str.toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'\s]+/g, ' ')
    .trim();
}

function normalizeAggressive(str) {
  return normalize(str)
    .replace(/^(le |la |les |l |saint |sainte |sur |en |de |du |des |d )/, '')
    .replace(/ (le|la|les|sur|en|de|du|des|d|et|sous)$/, '')
    .replace(/ (le|la|les|sur|en|de|du|des|d|et|sous) /g, ' ')
    .trim();
}

// ===== CHARGE LES COMMUNES OFFICIELLES =====
async function loadOfficialCommunes(dept) {
  // D'abord essaie le fichier local
  const localFile = `communes_${dept}.txt`;
  if (fs.existsSync(localFile)) {
    const lines = fs.readFileSync(localFile, 'utf8').split('\n').filter(Boolean);
    const communes = lines.map(l => {
      const match = l.match(/^(.+) \((\d+)\)$/);
      return match ? { nom: match[1], code: match[2] } : null;
    }).filter(Boolean);
    return communes;
  }
  // Sinon télécharge depuis l'API
  const res = await fetch(
    `https://geo.api.gouv.fr/communes?codeDepartement=${dept}&fields=nom,code&format=json&limit=700`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ===== CHARGE SCHOOLS =====
async function loadSchools(dept) {
  const localFile = `../public/schools_${dept}.json`;
  if (fs.existsSync(localFile)) {
    return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  }
  const url = `${GITHUB_RAW_BASE}/schools_${dept}.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

// Trouve le meilleur match dans les communes officielles
function findBestMatch(nom, officialIndex) {
  // 1. Correspondance exacte normalisée
  if (officialIndex[normalize(nom)]) return officialIndex[normalize(nom)];

  // 2. Correspondance agressive (sans articles)
  const aggNom = normalizeAggressive(nom);
  for (const [key, commune] of Object.entries(officialIndex)) {
    if (normalizeAggressive(commune.nom) === aggNom) return commune;
  }

  // 3. Similarité par mots communs
  const wordsNom = aggNom.split(' ').filter(w => w.length > 2);
  let bestMatch = null, bestScore = 0;
  for (const commune of Object.values(officialIndex)) {
    const wordsKey = normalizeAggressive(commune.nom).split(' ').filter(w => w.length > 2);
    if (!wordsNom.length || !wordsKey.length) continue;
    const common = wordsNom.filter(w => wordsKey.some(k => k.startsWith(w) || w.startsWith(k)));
    const score = common.length / Math.max(wordsNom.length, wordsKey.length);
    if (score > bestScore && score >= 0.7) { bestScore = score; bestMatch = commune; }
  }
  return bestMatch;
}

// ===== TRAITEMENT D'UN DÉPARTEMENT =====
async function processDept(dept) {
  let official, schools;
  try {
    official = await loadOfficialCommunes(dept);
    schools = await loadSchools(dept);
  } catch(e) {
    return null;
  }
  if (!schools || !official.length) return null;

  // Index officiel par nom normalisé
  const officialIndex = {};
  official.forEach(c => { officialIndex[normalize(c.nom)] = c; });

  // Communes uniques dans schools
  const schoolCommunes = [...new Set(schools.map(s => s.nom_commune).filter(Boolean))];

  const corrections = {};
  const notFound = [];

  for (const nom of schoolCommunes) {
    if (officialIndex[normalize(nom)]) continue; // OK, nom exact

    const match = findBestMatch(nom, officialIndex);
    if (match && match.nom !== nom) {
      corrections[nom] = match.nom;
    } else if (!match) {
      notFound.push(nom);
    }
  }

  return { dept, corrections, notFound, total: schoolCommunes.length };
}

// ===== MAIN =====
// Détecter les départements actifs depuis les fichiers schools disponibles
function getActiveDepts() {
  if (!fs.existsSync('../public')) return [];
  return fs.readdirSync('../public')
    .filter(f => f.match(/^schools_(\d+)\.json$/))
    .map(f => f.match(/^schools_(\d+)\.json$/)[1])
    .sort();
}

const depts = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : getActiveDepts();

if (!depts.length) {
  console.error('❌ Aucun département trouvé. Lance depuis le dossier tools/');
  process.exit(1);
}

console.log(`🔍 Vérification des communes pour ${depts.length} département(s)...\n`);

let totalCorrections = 0, totalNotFound = 0;
const allCorrections = {};

for (const dept of depts) {
  const result = await processDept(dept);
  if (!result) { console.log(`⏭️  ${dept} — ignoré`); continue; }

  const { corrections, notFound, total } = result;
  const nbCorr = Object.keys(corrections).length;

  if (nbCorr === 0 && notFound.length === 0) {
    console.log(`✅ ${dept} — ${total} communes OK`);
  } else {
    console.log(`⚠️  ${dept} — ${total} communes, ${nbCorr} corrections, ${notFound.length} introuvables`);
    if (nbCorr > 0) {
      Object.entries(corrections).forEach(([old, newName]) => {
        console.log(`   ~ "${old}" → "${newName}"`);
      });
      allCorrections[dept] = corrections;
    }
    if (notFound.length > 0) {
      console.log(`   ? Introuvables: ${notFound.join(', ')}`);
    }
  }

  totalCorrections += nbCorr;
  totalNotFound += notFound.length;
}

console.log(`\n📊 Résumé: ${totalCorrections} corrections possibles, ${totalNotFound} communes introuvables`);

// Proposer d'appliquer les corrections
if (totalCorrections > 0) {
  console.log(`\n💾 Application des corrections dans les fichiers schools_XX.json...`);
  for (const [dept, corrections] of Object.entries(allCorrections)) {
    const localFile = `../public/schools_${dept}.json`;
    if (!fs.existsSync(localFile)) continue;
    const schools = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    let count = 0;
    schools.forEach(s => {
      if (s.nom_commune && corrections[s.nom_commune]) {
        s.nom_commune = corrections[s.nom_commune];
        count++;
      }
    });
    fs.writeFileSync(localFile, JSON.stringify(schools));
    console.log(`  ✅ schools_${dept}.json — ${count} écoles corrigées`);
  }
  console.log(`\n👉 Commit et push les fichiers schools_XX.json modifiés`);
}
