import { put } from '@vercel/blob'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const buffer = Buffer.concat(chunks)
    const filename = req.headers['x-filename'] || 'document.pdf'

    const blob = await put(filename, buffer, {
      access: 'public',
    })

    res.status(200).json({ url: blob.url })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
