const fs = require('fs');

fs.readFile('schools.json', 'utf8', (err, data) => {
    if (err) {
        console.error("Erreur de lecture du fichier :", err);
        return;
    }

    let schools;
    try {
        schools = JSON.parse(data);
    } catch (parseErr) {
        console.error("Erreur de parsing JSON :", parseErr);
        return;
    }

    schools.forEach(school => {
        if (school.departement) {
            // Supprimer uniquement les caractères indésirables (ex : les points rouges)
            school.departement = school.departement.replace(/[^\w\sàâçéèêëîïôûùü]/gi, '').trim();
        }
    });

    fs.writeFile('schools.json', JSON.stringify(schools, null, 2), (writeErr) => {
        if (writeErr) {
            console.error("Erreur d'écriture dans le fichier :", writeErr);
            return;
        }
        console.log("Le fichier schools.json a été nettoyé avec succès.");
    });
});