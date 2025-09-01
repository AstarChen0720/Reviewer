// Supabase Edge Function: save-user-key
// Actions: save | delete | status
// Env: AI_KEY_ENC_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
// Request JSON:
// { action:'save', apiKey:string } OR { action:'delete' } OR { action:'status' }
// Response:
//  save -> { ok:true, last4:string }
//  delete -> { ok:true }
//  status -> { hasKey:boolean, last4?:string }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const ENC_SECRET = Deno.env.get('AI_KEY_ENC_SECRET') || '';

interface ReqBody {
  action: 'status' | 'save' | 'delete';
  apiKey?: string;
}

function json(data:any,status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'Content-Type':'application/json',
      'Cache-Control':'no-store'
    }
  });
}

async function deriveEncryptKey(){
  if (!ENC_SECRET) throw new Error('Missing AI_KEY_ENC_SECRET');
  const bytes = new TextEncoder().encode(ENC_SECRET);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt','decrypt']);
}

function toB64(u8:Uint8Array){
  let s=''; u8.forEach(b=> s+=String.fromCharCode(b));
  return btoa(s);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error:'Method not allowed' },405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error:'Server not configured' },500);

  let body: ReqBody;
  try { body = await req.json(); } catch { return json({ error:'Bad JSON' },400); }
  if (!body.action) return json({ error:'Missing action' },400);

  const authHeader = req.headers.get('Authorization') || '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: authHeader ? { headers:{ Authorization: authHeader } } : {}
  });
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user) return json({ error:'Unauthorized' },401);

  if (body.action === 'status') {
    const { data } = await supabase.from('user_ai_keys').select('last4').eq('user_id', user.id).single();
    return json({ hasKey: !!data, last4: data?.last4 });
  }

  if (body.action === 'delete') {
    await supabase.from('user_ai_keys').delete().eq('user_id', user.id);
    return json({ ok:true, deleted:true });
  }

  if (body.action === 'save') {
    if (!body.apiKey || body.apiKey.length < 10) return json({ error:'Invalid apiKey' },400);
    try {
      const cryptoKey = await deriveEncryptKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherBuf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(body.apiKey));
      const cipher = toB64(new Uint8Array(cipherBuf));
      const ivB64 = toB64(iv);
      const last4 = body.apiKey.slice(-4);
      await supabase.from('user_ai_keys').upsert({
        user_id: user.id,
        key_ciphertext: cipher,
        iv: ivB64,
        last4
      });
      return json({ ok:true, last4 });
    } catch (e:any) {
      return json({ error:'Encrypt failed', detail:e.message },500);
    }
  }

  return json({ error:'Unsupported action' },400);
});
