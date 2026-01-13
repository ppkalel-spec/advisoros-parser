# AdvisorOS Illustration Parser API

Serverless API for parsing life insurance illustrations using Claude Vision.

## Deployment

1. Deploy to Vercel
2. Add environment variables:
   - `ANTHROPIC_API_KEY` - Your Anthropic API key
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_KEY` - Your Supabase service_role key

## API Endpoint

```
POST /api/parse-illustration

Body (JSON):
{
    "images": ["base64_image_1", "base64_image_2", ...]
}

Response:
{
    "success": true,
    "carrier": "Symetra",
    "product": "Accumulator VUL",
    "policyInfo": {
        "insuredName": "John Smith",
        "insuredAge": 45,
        "faceAmount": 5000000,
        "premium": 50000,
        ...
    },
    "projections": [
        {"year": 1, "age": 45, "premium": 50000, "policyValue": 48000, ...},
        ...
    ],
    "expenses": [...],
    "templateUsed": false,
    "confidence": 0.9
}
```

## Cost

- Anthropic API: ~$0.03-0.05 per page
- Typical 20-page illustration: ~$0.60-1.00
- After template exists: Same cost (template matching not yet implemented server-side)
