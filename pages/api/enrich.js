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
  const pays = imData.localisation?.pays || 'France'

  const assetSpecificInstructions = {
    commerce: `Pour cet actif COMMERCE, analyse spécifiquement:
- Zone de chalandise: population dans rayon 5, 10, 15min (voiture et marche)
- Trafic piéton de la rue (passages/jour si disponible)
- Concurrence directe dans un rayon de 500m-1km (enseignes similaires)
- Parkings à proximité (nb places, tarifs)
- Projets commerciaux concurrents dans la zone`,
    logistique: `Pour cet actif LOGISTIQUE/INDUSTRIEL, analyse spécifiquement:
- Proximité aux axes autoroutiers (distances précises aux échangeurs)
- Accès aux ports, aéroports, gares de fret
- Qualité de la zone logistique (taux de vacance local)
- Contraintes environnementales (ICPE, PLU)
- Offre alternative dans un rayon de 20km`,
    industriel: `Pour cet actif INDUSTRIEL, analyse spécifiquement:
- Accessibilité poids lourds et transport
- Bassin d'emploi local et disponibilité de main d'oeuvre
- Proximité aux fournisseurs/clients du locataire
- Contraintes réglementaires (ICPE, classification)
- Valeur terrains dans la zone`,
    bureau: `Pour cet actif BUREAU, analyse spécifiquement:
- Accessibilité transports en commun (détail lignes et fréquences)
- Quartier d'affaires et benchmark vs QCA/QBA
- Services de proximité (restaurants, hôtels, services)
- Taux de vacance bureaux dans le quartier
- Loyers prime vs secondaire dans le quartier`,
    hôtel: `Pour cet actif HÔTEL, analyse spécifiquement:
- RevPAR et taux d'occupation moyens de la destination
- Concurrence hôtelière dans un rayon 500m-1km (étoiles, capacité)
- Mix clientèle (affaires vs loisirs) de la destination
- Saisonnalité et événements générateurs de flux
- Pipeline hôtelier prévu dans la zone`,
  }

  const assetInstruction = assetSpecificInstructions[classeActif] || assetSpecificInstructions.bureau

  const prompt = `Tu es un analyste en investissement immobilier indépendant et critique. L'IM est souvent optimiste: croise avec des sources externes.

Données de l'IM:
- Actif: ${imData.titre} (${classeActif})
- Localisation: ${adresse}, ${ville}, ${pays}
- Locataires: ${locataires}
- Loyer de marché selon l'IM: ${imData.marche_locatif_im?.loyer_marche_cite || 'N/D'}
- Surface: ${imData.etat_locatif?.surface_totale || 'N/D'}

Fais des recherches web approfondies pour:

1. SANTÉ FINANCIÈRE de chaque locataire (${locataires}):
   - Cherche sur Pappers.fr, Companies House, Infogreffe, Societe.com, ou rapports annuels officiels
   - Chiffre d'affaires, résultat net, effectifs, notation crédit si dispo
   - Actualités récentes (difficultés, croissance, restructuration)
   - Donne des URLS précises et vérifiables

2. LOYERS DE MARCHÉ RÉELS pour ${classeActif} à ${ville}:
   - Cherche sur BNP Paribas Real Estate, JLL, CBRE, Cushman & Wakefield, SeLoger Pro, MeilleursAgents, Xerfi
   - Offres concrètes sur Citynews, LoopNet, BureauxLocaux, Immobilier-professionnel.fr
   - Donne des fourchettes précises avec sources

3. ANALYSE SPÉCIFIQUE À LA CLASSE D'ACTIF:
${assetInstruction}

4. PROJETS DE DÉVELOPPEMENT dans la zone à ${ville}

5. CONTEXTE MARCHÉ ${classeActif} à ${ville} / ${pays}

Réponds UNIQUEMENT en JSON valide (sans backticks markdown):
{
  "locataires_analyse": [
    {
      "nom": "nom exact",
      "sante_financiere": "solide / correcte / fragile / inconnue",
      "chiffre_affaires": "XXX M€ (année)",
      "resultat_net": "XXX M€ ou N/D",
      "effectifs": "XXX employés ou N/D",
      "notation": "rating si dispo ou N/D",
      "sources": [
        { "label": "Pappers.fr - Bilan 2023", "url": "https://www.pappers.fr/..." },
        { "label": "Rapport annuel 2024", "url": "https://..." }
      ],
      "risque": "faible / moyen / élevé",
      "actualites": "faits marquants récents",
      "commentaire": "analyse critique en 2 phrases"
    }
  ],
  "marche_locatif_reel": {
    "fourchette_loyers": "XXX-XXX €/m²/an",
    "tendance": "hausse / stable / baisse",
    "vacance_zone": "forte / modérée / faible",
    "offres_trouvees": [
      { "description": "Bureaux 500m², Rue X", "loyer": "XXX €/m²/an", "source_url": "https://..." },
      { "description": "Local commercial XXm², Avenue Y", "loyer": "XXX €/m²/an", "source_url": "https://..." }
    ],
    "sources_marche": [
      { "label": "CBRE Market Report Q4 2024", "url": "https://..." },
      { "label": "JLL - Marché bureaux Paris 2024", "url": "https://..." }
    ],
    "analyse": "comparaison loyers IM vs marché réel en 3 phrases"
  },
  "analyse_classe_actif": {
    "type": "${classeActif}",
    "zone_chalandise": {
      "population_5min": "XXX 000 hab ou N/A",
      "population_10min": "XXX 000 hab ou N/A",
      "trafic_pietonne": "XXX 000 passages/jour ou N/A",
      "concurrents_proches": ["Concurrent 1 - 200m", "Concurrent 2 - 500m"]
    },
    "accessibilite_logistique": {
      "autoroute_plus_proche": "A6 - Échangeur X à 2km ou N/A",
      "port_aeroport": "Aéroport X à 15km ou N/A",
      "axes_details": ["M60 à 5min", "M62 à 10min"]
    },
    "transports_detail": {
      "lignes_proches": ["Métro L1 - Station X à 200m", "Bus 72 - Arrêt Y à 100m"],
      "isochrone_15min_tc": "description de la zone accessible en 15min TC",
      "score_accessibilite": "excellent / bon / moyen / faible"
    },
    "concurrence": ["élément 1", "élément 2"],
    "points_specifiques": ["point 1", "point 2", "point 3"]
  },
  "projets_zone": [
    {
      "nom": "nom du projet",
      "type": "bureau / hotel / logement / commercial / transport / autre",
      "statut": "livré / en cours / autorisé / en projet",
      "impact": "positif / négatif / neutre",
      "description": "description courte",
      "source_url": "https://..."
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
    "note": "X",
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
        max_tokens: 6000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: `Anthropic API error ${response.status}: ${err.slice(0, 300)}` })
    }

    const data = await response.json()

    // Collect only text blocks (skip tool_use / tool_result blocks)
    const raw = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('')

    // Extract JSON robustly — find first { ... } block
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Pas de JSON trouvé dans la réponse. Réponse brute: ' + raw.slice(0, 500) })
    }

    let parsed
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      // Try stripping markdown fences and retry
      const cleaned = jsonMatch[0].replace(/```json|```/g, '').trim()
      parsed = JSON.parse(cleaned)
    }

    res.status(200).json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
