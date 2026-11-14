/* 與 JasonHome 同一個 Google OAuth 網頁用戶端。
 * 已授權的 JavaScript 來源含 https://schmidtaiwan.github.io ，路徑不用另加。
 * 自選股、持股、交易日誌只寫入 preferredEmail 的雲端硬碟 / StockJason。
 * 檔名帶登入的 Gmail，所以每個帳號讀自己的那一份。
 */
window.GOOGLE_CONFIG = {
  clientId: "90391506221-41kb4us4hsuq7go94udf3o17hr2f9uoh.apps.googleusercontent.com",
  preferredEmail: "jason660803@gmail.com",
  editors: ["jason660803@gmail.com", "backy2777@gmail.com"],
  folderName: "StockJason",
  /* Tailscale Serve 的 HTTPS 根網址，例 https://你的電腦.tailXXXX.ts.net （勿用 http://192.168） */
  liveBridgeBaseUrl: "https://desktop-lpmd0rk.tail3f8104.ts.net",
  /* 選填：FinMind 付費 token，亦可在「籌碼健檢」頁貼上並存本機 */
  finmindToken: ""
};
