export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
    responseLimit: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { base64Data, filename } = req.body
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurée' })

  const system = `Tu es un analyste senior en investissement immobilier. Analyse cet Investment Memorandum et retourne UNIQUEMENT un JSON valide (sans backticks ni markdown).

Structure requise:
{
  "titre": "nom de l'actif",
  "classe_actif": "bureau / commerce / logistique / résidentiel / mixte / autre",
  "localisation": {
    "adresse": "adresse complète",
    "ville": "ville",
    "pays": "pays",
    "code_postal": "code postal si disponible",
    "analyse_im": "analyse de la localisation selon l'IM"
  },
  "transports": {
    "metro": ["lignes"],
    "rer": ["lignes"],
    "bus": ["lignes"],
    "gare": "gare proche",
    "analyse_im": "analyse transports selon l'IM"
  },
  "etat_locatif": {
    "taux_occupation": "XX%",
    "surface_totale": "XXX m²",
    "loyer_total_annuel": "XXX €",
    "locataires": [
      {
        "nom": "nom",
        "secteur": "secteur",
        "surface": "m²",
        "loyer_annuel": "€",
        "loyer_m2": "€/m²/an",
        "echeance_bail": "date",
        "type_bail": "3-6-9 / ferme / autre",
        "fiabilite_im": "forte / moyenne / faible",
        "note_im": "justification selon l'IM"
      }
    ]
  },
  "durees_engagement": {
    "wal": "X,X ans",
    "bail_plus_long": "X ans - locataire",
    "bail_plus_court": "X ans - locataire"
  },
  "financier": {
    "prix_demande": "XXX €",
    "rendement_vendeur": "X,XX%",
    "rendement_brut_calcule": "X,XX%",
    "valeur_m2": "XXX €/m²",
    "valeur_locative_theorique": "XXX €/m²/an selon l'IM"
  },
  "marche_locatif_im": {
    "loyer_marche_cite": "XXX €/m²/an",
    "comparables_cites": ["comparable 1"]
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
        max_tokens: 3000,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data }, title: filename },
            { type: 'text', text: 'Extrais les données de ce mémorandum.' }
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
    res.status(200).json(parsed)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
