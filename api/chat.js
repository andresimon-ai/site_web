// In-memory rate limiting simple (par IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 12; // 12 questions par minute max par IP

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  // Nettoyage périodique simple
  if (rateLimitMap.size > 2000) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (now - val.startTime > RATE_LIMIT_WINDOW) {
        rateLimitMap.delete(key);
      }
    }
  }

  if (!record || (now - record.startTime) > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return false;
  }

  record.count += 1;
  return record.count > MAX_REQUESTS_PER_WINDOW;
}

export default async function handler(req, res) {
  // En-têtes de sécurité de l'API
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  // Configuration CORS contrôlée
  const origin = req.headers.origin;
  if (origin) {
    // Si une origine est transmise, on ne l'autorise que si nécessaire
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Accept'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  // Détection IP pour le rate-limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ 
      text: "Vous avez posé beaucoup de questions en peu de temps. Veuillez patienter une minute avant de continuer." 
    });
  }

  const fallbackAnswer = "Chez TwoDevs, nous concevons des sites vitrines modernes (dès 650 €) et des solutions sur-mesure avec assistant IA (dès 1 090 €), ultra-rapides et sans abonnement. N'hésitez pas à nous envoyer un message via le formulaire en bas de page pour échanger de vive voix !";

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY manquante dans l'environnement Vercel.");
    return res.status(200).json({ text: fallbackAnswer });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { history, userQuestion } = body;

    // Validation et assainissement des entrées
    if (typeof userQuestion !== 'string') {
      userQuestion = '';
    }
    // Tronquer à 500 caractères max pour éviter les attaques DoS ou surcoûts d'API
    userQuestion = userQuestion.slice(0, 500).trim();

    if (!userQuestion && (!Array.isArray(history) || history.length === 0)) {
      return res.status(400).json({ error: 'Message vide ou invalide.' });
    }

    const systemPrompt = `Tu es l'assistant virtuel officiel et bienveillant de "TwoDevs", un studio d'ingénierie web et d'intelligence artificielle fondé par deux étudiants passionnés en BUT Informatique en France.
Ton rôle est de répondre aux questions des visiteurs avec clarté, professionnalisme et concision, et de les orienter vers la formule idéale :

Nos offres et formules :
1. "Vitrine Essentiel" (650 €) : Site One-Page moderne, ultra-rapide, responsive mobile/tablette, formulaire de contact, référencement de base Google, livraison express en 7 jours.
2. "Sur-Mesure & IA" (1 090 € - Notre formule phare) : Site multi-pages complet (jusqu'à 5 pages), design ergonomique sur-mesure, assistant IA interactif intégré et configuré sur les données de l'entreprise, SEO sémantique pour moteurs IA, livraison ~2 semaines.
3. "IA & Automatisation Sur-Mesure" (Dès 1 490 € / Sur devis) : Applications web spécifiques, intégrations d'APIs IA, workflows automatisés (Make / n8n / Python), dashboards de gestion.

Nos atouts majeurs :
- Échange direct avec les développeurs (zéro intermédiaire, pas de surcoût d'agence).
- Code 100% propriétaire remis au client (zéro abonnement forcé).
- Performance maximale garantie (Score Google Lighthouse 100/100, temps de chargement < 0.8s).
- Contact direct : email contact@twodevs2.fr ou formulaire de contact au bas de la page.

Consignes pour tes réponses :
- Reste toujours concis, chaleureux et percutant (2 à 4 phrases maximum par réponse, parfaitement adaptées à un format messagerie).
- Si on te demande un devis ou une estimation, donne les prix indicatifs et propose d'utiliser le simulateur plus bas ou d'envoyer un message via le formulaire.
- Réponds en français fluide et soigné.`;

    // Filtrer et limiter l'historique (max 8 messages, max 500 caractères chacun)
    let contents = [];
    if (Array.isArray(history)) {
      contents = history.slice(-8).map(item => {
        const role = item.role === 'model' ? 'model' : 'user';
        let text = '';
        if (Array.isArray(item.parts) && item.parts[0]?.text) {
          text = String(item.parts[0].text);
        } else if (item.text) {
          text = String(item.text);
        }
        return {
          role,
          parts: [{ text: text.slice(0, 500) }]
        };
      });
    }

    if (contents.length === 0) {
      contents = [{ role: 'user', parts: [{ text: userQuestion || 'Bonjour' }] }];
    }

    // Modèles rapides et fiables
    const models = ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-flash-latest"];
    let replyText = null;

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 250
            }
          })
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate && candidate.trim()) {
            replyText = candidate.trim();
            break;
          }
        } else {
          console.warn(`Modèle ${model} status ${response.status}`);
        }
      } catch (err) {
        console.warn(`Erreur pour modèle ${model}:`, err.message);
      }
    }

    if (!replyText) {
      replyText = fallbackAnswer;
    }

    return res.status(200).json({ text: replyText });
  } catch (error) {
    console.error('Erreur API Chat:', error);
    return res.status(200).json({ text: fallbackAnswer });
  }
}
