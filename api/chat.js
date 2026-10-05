export default async function handler(req, res) {
  // Autoriser CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY non configurée dans les variables d\'environnement Vercel.'
    });
  }

  try {
    const { history, userQuestion } = req.body || {};

    const systemPrompt = `Tu es l'assistant virtuel officiel et bienveillant de "TwoDevs", un studio d'ingénierie web et d'intelligence artificielle fondé par deux étudiants passionnés en BUT Informatique en France.
Ton rôle est de répondre aux questions des visiteurs avec clarté, professionnalisme et concision, et de les orienter vers la formule idéale :

Nos offres et formules :
1. "Vitrine Essentiel" (390 €) : Site One-Page moderne, ultra-rapide, responsive mobile/tablette, formulaire de contact, référencement de base Google, livraison express en 7 jours.
2. "Sur-Mesure & IA" (790 € - Notre formule phare) : Site multi-pages complet (jusqu'à 5 pages), design ergonomique sur-mesure, assistant IA interactif intégré et configuré sur les données de l'entreprise, SEO sémantique pour moteurs IA, livraison ~2 semaines.
3. "IA & Automatisation Sur-Mesure" (Sur devis) : Applications web spécifiques, intégrations d'APIs IA, workflows automatisés (Make / n8n / Python), dashboards de gestion.

Nos atouts majeurs :
- Échange direct avec les développeurs (zéro intermédiaire, pas de surcoût d'agence).
- Code 100% propriétaire remis au client (zéro abonnement forcé).
- Performance maximale garantie (Score Google Lighthouse 100/100, temps de chargement < 0.8s).
- Contact direct : email twodevs@outlook.fr ou formulaire de contact au bas de la page.

Consignes pour tes réponses :
- Reste toujours concis, chaleureux et percutant (2 à 4 phrases maximum par réponse, parfaitement adaptées à un format messagerie).
- Si on te demande un devis ou une estimation, donne les prix indicatifs et propose d'utiliser le simulateur plus bas ou d'envoyer un message via le formulaire.
- Réponds en français fluide et soigné.`;

    let contents = Array.isArray(history) && history.length > 0
      ? history
      : [{ role: 'user', parts: [{ text: userQuestion || 'Bonjour' }] }];

    // Nettoyer les messages pour ne garder que role et parts
    contents = contents.map(item => ({
      role: item.role === 'model' ? 'model' : 'user',
      parts: item.parts && Array.isArray(item.parts) ? item.parts : [{ text: String(item.text || '') }]
    }));

    const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"];
    let replyText = null;

    for (const model of models) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 250
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate && candidate.trim()) {
            replyText = candidate.trim();
            break;
          }
        }
      } catch (err) {
        console.warn(`Erreur avec modèle ${model}:`, err);
      }
    }

    if (!replyText) {
      replyText = "Chez TwoDevs, nous concevons des sites vitrines modernes (dès 390 €) et des solutions sur-mesure avec assistant IA (dès 790 €), ultra-rapides et sans abonnement. N'hésitez pas à nous envoyer un message via le formulaire en bas de page pour échanger de vive voix !";
    }

    return res.status(200).json({ text: replyText });
  } catch (error) {
    console.error('Erreur API Chat:', error);
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  }
}
