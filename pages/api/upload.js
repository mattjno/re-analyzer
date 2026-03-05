import { handleUpload } from '@vercel/blob/client'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const jsonResponse = await handleUpload({
      request: req,
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 50 * 1024 * 1024, // 50MB max
      }),
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url)
      },
    })
    res.status(200).json(jsonResponse)
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}
