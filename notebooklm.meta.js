// ==UserScript==
// @name         NotebookLM 一鍵生成互動式報告
// @namespace    https://github.com/yueh-notebooklm
// @version      12.7
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
