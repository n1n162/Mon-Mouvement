// ─────────────────────────────────────────────────────────────────
// auth.js — à inclure dans ton index.html / script principal
// Gère la vérification d'accès et l'envoi du token JWT dans les requêtes
// ─────────────────────────────────────────────────────────────────

(function () {
  const TOKEN_KEY = "access_token";

  // Vérifie si le token est présent et non expiré
  function getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp * 1000 < Date.now()) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return token;
    } catch (e) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
  }

  // Redirige vers /pricing.html si pas de token valide
  function requireAccess() {
    if (!getToken()) {
      window.location.href = "/pricing.html";
    }
  }

  // Wrapper fetch qui ajoute automatiquement le token Authorization
  function apiFetch(url, options = {}) {
    const token = getToken();
    if (!token) {
      window.location.href = "/pricing.html";
      return Promise.reject(new Error("Non authentifié"));
    }
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };
    return fetch(url, { ...options, headers });
  }

  // Exposer globalement
  window.Auth = { requireAccess, apiFetch, getToken };
})();

// ─────────────────────────────────────────────────────────────────
// UTILISATION dans ton script.js existant :
//
// 1. Inclure dans ton HTML AVANT script.js :
//    <script src="/auth.js"></script>
//
// 2. Au début de script.js, ajouter :
//    Auth.requireAccess(); // redirige si pas d'accès
//
// 3. Remplacer tous tes appels fetch vers /api/ par :
//    Auth.apiFetch("/api/matrix/ors", { method: "POST", body: JSON.stringify(data) })
//      .then(res => res.json())
//      .then(data => { ... })
//
// ─────────────────────────────────────────────────────────────────
