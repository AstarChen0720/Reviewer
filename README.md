reviewer 

1. 加入資料:
   1. 把學過的單字文法拖到或複製到網站上的三個箱子裡面
      1. 會自動分格成一個個block可以自由拖動
2. 儲存資料:
   1. database會把三個箱子裡面的東西儲存,並且自動分類成單字或文法、(日文或英文---未來功能)
3. 閱讀:
   1. 將三個箱子裡面的資料，依照不同"生成器"(可能是日檢或托福生成器)抓取資料(未來功能)，來生成文章
   2. 生成的文章中，有出現box裡面的單字或文法，會用不同顏色的底線標出
4. 更新資料:
   1. 在讀完文章後，會有三個box裡面會顯示有在文章內出現過的單字跟文法，你可自由拖動，會在database上將原本內容所在的分類(那一box)做更新

實現

1. 作一可以將複製上去的資料自動分開成可自由在三個box中拖動的block的功能
2. 整改介面為我等等資料要接上ai做準備
   1. 先編輯的ui
   2. 在來是閱讀的ui
3. 連接到ai，分別用我的三個box的資料來生成文章
   1. 按下生成時會隨機提供20個資料(資料數量:沒印象8個、不熟8個、熟了4個)給ai做生成
   2. 再生成時就請他有用到的資料用span加上data-item-id包住，再套用css就可以
   3. 讓文章下面可以也有三個box是預計用來放文章中有出現的，對應語言的沒印象、不熟、熟悉的資料
   會隨著選擇是生成英文還是日文的文章會有所變化
4. 你可以自己修改指令、並且可以調整每個框備取用的資料量
5. 預設生成日文跟英文兩種文章
6. - 加入保存文章(最多15篇)
7. 新增一個魔法袋固定在右上角，可以托入所有不會的字，在文章中對有畫線的按下也可以放入袋中
8. 袋子點選後可以隨時展開顯示，如果有相同的字則不會重複儲存
9. 可以快速刪除或複製(可以自選要用什麼東西分開)或加入prompt再複製方便可以丟到ai裡面貼上尋問
10. 準備好同步的狀態和登入的帳號的ui
11. 梳理好資料同步的邏輯
12. 接上supabase讓資料可以存在上面同步，也可以讓人用帳號密碼登入
13. 經由用supabase連接到gemini ai


現在要做的:
- 所有資料都存成IndexedDB (Dexie) 
- 加入登入登出ui
- 新增"同步"按紐並且他本身就會顯示狀態
- 在最上面橫bar的Reviewer大字的右邊加上一個"登入"、"同步"按鈕、顯示"同步狀態"的圖示(可以顯示現在同步狀態)



目前問題
- 選分隔方式那裡格子凸出，
- 每次切換到文章高亮的功能時都會丟失文章(至少要到重新整理或重新生成再清空)
- 一次請求只叫他生成一篇文章而已但是他一次請求是可以生成多篇文章的
- 請ai生成取消沒用，他一樣會生成
- prompt編輯都是假編輯他不會保存
- 














- 以後可以做在popup裡面選，或用滑鼠停留時間決定(更加無感) 




1. Supabase 專案初始化
2. 安裝/環境變數
3. 建立核心資料表 + RLS
4. 建立 AI 相關表 (ai_usage_logs, user_ai_keys)
5. 啟用 Realtime / publication(目前先不做)
6. 前端 Supabase client 建立
7. 型別擴充 (updatedAt / deleted) + 本地 dirty queue
8. Push / Pull / Sync 模組
9. 登入 / 自動註冊 UI
10. Realtime 訂閱 (items / articles)(目前先不做)
11. Edge Function: gen-article (支援共享 key / 使用者儲存 key / 使用者臨時 key)
12. Edge Function: save-user-key (加密上傳) + delete-user-key
13. 前端 AI Key 管理 UI + 狀態 (remote / local / shared)
14. 文章生成流程整合 (順序選擇 key → 呼叫)
15. 生成請求可取消（AbortController）
16. Prompt 編輯永久保存 (Dexie or settings)
17. 文章視圖切換不丟失：持久 currentArticle
18. 多篇生成控制（限制 / 解析）
19. 修正 UI 問題（分隔框溢出等）
20. 週期 Full Pull + 測試與驗證流程

