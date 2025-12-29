# 如何在 GitHub Pages 部署並發布您的 PWA App

是的，這個 App 非常適合部署在 GitHub Pages！因為它完全由靜態檔案 (HTML/CSS/JS) 組成，且 GitHub Pages 提供的 **HTTPS** 是 PWA (安裝到手機) 的必要條件。

以下是完整的部署與設定步驟：

## 第一步：上傳程式碼到 GitHub
1. 在 GitHub 上建立一個新的 **Public Repository** (例如命名為 `my-fodmap-tracker`)。
2. 將您電腦上的專案資料夾初始化為 git 專案並推送到 GitHub (如果您熟悉 git 指令)：
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<您的帳號>/my-fodmap-tracker.git
   git push -u origin main
   ```
   *(或者您也可以直接使用 GitHub 網頁版的 "Upload files" 功能上傳所有檔案)*

## 第二步：開啟 GitHub Pages
1. 進入您的 GitHub Repository 頁面。
2. 點擊上方的 **Settings** (設定)。
3. 在左側選單找到 **Pages** (頁面)。
4. 在 **Build and deployment** 下的 **Source** 選擇 `Deploy from a branch`。
5. 在 **Branch** 選單中，選擇 `main` (或 master) 以及 `/ (root)` 資料夾，然後按 **Save**。
6. 等待約 1-2 分鐘，重新整理頁面，您會看到頂部出現您的網址，格式通常為：
   `https://<您的帳號>.github.io/my-fodmap-tracker/`

## 第三步：設定 Google Cloud Console (關鍵步驟)
為了讓 Google Drive 登入功能在 GitHub Pages 上運作，您必須修改 Google API 的授權設定：

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)。
2. 進入您的專案，選擇 **APIs & Services** > **Credentials** (憑證)。
3. 點擊您原本建立的 **OAuth 2.0 Client ID**。
4. 在 **Authorized JavaScript origins** (已授權的 JavaScript 來源) 區塊：
   - 點擊 **Add URI**。
   - 貼上您的 GitHub Pages 網址 (只保留網域部分)，例如：
     `https://<您的帳號>.github.io`
   - *注意：結尾不要有斜線 `/`。*
5. 按下 **Save** (儲存)。

## 第四步：使用者如何安裝 (下載)
當您的用戶 (或您自己) 使用手機瀏覽器 (Chrome/Safari) 開啟該網址時：

- **Android (Chrome)**: 瀏覽器下方通常會自動彈出「新增 My FODMAP 到主畫面」的提示，或是點擊選單中的「安裝應用程式」。
- **iOS (Safari)**: 點擊下方的「分享」按鈕 (往上的箭頭圖示)，往下滑找到並點擊「加入主畫面 (Add to Home Screen)」。

這樣就會像一個原生 App 一樣出現在手機桌面上，並且支援離線開啟！

## 注意事項
- **更新延遲**: 當您更新程式碼到 GitHub 後，GitHub Pages 可能需要幾分鐘才會更新。
- **快取**: 因為我們有使用 Service Worker (`sw.js`) 做離線功能，有時候瀏覽器會抓到舊的版本。如果更新後沒看到變動，請嘗試清除瀏覽器快取重新整理。
