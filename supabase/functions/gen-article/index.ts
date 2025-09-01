// Supabase Edge Function: gen-article
// Modes: shared | user-stored | provided
// Env needed (set via `supabase secrets set`):
//  - GEMINI_SHARED_KEY : shared Gemini key (for mode=shared)
//  - AI_KEY_ENC_SECRET : secret used to derive AES-GCM key for decrypting user stored API key
//  - SUPABASE_SERVICE_ROLE_KEY (optional if you prefer service role) otherwise anon key + JWT
//  - (Automatically provided) SUPABASE_URL
//  - (Automatically provided) SUPABASE_ANON_KEY
//
// Request JSON shape:
// { prompt:string; model:string; mode:'shared'|'user-stored'|'provided'; providedKey?:string }
//
// Response JSON shape on success:
// { raw:string; html:string; usedIds:string[] }
// On error: { error:string }

// Edge runtime types
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
// Declare Deno for type-checkers that don't pick up the edge runtime ambient types locally
// (Supabase deploy environment provides Deno global.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any;
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface ReqBody {
  prompt: string;
  model?: string;
  mode: 'shared'|'user-stored'|'provided';
  providedKey?: string;
}

// 正確的環境變數名稱：GEMINI_SHARED_KEY (不要放真實 key 字串在程式碼）
const GEMINI_SHARED_KEY = Deno.env.get('GEMINI_SHARED_KEY') || '';
const ENC_SECRET = Deno.env.get('AI_KEY_ENC_SECRET') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';

// Derive a 256-bit key from ENC_SECRET using SHA-256
async function getAesKey() {
  if (!ENC_SECRET) throw new Error('Missing AI_KEY_ENC_SECRET');
  const enc = new TextEncoder().encode(ENC_SECRET);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt','decrypt']);
}

async function decryptStored(api: { key_ciphertext: string; iv: string }) {
  const key = await getAesKey();
  const iv = Uint8Array.from(atob(api.iv), c => c.charCodeAt(0));
  const cipher = Uint8Array.from(atob(api.key_ciphertext), c => c.charCodeAt(0));
  try {
    const plainBuf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
  } catch {
    throw new Error('Failed to decrypt stored key');
  }
}

function jsonResponse(obj: any, init: ResponseInit = {}) {
  return new Response(JSON.stringify(obj), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...init.headers,
    }
  });
}

async function callGemini(apiKey: string, model: string, prompt: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 }
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error ${res.status}: ${t}`);
  }
  const data = await res.json();
  let text = '';
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) text = parts.map((p: any)=>p.text||'').join('\n'); else text = JSON.stringify(data);
  return text;
}

function extractJson(text: string) {
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  if (!jsonStr.startsWith('{')) {
    const m = jsonStr.match(/\{[\s\S]*\}/);
    if (m) jsonStr = m[0];
  }
  try { return JSON.parse(jsonStr); } catch { return { raw: text }; }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  const authHeader = req.headers.get('Authorization') || '';
  let body: ReqBody;
  try { body = await req.json(); } catch { return jsonResponse({ error:'Invalid JSON' }, { status:400 }); }
  if (!body.prompt) return jsonResponse({ error:'Missing prompt' }, { status:400 });
  // Use a broadly available default model; can override via request body
  const model = body.model || 'gemini-1.5-flash';
  if (!['shared','user-stored','provided'].includes(body.mode)) return jsonResponse({ error:'Invalid mode' }, { status:400 });

  // Setup Supabase client with anon key; rely on RLS (must allow user to select own user_ai_keys row & insert usage logs)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return jsonResponse({ error:'Server not configured' }, { status:500 });
  if (!authHeader) return jsonResponse({ error:'Missing Authorization header' }, { status:401 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } }
  });

  // Identify user
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return jsonResponse({ error:'Unauthorized' }, { status:401 });

  let apiKey = '';
  try {
    if (body.mode === 'shared') {
      if (!GEMINI_SHARED_KEY) throw new Error('Shared key not set');
      apiKey = GEMINI_SHARED_KEY;
    } else if (body.mode === 'provided') {
      if (!body.providedKey) throw new Error('providedKey required');
      apiKey = body.providedKey.trim();
    } else { // user-stored
      const { data, error } = await supabase.from('user_ai_keys').select('key_ciphertext,iv').eq('user_id', user.id).single();
      if (error || !data) throw new Error('No stored key');
      apiKey = await decryptStored(data as any);
    }
  } catch (e:any) {
    return jsonResponse({ error: e.message || String(e) }, { status:400 });
  }

  try {
    const text = await callGemini(apiKey, model, body.prompt);
    const parsed = extractJson(text);
    const raw = typeof parsed.raw === 'string' ? parsed.raw : (parsed.text || text);
    let html = typeof parsed.html === 'string' ? parsed.html : raw;
    let usedIds: string[] = Array.isArray(parsed.usedIds) ? parsed.usedIds.filter((x:any)=>typeof x==='string') : [];
    if (!usedIds.length) {
      const matches = html.match(/data-item-id="(.*?)"/g) || [];
      usedIds = Array.from(new Set(matches.map(s=>s.replace(/.*data-item-id="(.*)".*/, '$1'))));
    }
    // basic log (ignore failures)
    await supabase.from('ai_usage_logs').insert({ user_id: user.id, model, token_in: raw.length, token_out: html.length }).catch(()=>{});
    return jsonResponse({ raw, html, usedIds });
  } catch (e:any) {
  console.error('[gen-article] failure mode='+body.mode+' user='+ (authHeader? 'present':'missing') +' msg=', e?.message, 'stack=', e?.stack);
  return jsonResponse({ error: e.message || String(e) }, { status:500 });
  }
});
