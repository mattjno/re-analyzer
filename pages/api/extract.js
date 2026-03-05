export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { blobUrl, filename } = req.body
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })

  const pdfResponse = await fetch(blobUrl)
  const pdfBuffer = await pdfResponse.arrayBuffer()
  const base64Data = Buffer.from(pdfBuffer).toString('base64')

  const system = `Tu es un analyste senior en investissement immobilier. Analyse cet Investment Memorandum et retourne UNIQUEMENT un JSON valide (sans backticks ni markdown).

Structure requise:
{
  "titre": "nom de l'actif",
  "classe_actif": "bureau / commerce / logistique / résidentiel / mixte / hôtel / industriel",
  "localisation": {
    "adresse": "adresse complète la plus précise possible",
    "ville": "ville",
    "pays": "pays",
    "code_postal": "code postal si disponible",
    "analyse_im": "analyse de la localisation selon l'IM en 2-3 phrases"
  },
  "transports": {
    "metro": ["ex: Ligne 1 - Châtelet (200m)"],
    "rer": ["ex: RER A - Châtelet (200m)"],
    "tram": ["ex: T3a - Porte de Vincennes (100m)"],
    "bus": ["ex: Bus 29, 76"],
    "gare": "ex: Gare de Lyon (1,2km)",
    "analyse_im": "analyse transports selon l'IM"
  },
  "etat_locatif": {
    "taux_occupation": "XX%",
    "surface_totale": "XXX m²",
    "loyer_total_annuel": "XXX €/an",
    "locataires": [
      {
        "nom": "Nom du locataire",
        "secteur": "secteur d'activité précis",
        "surface": "XXX m²",
        "loyer_annuel": "XXX €/an",
        "loyer_m2": "XXX €/m²/an",
        "date_debut_bail": "MM/YYYY",
        "date_break": "MM/YYYY",
        "date_fin_bail": "MM/YYYY",
        "walb": "X,X ans",
        "walt": "X,X ans",
        "type_bail": "triple net / double net / simple net / brut",
        "note_im": "description selon l'IM"
      }
    ]
  },
  "durees_engagement": {
    "walb": "X,X ans",
    "walt": "X,X ans",
    "bail_plus_long": "X ans - Locataire",
    "bail_plus_court": "X ans - Locataire"
  },
  "financier": {
    "prix_demande": "XXX €",
    "rendement_vendeur": "X,XX%",
    "rendement_brut_calcule": "X,XX%",
    "valeur_m2": "XXX €/m²",
    "valeur_locative_theorique": "XXX €/m²/an"
  },
  "marche_locatif_im": {
    "loyer_marche_cite": "XXX €/m²/an",
    "comparables_cites": ["comparable 1"]
  },
  "classe_actif_details": {
    "type_specifique": "description précise",
    "annee_construction": "XXXX",
    "derniere_renovation": "XXXX",
    "certification": "HQE / BREEAM / LEED / EPC A / Aucune",
    "caracteristiques_cles": ["caractéristique 1", "caractéristique 2"]
  }
}
Si une donnée manque: "N/D".`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data }, title: filename },
            { type: 'text', text: 'Extrais toutes les données de ce mémorandum. Sois très précis sur les dates de bail (break, fin), les surfaces et loyers par locataire.' }
          ]
        }]
      })
    })

    if (!response.ok) {
      const err = await response.text()
      return res.status(response.status).json({ error: err })
    }

    const data = await response.json()
    const raw = data.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(raw)
    await fetch(blobUrl, { method: 'DELETE' }).catch(() => {})
    res.status(200).json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