project ref:"jjqpkutthygtqnizpjct"


交接摘要（明日快速銜接）

目前進度
已部署 save-user-key，status 顯示 hasKey = true（使用者金鑰已加密儲存成功）。
gen-article 已改為使用 anon key + Authorization Bearer JWT；欄位期望名稱為 key_ciphertext, iv, last4。
呼叫 gen-article 三種模式（user-stored / provided / shared）都回 500，尚未完成第 11 步驗證。
CLI 無 functions logs 參數可看雲端日誌；需到 Supabase Dashboard -> Logs -> Functions 查看，或本地 npx supabase functions serve 做本地測試。
很可能的 500 根因（尚未確認哪一個）
user_ai_keys 表仍使用 enc_key 而非 key_ciphertext。
AI_KEY_ENC_SECRET 與當初加密儲存時不同（導致解密失敗）。
GEMINI_SHARED_KEY / providedKey 無效或模型名稱不支援。
尚未重新 deploy 修改後的 gen-article（你剛剛新增 console.error 要再 deploy）。
明日第一件事（建議順序） (1) Dashboard -> Table Editor -> user_ai_keys 確認欄位：若仍是 enc_key 則執行： alter table public.user_ai_keys rename column enc_key to key_ciphertext; (2) Dashboard -> SQL Editor：建立/確認 RLS 政策（user_ai_keys 自己可存取；ai_usage_logs insert/select 自己）。 (3) Secrets 檢查：Dashboard -> Project Settings -> Secrets：
GEMINI_SHARED_KEY (有值，別貼出)
AI_KEY_ENC_SECRET (保持與現在一致，勿改) (4) 重新部署： npx supabase@latest functions deploy gen-article (5) 重新 save key（保證用新版欄位）： POST /save-user-key { action: "save", apiKey: "你的Gemini金鑰" } (6) 測試 user-stored → provided → shared（每次失敗記下返回 JSON）。 (7) 若仍 500：本地啟動： npx supabase@latest functions serve gen-article 用 http://localhost:54321/functions/v1/gen-article 測；看終端 console.error。 (8) 把錯誤訊息貼給助手（含 console.error 與返回 JSON）。
驗證成功的判斷
user-stored：返回 { raw, html, usedIds }（或至少 raw）。
provided：同上且不受儲存 key 影響。
shared：成功表示 GEMINI_SHARED_KEY 有設且可用；若錯 Shared key not set → re-set secret + redeploy。
完成第 11 步後的下一步（第 13 / 14 步）
新增前端設定 UI：選擇模式優先順序（provided > user-stored > shared > mock）。
改寫 runAI() 由直接前端呼叫 Gemini → 改呼叫 /gen-article。
加入錯誤提示（401 自動登出 / 400 顯示輸入錯誤 / 500 顯示「伺服器錯誤重試」）。
關鍵檔案位置
index.ts
index.ts
web/src/components/Reader.tsx（需要改寫 runAI 流程）
web/src/utils/ai.ts（之後精簡，移除直接 Gemini 呼叫）
明日回來請準備貼的資訊（若還卡住）
user_ai_keys 表欄位清單
/save-user-key status 回傳
本地 serve 的 console.error 行
一個 500 回傳的 JSON
不要遺失的注意事項
不要更改 AI_KEY_ENC_SECRET，否則已存 ciphertext 會解不開。
如果要重設 key，直接 action: delete -> save。
測試 provided 模式時 providedKey 必須是真實有效金鑰。
照這份清單做，明天可直接續接到測試與修正點。