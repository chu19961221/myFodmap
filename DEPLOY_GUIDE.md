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
為了讓 Google Drive 登入功能在 GitHub Pages (或您的本機環境) 上運作，您必須取得正確的憑證並設定授權網址。

### 1. 取得 Client ID 與 API Key (重要)
這款 APP 不需要「密碼 (Client Secret)」，而是需要 **API Key**。

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)。
2. 進入 **APIs & Services** > **Credentials** (憑證)。
3. **複製 Client ID**: 找到 OAuth 2.0 Client IDs 區塊，複製那個以 `.apps.googleusercontent.com` 結尾的字串。
4. **建立 API Key**:
   - 點擊上方 **+ CREATE CREDENTIALS** > **API Key**。
   - 複製產生出來的那串亂碼 Key。
   - (建議) 點擊編輯該 API Key，在 "API restrictions" 中選擇 **Google Drive API**，增加安全性。

### 2. 設定授權網址 (Authorized JavaScript origins)
1. 回到 OAuth 2.0 Client ID 的編輯頁面。
2. 在 **Authorized JavaScript origins** (已授權的 JavaScript 來源) 區塊：
   - **本機測試用**: 加入 `http://localhost:8000` (或您使用的 port)。
   - **GitHub Pages用**: 加入 `https://<您的帳號>.github.io` (注意結尾不可有斜線)。
3. 按下 **Save** (儲存)。

## 第四步：在 APP 中連接雲端
1. 打開您的 APP (不管是在 `localhost` 還是 GitHub Pages)。
2. 點擊右上角的 **齒輪 (設定) 圖示**。
3. 把剛剛取得的 **Client ID** 和 **API Key** 分別填入對應欄位。
4. 按下 **Save & Connect**。
5. 接著會彈出 Google 登入視窗，授權後狀態會變為綠燈，即完成串接！

## 第五步：使用者如何安裝 (下載)
當您的用戶 (或您自己) 使用手機瀏覽器 (Chrome/Safari) 開啟該網址時：
- **Android (Chrome)**: 瀏覽器下方通常會自動彈出「新增 My FODMAP 到主畫面」的提示，或是點擊選單中的「安裝應用程式」。
- **iOS (Safari)**: 點擊下方的「分享」按鈕 (往上的箭頭圖示)，往下滑找到並點擊「加入主畫面 (Add to Home Screen)」。

這樣就會像一個原生 App 一樣出現在手機桌面上，並且支援離線開啟！
