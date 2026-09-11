// Verify the Vertex AI image model is callable from this project BEFORE
// deploying the generateImage function. Run with your own ADC (no API key):
//
//   gcloud auth application-default login
//   node scripts/verify-vertex.mjs
//
// Optional flags: --project cocktails-c2705 --region us-central1
//                 --model gemini-2.5-flash-image
//
// Checks, in order — each one maps to a setup step in
// docs/cloud-ai-backend.md → "The image pool":
//   1. credentials resolvable (ADC / GOOGLE_APPLICATION_CREDENTIALS)
//   2. the Vertex AI API is enabled for the project (403/404 otherwise)
//   3. the account may call the image model (roles/aiplatform.user missing → 403)
//   4. the model accepts responseModalities IMAGE + imageConfig (a wrong model
//      id or a non-image model reports a 400 with the reason)

import { GoogleAuth } from 'google-auth-library'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : null
}

const project = arg('project') ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'cocktails-c2705'
const region = arg('region') ?? process.env.VERTEX_REGION ?? 'us-central1'
const model = arg('model') ?? process.env.IMAGE_GEN_MODEL ?? 'gemini-2.5-flash-image'

const url =
  `https://${region}-aiplatform.googleapis.com/v1/projects/${project}` +
  `/locations/${region}/publishers/google/models/${model}:generateContent`

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
const client = await auth.getClient()
const token = await client.getAccessToken()
if (!token.token) {
  console.error('✗ Could not obtain an ADC token — run `gcloud auth application-default login` first.')
  process.exit(1)
}
console.log(`Project ${project} · region ${region} · model ${model}`)

const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.token}` },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'A daiquiri in a chilled coupe, lime wheel on the rim.' }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '1K', aspectRatio: '3:4' } },
  }),
})

if (!res.ok) {
  const body = await res.text()
  console.error(`\n✗ ${res.status} from ${model}: ${body.slice(0, 500)}`)
  if (res.status === 403) {
    console.error(
      '  Either the Vertex AI API is not enabled (console → APIs & Services → Enable "Vertex AI API")\n' +
        `  or this account lacks "Vertex AI User" (roles/aiplatform.user) on ${project}.`,
    )
  }
  if (res.status === 404) {
    console.error(`  Model "${model}" was not found in ${region}. Check IMAGE_GEN_MODEL — see docs/cloud-ai-backend.md.`)
  }
  process.exit(1)
}

const data = await res.json()
const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
if (!part?.inlineData?.data) {
  console.error('\n✗ The model answered but returned no image:', JSON.stringify(data).slice(0, 500))
  process.exit(1)
}
console.log(`\n✓ ${model} returned a ${part.inlineData.mimeType} image (${Math.round((part.inlineData.data.length * 3) / 4 / 1024)} KB).`)
console.log('  Vertex is ready — deploy functions and the pool will generate on demand.')
