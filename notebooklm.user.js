// ==UserScript==
// @name         NotebookLM 一鍵生成互動式報告
// @namespace    https://github.com/yueh-notebooklm
// @version      12.8
// @updateURL    https://raw.githubusercontent.com/ss890527/notebooklm-userscript/main/notebooklm.meta.js
// @downloadURL  https://raw.githubusercontent.com/ss890527/notebooklm-userscript/main/notebooklm.user.js
// @description  開分頁就自動完成「取連結 → 建立筆記本 → 匯入來源 → 逐一生成互動式報告」；內建閱讀模式與斷點續跑
// @match        https://notebook.google.com/*
// @match        https://notebooklm.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  const VERSION = '12.8';

  /* ============================================================
   * ★ v12.8 2026-10-09 設定入口與選單診斷
   *   現象：使用者已確認 menu grant 存在，擴充功能選單仍沒有設定入口。
   *   缺口：API 不可用時靜默返回，不能判斷註冊狀態；確切環境原因尚未確定。
   *   修法：浮動面板直接提供「⚙ 設定網址」，共用保存流程；註冊失敗不阻斷主流程。
   *   診斷只顯示狀態，不輸出端點或 token。
   *
   * ★ v12.7 2026-10-09 多電腦自動更新
   *   updateURL／downloadURL 指向獨立腳本倉庫；沿用 name／namespace。
   *   Web App 個人網址改存 GM 儲存，程式更新不再清空設定。
   *   每台電腦首次安裝後從竄改猴選單設定網址；不在程式或公開倉庫存 token。
   *
   * ★ v12.6 2026-10-09 生成失敗隔離
   *   現象：11 個來源匯入成功，#1 硬逾時後其餘來源連鎖失敗。
   *   已確認：Promise.race 不會取消 processOne；來源清單消失原因尚未確定。
   *   修法：合作式 deadline／中止檢查，逐部串行退出；恢復失敗停止整批。
   *   每步即時記錄；達到匯入數量時不再誤報缺片。保留檔名，版本依 git 保存。
   *
   * ★ v12.0 直接跟 Apps Script 要連結
   *
   *   在此之前每天要做的兩個動作：
   *     開試算表 → 選單「複製連結」 → 切到 NotebookLM → 按 📥
   *   現在：開 NotebookLM 分頁，結束。
   *
   *   做法：Apps Script 部署成 Web App 回傳 JSON，這支腳本用
   *   GM_xmlhttpRequest 直接抓（不受 CORS 限制），剪貼簿完全退出流程
   *   ——順帶消滅了「剪貼簿殘留雜訊被當成來源」那整類問題。
   *   Web App 抓不到時仍會退回讀剪貼簿，等於多一層保險而不是換掉舊路。
   *
   *   ⚠ @grant 從 none 改成有值，執行環境進入竄改猴沙箱。
   *     沙箱裡的 window 是代理物件，MouseEvent 的 view 若用它可能失效，
   *     所以另外取 REAL_WINDOW（unsafeWindow）給所有滑鼠事件用。
   *     §8 的分隔線拖曳完全依賴 mouse 事件，這點不能省。
   *
   *   自動執行的三道閘（避免每次開分頁都建一個新筆記本）：
   *     1. 只在首頁／清單頁跑，進到既有筆記本裡不會觸發
   *     2. 同一組連結只跑一次（比對指紋，記在 GM 儲存）
   *     3. 倒數期間可取消
   *   （v12.5 加了第四道：Apps Script 端的跨電腦已執行記錄，見下方 v12.5）
   *
   * ★ v12.1 主執行緒閒置閘
   *   v12.0 那輪出現一個乾淨的反向相關：勾選慢的三部彈窗都瞬開（13～31ms），
   *   唯一勾選快的那部（386ms）彈窗要試四次共 4.6 秒。
   *   → 機制：報告按鈕的點擊要在頁面閒下來時才會被收下。
   *     勾選慢時那 3 秒等於免費把頁面等閒了；勾選快時我們趁它還在忙就點，
   *     click 事件被丟掉。總時間因此是守恆的，所以調常數永遠調不動。
   *   → 這也回頭解釋了 v11.3→v11.4 的退化（砍掉 SELECT_SETTLE_MS 後彈窗更難開），
   *     當時我以為是巧合。
   *   → 做法：點報告按鈕前先量事件迴圈延遲，連續兩次低於 IDLE_LAG_MS 才動手；
   *     等不到就照樣點（重試比死等便宜）。實測延遲值會記進計時字串以便校準。
   *   → IDLE_GATE_ENABLED 設成 false 即可退回 v12.0 行為，方便 A/B。
   *
   * ★ v12.2（v12.1 的假設被實測推翻，已預設關閉那道閘）
   *   實測（5 部）：
   *     #1 等閒置逾時 5996ms（lag 996ms）→ 彈窗 35ms ✓
   *     #2 等閒置逾時 4003ms（lag 988ms）→ 彈窗 21ms ✓
   *     #3 等閒置逾時 29066ms（lag 2879ms）→ 彈窗 12ms ✓
   *     #4 等閒置通過 130ms（lag 5ms）→ 彈窗失敗 4 次共 3.3s ✗
   *     #5 等閒置通過 142ms（lag 5ms）→ 彈窗失敗 4 次共 3.3s ✗
   *   主執行緒【閒】的時候點擊失敗，【忙】的時候反而成功——與假設完全相反。
   *
   *   把「點報告鈕前總共經過多久」算出來就清楚了：
   *     #1 8.8s ✓｜#2 7.0s ✓｜#3 32s ✓｜#4 0.5s ✗｜#5 0.5s ✗
   *   決定成敗的是【經過時間】，不是閒置。閒置閘在 #1～#3 之所以看似有效，
   *   只是因為它剛好白等了 4～29 秒；#3 那 29 秒把總時長從 40s 推到 79s。
   *
   *   結論：關掉這道閘。現有的重試機制本來就在做對的事——
   *   它自動提供約 3.3 秒的經過時間，頁面沒好就重試、好了就 12ms 通過，
   *   是自適應的。三次試圖用固定規則取代它，三次都輸給它。
   *   （關於這個步驟的錯誤假設依序是：缺 mouse 事件 → 逾時太短 → 主執行緒忙。
   *    留著這份紀錄，免得日後又從同一個方向重走一遍。）
   *
   *   另修：手動 📥 的重複匯入防呆。實際踩到的情況是開分頁自動跑了一輪，
   *   使用者不知情又手動按一次，同樣五支影片產生兩個筆記本。
   *   改成需要再按一次確認，而不是直接擋掉。
   *
   * ★ v12.3 停留在既有筆記本時的行為
   *   舊版 ensureNotebookReady 看到「已在筆記本頁且新增來源可用」就直接沿用，
   *   也就是說你在讀舊筆記本時按 📥，今天的來源會被倒進那個舊筆記本。
   *   那不是卡住，是污染，而且事後很難查出是哪一批混進去的。
   *   修法：只有明確讀到「0 個來源」才沿用；否則呼叫 createNewNotebook()
   *   另開一個（標題列的「建立新筆記本」在內頁也在，不必先回首頁），
   *   它失敗才退回導向首頁重來，並靠 selfReload 標記讓續跑閘接手。
   *   自動執行維持只在首頁觸發——你打開舊筆記本通常是要讀文章，
   *   這時候把畫面拉走比省一個點擊更討厭。要改用 AUTO_RUN_ANYWHERE。
   *
   * ★ v12.4 NotebookLM 改版：報告彈窗換成「建立報告」，網誌文章卡片消失
   *   現象（2026-09-12 實測 11 部，成功 0）：
   *     #1 單部硬逾時｜#2 單部硬逾時｜#3～#6 找不到「網誌文章」卡片
   *     快照顯示 dialog=有、spinner=1、reportBtn=無 —— 彈窗有開，只是內容變了。
   *   根因：點「報告」後現在是「建立報告」彈窗，內容為
   *     格式（互動式〔預設，新推出〕／文件）＋ 範本（學習總覽）
   *     ＋ 右下「稍後生成／立即生成」。
   *     「網誌文章」被收進「文件」那條分支，第一層已經沒有這張卡片，
   *     所以 findBlogCard 永遠落空，彈窗留著不關又讓下一部連鎖失敗。
   *   修法：卡片點選整個拿掉，改成「開彈窗 → （可選）選格式 → 按立即生成」。
   *     - SEL.blogText → SEL.generateStrict／generateLoose／generateDeny
   *       ⚠ 絕不可只比對「生成」：同一列還有「稍後生成」，點下去只排進佇列不產出。
   *       所以先做完全相符，放寬時仍先用 generateDeny 濾掉稍後／取消。
   *     - CFG.REPORT_FORMAT 預設 'default'＝不碰格式，直接用畫面上的預設值（互動式）。
   *       想固定某一種再改 'interactive'／'document'；那條路會先點格式卡再送出。
   *       預設不點的理由：格式卡是單選，對已選中的那張再點一次的行為未知，
   *       而「不點」在目前的 UI 下是正確且零風險的。
   *     - CARD_RENDER_MS → GEN_BTN_WAIT_MS（語意從等卡片渲染改成等生成鈕啟用）。
   *   另修：VIDEO_HARD_TIMEOUT_MS 60s → 90s。
   *     這次來源有 11 個，selectOnly 是 O(來源數) 的逐格點擊＋驗證，
   *     光勾選就可能吃掉數十秒；60 秒是 4～5 個來源時代訂的值，
   *     #1／#2 的「單部硬逾時」有一半是這個預算過期造成的。
   *
   * ★ v12.5 跨電腦防重複執行（搭配 YT_WebApp v1.1）
   *   背景：去重指紋存在 GM 儲存，只在這一台瀏覽器有效。
   *   現象：早上家裡電腦自動跑完，到公司開 NotebookLM 又自動跑一次，多一本筆記本。
   *   先想過「只在 05:00–12:00 自動跑」——擋不住，家裡和公司都在早上開。
   *   修法：匯入成功（added > 0）後打 Web App 的 &done=<batchId>，記在指令碼屬性；
   *     之後任何一台來要連結都會拿到 doneAt，自動執行停手、手動 📥 要求再按一次確認。
   *     - 回報時機是「匯入成功」而非「報告全部生成完」：筆記本一建出來，
   *       重跑就一定多一本；生成中途被重整還有斷點續跑（batchId 存在 job 裡）。
   *     - batchId 由伺服器算（C 欄連結的 SHA-256 前 16 碼），連結一換就自然失效。
   *     - 端點是舊版、或回報失敗 → 只記警告，行為退回 v12.4 的單機去重。
   *     - 同一批要重跑：按 📥 兩次，或在 Apps Script 執行 clearDoneMark()。
   * ========================================================== */

  /** 沙箱模式下 window 是代理物件，滑鼠事件的 view 要用真的那個 */
  const REAL_WINDOW = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

  /** 沙箱 API 的安全取用（萬一使用者把 @grant 改回 none 也不會整支炸掉） */
  const GM_HAS_XHR = (typeof GM_xmlhttpRequest === 'function');
  function gmGet(key, fallback) {
    try { return (typeof GM_getValue === 'function') ? GM_getValue(key, fallback) : fallback; }
    catch (e) { return fallback; }
  }
  function gmSet(key, value) {
    try { if (typeof GM_setValue === 'function') GM_setValue(key, value); } catch (e) {}
  }

  /* ============================================================
   * ★ v11.0 新增：來源匯入自動化（本次改動全集中在 §2.5 / §8.5 / §10）
   *
   *   原本手動的五步 → 現在一顆「📥 匯入＋生成」按鈕：
   *     建立新筆記本 → 新增來源 → 網站 → 貼上連結 → 插入 → 開始生成
   *
   *   三個實作重點：
   *   1. 剪貼簿：navigator.clipboard.readText()（首次會跳權限提示）。
   *      被拒或讀到空白時，自動退回「聚焦網址框等你按 Ctrl+V」，
   *      偵測到內容就繼續，不會卡死。
   *   2. 斷點續跑：重整頁面會殺掉腳本狀態，所以待辦工作寫進 localStorage。
   *      筆記本卡在 loading 時自動重整，重新注入後自己撿回進度續跑。
   *      最多自動重整 MAX_RELOADS 次，避免無限迴圈。
   *   3. 輸入框：Angular 不吃直接賦值，需原生 setter + 派發 input 事件。
   *      準備三種寫法依序退場，同 §5 checkbox 的多策略思路。
   *
   *   ⚠ 選擇器係依 UI 文字推定，尚未經 DOM 實測。
   *      失敗時按 Alt+D（或面板的 🔧）跑診斷，
   *      它會印出腳本看得到的所有按鈕文字，據此校正 §2.5 的正規式。
   *
   * ★ v11.1（2026-08-29 實測修正）
   *   實測結果：六步走完五步，卡在最後按「插入」。
   *   1. 找按鈕不再只看 getDialog() 內部，也不再因 disabled 就當作不存在。
   *      Angular 要跑完一輪變更偵測才解鎖按鈕 → 改成 waitFor 等它啟用，
   *      真的一直停用也照點，並記錄下來。
   *   2. 「插入」比對改為「完全相符優先、包含為輔」，並排除「新增來源」，
   *      避免搜尋範圍退到 document 時誤點背景那顆。
   *   3. 點擊三策略：click → mouse 事件 → 點內層 label，
   *      以「對話框是否關閉」判定成功。
   *   4. 失敗時在關閉彈窗【之前】自動印出現場，
   *      因為彈窗開著時面板的 🔧 按不到；另加 Alt+D 隨時可診斷。
   *   5. 填值後補送 keyup／blur，某些表單要收到鍵盤事件才重算驗證狀態。
   *
   * ★ v11.2（2026-08-29 第二次實測修正）— 真正的根因
   *   對話框上方有一個「在網路上搜尋新來源」搜尋框（帶 網路／Fast Research chip），
   *   下方按鈕列的「網站」才會開出「網站與 YouTube 網址」面板。
   *   v11.1 用「找得到輸入框就當作已到位」判斷，於是根本沒點「網站」，
   *   把四條連結貼進了搜尋框——那裡沒有「插入」，只有搜尋箭頭，
   *   所以才會出現「填值成功 175 字」後緊接著「找不到插入按鈕」。
   *   修法有三：
   *     a. 到位與否改看子面板標題（websitePanelShown），不再看輸入框存在與否
   *     b. findUrlInput 加黑名單，排除搜尋框（比對 placeholder 與鄰近的 Fast Research chip）
   *     c. findClickableByText 的排序改成「取葉節點中文字最短者」，
   *        原本的 compareDocumentPosition 寫法不是合法的比較函式，結果不穩定
   *
   * ★ v11.3（2026-08-29 第三次實測修正）
   *   1. 「網站」鈕的實際文字是 "linkvideo_youtube網站"——icon ligature 直接黏在前面。
   *      原正規式要求 (^|\s) 邊界，因此完全比不中。改成純包含比對，
   *      並移除 連結／Link／URL 這幾個候選（ligature 裡就有 "link"，會誤中）。
   *      同理「插入」改為結尾比對，不再要求完全相符。
   *   2. 新增 ONLY_YOUTUBE 閘門。實測時剪貼簿殘留的是腳本原始碼，
   *      被解析出 @namespace／@match 三條「網址」，差點匯進筆記本。
   *      非 YouTube 影片連結與帶萬用字元的樣式一律擋掉，並在紀錄列出被擋的項目。
   *
   * ★ v11.4（依 v11.3 成功執行的計時資料做的最佳化）
   *   正確性：
   *   1. waitImportDone 加停滯偵測：連續 IMPORT_STALL_MS 沒有新來源就認賠繼續。
   *      舊版只要有一條匯不進來就會空等滿 4 分鐘，而 NotebookLM 自己就說了
   *      「剛上傳的影片可能無法匯入」——那是常態。
   *   2. 續跑加 selfReload 閘門：只有腳本自己為了解決卡 loading 而重整時才自動接手。
   *      舊版分不清是誰重整的，你手動重整或關分頁再開，它會再建一個新筆記本。
   *   3. 同一筆記本的重複匯入防呆：各筆記本分開記已匯入的 videoId。
   *   效率（v11.3 實測 4 部 28 秒，以下三項合計預估省下四成以上）：
   *   4. 報告彈窗第一次就送完整 mouse 事件。實測 4 部裡有 2 部第一次 .click()
   *      沒反應，白等 1500ms 逾時才靠重試成功——那 1.5 秒純屬浪費。
   *   5. SELECT_SETTLE_MS 1200 → 150：後面本來就有 waitFor 驗證，這段是重複保險。
   *   6. SUBMIT_BUFFER_MS 從固定睡 2 秒改成偵測工作室出現新卡片，通常 300～600ms。
   *   7. queryAllDeep 加 shadow DOM 探測快取，省掉輪詢時每次的全頁走訪。
   *   顯示：
   *   8. cleanLabel 去掉 icon ligature，紀錄不再出現「linkvideo_yo」這種截斷。
   *
   * ★ v11.5（修正 v11.4 造成的退化）
   *   v11.4 實測：勾選 1440→370ms、送出 2010→420ms 都如預期，
   *   但報告彈窗從兩次嘗試變成三次（#0=1614｜#1=2012｜#2=511，合計 4.1s），
   *   反而比 v11.3 的 2.0s 更差，吃掉了前面省下來的時間。
   *   誤判：以為第一次點擊失效是缺 mouse 事件。
   *   真相：彈窗本來就要 1.6～2 秒才出現，而 DIALOG_OPEN_MS 設在 1500ms，
   *         等於在它正要冒出來時放棄，那次多餘的點擊又把它關掉，所以要點三次。
   *         v11.3 之所以兩次就成功，是 SELECT_SETTLE_MS 那 1200ms 睡眠
   *         讓彈窗提前起跑——把睡眠拿掉，就等於把成本從睡覺搬到重試，而重試更貴。
   *   修法：DIALOG_OPEN_MS 1500 → 4000，重試間隔 500 → 250。
   *         waitFor 是輪詢的，彈窗一出現就往下走，逾時設長對快速開啟的情況零代價。
   *   —— 這個修法是錯的，見 v11.6。
   *
   * ★ v11.6（推翻 v11.5 的理論）
   *   v11.5 實測：#0=4524ms、#0=4988ms 都超過 4000ms 逾時，彈窗根本沒開；
   *   但同一輪的 #1=18ms、#4=15ms 卻是瞬開。同程式碼、同按鈕、結果雙峰。
   *   → 這不是「彈窗需要 1.6～2 秒」，是那一下點擊有時候沒有註冊。是競態不是延遲。
   *   → 拉長逾時只是把每次失敗的代價從 1.5 秒變成 4.5 秒。
   *   修法：逾時 800ms、間隔 200ms、重試 4 次。讓失敗變便宜，而不是讓等待變長。
   *
   *   另記一筆給未來的自己：同一份程式碼、同樣四支影片，
   *   總耗時在 26～37 秒之間跳動；勾選+驗證 370～2875ms、送出確認 415～2951ms。
   *   run-to-run 的變異已經大於這些常數微調的效果，
   *   繼續盯著單次計時調參數只會調到雜訊。要再優化請先累積多天資料。
   * ========================================================== */

  /* ============================================================
   * 1. 可調參數
   * ========================================================== */
  const CFG = {
    SOURCE_MIN_WAIT_MS:   8000,
    SOURCE_STABLE_ROUNDS: 3,
    SOURCE_POLL_MS:       1000,
    SOURCE_WAIT_MAX_MS:   300000,
    TAB_VERIFY_MS: 6000,
    TAB_POLL_MS:   150,
    MASTER_SETTLE_MS:     300,
    CLICK_VERIFY_MS:     1200,
    /** ★ v11.4 從 1200 降到 150：後面緊接著就有 waitFor 驗證勾選結果，
     *  這段睡眠是重複的保險，每部片白花 1 秒 */
    SELECT_SETTLE_MS:     150,
    SELECT_VERIFY_MS:    3000,
    REPORT_BTN_WAIT_MS: 10000,
    /** ★ v11.6 降到 800。這個值我調錯過兩次，把結論寫清楚免得再犯：
     *
     *  v11.5 把逾時拉到 4000ms，結果實測出現 #0=4524ms、#0=4988ms
     *  ——彈窗根本沒在四秒內出現。但同一輪的 #1、#4 卻是 18ms、15ms 就開。
     *  同樣的程式碼、同樣的按鈕，結果是雙峰的：不是慢，是那一下點擊沒有註冊。
     *
     *  既然失敗是隨機的、而重試幾乎總是成功（實測 354ms、1020ms），
     *  正確策略是讓失敗變便宜，不是讓等待變長：
     *    逾時 800ms ＋ 間隔 200ms ＋ 多給幾次機會
     *    → 失敗一次只賠 1 秒，典型總成本約 1.4 秒
     *    （對照：v11.3 賠 2.0 秒、v11.5 賠 4.9 秒）
     *  快速開啟的情況不受影響，waitFor 一偵測到就往下走。 */
    DIALOG_OPEN_MS:       800,
    DIALOG_RETRY_GAP_MS:  200,
    /** ★ v12.4 原 CARD_RENDER_MS。語意從「等網誌文章卡片渲染」改成
     *  「等『立即生成』按鈕出現且可按」——改版後彈窗裡已經沒有卡片可點 */
    GEN_BTN_WAIT_MS:     8000,
    /** ★ v12.4 報告格式：
     *  'default'    = 不碰格式選項，直接送出（NotebookLM 目前預設＝互動式）← 建議值
     *  'interactive'／'document' = 送出前先點該格式卡
     *  預設不點的理由：格式卡是單選，對已選中的那張再點一次行為未知；
     *  哪天 NotebookLM 把預設改掉，再改這個值即可。 */
    REPORT_FORMAT:  'default',
    /** ★ v11.4 語意改變：不再是固定睡眠，而是「等工作室出現新卡片」的上限。
     *  偵測到變化就往下走，通常 300～600ms，逾時才退回等滿 */
    SUBMIT_BUFFER_MS:    2500,
    SUBMIT_SETTLE_MS:     250,
    /** ★ v11.6 從 3 提高到 4（共 5 次機會）。逾時降到 800ms 後，
     *  多給機會的成本很低，而彈窗沒開是唯一會讓整部片失敗的環節 */
    BLOG_RETRY:             4,

    /* ── ★ v12.1 主執行緒閒置閘（v12.2 起預設關閉，假設已被實測推翻）──
     * 原假設：報告按鈕的點擊要在頁面閒下來時才會被收下。
     * 實測結果完全相反，詳見檔頭 v12.2 那段。留著程式碼只為了可重現。 */
    IDLE_GATE_ENABLED:    false,
    /** 事件迴圈延遲低於這個值視為閒。空閒時基準約 1～5ms，塞車時可達數百 ms */
    IDLE_LAG_MS:             60,
    /** 連續幾次達標才算數，避免抓到短暫的空檔 */
    IDLE_STREAK:              2,
    IDLE_POLL_MS:           120,
    /** 等不到閒置也照樣往下走，不讓它變成新的卡點 */
    IDLE_MAX_WAIT_MS:      4000,
    /** ★ v12.4 60000 → 90000。selectOnly 是 O(來源數) 的逐格點擊＋驗證，
     *  60 秒是來源只有 4～5 個時訂的預算；11 個來源時光勾選就可能吃掉數十秒。
     *  來源數若再往上長（20+），這個值要跟著調，或改成依來源數計算。 */
    VIDEO_HARD_TIMEOUT_MS: 90000,
    CLICK_DELAY_MS: 300,
    ONLY_INDEX: null,
    // 閱讀版面
    ON_DONE_LAYOUT:      true,
    COLLAPSE_VERIFY_MS:  3000,
    LAYOUT_SETTLE_MS:     400,
    DRAG_STEPS:            10,   // 實測 4 步就到夾制點，10 步已充裕
    DRAG_STEP_MS:          20,
    MIN_PANEL_W:          285,   // data-minimum-panel-width 讀不到時的後備值
    VIEWPORT_MIN:        1060,   // 實測 816 無 gutter、1117 有；三欄的大致斷點
    RESTORE_RATIO:       0.73,
    ON_DONE: 'close',
    DONE_DELAY_MS: 3000,
    MAX_LOG_LINES: 400,

    // ── ★ v11.0 來源匯入 ──
    /** 'batch' = 一次貼上全部連結（NotebookLM 網址框支援多行）
     *  'single' = 一條一條匯入（batch 只成功部分時的後備，較慢但最穩） */
    IMPORT_MODE:          'batch',
    /** 讀不到剪貼簿時，等你手動 Ctrl+V 的上限 */
    CLIPBOARD_WAIT_MS:   120000,
    /** 新筆記本從點擊到「新增來源」可用的等待上限，逾時就重整 */
    NOTEBOOK_READY_MS:    45000,
    ADD_DIALOG_WAIT_MS:    8000,
    WEBSITE_OPT_WAIT_MS:   6000,
    URL_INPUT_WAIT_MS:     6000,
    INSERT_BTN_WAIT_MS:    6000,
    /** 匯入後等待來源全部處理完成的上限 */
    IMPORT_DONE_MAX_MS:  240000,
    /** ★ v11.4 連續這麼久沒有新來源進來就認賠繼續。
     *  NotebookLM 自己在面板上就寫了「剛上傳的影片可能無法匯入」，
     *  少一條就空等滿 IMPORT_DONE_MAX_MS 是不能接受的 */
    IMPORT_STALL_MS:      30000,
    IMPORT_SETTLE_MS:       800,
    /** ★ v11.4 shadow DOM 探測結果的快取時效 */
    SHADOW_PROBE_TTL_MS:   5000,
    /** 卡 loading 時最多自動重整幾次 */
    MAX_RELOADS:              2,
    /** 匯入完成後是否自動接著跑生成 */
    AUTO_GENERATE_AFTER_IMPORT: true,
    /* ── ★ v12.0 Apps Script Web App ── */
    /**
     * 個人網址從竄改猴選單設定，存 GM 儲存；此處必須留空。
     * 舊版碼內網址僅供一次遷移，發布版不可帶入。
     */
    WEBAPP_URL: "",
    WEBAPP_TIMEOUT_MS:    15000,
    /** 開分頁後自動執行。三道閘見檔頭說明；不想自動跑就改 false */
    AUTO_RUN_ON_LOAD:      true,
    /** 自動執行前的倒數（毫秒），這段期間按 ⏹ 可取消 */
    AUTO_RUN_COUNTDOWN_MS:  6000,
    /** 等頁面畫完再抓連結 */
    AUTO_RUN_BOOT_DELAY_MS: 2500,
    /** ★ v12.2 這段時間內同一批連結再手動匯入，會先要求確認 */
    DUP_WARN_MS:         3600000,
    /**
     * ★ v12.3 停留在既有筆記本時要不要也自動執行。
     * 預設 false：你打開舊筆記本通常是要讀文章，這時候自動跑會把畫面
     * 從你正在讀的東西上拉走（它會另外建一個新筆記本並跳過去）。
     * 改成 true 就變成「打開任何 NotebookLM 頁面都會自動跑」。
     */
    AUTO_RUN_ANYWHERE:    false,

    /** ★ v11.3 只收 YouTube 連結。剪貼簿常殘留別的東西，
     *  沒有這道閘，雜訊會直接變成來源污染知識庫。
     *  偶爾要匯入一般網頁時再改成 false。 */
    ONLY_YOUTUBE: true,
    /** 待辦工作的有效期限，超過就視為過期不續跑 */
    JOB_TTL_MS:          900000,
  };

  /* 個人設定與更新程式分開；不要在 log、原始碼或公開倉庫留下含 token 的網址。 */
  const WEBAPP_SETTING_KEY = 'nblm_webapp_url_v1';
  function validWebAppUrl(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname === 'script.google.com' &&
        !u.username && !u.password && !u.hash &&
        /^\/macros\/s\/[^/]+\/exec$/.test(u.pathname) && !!u.searchParams.get('token');
    } catch (_) { return false; }
  }
  const personalSettingsStatus = { menu: '未嘗試' };
  function editWebAppSettings() {
    if (running || importing || layoutBusy) {
      REAL_WINDOW.alert('目前有工作執行中，請完成或停止後再設定網址。');
      return;
    }
  const input = REAL_WINDOW.prompt('請貼上 showWebAppEndpoint() 取得的完整網址。只保存在本機竄改猴，不需傳給 AI。', '');
  if (input === null) return;
  const value = input.trim();
  if (!validWebAppUrl(value)) {
    REAL_WINDOW.alert('網址格式不符：需要 script.google.com/macros/s/.../exec，且含 token 參數。');
    return;
  }
  // 設定失敗不可宣稱成功，避免在舊 API 失效時默默丟失個人設定。
  try {
    if (typeof GM_setValue !== 'function' || typeof GM_getValue !== 'function') throw new Error('GM storage unavailable');
    GM_setValue(WEBAPP_SETTING_KEY, value);
    if (GM_getValue(WEBAPP_SETTING_KEY, '') !== value) throw new Error('GM storage verification failed');
  } catch (_) {
    REAL_WINDOW.alert('設定未保存，請檢查竄改猴儲存權限後再試。');
    return;
  }
  CFG.WEBAPP_URL = value;
  REAL_WINDOW.alert('已保存。請在目前工作完成後重新整理 NotebookLM 分頁。');
  }
  function initializePersonalSettings() {
    const saved = gmGet(WEBAPP_SETTING_KEY, '');
    if (saved && validWebAppUrl(saved)) CFG.WEBAPP_URL = saved;
    else if (CFG.WEBAPP_URL && validWebAppUrl(CFG.WEBAPP_URL)) gmSet(WEBAPP_SETTING_KEY, CFG.WEBAPP_URL);
    else CFG.WEBAPP_URL = '';
    if (typeof GM_registerMenuCommand !== 'function') {
      personalSettingsStatus.menu = 'API 不可用';
      return;
    }
    try {
      GM_registerMenuCommand('設定 Web App 網址（更新後保留）', editWebAppSettings);
      personalSettingsStatus.menu = '註冊呼叫成功（顯示仍以擴充功能實況為準）';
    } catch (_) {
      personalSettingsStatus.menu = '註冊呼叫失敗';
    }
  }
  initializePersonalSettings();

  /* ============================================================
   * 2. Selector 集中區
   *    註：勿用 ng-tns-cXXXXXXX（Angular 動態 scope id，每次 build 都變）
   * ========================================================== */
  const SEL = {
    sourceCb:   'mat-checkbox.select-checkbox',
    masterCb:   'mat-checkbox.select-checkbox-all-sources',
    checkbox:   'mat-checkbox, [role="checkbox"]',
    checkedCls: /mat-mdc-checkbox-checked|mdc-checkbox--selected/,
    selectAll:  /^\s*(全選|全部選取|取消全選|選取所有來源|所有來源|Select all|Deselect all)\s*$/i,
    iconLigature: /^[a-z][a-z0-9_]{2,}$/,
    spinner:    '.loading-spinner, mat-spinner, mat-progress-spinner, [role="progressbar"]',
    dialog:     'mat-dialog-container, .cdk-overlay-pane [role="dialog"], .mat-mdc-dialog-container',
    overlayBackdrop: '.cdk-overlay-backdrop',
    tabText:    { source: /^\s*(來源|Sources?)\s*$/, studio: /^\s*(工作室|Studio)\s*$/ },
    reportText: /報告|Report/,
    /* ── ★ v12.4 「建立報告」彈窗（取代舊的「網誌文章」卡片）── */
    /** 彈窗標題，僅供診斷與紀錄辨識用，不作為流程判斷條件 */
    reportDialogTitle: /(建立報告|Create report)/i,
    /** 送出鈕。完全相符優先——放寬比對一定要搭配 generateDeny 使用 */
    generateStrict: /^\s*(立即生成|Generate now|Generate)\s*$/i,
    generateLoose:  /(立即生成|Generate now)/i,
    /** ⚠ 「稍後生成」只會排進佇列不會產出，誤點等於整批白跑且不會報錯 */
    generateDeny:   /(稍後|Later|取消|Cancel|關閉|Close)/i,
    /** 格式卡，只有 CFG.REPORT_FORMAT 不是 'default' 時才會用到 */
    formatInteractive: /(互動式|Interactive)/i,
    formatDocument:    /(^|[^字])文件|Document/i,
    toggleSrc:  'button[class*="toggle-sou"]',
    dockIcon:   /^dock_to_(right|left)$/,
    gutter:     '.panel-gutter',
    panelHeader:'.panel-header',
    minWidthAttr:'[data-minimum-panel-width]',
  };

  /* ============================================================
   * 2.5 ★ v11.0 匯入流程專用 Selector
   *     文字用「包含」而非「完全相等」比對：Material 按鈕常夾帶 icon ligature，
   *     完全相等會因為 "add新增來源" 這種串接而失配。
   * ========================================================== */
  const IMP = {
    newNotebook: /(建立新的?筆記本|新增筆記本|Create new notebook|New notebook)/i,
    addSource:   /(新增來源|新增資料來源|Add sources?)/i,
    /** 「網站」選項。★ v11.3：實際文字是 "linkvideo_youtube網站"——
     *  icon ligature 直接黏在前面，不可要求前後有空白邊界。
     *  也不可把 連結／Link／URL 寫進來：ligature 裡本來就有 "link"，會誤中。 */
    websiteOpt:  /(網站|Website)/i,
    /** 「插入」按鈕：先找完全相符，找不到才放寬成包含。
     *  絕不可把「新增來源」寫進來——搜尋範圍退到 document 時會誤中背景那顆。 */
    /** 結尾比對而非完全相符：按鈕文字可能帶 icon ligature 前綴 */
    insertStrict: /(插入|Insert)\s*$/i,
    insertLoose:  /(插入|Insert)/i,
    /** 對話框標題，用來確認彈窗真的是「新增來源」那一個 */
    addDialogTitle: /(製作語音和影片摘要|新增來源|Add sources?|上傳來源)/i,
    /** 聊天框旁的「N 個來源」計數，匯入驗證用 */
    sourceCount: /(\d+)\s*個來源|(\d+)\s*sources?\b/i,
    /** 網址輸入框候選 */
    urlInputSel: 'input[type="url"], input[type="text"], textarea',
    urlInputHint: /(貼上|貼上網址|輸入網址|Paste|URL|網址|連結|https?)/i,

    /** ★ v11.2 點「網站」之後才會出現的子面板標題——判斷是否真的到位 */
    websitePanelTitle: /(網站與\s*YouTube\s*網址|Website and YouTube URLs?|網站與\s*YouTube)/i,

    /** ★ v11.2 對話框上方那個「在網路上搜尋新來源」搜尋框的黑名單。
     *  它跟網址框長得很像但完全不同用途，貼進去只會變成網路搜尋。 */
    searchBoxDeny: /(在網路上搜尋|搜尋新來源|探索新來源|Search the web|Discover sources?)/i,
  };

  const STORE_KEY  = 'nblm_auto_state_v1';
  const LAYOUT_KEY = 'nblm_layout_v1';
  const MODE_KEY   = 'nblm_layout_mode_v1';
  const JOB_KEY    = 'nblm_job_v1';        // ★ v11.0 斷點續跑

  /* ============================================================
   * 3. 工具函式
   * ========================================================== */
  let activeVideoTask = null;
  function checkVideoTask() {
    const task = activeVideoTask;
    if (!task) return;
    if (stopFlag) throw new Error(`使用者中止（步驟：${task.stage}）`);
    if (Date.now() >= task.deadline) throw new Error(`單部硬逾時（步驟：${task.stage}，已 ${Math.round((Date.now() - task.startedAt) / 1000)}s）`);
  }
  async function sleep(ms) {
    checkVideoTask();
    const end = Date.now() + ms;
    do {
      await new Promise(r => setTimeout(r, activeVideoTask ? Math.min(100, Math.max(0, end - Date.now())) : Math.max(0, end - Date.now())));
      checkVideoTask();
    } while (Date.now() < end);
  }
  const now = () => Date.now();
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function label(el) {
    return (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title')))
        || el.textContent || '';
  }
  /**
   * ★ v11.4 shadow DOM 探測快取。
   * queryAllDeep 原本每次都要 querySelectorAll('*') 走訪整份 DOM，
   * 只為了看有沒有 shadowRoot——而它在 waitFor 的輪詢裡每 100～200ms 就被呼叫一次。
   * NotebookLM 實際上沒用 shadow DOM，所以探測一次、快取 5 秒，
   * 沒有就走 querySelectorAll 快速路徑。仍保留定期重探，以防日後改版才引入。
   */
  let _shadowProbe = { at: 0, has: false };
  function pageHasShadow() {
    if (_shadowProbe.at && now() - _shadowProbe.at < CFG.SHADOW_PROBE_TTL_MS) return _shadowProbe.has;
    let has = false;
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) { has = true; break; }
    }
    _shadowProbe = { at: now(), has };
    return has;
  }
  function queryAllDeep(sel, root = document) {
    if (!pageHasShadow()) return [...root.querySelectorAll(sel)];
    const out = [...root.querySelectorAll(sel)];
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) out.push(...queryAllDeep(sel, el.shadowRoot));
    }
    return out;
  }
  /** 去掉 Material icon ligature，只給紀錄顯示用；比對一律走原始 label */
  function cleanLabel(el) {
    return (label(el) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[a-z0-9_]+(?=[^\x00-\x7F])/, '')      // "linkvideo_youtube網站" → "網站"
      .replace(/(?<=[^\x00-\x7F])[a-z0-9_]+$/, '')      // "網路keyboard_arrow_down" → "網路"
      .trim();
  }
  async function waitFor(fn, timeoutMs, pollMs = 120) {
    const deadline = now() + timeoutMs;
    for (;;) {
      checkVideoTask();
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      checkVideoTask();
      if (v) return v;
      if (now() > deadline) return null;
      await sleep(pollMs);
    }
  }
  function makeTimer() {
    let last = now();
    const parts = [];
    return {
      mark(name) { const d = now() - last; last = now(); parts.push(`${name}=${d}ms`); return d; },
      toString() { return parts.join('｜'); },
    };
  }
  function fireClick(el, withMouseEvents = false) {
    checkVideoTask();
    if (!el) return false;
    if (withMouseEvents) {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    }
    el.click();
    return true;
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* ── ★ v11.0 待辦工作（可跨頁面重整） ── */
  function loadJob() {
    try {
      const j = JSON.parse(localStorage.getItem(JOB_KEY));
      if (!j || !j.ts) return null;
      if (now() - j.ts > CFG.JOB_TTL_MS) { clearJob(); return null; }
      return j;
    } catch (e) { return null; }
  }
  function saveJob(j) {
    try { localStorage.setItem(JOB_KEY, JSON.stringify({ ...j, ts: now() })); } catch (e) {}
  }
  function clearJob() {
    try { localStorage.removeItem(JOB_KEY); } catch (e) {}
  }

  /* ============================================================
   * 4. UI 面板（開始 / 停止 / 重跑失敗 ＋ 標題列閱讀模式鈕）
   * ========================================================== */
  const UI = (function buildUI() {
    const panel = document.createElement('div');
    panel.id = 'nblm-auto-panel';
    panel.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'width:380px',
      'background:#202124', 'color:#e8eaed', 'border:1px solid #5f6368',
      'border-radius:8px', 'padding:10px', 'z-index:2147483647',
      'font:12px/1.5 system-ui,-apple-system,"Noto Sans TC",sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.5)',
    ].join(';');
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:move;user-select:none;padding-bottom:8px;color:#9aa0a6;';
    const title = document.createElement('span');
    title.style.flex = '1';
    title.textContent = `NotebookLM 自動化 v${VERSION}`;
    title.title = '雙擊＝切換閱讀版面／還原｜Shift+雙擊＝重整頁面';
    const mkBtn = (t, tip) => {
      const b = document.createElement('button');
      b.textContent = t; b.title = tip;
      b.style.cssText = 'width:22px;height:22px;border:1px solid #5f6368;border-radius:4px;background:#2a2a2a;color:#e8eaed;cursor:pointer;font-size:12px;padding:0;';
      return b;
    };
    const btnDiag   = mkBtn('🔧', '診斷：印出腳本看得到的按鈕文字（匯入失敗時用）');
    const btnLayout = mkBtn('📖', '閱讀模式');
    btnLayout.style.width = '26px';
    const btnMin = mkBtn('—', '縮小 / 展開');
    const btnCls = mkBtn('✕', '關閉（右下角圓點可再開啟）');
    bar.append(title, btnDiag, btnLayout, btnMin, btnCls);

    const body = document.createElement('div');

    // ★ v11.0 主要動作：匯入＋生成
    const rowMain = document.createElement('div');
    rowMain.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
    const mkAction = (t, bg) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.style.cssText = `flex:1;padding:6px 8px;border:0;border-radius:5px;background:${bg};color:#fff;cursor:pointer;font-size:12px;`;
      return b;
    };
    const btnImport = mkAction('📥 匯入＋生成', '#1e8e3e');
    btnImport.title = '從剪貼簿讀連結 → 建立筆記本 → 匯入來源 → 逐一生成';
    const btnSettings = mkAction('⚙ 設定網址', '#5f6368');
    btnSettings.title = '設定 Web App 網址（更新後保留）';
    rowMain.append(btnImport, btnSettings);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
    const btnRun   = mkAction('▶ 只生成', '#1a73e8');
    btnRun.title = '來源已經在筆記本裡時使用';
    const btnRetry = mkAction('↻ 重跑失敗', '#f9ab00');
    const btnStop  = mkAction('⏹ 停止',     '#5f6368');
    btnRetry.style.display = 'none';
    row.append(btnRun, btnRetry, btnStop);

    const status = document.createElement('div');
    status.style.cssText = 'margin-bottom:6px;color:#8ab4f8;';
    status.textContent = '待命';
    const logBox = document.createElement('div');
    logBox.title = '雙擊複製全部紀錄';
    logBox.style.cssText = 'max-height:300px;overflow:auto;background:#111;border-radius:5px;padding:6px;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;';
    body.append(rowMain, row, status, logBox);
    panel.append(bar, body);
    document.body.appendChild(panel);

    const dot = document.createElement('div');
    dot.textContent = '▶';
    dot.title = '左鍵：開啟面板｜右鍵：切換版面';
    dot.style.cssText = 'position:fixed;right:16px;bottom:16px;width:36px;height:36px;border-radius:50%;background:#1a73e8;color:#fff;display:none;text-align:center;line-height:36px;cursor:pointer;z-index:2147483647;box-shadow:0 2px 8px rgba(0,0,0,.4);';
    dot.onclick = () => { dot.style.display = 'none'; panel.style.display = ''; };
    document.body.appendChild(dot);

    let folded = false;
    const setFold = v => {
      folded = v;
      body.style.display = folded ? 'none' : '';
      btnMin.textContent = folded ? '□' : '—';
    };
    btnMin.onclick = () => setFold(!folded);
    btnCls.onclick = () => { panel.style.display = 'none'; dot.style.display = 'block'; };
    logBox.addEventListener('dblclick', () => {
      const text = [...logBox.childNodes].map(n => n.textContent).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(() => { status.textContent = '📋 已複製紀錄到剪貼簿'; })
        .catch(() => { status.textContent = '⚠️ 複製失敗，請手動選取'; });
    });
    let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    bar.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      const r = panel.getBoundingClientRect();
      Object.assign(panel.style, { left: r.left + 'px', top: r.top + 'px', right: 'auto', bottom: 'auto' });
      drag = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (ox + e.clientX - sx) + 'px';
      panel.style.top  = (oy + e.clientY - sy) + 'px';
    });
    document.addEventListener('mouseup', () => { drag = false; });

    return {
      panel, dot, bar, btnDiag, btnLayout, btnImport, btnSettings, btnRun, btnRetry, btnStop, setFold,
      /** mode: 'reading' | 'normal'；busy=true 時禁用（生成中或切換中） */
      setLayoutBtn(mode, busy) {
        const reading = (mode === 'reading');
        btnLayout.textContent = reading ? '↩' : '📖';
        btnLayout.title = reading
          ? '還原原始版面（目前：閱讀模式）'
          : '閱讀模式：收合來源＋最大化工作室（Alt+R）';
        btnLayout.style.background  = reading ? '#1a73e8' : '#2a2a2a';
        btnLayout.style.borderColor = reading ? '#1a73e8' : '#5f6368';
        btnLayout.disabled = !!busy;
        btnLayout.style.opacity = busy ? '0.4' : '1';
        btnLayout.style.cursor  = busy ? 'not-allowed' : 'pointer';
      },
      log(msg) {
        const line = document.createElement('div');
        line.textContent = msg;
        logBox.appendChild(line);
        while (logBox.childNodes.length > CFG.MAX_LOG_LINES) logBox.removeChild(logBox.firstChild);
        logBox.scrollTop = logBox.scrollHeight;
        console.log('[NBLM]', msg);
      },
      status(msg) { status.textContent = msg; },
      arm() { panel.style.border = '1px solid #5f6368'; setFold(false); },
      done(ok, fail) {
        if (fail > 0) {
          panel.style.border = '2px solid #ea4335';
          this.status(`⚠️ 完成，但有 ${fail} 部失敗（雙擊下方紀錄可複製）`);
          return;
        }
        this.status(`🎉 全部成功 ${ok} 部`);
        if (CFG.ON_DONE === 'off') return;
        setTimeout(() => {
          if (CFG.ON_DONE === 'close') { panel.style.display = 'none'; dot.style.display = 'block'; }
          else setFold(true);
        }, CFG.DONE_DELAY_MS);
      },
    };
  })();

  /* ============================================================
   * 5. 來源：一律即時查詢（節點會在 Angular 重繪後失效）
   * ========================================================== */
  function liveSources() { return queryAllDeep(SEL.sourceCb).filter(isVisible); }
  function liveMasters() { return queryAllDeep(SEL.masterCb).filter(isVisible); }
  function rawCheckboxes() { return queryAllDeep(SEL.checkbox).filter(isVisible); }
  function isChecked(cb) {
    if (!cb || !cb.isConnected) return false;
    if (SEL.checkedCls.test(cb.className || '')) return true;
    if (cb.getAttribute('aria-checked') === 'true') return true;
    const input = cb.querySelector && cb.querySelector('input[type="checkbox"]');
    if (input && (input.checked || input.getAttribute('aria-checked') === 'true')) return true;
    return false;
  }
  const CLICK_STRATEGIES = [
    ['input', cb => { const i = cb.querySelector('input[type="checkbox"]'); if (i) i.click(); }],
    ['host',  cb => cb.click()],
    ['label', cb => { const l = cb.querySelector('label'); if (l) l.click(); }],
    ['mouse', cb => {
      const t = cb.querySelector('.mdc-checkbox__background, .mdc-checkbox') || cb;
      t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      t.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
      t.click();
    }],
  ];
  async function ensureState(i, want) {
    const get = () => liveSources()[i] || null;
    if (!get()) return { ok: false, strategy: null, tried: 0 };
    if (isChecked(get()) === want) return { ok: true, strategy: null, tried: 0 };
    let tried = 0;
    for (const [name, fn] of CLICK_STRATEGIES) {
      const cb = get();
      if (!cb) break;
      if (isChecked(cb) === want) return { ok: true, strategy: name, tried };
      tried++;
      checkVideoTask();
      try { fn(cb); } catch (e) { /* 換下一招 */ }
      const ok = await waitFor(() => {
        const c = get();
        return c && isChecked(c) === want;
      }, CFG.CLICK_VERIFY_MS, 100);
      if (ok) return { ok: true, strategy: name, tried };
    }
    return { ok: false, strategy: null, tried };
  }
  function plausibleLines(text) {
    return (text || '').split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !SEL.iconLigature.test(s))
      .filter(s => !SEL.selectAll.test(s))
      .filter(s => !/^\d+$/.test(s))
      .filter(s => s.length > 1 && s.length < 200);
  }
  function sourceTitle(cb) {
    if (!cb) return '';
    let el = cb, up = 0;
    while (el && up++ < 5) {
      const al = ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '').trim();
      if (al) {
        if (SEL.selectAll.test(al)) return '';
        const clean = al.replace(/^(選取|取消選取|Select|Deselect)\s*/i, '').replace(/^來源[:：]\s*/, '').trim();
        if (clean && !SEL.iconLigature.test(clean)) return clean;
      }
      el = el.parentElement;
    }
    el = cb; up = 0;
    while (el && up++ < 6) {
      el = el.parentElement;
      if (!el) break;
      const raw = (el.innerText || '').trim();
      if (!raw) continue;
      if (SEL.selectAll.test(raw)) return '';
      const lines = plausibleLines(raw);
      if (lines.length) return lines[0];
    }
    return '';
  }
  function collectSources() {
    const els = liveSources();
    if (els.length) {
      UI.log(`ℹ️ 來源 ${els.length} 個（全選主控 ${liveMasters().length} 個，已排除）`);
      return els.map(el => ({ el, title: sourceTitle(el) || '(無標題)' }));
    }
    UI.log('⚠️ 找不到 .select-checkbox，退回文字啟發式');
    const all = rawCheckboxes(), list = [];
    for (const cb of all) {
      const t = sourceTitle(cb);
      if (t && !SEL.selectAll.test(t)) list.push({ el: cb, title: t });
    }
    return list.length ? list : all.map((el, i) => ({ el, title: `(未知 #${i + 1})` }));
  }
  async function selectOnly(idx, expect) {
    for (const m of liveMasters()) {
      if (isChecked(m)) { fireClick(m.querySelector('input[type="checkbox"]') || m); await sleep(CFG.MASTER_SETTLE_MS); }
    }
    const n = liveSources().length;
    if (n !== expect.count) throw new Error(`來源數量變動：掃描時 ${expect.count} 個，現在 ${n} 個`);
    const used = [];
    for (let i = 0; i < n; i++) {
      const want = (i === idx);
      const r = await ensureState(i, want);
      if (!r.ok) throw new Error(`第 ${i + 1} 格無法設為「${want ? '勾選' : '取消'}」（已試 ${r.tried} 種點擊法）`);
      if (r.strategy) used.push(`${i + 1}:${r.strategy}`);
    }
    await sleep(CFG.SELECT_SETTLE_MS);
    const ok = await waitFor(() => {
      const b = liveSources();
      if (b.length !== expect.count) return false;
      return b.filter(isChecked).length === 1 && isChecked(b[idx]);
    }, CFG.SELECT_VERIFY_MS, 150);
    if (!ok) {
      const b = liveSources();
      const c = b.map((x, i) => (isChecked(x) ? i + 1 : 0)).filter(Boolean);
      throw new Error(`勾選驗證失敗：期望只勾 #${idx + 1}，實際勾了 ${c.length} 個 [${c.join(',')}]`);
    }
    const t = sourceTitle(liveSources()[idx]);
    if (expect.title && t && expect.title !== '(無標題)' && t !== expect.title) {
      throw new Error(`順序位移：#${idx + 1} 期望「${expect.title.slice(0, 20)}」實際「${t.slice(0, 20)}」`);
    }
    return used.length ? `策略[${used.join(' ')}]` : '策略[免點]';
  }

  /* ============================================================
   * 6. 自動診斷（失敗時自動印出，不設按鈕）
   * ========================================================== */
  let deepDumped = false;
  function snapshot() {
    return [
      `viewport=${window.innerWidth}`,
      `checkbox=${rawCheckboxes().length}`,
      `source=${liveSources().length}`,
      `master=${liveMasters().length}`,
      `checked=[${liveSources().map((c, i) => (isChecked(c) ? i + 1 : 0)).filter(Boolean).join(',')}]`,
      `dialog=${getDialog() ? '有' : '無'}`,
      `reportBtn=${findReportBtn() ? '有' : '無'}`,
      `spinner=${queryAllDeep(SEL.spinner).filter(isVisible).length}`,
      `gutter=[${liveGutters().map(gutterX).join(',')}]`,
      `srcCollapsed=${sourcePanelCollapsed()}`,
      `mode=${readMode()}`,
      `sourceCount=${readSourceCount()}`,
    ].join('｜');
  }
  function deepDump() {
    if (deepDumped) return;
    deepDumped = true;
    UI.log('🧪 首次失敗，附上 DOM 結構：');
    rawCheckboxes().slice(0, 3).forEach((cb, i) => {
      const gp = cb.parentElement && cb.parentElement.parentElement;
      UI.log(`  cb[${i}] class="${(cb.className || '').toString().slice(0, 80)}"`);
      UI.log(`        connected=${cb.isConnected} checked=${isChecked(cb)} input=${cb.querySelector('input[type="checkbox"]') ? '有' : '無'}`);
      UI.log(`        text=${JSON.stringify(((gp && gp.innerText) || '').slice(0, 80))} → 標題="${sourceTitle(cb)}"`);
    });
  }

  /* ============================================================
   * 7. 頁面操作
   * ========================================================== */
  function getTabBtn(kind) {
    const re = SEL.tabText[kind];
    return queryAllDeep('button,[role="tab"],.mdc-tab').find(el => isVisible(el) && re.test(label(el).trim())) || null;
  }
  function getDialog() {
    return queryAllDeep(SEL.dialog).find(isVisible) || null;
  }
  function findReportBtn() {
    return queryAllDeep('button,[role="button"]').find(el =>
      isVisible(el) && SEL.reportText.test(label(el)) && !getDialog()
    ) || null;
  }
  /**
   * ★ v12.4 「建立報告」彈窗右下的送出鈕。
   *
   * 兩道防線，缺一不可：
   *   1. 先用 generateDeny 把「稍後生成／取消」整個濾掉。誤點「稍後生成」
   *      不會報錯、彈窗也會關，但報告不會產出——這種失敗最難事後發現。
   *   2. 完全相符優先，找不到才放寬成包含比對（Material 按鈕常黏 icon ligature，
   *      所以用 cleanLabel 而不是 label）。
   * 同名多顆時取最靠右下的那顆，與 findInsertBtn 同一套規則。
   */
  function findGenerateBtn(scope) {
    const dlg = scope || getDialog();
    const scopes = dlg ? [dlg, document] : [document];

    for (const root of scopes) {
      const all = queryAllDeep('button,[role="button"],[type="submit"]', root)
        .filter(isVisible)
        .filter(el => !SEL.generateDeny.test(cleanLabel(el)));

      let hit = all.filter(el => SEL.generateStrict.test(cleanLabel(el)));
      if (!hit.length) hit = all.filter(el => SEL.generateLoose.test(cleanLabel(el)));
      if (!hit.length) continue;

      return hit.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.bottom + rb.right) - (ra.bottom + ra.right);
      })[0];
    }
    return null;
  }

  /**
   * ★ v12.4 指定報告格式。CFG.REPORT_FORMAT 為 'default' 時不會被呼叫。
   * 找不到格式卡不算失敗——彈窗本來就有預設值，照樣可以送出。
   */
  async function chooseReportFormat(dlg) {
    const re = CFG.REPORT_FORMAT === 'document' ? SEL.formatDocument : SEL.formatInteractive;
    const card = findClickableByText(re, dlg || getDialog() || document);
    if (!card) { UI.log(`   ⓘ 找不到「${CFG.REPORT_FORMAT}」格式卡，沿用彈窗預設值`); return false; }
    fireClick(card, true);
    await sleep(CFG.SUBMIT_SETTLE_MS);
    return true;
  }

  /**
   * ★ v11.4 工作室面板的內容指紋，用來確認報告真的送出去了。
   * 送出後工作室會多一張生成中的卡片，面板文字長度隨之改變。
   * 取最右邊那個 panel-header 的父層當作工作室面板；取不到就回 -1，
   * 呼叫端會退回原本的固定等待，不會因此失敗。
   */
  function studioSignature() {
    const hs = liveHeaders();
    const hd = hs.length ? hs[hs.length - 1] : null;
    const panel = hd && hd.parentElement;
    if (!panel) return -1;
    return (panel.innerText || '').length;
  }

  /* ── ★ v12.1 主執行緒閒置偵測 ──
   *
   * 這是目前唯一有機制支撐的假設，證據來自 v12.0 那輪的反向相關：
   *   #1 勾選 2941ms → 彈窗 31ms
   *   #2 勾選 2980ms → 彈窗 13ms
   *   #3 勾選  386ms → 彈窗 4 次共 4.6s   ← 唯一勾選快的，也是唯一彈窗難開的
   *   #4 勾選 2995ms → 彈窗 14ms
   * 勾選慢的時候，那 3 秒等於免費幫我們把頁面等閒了；勾選快的時候，
   * 我們趁頁面還在忙就去點，click 事件就掉了。
   * 這也回頭解釋了 v11.3→v11.4 的退化：砍掉 SELECT_SETTLE_MS 之後彈窗更難開。
   *
   * 所以不要再等固定時間，改成量事件迴圈的延遲，等它真的空下來再動手。
   */

  /** 排一個 setTimeout(0)，看它實際多久才被執行。塞車時這個值會飆高 */
  function eventLoopLag() {
    return new Promise(resolve => {
      const t0 = performance.now();
      setTimeout(() => resolve(Math.round(performance.now() - t0)), 0);
    });
  }

  /**
   * 等主執行緒空下來。連續 IDLE_STREAK 次量到低延遲才算數。
   * 等不到就照樣回傳並往下走——寧可點了沒中再重試，也不要多一個死等點。
   */
  async function waitMainThreadIdle(maxMs) {
    const t0 = now();
    let streak = 0, lag = -1;

    while (now() - t0 < maxMs) {
      lag = await eventLoopLag();
      if (lag <= CFG.IDLE_LAG_MS) {
        if (++streak >= CFG.IDLE_STREAK) {
          return { idle: true, waited: now() - t0, lag };
        }
      } else {
        streak = 0;
      }
      await sleep(CFG.IDLE_POLL_MS);
    }
    return { idle: false, waited: now() - t0, lag };
  }

  function tabReady(kind) {
    return kind === 'source' ? liveSources().length > 0 : !!findReportBtn();
  }
  async function gotoTab(kind) {
    if (tabReady(kind)) return 0;
    const btn = getTabBtn(kind);
    if (btn) fireClick(btn);
    const ok = await waitFor(() => tabReady(kind), CFG.TAB_VERIFY_MS, CFG.TAB_POLL_MS);
    if (!ok) throw new Error(`切換至「${kind}」逾時`);
    return 0;
  }
  async function closeModals() {
    let guard = 0;
    while (getDialog() && guard++ < 5) {
      checkVideoTask();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(200);
    }
    /* ★ v12.4 Escape 沒收下時改點彈窗自己的 ✕。
     * 實測失敗紀錄裡出現過 dialog=有＋spinner=1 卡住，之後每一部都連鎖失敗
     * ——因為 findReportBtn 有「畫面上不能有彈窗」這個前提。
     * ⚠ 只點明確的關閉鈕：「稍後生成」按下去會把報告排進佇列，不是關閉。 */
    const dlg = getDialog();
    if (dlg) {
      const x = queryAllDeep('button,[role="button"]', dlg)
        .filter(isVisible)
        .find(el => /^(關閉|Close|取消|Cancel|✕|×)$/i.test(cleanLabel(el)));
      if (x) { fireClick(x, true); await sleep(200); }
    }
    const bd = queryAllDeep(SEL.overlayBackdrop).find(isVisible);
    if (bd) { fireClick(bd); await sleep(150); }
  }
  async function waitSourcesReady() {
    const t0 = now();
    let stable = 0, lastCount = -1;
    for (;;) {
      const spinning = queryAllDeep(SEL.spinner).filter(isVisible).length;
      const count = rawCheckboxes().length;
      const elapsed = now() - t0;
      if (count > lastCount) stable = 0; else if (!spinning) stable++;
      lastCount = count;
      UI.status(`⏳ 等待來源｜checkbox=${count}｜轉圈=${spinning}｜穩定=${stable}/${CFG.SOURCE_STABLE_ROUNDS}`);
      if (elapsed >= CFG.SOURCE_MIN_WAIT_MS && !spinning && count > 0 && stable >= CFG.SOURCE_STABLE_ROUNDS) {
        UI.log(`✅ 來源已穩定（等待 ${Math.round(elapsed / 1000)}s）`);
        return;
      }
      if (elapsed > CFG.SOURCE_WAIT_MAX_MS) {
        UI.log('⚠️ 來源等待逾時，以現況繼續');
        return;
      }
      await sleep(CFG.SOURCE_POLL_MS);
    }
  }

  /* ============================================================
   * 8. 閱讀模式：收合來源 + 最大化工作室（可逆、獨立記帳）
   *    2026-08-01 實測校準：
   *      收合鈕 button[class*="toggle-sou"]，aria-label 狀態中立 → 只能驗結果
   *      分隔線 div.panel-gutter，getEventListeners 顯示【只掛 mousedown】
   *        → pointer 事件完全無效（純 pointer 組軌跡 20 點全不動）
   *      夾制公式：最終 x = 左鄰面板 left + data-minimum-panel-width(285)
   *        展開來源時 262+285=547；收合後 64+285=349，兩次實測皆吻合
   *      viewport < 約 1060 時三欄變單欄，.panel-gutter 整批不存在
   *      ⚠ DevTools 靠右停靠會吃掉頁面寬度並跨過斷點，驗證時請停靠下方
   * ========================================================== */
  let layoutBusy = false;
  function readMode() {
    try { return localStorage.getItem(MODE_KEY) === 'reading' ? 'reading' : 'normal'; }
    catch (e) { return 'normal'; }
  }
  function writeMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
    UI.setLayoutBtn(m, layoutBusy || running);
  }
  /** 紀錄可能被原生 UI 繞過，DOM 實況為最終裁判 */
  function currentMode() {
    const saved = readMode();
    const domCollapsed = sourcePanelCollapsed();
    if (saved === 'reading' && !domCollapsed) {
      UI.log('   ⓘ 紀錄為閱讀模式但來源面板已展開（原生 UI 繞過），以實況為準');
      return 'normal';
    }
    if (saved === 'normal' && domCollapsed) {
      UI.log('   ⓘ 來源面板已被手動收合，視為閱讀模式');
      return 'reading';
    }
    return saved;
  }
  function liveGutters() {
    return queryAllDeep(SEL.gutter).filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }
  function rightGutter() {
    const gs = liveGutters();
    return gs.length ? gs[gs.length - 1] : null;
  }
  function gutterX(g) { return g ? Math.round(g.getBoundingClientRect().left) : -1; }
  function liveHeaders() {
    return queryAllDeep(SEL.panelHeader).filter(isVisible)
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }
  /** 預測夾制點：對話面板左緣 + 最小寬。有預測值就能做精確斷言，不必靠位移量猜 */
  function predictClamp() {
    const hs = liveHeaders();
    if (hs.length < 2) return null;
    const chat = hs[hs.length - 2];
    const host = queryAllDeep(SEL.minWidthAttr)[0];
    const raw  = host ? parseInt(host.getAttribute('data-minimum-panel-width'), 10) : NaN;
    const minW = Number.isFinite(raw) ? raw : CFG.MIN_PANEL_W;
    return Math.round(chat.getBoundingClientRect().left + minW);
  }
  function findToggleSrcBtn() {
    const byClass = queryAllDeep(SEL.toggleSrc).filter(isVisible);
    if (byClass.length) return byClass[0];
    const byIcon = queryAllDeep('button').filter(isVisible)
      .filter(b => SEL.dockIcon.test((b.innerText || '').trim()))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return byIcon[0] || null;
  }
  /** 收合狀態看 header 寬度：來源匯入中 checkbox 也是 0，用數量判斷會反向誤觸 */
  function sourcePanelCollapsed() {
    const btn = findToggleSrcBtn();
    if (!btn) return false;
    const hd = (btn.closest && btn.closest(SEL.panelHeader)) || btn;
    return hd.getBoundingClientRect().width < 120;
  }
  async function toggleSourcePanel(wantCollapsed) {
    if (sourcePanelCollapsed() === wantCollapsed) return true;
    const btn = findToggleSrcBtn();
    if (!btn) { UI.log('   ⚠️ 找不到來源面板收合鈕'); return false; }
    fireClick(btn);
    const ok = await waitFor(() => sourcePanelCollapsed() === wantCollapsed, CFG.COLLAPSE_VERIFY_MS, 120);
    await sleep(CFG.LAYOUT_SETTLE_MS);
    const hd = (btn.closest && btn.closest(SEL.panelHeader)) || btn;
    UI.log(`   ${ok ? '✅' : '⚠️'} 來源面板${wantCollapsed ? '收合' : '展開'}${ok ? '完成' : '未生效'}（header ${Math.round(hd.getBoundingClientRect().width)}px）`);
    return ok;
  }
  async function ensureSourcePanelOpen() {
    if (!sourcePanelCollapsed()) return true;
    UI.log('↔ 來源面板為收合狀態，先展開');
    return toggleSourcePanel(false);
  }
  /** 純 mouse 事件拖曳。gutter 只掛 mousedown，pointer 一律不送 */
  async function dragGutterTo(gutter, targetX, steps, stepMs) {
    const r  = gutter.getBoundingClientRect();
    const y  = Math.round(r.top + r.height / 2);
    const x0 = Math.round(r.left + r.width / 2);
    const fire = (type, x, buttons) => gutter.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: REAL_WINDOW,
      clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons,
    }));
    fire('mousemove', x0, 0);
    fire('mousedown', x0, 1);
    await sleep(40);
    for (let i = 1; i <= steps; i++) {
      fire('mousemove', Math.round(x0 + (targetX - x0) * (i / steps)), 1);
      await sleep(stepMs);
    }
    fire('mousemove', targetX, 1);
    await sleep(40);
    fire('mouseup', targetX, 0);
    await sleep(CFG.LAYOUT_SETTLE_MS);
    return gutterX(gutter);
  }
  /** 無條件記帳 before → after，失敗時才有證據可查 */
  async function dragWithRetry(g, targetX, tag) {
    const before = gutterX(g);
    let after = await dragGutterTo(g, targetX, CFG.DRAG_STEPS, CFG.DRAG_STEP_MS);
    if (after === before && Math.abs(before - targetX) > 40) {
      UI.log(`   ↻ ${tag}首次無位移，慢速重試`);
      after = await dragGutterTo(g, targetX, CFG.DRAG_STEPS * 2, CFG.DRAG_STEP_MS * 3);
    }
    UI.log(`   ▸ ${tag}拖曳 x ${before} → ${after}（目標 ${targetX}）`);
    return { before, after };
  }
  function noGutterHint() {
    UI.log(`   ⚠️ 找不到分隔線｜viewport=${window.innerWidth}px（實測需 ≥ 約 ${CFG.VIEWPORT_MIN}px 才是三欄版面；DevTools 靠右停靠會吃掉寬度）`);
  }
  async function applyReadingLayout() {
    UI.log('📖 套用閱讀版面…');
    // 原始分隔線位置必須在收合前記錄：收合後 x 已被 clamp 公式汙染
    const g0 = rightGutter();
    if (g0) {
      const x0 = gutterX(g0);
      try { localStorage.setItem(LAYOUT_KEY, String(x0)); } catch (e) {}
      UI.log(`   ⓘ 已記住原始分隔線 x=${x0}`);
    }
    // 收合永遠先做且無條件做：窄視窗沒有 gutter，但收合本身就有價值
    const collapsed = await toggleSourcePanel(true);
    writeMode('reading');   // 提前記帳 → 任何中途失敗都還能用同一顆鈕退回
    const g = rightGutter();
    if (!g) {
      noGutterHint();
      UI.status(collapsed ? '📖 閱讀模式（僅收合，無分隔線）' : '📖 版面：未生效');
      return;
    }
    const clamp = predictClamp();
    if (clamp !== null) UI.log(`   ⓘ 預測夾制點 x≈${clamp}`);
    const { before, after } = await dragWithRetry(g, 0, '');
    const ok = (clamp !== null) ? (after <= clamp + 20) : (after < before - 30);
    if (ok) {
      UI.log(`   ✅ 工作室已最大化（寬約 ${window.innerWidth - after - 16}px）`);
      UI.status('📖 閱讀模式（再按 📖 或雙擊標題列還原）');
    } else {
      UI.log(`   ⚠️ 拖曳未達預期（停在 ${after}${clamp !== null ? `，應 ≤ ${clamp + 20}` : ''}）`);
      UI.status('📖 版面：拖曳失敗（已收合來源）');
    }
  }
  async function restoreLayout() {
    UI.log('↩️ 還原原始版面…');
    await toggleSourcePanel(false);
    writeMode('normal');
    const g = rightGutter();
    if (!g) { noGutterHint(); UI.status('↩️ 僅完成展開'); return; }
    let target = parseInt(localStorage.getItem(LAYOUT_KEY), 10);
    if (!Number.isFinite(target)) {
      target = Math.round(window.innerWidth * CFG.RESTORE_RATIO);
      UI.log(`   ⓘ 無原始位置紀錄，退回視窗寬 ${Math.round(CFG.RESTORE_RATIO * 100)}%`);
    }
    target = Math.max(0, Math.min(target, window.innerWidth - 1));
    const { after } = await dragWithRetry(g, target, '還原');
    if (Math.abs(after - target) > 40) {
      UI.log('   ⚠️ 還原不精確｜Shift+雙擊標題列可強制重整');
      UI.status('↩️ 還原不精確');
    } else {
      UI.status('↩️ 已還原原始版面');
    }
  }
  async function toggleLayout() {
    if (running)    { UI.log('⚠️ 生成進行中，暫不調整版面'); return; }
    if (importing)  { UI.log('⚠️ 匯入進行中，暫不調整版面'); return; }
    if (layoutBusy) { UI.log('⚠️ 版面切換進行中，忽略重複觸發'); return; }
    layoutBusy = true;
    const from = currentMode();
    UI.setLayoutBtn(from, true);
    try {
      return from === 'reading' ? await restoreLayout() : await applyReadingLayout();
    } finally {
      layoutBusy = false;
      UI.setLayoutBtn(readMode(), false);
    }
  }

  /* ============================================================
   * 8.5 ★ v11.0 來源匯入
   *      建立筆記本 → 新增來源 → 網站 → 貼上 → 插入 → 等待處理完成
   * ========================================================== */
  let importing = false;

  /* ── 通用：依可見文字找可點元素 ── */
  function findClickableByText(re, scope) {
    const root = scope || document;
    const cands = queryAllDeep('button,[role="button"],[role="menuitem"],[role="option"],a,mat-card,.mat-mdc-card', root)
      .filter(isVisible)
      .filter(el => re.test(label(el)));
    if (!cands.length) return null;

    // 外層容器往往含有相同文字，但 handler 掛在內層。
    // 先只留「不包含其他候選」的葉節點，再取文字最短的那個。
    const leaf = cands.filter(el => !cands.some(o => o !== el && el.contains(o)));
    const pool = leaf.length ? leaf : cands;
    return pool.sort((a, b) =>
      (label(a) || '').trim().length - (label(b) || '').trim().length
    )[0];
  }

  /** 讀「N 個來源」計數；讀不到回 -1 */
  function readSourceCount() {
    const txt = (document.body && document.body.innerText) || '';
    const m = txt.match(IMP.sourceCount);
    if (!m) return -1;
    return parseInt(m[1] || m[2], 10);
  }

  function isNotebookPage() {
    return /\/notebook\//.test(location.pathname);
  }

  /* ── ★ v11.4 重複匯入防呆 ──
   * 每個筆記本各記一份已匯入的 videoId。同一個筆記本按兩次匯入時，
   * 重複的連結會被擋掉而不是變成第二份來源。
   * 記在 localStorage，以筆記本 id 分開，不會互相污染。 */
  function notebookId() {
    const m = location.pathname.match(/\/notebook\/([^/?#]+)/);
    return m ? m[1] : '';
  }
  function importedKey() { return 'nblm_imported_' + (notebookId() || 'unknown'); }
  function loadImported() {
    try { return JSON.parse(localStorage.getItem(importedKey())) || []; } catch (e) { return []; }
  }
  function addImported(ids) {
    try {
      localStorage.setItem(importedKey(), JSON.stringify([...new Set([...loadImported(), ...ids])]));
    } catch (e) {}
  }
  function videoIdOf(url) {
    const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?&]+)/) ||
              url.match(/shorts\/([^?&]+)/) || url.match(/live\/([^?&]+)/);
    return m ? m[1] : url;
  }
  /** 濾掉這個筆記本已經匯過的連結 */
  function dedupeAgainstNotebook(urls) {
    const seen = new Set(loadImported());
    if (!seen.size) return urls;

    const fresh = urls.filter(u => !seen.has(videoIdOf(u)));
    const skipped = urls.length - fresh.length;
    if (skipped > 0) {
      UI.log(`   ⚠️ 略過 ${skipped} 個這個筆記本已匯入過的連結`);
    }
    return fresh;
  }

  /* ── 剪貼簿 ── */

  /** 只認影片頁，不認頻道頁或播放清單 */
  const YT_URL = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i;

  /**
   * ★ v11.3 加了一道閘。
   * 實測時剪貼簿裡殘留的是腳本原始碼，被抓出 @namespace 與 @match 三條「網址」，
   * 差點就把 github.com 和帶萬用字元的樣式匯進筆記本。
   * 雜訊進了來源就會污染 RAG 查詢，寧可擋掉也不要放行。
   */
  function parseUrls(text, quiet) {
    const raw = (text || '')
      .split(/[\s\n\r]+/)
      .map(s => s.trim().replace(/[)\]，。、]+$/, ''))
      .filter(s => /^https?:\/\/\S+$/i.test(s))
      .filter(s => !/[*<>]/.test(s));            // @match 那種萬用字元樣式

    const uniq = [...new Set(raw)];
    if (!CFG.ONLY_YOUTUBE) return uniq;

    const yt = uniq.filter(u => YT_URL.test(u));
    const dropped = uniq.length - yt.length;
    if (dropped > 0 && !quiet) {
      UI.log(`   ⚠️ 已略過 ${dropped} 個非 YouTube 影片連結（ONLY_YOUTUBE 開啟中）`);
      uniq.filter(u => !YT_URL.test(u)).slice(0, 3)
        .forEach(u => UI.log(`      ✗ ${u.slice(0, 60)}`));
    }
    return yt;
  }

  /* ── ★ v12.0 直接跟 Apps Script Web App 要連結 ──
   * 用 GM_xmlhttpRequest 而不是 fetch：它是特權請求，不受同源政策限制，
   * Apps Script 的 /exec 網址又會轉址到 script.googleusercontent.com，
   * 兩個網域都要寫進 @connect。 */
  function fetchLinksFromWebApp() {
    return new Promise(resolve => {
      const url = (CFG.WEBAPP_URL || '').trim();
      if (!url) return resolve(null);
      if (!GM_HAS_XHR) {
        UI.log('⚠️ 沒有 GM_xmlhttpRequest 權限，略過 Web App（檢查腳本標頭的 @grant）');
        return resolve(null);
      }

      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };

      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          timeout: CFG.WEBAPP_TIMEOUT_MS,
          onload: res => {
            if (res.status !== 200) {
              UI.log(`⚠️ Web App 回應 HTTP ${res.status}`);
              return finish(null);
            }
            let data;
            try { data = JSON.parse(res.responseText); }
            catch (e) {
              // 常見情況：金鑰錯誤時 Google 回登入頁而不是 JSON
              UI.log('⚠️ Web App 回傳的不是 JSON（多半是金鑰錯誤或未部署成「任何人」可存取）');
              return finish(null);
            }
            if (!data.ok) {
              UI.log(`⚠️ Web App 回報錯誤：${data.error}${data.message ? '｜' + data.message : ''}`);
              return finish(null);
            }
            const urls = parseUrls((data.links || []).join('\n'));
            UI.log(`🔗 Web App 取得 ${urls.length} 個 YouTube 連結` +
                   (data.updatedAt ? `（主表上次更新 ${data.updatedAt}）` : ''));
            // ★ v12.5 batchId／doneAt 是 Web App v1.1 才有的欄位，舊版端點回空字串＝不啟用跨電腦閘
            finish({ urls, updatedAt: data.updatedAt || '',
                     batchId: data.batchId || '', doneAt: data.doneAt || '' });
          },
          onerror: () => { UI.log('⚠️ Web App 連線失敗'); finish(null); },
          ontimeout: () => { UI.log('⚠️ Web App 逾時'); finish(null); },
        });
      } catch (e) {
        UI.log(`⚠️ Web App 請求例外：${e.message}`);
        finish(null);
      }
    });
  }

  /* ── ★ v12.5 跑完回報 Web App「這批已執行」──
   * GM 儲存只在這一台瀏覽器，家裡跑完到公司開分頁還是會再跑一次。
   * 匯入成功後打 &done=<batchId>，Web App 記在指令碼屬性，
   * 之後任何一台來要連結都會拿到 doneAt，自動執行就停手。
   * 失敗只記警告：最壞情況是退回 v12.4 的單機去重，不影響本次流程。 */
  function reportDoneToWebApp(batchId) {
    return new Promise(resolve => {
      const url = (CFG.WEBAPP_URL || '').trim();
      if (!url || !batchId || !GM_HAS_XHR) return resolve(false);

      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        UI.log(ok ? '☁️ 已回報 Apps Script：這批已執行（其他電腦不會再自動跑）'
                  : '⚠️ 回報 Apps Script 失敗，其他電腦開分頁仍可能再跑一次');
        resolve(ok);
      };

      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url + (url.includes('?') ? '&' : '?') + 'done=' + encodeURIComponent(batchId),
          timeout: CFG.WEBAPP_TIMEOUT_MS,
          onload: res => {
            let data = null;
            try { data = JSON.parse(res.responseText); } catch (e) {}
            finish(res.status === 200 && !!(data && data.ok && data.recorded));
          },
          onerror: () => finish(false),
          ontimeout: () => finish(false),
        });
      } catch (e) {
        finish(false);
      }
    });
  }

  /** 取得連結：先問 Web App，失敗才退回剪貼簿
   *  ★ v12.5 回傳 { urls, batchId, doneAt }；剪貼簿來源沒有 batchId，也就不回報 */
  async function obtainUrls() {
    const fromApp = await fetchLinksFromWebApp();
    if (fromApp && fromApp.urls.length) return fromApp;
    if (CFG.WEBAPP_URL) UI.log('   ⓘ Web App 沒給到連結，改讀剪貼簿');
    return { urls: await readClipboardUrls(), batchId: '', doneAt: '' };
  }

  async function readClipboardUrls() {
    try {
      const txt = await navigator.clipboard.readText();
      const urls = parseUrls(txt);
      if (urls.length) {
        UI.log(`📋 剪貼簿讀到 ${urls.length} 個 YouTube 連結`);
        return urls;
      }
      if ((txt || '').trim()) {
        UI.log(`⚠️ 剪貼簿有內容（${(txt || '').length} 字）但沒有 YouTube 影片連結`);
        UI.log('   ⓘ 請先回 Google Sheet 執行「📋 複製連結」，再回來按匯入');
      } else {
        UI.log('⚠️ 剪貼簿是空的');
      }
    } catch (e) {
      UI.log(`⚠️ 無法讀取剪貼簿：${e.message}`);
      UI.log('   （Chrome 會在首次讀取時詢問權限，按「允許」之後就不會再問）');
    }
    return [];
  }

  /* ── 步驟 1：確保身處一個可用的新筆記本 ── */

  /**
   * ★ v12.3 從任何地方開一個全新的筆記本。
   * 標題列的「建立新筆記本」在筆記本內頁也在，所以不必先回首頁；
   * 以「筆記本 id 有沒有換掉」當作成功判準，比看畫面可靠。
   */
  async function createNewNotebook() {
    const before = notebookId();
    const btn = findClickableByText(IMP.newNotebook);
    if (!btn) { UI.log('   ⚠️ 找不到「建立新筆記本」按鈕'); return false; }

    UI.log(`▸ 點擊「${cleanLabel(btn).slice(0, 12) || '建立新筆記本'}」`);
    fireClick(btn, true);

    const ok = await waitFor(() => {
      if (!isNotebookPage()) return false;
      if (notebookId() === before) return false;      // id 沒換＝還在原本那個
      return !!findClickableByText(IMP.addSource);
    }, CFG.NOTEBOOK_READY_MS, 400);

    if (!ok) { UI.log('   ⚠️ 新筆記本沒有在預期時間內出現'); return false; }
    await sleep(CFG.IMPORT_SETTLE_MS);
    UI.log('   ✅ 已建立新筆記本');
    return true;
  }

  /**
   * 後備手段：導回首頁重來。
   * 會離開目前頁面，所以待辦工作要先存好並標記 selfReload，
   * 重新注入後由 resumeJob 接手（沒標記的話續跑閘會擋下來，那是刻意的）。
   */
  async function goHomeAndRestart_(allowReload) {
    if (!allowReload) throw new Error('無法建立新筆記本，且此處不允許導頁');

    const job = loadJob() || {};
    const n = (job.reloads || 0) + 1;
    if (n > CFG.MAX_RELOADS) throw new Error(`已嘗試 ${CFG.MAX_RELOADS} 次仍無法取得可用的筆記本`);

    UI.log(`   ↩️ 改用回首頁的方式重來（第 ${n} 次）`);
    saveJob({ ...job, phase: 'ensure-notebook', reloads: n, selfReload: true });
    await sleep(400);
    location.href = location.origin + '/';
    await sleep(30000);            // 導頁中，這行不會真的跑完
    return false;
  }

  async function ensureNotebookReady(allowReload) {
    /* ★ v12.3 已經在某個筆記本裡的時候，要先分清楚它是不是空的。
     * 舊版無條件沿用當前筆記本 → 等於把今天的來源倒進你正在讀的舊筆記本。
     * 那不是卡住，是污染，而且事後很難看出是哪一批混進去的。
     * 只有明確讀到「0 個來源」才沿用；讀不到數字時一律視為有內容，另外建一個。 */
    if (isNotebookPage()) {
      const cnt = readSourceCount();

      if (cnt === 0 && findClickableByText(IMP.addSource)) {
        UI.log('✅ 已在空白筆記本，直接沿用');
        return true;
      }

      UI.log(cnt > 0
        ? `ⓘ 目前這個筆記本已有 ${cnt} 個來源，另外建一個，不動它`
        : 'ⓘ 讀不到來源數量，保險起見另外建一個筆記本');

      if (await createNewNotebook()) return true;
      return await goHomeAndRestart_(allowReload);
    }

    const createBtn = findClickableByText(IMP.newNotebook);
    if (createBtn) {
      UI.log('▸ 點擊「建立新的筆記本」');
      fireClick(createBtn, true);
    } else if (!isNotebookPage()) {
      throw new Error('找不到「建立新的筆記本」按鈕（請按 🔧 診斷看實際文字）');
    }

    const ready = await waitFor(
      () => isNotebookPage() && findClickableByText(IMP.addSource),
      CFG.NOTEBOOK_READY_MS, 400
    );
    if (ready) {
      UI.log('✅ 筆記本已就緒');
      return true;
    }

    // 卡 loading：重整一次再續跑（狀態已存在 localStorage）
    if (allowReload) {
      const job = loadJob() || {};
      const n = (job.reloads || 0) + 1;
      if (n <= CFG.MAX_RELOADS) {
        UI.log(`⏳ 筆記本卡在載入中，執行第 ${n} 次自動重整…`);
        // selfReload 是續跑的唯一憑據：只有腳本自己發動的重整才准自動接手
        saveJob({ ...job, phase: 'ensure-notebook', reloads: n, selfReload: true });
        await sleep(400);
        location.reload();
        await sleep(30000);          // 重整中，這裡不會真的跑完
        return false;
      }
      UI.log(`❌ 已自動重整 ${CFG.MAX_RELOADS} 次仍未就緒，停止`);
    }
    throw new Error('筆記本一直停在載入中');
  }

  /* ── 步驟 2：開啟「新增來源」對話框 ── */
  async function openAddSourceDialog() {
    if (getDialog() && IMP.addDialogTitle.test(getDialog().innerText || '')) {
      UI.log('   ⓘ 對話框已開啟');
      return getDialog();
    }
    const btn = findClickableByText(IMP.addSource);
    if (!btn) throw new Error('找不到「新增來源」按鈕');
    UI.log('▸ 點擊「新增來源」');
    fireClick(btn, true);

    const dlg = await waitFor(getDialog, CFG.ADD_DIALOG_WAIT_MS, 150);
    if (!dlg) throw new Error('「新增來源」對話框未開啟');
    await sleep(CFG.IMPORT_SETTLE_MS);
    return getDialog();
  }

  /* ── 步驟 3：選「網站」 ──
   *
   * ★ v11.2 這一步是 11.1 出錯的地方，記下來免得再犯：
   *   對話框上方有一個「在網路上搜尋新來源」搜尋框（帶 網路／Fast Research 兩顆 chip），
   *   下方按鈕列的「網站」才會開出真正的「網站與 YouTube 網址」面板。
   *   兩者都是可見輸入框，v11.1 用「找得到輸入框就當作已到位」判斷，
   *   於是跳過點擊「網站」，把連結貼進了搜尋框——那裡沒有「插入」，只有搜尋箭頭。
   *   修法：改用「面板標題」判斷是否到位，並把搜尋框列入黑名單。
   */

  /** 是否已經進入「網站與 YouTube 網址」面板 */
  function websitePanelShown() {
    const dlg = getDialog();
    if (!dlg) return false;                       // 沒有對話框就談不上到位
    if (IMP.websitePanelTitle.test(dlg.innerText || '')) return true;
    // 標題文案若有變動，對話框內存在「插入」鈕也足以證明已在網址面板
    return !!findInsertBtn();
  }

  async function chooseWebsiteOption() {
    if (websitePanelShown()) {
      UI.log('   ⓘ 已在「網站與 YouTube 網址」面板');
      return true;
    }

    const scope = getDialog() || document;
    const opt = findClickableByText(IMP.websiteOpt, scope);
    if (!opt) {
      dumpDialogButtons('找不到「網站」選項');
      throw new Error('找不到「網站」選項');
    }

    UI.log(`▸ 點擊「${cleanLabel(opt).slice(0, 12) || '網站'}」`);
    fireClick(opt, true);

    const ok = await waitFor(websitePanelShown, CFG.WEBSITE_OPT_WAIT_MS, 200);
    if (!ok) {
      dumpDialogButtons('點了「網站」但沒進入網址面板');
      throw new Error('點了「網站」後沒有進入網址輸入面板');
    }
    await sleep(CFG.IMPORT_SETTLE_MS);

    const input = await waitFor(() => findUrlInput(), CFG.URL_INPUT_WAIT_MS, 150);
    if (!input) {
      dumpDialogButtons('已進入網址面板但找不到輸入框');
      throw new Error('網址面板已開啟但找不到輸入框');
    }
    UI.log('   ✅ 已進入「網站與 YouTube 網址」面板');
    return true;
  }

  /** 這個輸入框是不是上方那個網路搜尋框？是的話絕對不能貼連結進去 */
  function isSearchBox(el) {
    const meta = (el.getAttribute('placeholder') || '') + ' ' +
                 (el.getAttribute('aria-label') || '') + ' ' +
                 (el.getAttribute('name') || '');
    if (IMP.searchBoxDeny.test(meta)) return true;

    // 搜尋框旁邊會有 網路／Fast Research 兩顆 chip，往上找三層就會撞到
    let p = el.parentElement, up = 0;
    while (p && up++ < 3) {
      if (/Fast Research/i.test(p.innerText || '')) return true;
      p = p.parentElement;
    }
    return false;
  }

  /** 在對話框內找網址輸入框：先排除搜尋框，再優先看有網址字樣的 */
  function findUrlInput(scope) {
    const root = scope || getDialog() || document;
    const inputs = queryAllDeep(IMP.urlInputSel, root).filter(isVisible)
      .filter(el => !el.disabled && !el.readOnly)
      .filter(el => !isSearchBox(el));
    if (!inputs.length) return null;

    const hinted = inputs.find(el => IMP.urlInputHint.test(
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '') + ' ' +
      (el.getAttribute('name') || '') + ' ' +
      (el.getAttribute('type') || '')
    ));
    if (hinted) return hinted;

    // 沒有提示字樣時，取面積最大的那個（網址框是多行 textarea，通常最大）
    return inputs.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    })[0];
  }

  /* ── 步驟 4：把連結寫進輸入框（三種寫法依序退場） ── */
  function setNativeValue(el, value) {
    const proto = (el.tagName === 'TEXTAREA')
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
  }

  const FILL_STRATEGIES = [
    ['setter', (el, text) => {
      el.focus();
      setNativeValue(el, text);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      // 有些表單要收到鍵盤事件才會重算驗證狀態，「插入」鈕才會解鎖
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'v' }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
      el.focus();
    }],
    ['paste', (el, text) => {
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
    }],
    ['execCommand', (el, text) => {
      el.focus();
      try { el.setSelectionRange(0, (el.value || '').length); } catch (e) {}
      document.execCommand('insertText', false, text);
    }],
  ];

  async function fillUrlInput(text) {
    for (const [name, fn] of FILL_STRATEGIES) {
      const el = findUrlInput();
      if (!el) throw new Error('填值時找不到網址輸入框');
      try { fn(el, text); } catch (e) { UI.log(`   ⓘ 填值策略 ${name} 例外：${e.message}`); }
      await sleep(300);
      const cur = findUrlInput();
      if (cur && (cur.value || '').trim().length > 0) {
        UI.log(`   ✅ 填值成功（策略 ${name}，${(cur.value || '').length} 字）`);
        return true;
      }
      UI.log(`   ↻ 填值策略 ${name} 無效，換下一種`);
    }
    return false;
  }

  /** 讀不到剪貼簿時的後備：聚焦輸入框，等使用者自己按 Ctrl+V */
  async function waitManualPaste() {
    const el = findUrlInput();
    if (el) el.focus();
    UI.status('⌨️ 請在網址框按 Ctrl+V（偵測到內容會自動繼續）');
    UI.log('⌨️ 等待手動貼上…游標已放進網址框，直接按 Ctrl+V 即可');

    const filled = await waitFor(() => {
      const cur = findUrlInput();
      return cur && parseUrls(cur.value).length > 0 ? cur : null;
    }, CFG.CLIPBOARD_WAIT_MS, 400);

    if (!filled) throw new Error('等待手動貼上逾時');
    const urls = parseUrls(filled.value);
    UI.log(`   ✅ 偵測到手動貼上的 ${urls.length} 個連結`);
    return urls;
  }

  /* ── 步驟 5：按「插入」 ── */

  /** Material 的停用狀態有四種寫法，只看 .disabled 會漏 */
  function isDisabled(el) {
    return el.disabled === true
      || el.getAttribute('disabled') !== null
      || el.getAttribute('aria-disabled') === 'true'
      || /mat-mdc-button-disabled|mdc-button--disabled/.test(el.className || '');
  }

  /**
   * 找「插入」按鈕。
   * v11.1 修正：不再只在 getDialog() 內找，也不再因為 disabled 就當作不存在。
   *   - 搜尋範圍：對話框 → 整份文件（overlay pane 有時不在 dialog 容器底下）
   *   - 比對：完全相符優先，失敗才放寬
   *   - 同名多顆時取最靠右下的（截圖中「插入」在對話框右下角）
   */
  function findInsertBtn() {
    const dlg = getDialog();
    const scopes = dlg ? [dlg, document] : [document];

    for (const scope of scopes) {
      const all = queryAllDeep('button,[role="button"],[type="submit"]', scope)
        .filter(isVisible)
        .filter(el => !IMP.addSource.test(label(el) || ''));   // 排除背景的「新增來源」

      let hit = all.filter(el => IMP.insertStrict.test((label(el) || '').trim()));
      if (!hit.length) hit = all.filter(el => IMP.insertLoose.test(label(el) || ''));
      if (!hit.length) continue;

      return hit.sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.bottom + rb.right) - (ra.bottom + ra.right);
      })[0];
    }
    return null;
  }

  /** 彈窗還開著時就把現場印出來——失敗當下按不到 🔧，所以自動印 */
  function dumpDialogButtons(reason) {
    UI.log(`🔧 自動診斷（${reason}）`);
    const dlg = getDialog();
    UI.log(`   對話框=${dlg ? '有' : '無'}｜標題=${JSON.stringify(((dlg && dlg.innerText) || '').split('\n')[0] || '')}`);

    const scope = dlg || document;
    const btns = queryAllDeep('button,[role="button"],[type="submit"]', scope).filter(isVisible);
    UI.log(`   對話框內可見按鈕 ${btns.length} 顆：`);
    btns.slice(0, 25).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      UI.log(`     [${i}] ${JSON.stringify((label(el) || '').replace(/\s+/g, ' ').trim().slice(0, 30))}` +
             ` <${el.tagName.toLowerCase()}> 停用=${isDisabled(el)}` +
             ` @${Math.round(r.left)},${Math.round(r.top)}`);
    });

    if (dlg) {
      const outside = queryAllDeep('button,[role="button"],[type="submit"]', document)
        .filter(isVisible).filter(el => !dlg.contains(el));
      const named = outside.map(el => (label(el) || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length < 30);
      UI.log(`   對話框外還有 ${outside.length} 顆按鈕：${[...new Set(named)].slice(0, 12).join('｜')}`);
    }
  }

  const INSERT_CLICK_STRATEGIES = [
    ['click',  el => el.click()],
    ['mouse',  el => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: REAL_WINDOW }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: REAL_WINDOW }));
      el.click();
    }],
    ['inner',  el => {
      const t = el.querySelector('.mdc-button__label, span') || el;
      t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: REAL_WINDOW }));
      t.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: REAL_WINDOW }));
      t.click();
    }],
  ];

  async function clickInsert() {
    // Angular 要跑完一輪變更偵測才會解鎖按鈕，所以用等的而不是看一眼就放棄
    let btn = await waitFor(() => {
      const b = findInsertBtn();
      return (b && !isDisabled(b)) ? b : null;
    }, CFG.INSERT_BTN_WAIT_MS, 200);

    if (!btn) {
      btn = findInsertBtn();
      if (!btn) {
        dumpDialogButtons('找不到「插入」按鈕');
        throw new Error('找不到「插入」按鈕');
      }
      UI.log('   ⚠️ 「插入」按鈕持續為停用狀態，仍嘗試點擊');
    }

    const shown = cleanLabel(btn).slice(0, 20) || '插入';
    for (const [name, fn] of INSERT_CLICK_STRATEGIES) {
      UI.log(`▸ 點擊「${shown}」（策略 ${name}）`);
      try { fn(btn); } catch (e) { UI.log(`   ⓘ 策略 ${name} 例外：${e.message}`); }

      // 對話框關閉即視為送出成功
      const closed = await waitFor(() => !getDialog(), 2500, 200);
      if (closed) { UI.log(`   ✅ 對話框已關閉（策略 ${name}）`); return true; }

      if (!btn.isConnected) { UI.log('   ✅ 按鈕已從 DOM 移除，視為已送出'); return true; }
      UI.log(`   ↻ 策略 ${name} 後對話框仍開著，換下一種`);
    }

    dumpDialogButtons('點了插入但對話框沒關');
    UI.log('   ⚠️ 三種點擊策略都沒關掉對話框，仍繼續等待來源出現');
    return true;
  }

  /* ── 步驟 6：等來源全部匯入完成 ── */
  async function waitImportDone(expected) {
    const t0 = now();
    let stable = 0, last = -1, lastChangeAt = now();

    for (;;) {
      const spinning = queryAllDeep(SEL.spinner).filter(isVisible).length;
      const cnt = readSourceCount();
      const cbs = rawCheckboxes().length;
      const elapsed = now() - t0;

      const seen = cnt >= 0 ? cnt : cbs;
      if (seen !== last) { stable = 0; last = seen; lastChangeAt = now(); }
      else if (!spinning) stable++;

      const idle = Math.round((now() - lastChangeAt) / 1000);
      UI.status(`⏳ 匯入中 ${seen}/${expected}｜轉圈=${spinning}｜穩定=${stable}｜停滯 ${idle}s`);

      if (!spinning && seen >= expected && stable >= 3) {
        UI.log(`✅ 匯入完成：${seen} / ${expected} 個來源（${Math.round(elapsed / 1000)}s）`);
        return seen;
      }

      // ★ v11.4 停滯偵測：有片子匯不進來時不要空等滿 4 分鐘。
      // NotebookLM 面板上明寫「剛上傳的影片可能無法匯入」，這是常態不是異常。
      if (!spinning && seen < expected && now() - lastChangeAt > CFG.IMPORT_STALL_MS) {
        UI.log(`⚠️ 已 ${idle} 秒沒有新來源進來，停止等待（${seen} / ${expected}）`);
        UI.log('   ⓘ 少掉的通常是剛上傳、私人或已下架的影片，可到來源面板核對後手動補');
        return seen;
      }

      if (elapsed > CFG.IMPORT_DONE_MAX_MS) {
        UI.log(`⚠️ 匯入等待逾時，目前 ${seen} / ${expected}，以現況繼續`);
        return seen;
      }
      await sleep(800);
    }
  }

  /* ── 匯入主流程 ── */
  async function importSources(urls) {
    const T = makeTimer();

    await ensureNotebookReady(true);            T.mark('筆記本就緒');

    // 筆記本 id 這時才確定，去重必須放在這之後
    if (urls && urls.length) {
      urls = dedupeAgainstNotebook(urls);
      if (!urls.length) {
        UI.log('ℹ️ 這些連結在這個筆記本裡都匯過了，沒有新的可匯入');
        return 0;
      }
    }

    const before = Math.max(readSourceCount(), 0);

    await openAddSourceDialog();                T.mark('開對話框');
    await chooseWebsiteOption();                T.mark('選網站');

    // 沒有預先讀到連結 → 讓使用者手動貼，貼完直接沿用
    if (!urls || !urls.length) {
      urls = await waitManualPaste();
    } else {
      const text = urls.join('\n');
      const ok = await fillUrlInput(text);
      if (!ok) {
        UI.log('⚠️ 三種填值策略都無效，改請你手動貼上');
        urls = await waitManualPaste();
      }
    }
    T.mark('填入網址');

    await clickInsert();                        T.mark('送出');
    const got = await waitImportDone(before + urls.length);
    T.mark('等待匯入');

    const added = got - before;
    if (added > 0) addImported(urls.map(videoIdOf));   // 記帳，供下次去重
    if (added < urls.length) {
      UI.log(`⚠️ 預期新增 ${urls.length} 個，實際 ${added} 個`);
      if (CFG.IMPORT_MODE === 'batch') {
        UI.log('   ⓘ 批次模式可能不支援多行網址；把 CFG.IMPORT_MODE 改成 "single" 可改成逐條匯入');
      }
    }
    UI.log(`📥 匯入階段完成｜${T.toString()}`);
    return added;
  }

  /** 逐條匯入（batch 不支援多行時的後備） */
  async function importSourcesOneByOne(urls) {
    let added = 0;
    for (let i = 0; i < urls.length; i++) {
      if (stopFlag) { UI.log('⏹ 使用者中止匯入'); break; }
      UI.status(`📥 逐條匯入 ${i + 1}／${urls.length}`);
      const before = Math.max(readSourceCount(), 0);
      try {
        await openAddSourceDialog();
        await chooseWebsiteOption();
        const ok = await fillUrlInput(urls[i]);
        if (!ok) throw new Error('填值失敗');
        await clickInsert();
        const got = await waitImportDone(before + 1);
        if (got > before) added++;
      } catch (e) {
        UI.log(`❌ 第 ${i + 1} 條匯入失敗：${e.message}`);
        await closeModals();
      }
      await sleep(CFG.IMPORT_SETTLE_MS);
    }
    UI.log(`📥 逐條匯入完成：${added} / ${urls.length}`);
    return added;
  }

  /* ── 對外入口：匯入 ＋（可選）接著生成 ── */
  /* ★ v12.2 手動重複匯入防呆。
   * 實測踩到的情況：開分頁時自動跑了一輪，使用者不知道，又手動按 📥，
   * 結果同樣五支影片產生了兩個筆記本。
   * 自動執行本來就有防重複閘，但手動按鈕刻意繞過它——當時的假設是
   *「你要手動按就是真的想再跑」，而那個假設錯了：你按的時候並不知道跑過了。
   * 改成需要再按一次確認，而不是直接擋掉（有時候真的就是要重跑）。 */
  const AUTORUN_SIG_KEY = 'nblm_autorun_sig';
  const AUTORUN_AT_KEY  = 'nblm_autorun_at';
  let dupConfirm = { sig: '', until: 0 };

  async function runImportAndGenerate(preloadedUrls, opts) {
    if (running || importing) { UI.log('⚠️ 已在執行中'); return; }
    const trusted = !!(opts && opts.confirmed);

    importing = true; stopFlag = false;
    UI.arm();
    UI.setLayoutBtn(readMode(), true);
    UI.log(`📥 開始匯入流程（模式 ${CFG.IMPORT_MODE}）`);

    try {
      // ★ v12.5 batchId：續跑／自動執行由 opts 帶入，手動 📥 從 Web App 回應取得
      let batchId = (opts && opts.batchId) || '';
      let serverDoneAt = '';
      let urls;
      if (preloadedUrls && preloadedUrls.length) {
        urls = preloadedUrls;
      } else {
        const got = await obtainUrls();
        urls = got.urls;
        batchId = got.batchId || '';
        serverDoneAt = got.doneAt || '';
      }

      // ── 重複匯入檢查（自動執行已自行檢查過，帶 confirmed 進來就跳過）──
      if (!trusted && urls.length) {
        const sig = urls.join('|');
        const lastAt = gmGet(AUTORUN_AT_KEY, 0);
        const recent = lastAt && (now() - lastAt) < CFG.DUP_WARN_MS;
        const armed = dupConfirm.sig === sig && now() < dupConfirm.until;
        const localDup = gmGet(AUTORUN_SIG_KEY, '') === sig && recent;

        if ((localDup || serverDoneAt) && !armed) {
          if (localDup) {
            const ago = Math.round((now() - lastAt) / 60000);
            UI.log(`⚠️ 這 ${urls.length} 個連結 ${ago} 分鐘前已經匯入過了（多半是開分頁時自動跑的）`);
          } else {
            UI.log(`⚠️ 這 ${urls.length} 個連結已在 ${serverDoneAt} 執行過（多半是另一台電腦）`);
          }
          UI.log('   ⓘ 再按一次 📥 會另外建立一個內容相同的筆記本');
          UI.log('   ⓘ 不想重複的話，回首頁看看是不是已經有今天的筆記本了');
          UI.status('⚠️ 這批跑過了，再按一次 📥 確認');
          dupConfirm = { sig, until: now() + 15000 };
          return;
        }
        dupConfirm = { sig: '', until: 0 };
      }

      // 把工作存起來：中途重整也能撿回（★ v12.5 連 batchId 一起存，續跑完才回報得了）
      saveJob({ phase: 'import', urls, batchId, reloads: (loadJob() || {}).reloads || 0 });

      if (urls.length) {
        UI.log(`   連結清單（前 3 筆）：`);
        urls.slice(0, 3).forEach((u, i) => UI.log(`     ${i + 1}. ${u}`));
        if (urls.length > 3) UI.log(`     …共 ${urls.length} 筆`);
      }

      const added = (CFG.IMPORT_MODE === 'single' && urls.length)
        ? await importSourcesOneByOne(urls)
        : await importSources(urls);

      clearJob();

      // 手動跑成功也要記帳，否則下次的重複檢查會漏掉這一輪
      if (added > 0 && urls.length) {
        gmSet(AUTORUN_SIG_KEY, urls.join('|'));
        gmSet(AUTORUN_AT_KEY, now());
        // ★ v12.5 筆記本已經建出來，這時就要讓其他電腦知道（不等報告生成完）
        if (batchId) await reportDoneToWebApp(batchId);
      }

      if (added <= 0) {
        UI.status('⚠️ 沒有匯入任何來源');
        UI.log('❌ 匯入結果為 0，不進入生成階段');
        return;
      }

      if (!CFG.AUTO_GENERATE_AFTER_IMPORT) {
        UI.status(`✅ 已匯入 ${added} 個來源（未自動生成）`);
        return;
      }

      UI.log('──────── 匯入完成，進入生成階段 ────────');
      importing = false;                 // 交棒給 run()，避免互斥誤判
      UI.setLayoutBtn(readMode(), false);
      await run(null);
      return;

    } catch (e) {
      UI.log(`💥 匯入中斷：${e.message}`);
      UI.log(`   現場快照 ▸ ${snapshot()}`);
      // 彈窗還開著的當下就診斷完，關掉之後現場就沒了
      try { if (getDialog()) dumpDialogButtons('匯入中斷，關閉彈窗前留存現場'); }
      catch (e2) { UI.log(`   ⚠️ 自動診斷失敗：${e2.message}`); }
      UI.status(`❌ 匯入失敗：${e.message}`);
      await closeModals();
      clearJob();
    } finally {
      importing = false;
      UI.setLayoutBtn(readMode(), false);
    }
  }

  /* ── 選擇器校正用診斷 ── */
  function diagnoseImportUI() {
    UI.log('🔧 匯入 UI 診斷開始');
    UI.log(`   設定選單：${personalSettingsStatus.menu}｜面板設定按鈕=${UI.btnSettings ? '有' : '無'}`);
    UI.log(`   網址=${location.pathname}｜筆記本頁=${isNotebookPage()}｜來源計數=${readSourceCount()}`);

    const dlg = getDialog();
    UI.log(`   對話框=${dlg ? '有' : '無'}`);

    const scope = dlg || document;
    const btns = queryAllDeep('button,[role="button"],[role="menuitem"],[role="option"]', scope)
      .filter(isVisible)
      .map(el => (label(el) || '').replace(/\s+/g, ' ').trim())
      .filter(t => t && t.length < 40);

    const uniq = [...new Set(btns)];
    UI.log(`   可見按鈕文字（${uniq.length} 種）：`);
    uniq.slice(0, 40).forEach(t => UI.log(`     ・${JSON.stringify(t)}`));
    if (uniq.length > 40) UI.log(`     …另有 ${uniq.length - 40} 種未列出`);

    const inputs = queryAllDeep(IMP.urlInputSel, scope).filter(isVisible);
    UI.log(`   可見輸入框（${inputs.length}）：`);
    inputs.slice(0, 8).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      UI.log(`     [${i}] <${el.tagName.toLowerCase()}> type=${el.type || '-'} ` +
             `placeholder=${JSON.stringify(el.getAttribute('placeholder') || '')} ` +
             `aria=${JSON.stringify(el.getAttribute('aria-label') || '')} ` +
             `${Math.round(r.width)}×${Math.round(r.height)}`);
    });

    UI.log('   對照 §2.5 的 IMP 正規式，把對不上的文字補進去即可');
    UI.status('🔧 診斷完成（雙擊紀錄可複製）');
  }

  /* ============================================================
   * 9. 主流程
   * ========================================================== */
  let running = false, stopFlag = false;
  async function scan() {
    await ensureSourcePanelOpen();
    await gotoTab('source');
    await waitSourcesReady();
    const list = collectSources();
    UI.log(`🔍 偵測到 ${list.length} 個來源：`);
    list.forEach((s, i) => UI.log(`   #${i + 1}  ${s.title.slice(0, 60)}`));
    return list;
  }
  async function processOne(idx, list) {
    const T = makeTimer();
    const stage = name => {
      checkVideoTask();
      activeVideoTask.stage = name;
      UI.log(`   ▸ #${idx + 1} ${name}（已 ${Math.round((now() - activeVideoTask.startedAt) / 1000)}s）`);
    };
    stage('清彈窗');
    await closeModals();                       T.mark('清彈窗');
    stage('切來源');
    await gotoTab('source');                   T.mark('切來源');
    stage('勾選+驗證');
    const detail = await selectOnly(idx, { count: list.length, title: list[idx].title });
    T.mark('勾選+驗證');
    stage('切工作室');
    await gotoTab('studio');                   T.mark('切工作室');
    stage('找報告按鈕');
    const btn = await waitFor(findReportBtn, CFG.REPORT_BTN_WAIT_MS);
    if (!btn) throw new Error('找不到「報告」按鈕');
    T.mark('找按鈕');

    // ★ v12.1 頁面還在忙的時候點下去，click 事件會被丟掉。先等它閒下來。
    // 延遲值一併記進計時字串，跑幾天就能看出該不該調 IDLE_LAG_MS。
    if (CFG.IDLE_GATE_ENABLED) {
      stage('等主執行緒閒置');
      const st = await waitMainThreadIdle(CFG.IDLE_MAX_WAIT_MS);
      T.mark(`等閒置${st.idle ? '' : '(逾時)'}[lag=${st.lag}ms]`);
    }
    let dlg = null;
    for (let attempt = 0; attempt <= CFG.BLOG_RETRY; attempt++) {
      // ★ v11.4 第一次就送完整 mouse 事件。
      // v11.3 實測：4 部裡有 2 部第一次純 .click() 沒反應，等滿 1500ms 逾時後
      // 才靠帶 mouse 事件的重試在 522ms 內開啟——那 1.5 秒是白等的。
      stage(`開報告彈窗#${attempt}`);
      fireClick(btn, true);
      dlg = await waitFor(getDialog, CFG.DIALOG_OPEN_MS);
      T.mark(`彈窗開#${attempt}`);
      if (dlg) break;
      await sleep(CFG.DIALOG_RETRY_GAP_MS);
    }
    if (!dlg) throw new Error('彈窗未開啟');

    // ★ v12.4 改版後的「建立報告」彈窗：格式（互動式／文件）＋ 範本，右下送出。
    //         預設不碰格式，直接按「立即生成」——互動式本來就是預設選項。
    if (CFG.REPORT_FORMAT !== 'default') {
      stage('選報告格式');
      await chooseReportFormat(dlg);
      T.mark(`選格式(${CFG.REPORT_FORMAT})`);
    }

    // 按鈕要等 Angular 跑完一輪變更偵測才解鎖；等不到就照樣點（同 findInsertBtn 的策略）
    stage('找生成鈕');
    let genBtn = await waitFor(() => {
      const b = findGenerateBtn(dlg);
      return (b && !isDisabled(b)) ? b : null;
    }, CFG.GEN_BTN_WAIT_MS);
    T.mark('找生成鈕');

    if (!genBtn) {
      genBtn = findGenerateBtn(dlg);
      if (genBtn) UI.log('   ⚠️ 「立即生成」仍為停用狀態，照樣點下去');
    }
    if (!genBtn) {
      dumpDialogButtons('找不到「立即生成」，關閉彈窗前留存現場');
      throw new Error('找不到「立即生成」按鈕');
    }

    // ★ v11.4 改成偵測工作室內容變化，不再固定睡 2 秒
    stage('送出與確認');
    const sigBefore = studioSignature();
    fireClick(genBtn, true);
    const changed = await waitFor(
      () => studioSignature() !== sigBefore, CFG.SUBMIT_BUFFER_MS, 150
    );
    await sleep(CFG.SUBMIT_SETTLE_MS);
    T.mark(changed ? '送出確認' : '送出等滿');

    stage('收尾');
    await closeModals();                       T.mark('收尾');
    return `${T.toString()}｜${detail}`;
  }
  async function recoverSourceList(list) {
    UI.log('↻ 恢復來源清單…');
    await closeModals();
    if (!(await ensureSourcePanelOpen())) throw new Error('無法展開來源面板');
    await gotoTab('source');
    const ready = await waitFor(() => {
      if (queryAllDeep(SEL.spinner).filter(isVisible).length) return false;
      const sources = liveSources();
      return sources.length === list.length && sources.every((cb, i) => {
        const title = sourceTitle(cb);
        return title && (list[i].title === '(無標題)' || title === list[i].title);
      });
    }, CFG.TAB_VERIFY_MS, CFG.TAB_POLL_MS);
    if (!ready) throw new Error('來源數量／順序未恢復或仍在載入');
    UI.log('✅ 來源清單已恢復並核對順序');
  }
  async function run(indices) {
    if (running) { UI.log('⚠️ 已在執行中'); return; }
    running = true; stopFlag = false; deepDumped = false;
    UI.arm();
    UI.setLayoutBtn(readMode(), true);
    UI.btnRetry.style.display = 'none';
    const t0 = now();
    const failed = [];
    let ok = 0, deferred = 0;
    try {
      const list = await scan();
      const target = (indices && indices.length) ? indices
                   : (CFG.ONLY_INDEX !== null ? [CFG.ONLY_INDEX]
                   : list.map((_, i) => i));
      UI.log(`🚀 開始處理 ${target.length} 部（來源總數 ${list.length}）`);
      for (const idx of target) {
        if (stopFlag) { UI.log('⏹ 使用者中止'); break; }
        if (!list[idx]) { failed.push(idx); UI.log(`❌ #${idx + 1} 不存在`); continue; }
        UI.status(`處理中 ${idx + 1}／${list.length}：${list[idx].title.slice(0, 30)}`);
        const vt = now();
        try {
          // 工作完全退出前，不清除 context、不啟動下一部。
          let detail;
          activeVideoTask = { startedAt: vt, deadline: vt + CFG.VIDEO_HARD_TIMEOUT_MS, stage: '開始' };
          try {
            detail = await processOne(idx, list);
            checkVideoTask();
          } finally {
            activeVideoTask = null;
          }
          ok++;
          UI.log(`✅ #${idx + 1} ${list[idx].title.slice(0, 24)}（${Math.round((now() - vt) / 1000)}s）｜${detail}`);
        } catch (e) {
          failed.push(idx);
          UI.log(`❌ #${idx + 1} 失敗：${e.message}`);
          UI.log(`   現場快照 ▸ ${snapshot()}`);
          deepDump();
          if (stopFlag) break;
          try {
            await recoverSourceList(list);
          } catch (recoveryError) {
            UI.log(`🛑 停止整批：${recoveryError.message}；保留剩餘項目供重跑`);
            const pending = target.slice(target.indexOf(idx) + 1).filter(i => list[i]);
            deferred += pending.length;
            failed.push(...pending);
            UI.log(`   未處理 ${pending.length} 部（已加入重跑清單）`);
            break;
          }
        }
        await sleep(CFG.CLICK_DELAY_MS);
      }
    } catch (e) {
      UI.log(`💥 流程中斷：${e.message}`);
      UI.log(`   現場快照 ▸ ${snapshot()}`);
      deepDump();
    } finally {
      const secs = Math.round((now() - t0) / 1000);
      UI.log(`—— 結束：成功 ${ok}｜失敗 ${failed.length - deferred}｜未處理 ${deferred}｜總耗時 ${secs}s ——`);
      saveState({ ts: Date.now(), failed, ok, deferred, secs });
      if (failed.length) {
        UI.btnRetry.textContent = `↻ 重跑失敗 (${failed.length})`;
        UI.btnRetry.style.display = '';
      }
      UI.done(ok, failed.length);
      running = false;
      UI.setLayoutBtn(readMode(), false);
      if (!failed.length && ok > 0 && CFG.ON_DONE_LAYOUT) {
        try { await applyReadingLayout(); }   // 內部 writeMode 會同步按鈕
        catch (e) { UI.log(`⚠️ 版面套用失敗：${e.message}`); }
      }
    }
  }

  /* ============================================================
   * 10. 啟動
   * ========================================================== */
  UI.btnImport.onclick = () => runImportAndGenerate(null)
    .catch(err => UI.log(`⚠️ 匯入流程例外：${err.message}`));
  UI.btnSettings.onclick = editWebAppSettings;
  UI.log(`⚙ 設定網址請點面板按鈕｜擴充功能選單：${personalSettingsStatus.menu}`);
  UI.btnRun.onclick   = () => run(null);
  UI.btnStop.onclick  = () => { stopFlag = true; UI.log('⏹ 已送出中止訊號…'); };
  UI.btnRetry.onclick = () => {
    const s = loadState();
    if (s.failed && s.failed.length) run(s.failed.slice());
    else UI.log('沒有待重跑的項目');
  };
  UI.btnDiag.onclick   = () => { try { diagnoseImportUI(); } catch (e) { UI.log(`🔧 診斷失敗：${e.message}`); } };
  UI.btnLayout.onclick = () => toggleLayout().catch(err => UI.log(`⚠️ 版面切換失敗：${err.message}`));

  // Alt+R：手在鍵盤上時不必移動到面板；輸入框內不攔截
  window.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'r' && e.key !== 'R') return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    toggleLayout().catch(err => UI.log(`⚠️ 版面切換失敗：${err.message}`));
  }, true);

  // Alt+I：直接觸發匯入＋生成
  window.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'i' && e.key !== 'I') return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    runImportAndGenerate(null).catch(err => UI.log(`⚠️ 匯入流程例外：${err.message}`));
  }, true);

  // Alt+D：診斷。刻意不排除輸入框，因為彈窗開著時面板的 🔧 按不到，
  //        游標又常停在網址框裡——這是唯一叫得動診斷的路徑
  window.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== 'd' && e.key !== 'D') return;
    e.preventDefault();
    e.stopPropagation();
    try {
      diagnoseImportUI();
      if (getDialog()) dumpDialogButtons('手動診斷');
    } catch (err) { UI.log(`🔧 診斷失敗：${err.message}`); }
  }, true);

  UI.bar.addEventListener('dblclick', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.shiftKey) { location.reload(); return; }
    toggleLayout().catch(err => UI.log(`⚠️ 版面切換失敗：${err.message}`));
  });
  UI.dot.addEventListener('contextmenu', e => {
    e.preventDefault();
    toggleLayout().catch(err => UI.log(`⚠️ 版面切換失敗：${err.message}`));
  });

  (function bootCheck() {
    const s = loadState();
    if (s.failed && s.failed.length) {
      const when = new Date(s.ts).toLocaleString('zh-TW');
      UI.log(`📌 上次執行（${when}）有 ${s.failed.length} 部失敗：#${s.failed.map(i => i + 1).join(', #')}`);
      UI.btnRetry.textContent = `↻ 重跑失敗 (${s.failed.length})`;
      UI.btnRetry.style.display = '';
      UI.panel.style.border = '2px solid #f9ab00';
    }
  })();

  /* ★ v11.0 斷點續跑：自動重整後把未完成的匯入撿回來
   * ★ v11.4 加上 selfReload 閘門。
   *   舊版只要 15 分鐘內有未完成工作就自動跑，分不清這次重整是誰發動的。
   *   你自己手動重整、或關掉分頁再開，它會靜靜再建一個新筆記本、再匯一次。
   *   現在只有腳本自己為了解決卡 loading 而重整時才會自動接手。 */
  (function resumeJob() {
    const job = loadJob();
    if (!job || !job.phase) return;

    const ago = Math.round((now() - job.ts) / 1000);
    const count = (job.urls || []).length;

    if (!job.selfReload) {
      UI.log(`🔄 有一份未完成的匯入工作（${ago}s 前｜${count} 個連結），但這次重整不是腳本發動的`);
      UI.log('   ⓘ 不自動續跑，以免又開一個新筆記本。要繼續請自行按 📥');
      clearJob();
      return;
    }

    UI.log(`🔄 偵測到腳本自己發動的重整（${ago}s 前｜第 ${job.reloads || 0} 次｜${count} 個連結）`);
    UI.status('🔄 3 秒後自動續跑…（按 ⏹ 可取消）');
    setTimeout(() => {
      if (stopFlag) { UI.log('⏹ 已取消續跑'); clearJob(); return; }
      runImportAndGenerate(job.urls || null, { batchId: job.batchId || '' })
        .catch(err => UI.log(`⚠️ 續跑失敗：${err.message}`));
    }, 3000);
  })();

  /* ★ v12.0 開分頁自動執行
   *
   * 四道閘，任何一道沒過就只在紀錄裡說明原因、不執行：
   *   1. 只在首頁／清單頁跑——你打開既有筆記本讀文章時不會被打擾
   *   2. ★ v12.5 Apps Script 回報這批已執行（doneAt）——擋住「別台電腦跑過了」
   *   3. 同一組連結只跑一次——指紋存在 GM 儲存，重整分頁不會再建一個筆記本
   *   4. 倒數期間按 ⏹ 可取消
   * 這幾道是必要的：少了任何一道，每次開分頁都可能多一個新筆記本。 */
  (function autoRunOnLoad() {
    if (!CFG.AUTO_RUN_ON_LOAD) return;
    if (!CFG.WEBAPP_URL) return;                  // 沒設端點就不自動跑，剪貼簿模式維持手動
    if (loadJob()) return;                        // 有待辦工作，交給 resumeJob 處理

    setTimeout(async () => {
      try {
        if (running || importing) return;

        if (isNotebookPage() && !CFG.AUTO_RUN_ANYWHERE) {
          UI.log('ⓘ 目前在既有筆記本內，不自動執行——你多半是來讀文章的');
          UI.log('   ⓘ 要跑請按 📥（它會另外建新筆記本，不會動這一個）');
          UI.log('   ⓘ 想讓它在任何頁面都自動跑：把 AUTO_RUN_ANYWHERE 改成 true');
          return;
        }

        const got = await fetchLinksFromWebApp();
        if (!got || !got.urls.length) {
          UI.log('ⓘ Web App 目前沒有可匯入的連結，待命');
          return;
        }

        // ★ v12.5 第四道閘：Apps Script 記得這批已經有電腦跑過了
        if (got.doneAt) {
          UI.log(`ⓘ 這 ${got.urls.length} 個連結已在 ${got.doneAt} 執行過（可能是另一台電腦），不重複執行`);
          UI.log('   ⓘ 真的要再跑一次請直接按 📥');
          UI.status('待命（本批已處理過）');
          return;
        }

        const sig = got.urls.join('|');
        if (gmGet(AUTORUN_SIG_KEY, '') === sig) {
          const at = gmGet(AUTORUN_AT_KEY, 0);
          const ago = at ? Math.round((now() - at) / 60000) : '?';
          UI.log(`ⓘ 這 ${got.urls.length} 個連結 ${ago} 分鐘前已經跑過了，不重複執行`);
          UI.log('   ⓘ 真的要再跑一次請直接按 📥');
          UI.status('待命（本批已處理過）');
          return;
        }

        let left = Math.round(CFG.AUTO_RUN_COUNTDOWN_MS / 1000);
        UI.log(`🚀 偵測到 ${got.urls.length} 個新連結，${left} 秒後自動開始（按 ⏹ 取消）`);
        UI.arm();

        const tick = setInterval(() => {
          left--;
          if (stopFlag) {
            clearInterval(tick);
            UI.log('⏹ 已取消自動執行');
            UI.status('待命（自動執行已取消）');
            return;
          }
          if (left > 0) { UI.status(`🚀 ${left} 秒後自動開始…（按 ⏹ 取消）`); return; }

          clearInterval(tick);
          gmSet(AUTORUN_SIG_KEY, sig);
          gmSet(AUTORUN_AT_KEY, now());
          runImportAndGenerate(got.urls, { confirmed: true, batchId: got.batchId })
            .catch(err => UI.log(`⚠️ 自動執行失敗：${err.message}`));
        }, 1000);

        UI.status(`🚀 ${left} 秒後自動開始…（按 ⏹ 取消）`);

      } catch (e) {
        UI.log(`⚠️ 自動執行檢查失敗：${e.message}`);
      }
    }, CFG.AUTO_RUN_BOOT_DELAY_MS);
  })();

  // 面板要等 Angular 畫完才量得到 header 寬度，延遲一次狀態同步
  setTimeout(() => {
    try { UI.setLayoutBtn(currentMode(), false); } catch (e) {}
  }, 1500);

  UI.log(`✅ NotebookLM 自動化腳本 v${VERSION} 已注入`);
  UI.log('   📥 匯入＋生成＝Alt+I｜📖 閱讀模式＝Alt+R｜🔧 選擇器診斷在標題列');
  UI.log(CFG.WEBAPP_URL
    ? `   🔗 連結來源：Web App${CFG.AUTO_RUN_ON_LOAD ? '（開分頁自動執行）' : '（手動觸發）'}`
    : '   🔗 連結來源：剪貼簿（請從竄改猴選單設定 Web App 網址）');
  console.log(`✅ NotebookLM 自動化腳本 v${VERSION} 已注入`);
})();