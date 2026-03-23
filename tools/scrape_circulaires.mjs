// scrape_circulaires.mjs
// Télécharge automatiquement les circulaires PDF depuis e-mouvement.snuipp.fr
// Usage : node scrape_circulaires.mjs        → tous les départements
//         node scrape_circulaires.mjs 38 73  → départements spécifiques

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://e-mouvement.snuipp.fr';

const DEPTS = [
  '01','02','03','04','05','06','07','08','09','10',
  '11','12','13','14','15','16','17','18','19','21',
  '22','23','24','25','26','27','28','29','30','31',
  '32','33','34','35','36','37','38','39','40','41',
  '42','43','44','45','46','47','48','49','50','51',
  '52','53','54','55','56','57','58','59','60','61',
  '62','63','64','65','66','67','68','69','70','71',
  '72','73','74','75','76','77','78','79','80','81',
  '82','83','84','85','86','87','88','89','90','91',
  '92','93','94','95'
];

// Créer dossier de sortie
if (!fs.existsSync('circulaires')) fs.mkdirSync('circulaires');

// Cherche le lien PDF de la circulaire dans la page HTML
function findPdfLink(html, dept) {
  // Patterns courants pour trouver le PDF de la circulaire
  const patterns = [
    /href="([^"]*(?:circulaire|annexe)[^"]*\.pdf)"/gi,
    /href="([^"]*mouvement[^"]*\.pdf)"/gi,
    /href="([^"]*note[^"]*\.pdf)"/gi,
    /"(\/[^"]*\.pdf)"/gi,
  ];
  
  const found = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let url = match[1];
      if (!url.startsWith('http')) url = BASE_URL + url;
      found.add(url);
    }
  }
  return [...found];
}

async function processDept(dept) {
  // Essaie plusieurs URLs possibles
  const urls = [
    `${BASE_URL}/${dept}/circulaires`,
    `${BASE_URL}/${dept}`,
  ];

  let pdfLinks = [];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      if (!res.ok) continue;
      const html = await res.text();
      const links = findPdfLink(html, dept);
      pdfLinks.push(...links);
      if (links.length > 0) break;
    } catch(e) { continue; }
  }

  // Dédoublonner
  pdfLinks = [...new Set(pdfLinks)];

  if (pdfLinks.length === 0) {
    return { dept, status: 'no_pdf', links: [] };
  }

  // Télécharger le(s) PDF(s)
  const downloaded = [];
  for (const link of pdfLinks.slice(0, 3)) { // max 3 PDFs par dept
    try {
      const res = await fetch(link, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 30000
      });
      if (!res.ok) continue;
      
      const filename = `circulaires/${dept}_${path.basename(link).replace(/[^a-z0-9._-]/gi, '_')}`;
      const buffer = await res.buffer();
      fs.writeFileSync(filename, buffer);
      downloaded.push(filename);
    } catch(e) { continue; }
  }

  return { dept, status: downloaded.length > 0 ? 'ok' : 'download_failed', links: pdfLinks, downloaded };
}

// MAIN
const depts = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEPTS;
console.log(`🔍 Recherche des circulaires pour ${depts.length} département(s)...\n`);

const results = { ok: [], no_pdf: [], failed: [] };

for (const dept of depts) {
  process.stdout.write(`  Dept ${dept}... `);
  const result = await processDept(dept);
  
  if (result.status === 'ok') {
    console.log(`✅ ${result.downloaded.length} PDF(s) téléchargé(s)`);
    result.downloaded.forEach(f => console.log(`     → ${f}`));
    results.ok.push(dept);
  } else if (result.status === 'no_pdf') {
    console.log(`⚠️  Aucun PDF trouvé`);
    results.no_pdf.push(dept);
  } else {
    console.log(`❌ Échec téléchargement`);
    results.failed.push(dept);
  }

  await new Promise(r => setTimeout(r, 500)); // pause entre requêtes
}

// Rapport final
console.log(`\n📊 Résumé :`);
console.log(`  ✅ ${results.ok.length} départements téléchargés : ${results.ok.join(', ')}`);
console.log(`  ⚠️  ${results.no_pdf.length} sans PDF : ${results.no_pdf.join(', ')}`);
console.log(`  ❌ ${results.failed.length} en erreur : ${results.failed.join(', ')}`);
console.log(`\n📁 PDFs dans le dossier circulaires/`);

// Sauvegarder le rapport
fs.writeFileSync('circulaires/rapport.json', JSON.stringify(results, null, 2));
