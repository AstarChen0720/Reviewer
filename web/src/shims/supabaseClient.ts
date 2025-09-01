import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true }
});

export type SupabaseClientType = typeof supabase;

// Dev helper: 讓你在瀏覽器 Console 取得 token
// 重新整理頁面後在 Console 輸入：getSupabaseToken() 取得存取權杖
// 或直接使用 window.supabase 物件
if (typeof window !== 'undefined') {
  // 只掛一次
  // @ts-ignore
  if (!(window as any).supabase) {
    // @ts-ignore
    (window as any).supabase = supabase;
    // @ts-ignore
    (window as any).getSupabaseToken = async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token;
    };
  }
}