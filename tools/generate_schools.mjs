// generate_schools.mjs
// Génère schools_XX.json depuis l'API officielle data.education.gouv.fr
// Les noms de communes sont enrichis avec le nom officiel de geo.api.gouv.fr
// Usage : node generate_schools.mjs 38
//         node generate_schools.mjs 38 59 73 74
//         node generate_schools.mjs all  → tous les départements

import fetch from 'node-fetch';
import fs from 'fs';

const API_EDU = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records';
const API_GEO = 'https://geo.api.gouv.fr/communes';

// Champs à récupérer depuis l'API Education
const FIELDS = [
  'identifiant_de_l_etablissement',
  'nom_etablissement',
  'type_etablissement',
  'statut_public_prive',
  'adresse_1',
  'adresse_2',
  'code_postal',
  'nom_commune',
  'code_commune',
  'latitude',
  'longitude',
  'nombre_d_eleves',
  'telephone',
  'web',
  'mail',
  'ulis',
  'appartenance_education_prioritaire',
  'nom_circonscription',
  'date_maj_ligne',
  'etat',
  'ecole_maternelle',
  'ecole_elementaire'
].join(',');

// ===== CHARGE LES COMMUNES OFFICIELLES =====
async function loadCommuneIndex(dept) {
  const code = dept.padStart(3, '0');
  // Essaie le fichier local communes_XX.txt d'abord
  const localFile = `communes_${dept}.txt`;
  if (fs.existsSync(localFile)) {
    const lines = fs.readFileSync(localFile, 'utf8').split('\n').filter(Boolean);
    const index = {};
    lines.forEach(l => {
      const match = l.match(/^(.+) \((\d+)\)$/);
      if (match) index[match[2]] = match[1]; // code → nom officiel
    });
    console.log(`  📋 ${Object.keys(index).length} communes chargées depuis ${localFile}`);
    return index;
  }
  // Sinon télécharge
  console.log(`  📥 Téléchargement des communes dept ${dept}...`);
  const res = await fetch(`${API_GEO}?codeDepartement=${dept}&fields=nom,code&format=json&limit=700`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const index = {};
  data.forEach(c => { index[c.code] = c.nom; });
  return index;
}

// ===== TÉLÉCHARGE TOUTES LES ÉCOLES D'UN DÉPARTEMENT =====
async function fetchSchools(dept) {
  const code = dept.padStart(3, '0');
  const where = `code_departement="${code}" AND type_etablissement="Ecole" AND etat="OUVERT"`;
  
  let allRecords = [];
  let offset = 0;
  const limit = 100;
  let total = null;

  while (true) {
    const params = new URLSearchParams({
      where,
      select: FIELDS,
      limit: limit.toString(),
      offset: offset.toString(),
      order_by: 'nom_commune,nom_etablissement'
    });
    const url = `${API_EDU}?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (total === null) {
      total = data.total_count;
      process.stdout.write(`  📚 ${total} écoles à télécharger`);
    }

    allRecords.push(...data.results);
    process.stdout.write(`\r  📚 ${allRecords.length}/${total} écoles téléchargées`);

    if (allRecords.length >= total) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 50));
  }
  console.log('');
  return allRecords;
}

// ===== TRANSFORME UN ENREGISTREMENT EN FORMAT ÉCOLE =====
function transformRecord(record, communeIndex) {
  // Nom de commune officiel depuis geo.api.gouv.fr via code_commune
  const nomCommuneOfficiel = record.code_commune && communeIndex[record.code_commune]
    ? communeIndex[record.code_commune]
    : record.nom_commune;

  // Détermine le type (ECEL/ECMA)
  let type = 'Ecole';
  if (record.ecole_maternelle && !record.ecole_elementaire) type = 'Maternelle';
  else if (!record.ecole_maternelle && record.ecole_elementaire) type = 'Élémentaire';
  else if (record.ecole_maternelle && record.ecole_elementaire) type = 'Primaire';

  return {
    identifiant_de_l_etablissement: record.identifiant_de_l_etablissement,
    nom_etablissement: record.nom_etablissement,
    type,
    statut_public_prive: record.statut_public_prive,
    adresse_1: record.adresse_1 || '',
    adresse_2: record.adresse_2 || '',
    code_postal: record.code_postal,
    nom_commune: nomCommuneOfficiel,
    code_commune: record.code_commune,
    latitude: record.latitude,
    longitude: record.longitude,
    nombre_d_eleves: record.nombre_d_eleves,
    telephone: record.telephone,
    web: record.web,
    mail: record.mail,
    ulis: record.ulis,
    appartenance_education_prioritaire: record.appartenance_education_prioritaire,
    nom_circonscription: record.nom_circonscription,
    date_maj_ligne: record.date_maj_ligne,
  };
}

// ===== TRAITEMENT D'UN DÉPARTEMENT =====
async function processDept(dept) {
  console.log(`\n🏫 Département ${dept}...`);
  
  try {
    const [communeIndex, records] = await Promise.all([
      loadCommuneIndex(dept),
      fetchSchools(dept)
    ]);

    const schools = records.map(r => transformRecord(r, communeIndex));
    
    // Statistiques
    const withCoords = schools.filter(s => s.latitude && s.longitude).length;
    const officialNames = schools.filter(s => 
      s.code_commune && communeIndex[s.code_commune]
    ).length;

    const output = JSON.stringify(schools);
    const outFile = `../public/schools_${dept}.json`;
    fs.writeFileSync(outFile, output);

    console.log(`  ✅ ${schools.length} écoles (${withCoords} géolocalisées, ${officialNames} noms officiels)`);
    console.log(`  📦 Taille : ${(output.length / 1024).toFixed(0)} Ko → ${outFile}`);
    return true;
  } catch(e) {
    console.error(`  ❌ Erreur : ${e.message}`);
    return false;
  }
}

// ===== MAIN =====
async function getAllActiveDepts() {
  if (!fs.existsSync('../public')) return [];
  return fs.readdirSync('../public')
    .filter(f => f.match(/^schools_(\w+)\.json$/))
    .map(f => f.match(/^schools_(\w+)\.json$/)[1])
    .sort();
}

const args = process.argv.slice(2);
let depts;

if (args.length === 0 || args[0] === 'all') {
  depts = await getAllActiveDepts();
  if (depts.length === 0) {
    console.error('❌ Aucun fichier schools_XX.json trouvé dans public/');
    console.error('   Lance depuis le dossier tools/');
    process.exit(1);
  }
  console.log(`🔄 Régénération de ${depts.length} département(s) actifs : ${depts.join(', ')}`);
} else {
  depts = args;
  console.log(`🔄 Génération pour ${depts.length} département(s) : ${depts.join(', ')}`);
}

let success = 0, errors = 0;
for (const dept of depts) {
  const ok = await processDept(dept);
  if (ok) success++; else errors++;
}

console.log(`\n🎉 Terminé ! ${success} départements générés, ${errors} erreurs.`);
console.log(`👉 Commit et push les fichiers schools_XX.json dans public/`);
