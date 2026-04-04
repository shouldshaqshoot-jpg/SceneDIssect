export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { image, shotNumber } = req.body;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are a professional cinematographer. Analyse this frame and return ONLY a JSON object:
{"shotType":"<Extreme Close-Up|Close-Up|Medium Close-Up|Medium Shot|Medium Wide|Wide Shot|Extreme Wide>","angle":"<Eye Level|Low Angle|High Angle|Dutch Angle|Bird's Eye|Worm's Eye>","cameraMovement":"<Static|Pan|Tilt|Dolly|Tracking|Handheld|Crane|Cannot determine>","lighting":"<1-2 sentences>","composition":"<key framing technique>","mood":"<2-3 words>","lensEstimate":"<e.g. 24mm wide, 85mm tele>","shootFor":"<specific actionable tip>"}`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: `Analyse as shot ${shotNumber}. Return only the JSON.` }
        ]
      }]
    })
  });

  const data = await response.json();
  const text = (data.content || []).map(c => c.text || '').join('').replace(/```json|```/g, '').trim();

  try {
    res.status(200).json(JSON.parse(text));
  } catch {
    res.status(500).json({ error: 'Parse failed', raw: text });
  }
}
