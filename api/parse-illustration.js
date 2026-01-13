// AdvisorOS Illustration Parser - Vercel Serverless Function
// Handles PDF parsing via Claude Vision + Supabase template storage

export const config = {
    maxDuration: 60,
};

// CORS headers - must be returned on ALL responses including OPTIONS
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
    'Access-Control-Max-Age': '86400',
};

// Initialize Supabase client
function getSupabase(url, key) {
    return {
        async getTemplate(carrier, product) {
            const response = await fetch(
                `${url}/rest/v1/illustration_templates?carrier=eq.${encodeURIComponent(carrier)}&product=eq.${encodeURIComponent(product)}&limit=1`,
                {
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${key}`
                    }
                }
            );
            const data = await response.json();
            return data[0] || null;
        },
        
        async saveTemplate(template) {
            const response = await fetch(
                `${url}/rest/v1/illustration_templates`,
                {
                    method: 'POST',
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify(template)
                }
            );
            return response.ok;
        },
        
        async incrementUsage(carrier, product) {
            await fetch(
                `${url}/rest/v1/rpc/increment_template_usage`,
                {
                    method: 'POST',
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ p_carrier: carrier, p_product: product })
                }
            );
        }
    };
}

// Call Claude Vision API
async function callClaude(apiKey, images, prompt, model = 'claude-sonnet-4-20250514') {
    const content = [];
    
    for (const img of images) {
        content.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: img
            }
        });
    }
    
    content.push({ type: 'text', text: prompt });
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model,
            max_tokens: 8000,
            messages: [{ role: 'user', content }]
        })
    });
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.content[0].text;
}

function parseJSON(text) {
    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
        return null;
    }
}

// Main handler
export default async function handler(req, res) {
    // Set CORS headers on ALL responses
    Object.entries(corsHeaders).forEach(([key, value]) => {
        res.setHeader(key, value);
    });
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    // Get environment variables
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    
    if (!ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'Server not configured: missing Anthropic API key' });
    }
    
    try {
        const { images, pagesText } = req.body;
        
        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }
        
        console.log(`Processing ${images.length} page images...`);
        
        // Initialize Supabase if configured
        const supabase = SUPABASE_URL && SUPABASE_KEY 
            ? getSupabase(SUPABASE_URL, SUPABASE_KEY) 
            : null;
        
        // Step 1: Identify carrier and product
        const sampleImages = images.slice(0, Math.min(5, images.length));
        
        const structureResponse = await callClaude(ANTHROPIC_API_KEY, sampleImages, `
Analyze this life insurance illustration PDF to identify:
1. Insurance carrier name (e.g., Prudential, Symetra, Lincoln, Nationwide)
2. Product name (e.g., SVUL Protector, Accumulator VUL)

Return JSON only:
{
    "carrier": "carrier name",
    "product": "product name"
}
        `);
        
        const structure = parseJSON(structureResponse) || { carrier: 'Unknown', product: 'Unknown' };
        console.log(`Identified: ${structure.carrier} - ${structure.product}`);
        
        // Step 2: Check for existing template
        let useTemplate = false;
        let template = null;
        
        if (supabase && structure.carrier !== 'Unknown') {
            template = await supabase.getTemplate(structure.carrier, structure.product);
            if (template) {
                console.log('Found existing template');
                useTemplate = true;
            }
        }
        
        // Step 3: Extract policy info
        const policyResponse = await callClaude(ANTHROPIC_API_KEY, images.slice(0, 4), `
Extract policy information from this life insurance illustration.

Find and extract:
- Insured name (the person being insured, NOT the agent)
- Insured age at issue
- Second insured age (for survivorship policies only)
- Gender
- Risk/underwriting class
- Face amount / Death benefit amount
- Annual premium (ongoing annual premium)
- Year 1 premium (if different due to 1035 exchange)
- 1035 Exchange amount (if any)
- State

Return JSON only:
{
    "insuredName": "name",
    "insuredAge": number,
    "insuredAge2": number or null,
    "insuredGender": "Male" or "Female",
    "riskClass": "class",
    "faceAmount": number,
    "premium": number,
    "premiumYear1": number or null,
    "premiumYear2Plus": number or null,
    "exchange1035": number or null,
    "state": "XX"
}
        `);
        
        const policyInfo = parseJSON(policyResponse) || {};
        
        // Step 4: Extract projections
        const projImages = images.slice(0, Math.min(12, images.length));
        
        const projResponse = await callClaude(ANTHROPIC_API_KEY, projImages, `
Extract year-by-year projection data from this life insurance illustration.

IMPORTANT:
- For documents showing multiple rate scenarios (0% and 6%), use the NON-ZERO illustrated rate
- Policy Value should be GREATER than Surrender Value
- Extract data for all years shown (typically years 1-30 or more)

For each year extract:
- year: policy year (1, 2, 3...)
- age: insured's age
- premium: annual premium paid
- policyValue: policy/cash/contract value (NOT surrender value)
- surrenderValue: net surrender value
- deathBenefit: death benefit amount

Return JSON only:
{
    "projections": [
        {"year": 1, "age": 45, "premium": 50000, "policyValue": 48000, "surrenderValue": 45000, "deathBenefit": 1000000},
        ...
    ]
}
        `);
        
        const projData = parseJSON(projResponse) || {};
        const projections = projData.projections || [];
        
        // Step 5: Extract expenses
        const expImages = images.slice(Math.floor(images.length * 0.3), Math.min(images.length, Math.floor(images.length * 0.7) + 5));
        
        const expResponse = await callClaude(ANTHROPIC_API_KEY, expImages.slice(0, 6), `
Extract annual expense/charges data from this life insurance illustration.

Look for pages showing:
- Premium charges/loads
- Cost of Insurance (COI)
- Administrative fees
- Total policy charges

For each year extract:
- year: policy year
- premiumCharge: premium load/charge
- coi: cost of insurance
- adminCharge: administrative fees
- totalCharges: total charges

Return JSON only:
{
    "expenses": [
        {"year": 1, "premiumCharge": 5000, "coi": 2000, "adminCharge": 500, "totalCharges": 7500},
        ...
    ]
}
        `);
        
        const expData = parseJSON(expResponse) || {};
        const expenses = expData.expenses || [];
        
        // Step 6: Save as template if new and successful
        if (supabase && !useTemplate && structure.carrier !== 'Unknown' && projections.length >= 5) {
            console.log('Saving new template...');
            await supabase.saveTemplate({
                carrier: structure.carrier,
                product: structure.product,
                page_signatures: {},
                field_patterns: {},
                table_patterns: {},
                sample_extraction: {
                    policyInfo,
                    projectionsCount: projections.length,
                    expensesCount: expenses.length
                },
                usage_count: 1
            });
        } else if (supabase && useTemplate) {
            await supabase.incrementUsage(structure.carrier, structure.product);
        }
        
        // Return results
        const result = {
            success: true,
            carrier: structure.carrier,
            product: structure.product,
            policyInfo,
            projections,
            expenses,
            templateUsed: useTemplate,
            confidence: projections.length >= 10 ? 0.9 : projections.length >= 5 ? 0.7 : 0.5
        };
        
        console.log(`Extraction complete: ${projections.length} projection years, ${expenses.length} expense years`);
        
        return res.status(200).json(result);
        
    } catch (error) {
        console.error('Processing error:', error);
        return res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
}
