# NotebookLM 自動化腳本

最新版本：v12.7。支援匯入 YouTube 來源、逐一建立報告、閱讀版面與自動更新。

## 安裝與首次移轉

1. 使用已安裝 Tampermonkey 的瀏覽器開啟 [安裝腳本](https://raw.githubusercontent.com/ss890527/notebooklm-userscript/main/notebooklm.user.js)。
2. 確認只有一份同名腳本啟用。name／namespace 沿用舊版，通常會辨識為更新；仍須核對。
3. 開啟 NotebookLM，在竄改猴選單選「設定 Web App 網址（更新後保留）」。在本機貼上自行部署的 Web App 完整網址。
4. 工作完成後重新整理分頁，確認標題列顯示 v12.7。
5. 在 Tampermonkey 啟用腳本更新檢查。新增權限或更新來源可能要求確認。

每台電腦首次移轉需要設定一次；個人網址存各台 GM 儲存，之後程式更新保留設定。未設定端點時可走剪貼簿匯入。
此公開倉庫不提供個人 Web App 端點或 token，也不發布 Apps Script 專案。

## 自動更新

@updateURL 指向 notebooklm.meta.js；@downloadURL 指向 notebooklm.user.js。
各台依 Tampermonkey 設定的週期檢查版本，更新不是即時推送；已開啟的分頁需重新整理才使用新碼。
可以從 Tampermonkey 管理介面手動檢查更新。

## 維護

user.js 和 meta.js 必須在同一次發布使用相同 @version；程式 VERSION 與 changelog 同步更新。
發布前確認 Web App 設定保持空白，禁止將任何 token 或個人設定放進原始碼。
