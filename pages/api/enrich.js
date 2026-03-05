export const config = { api: { bodyParser: { sizeLimit: '1mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { imData } = req.body
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })

  const locataires = imData.etat_locatif?.locataires?.map(l => l.nom).filter(n => n && n !== 'N/D').join(', ') || ''
  const ville = imData.localisation?.ville || ''
  const adresse = imData.localisation?.adresse || ''
  const classeActif = imData.classe_actif || 'immobilier'

  const prompt = `Tu es un analyste en investissement immobilier indépendant et critique. L'IM est souvent optimiste: croise avec des sources externes.

Données de l'IM:
- Actif: ${imData.titre} (${classeActif})
- Localisation: ${adresse}, ${ville}
- Locataires: ${locataires}
- Loyer de marché selon l'IM: ${imData.marche_locatif_im?.loyer_marche_cite || 'N/D'}

Fais des recherches web pour:
1. Solidité financière et réputation de chaque locataire (${locataires})
2. Loyers réels pour ${classeActif} à ${ville} (cherche des offres actuelles sur des sites immobiliers)
3. Projets de développement dans la zone: nouveaux immeubles, hôtels, logements, transports à ${ville}
4. Contexte économique du marché immobilier ${classeActif} à ${ville}

Réponds UNIQUEMENT en JSON valide (sans backticks):
{
  "locataires_analyse": [
    {
      "nom": "nom",
      "sante_financiere": "solide / correcte / fragile / inconnue",
      "sources": ["info clé 1", "info clé 2"],
      "risque": "faible / moyen / élevé",
      "commentaire": "analyse critique en 2 phrases"
    }
  ],
  "marche_locatif_reel": {
    "fourchette_loyers": "XXX-XXX €/m²/an",
    "tendance": "hausse / stable / baisse",
    "vacance_zone": "forte / modérée / faible",
    "offres_trouvees": ["offre comparable 1", "offre comparable 2"],
    "analyse": "comparaison loyers IM vs marché réel en 3 phrases"
  },
  "projets_zone": [
    {
      "nom": "nom du projet",
      "type": "bureau / hotel / logement / commercial / transport / autre",
      "statut": "livré / en cours / autorisé / en projet",
      "impact": "positif / négatif / neutre",
      "description": "description courte"
    }
  ],
  "contexte_marche": {
    "dynamisme": "très actif / actif / stable / atone",
    "tendance_investisseurs": "description",
    "risques_macro": ["risque 1", "risque 2"],
    "opportunites_macro": ["opportunité 1", "opportunité 2"]
  },
  "verdict_independant": {
    "fiabilite_im": "optimiste / réaliste / conservateur",
    "points_divergence": ["écart 1", "écart 2"],
    "recommandation": "À étudier / Prudence / À éviter",
    "note": "X/10",
    "resume": "synthèse critique en 3 phrases pour comité d'investissement"
  },
  "swot": {
    "forces": ["point 1", "point 2", "point 3"],
    "faiblesses": ["point 1", "point 2"],
    "opportunites": ["point 1", "point 2"],
    "menaces": ["point 1", "point 2"]
  }
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(raw)
    res.status(200).json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
