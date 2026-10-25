# 島嶼路網 Island Pulse

台灣交通資訊整合 App 的前端與官方資料代理。地圖整合道路事件、測速設置點、運輸資訊與路線查詢入口。測速清冊（警政署資料集 7320、13940）目前可由公開網站讀取；警廣道路事件代理（15221）已完成程式整合，但 Render 線上測試回傳上游 `fetch failed`，因此目前會正確顯示不可用狀態。TDX 代理已建置，正式班次需要在 Render 設定憑證。

## 本機啟動

需求：Node.js 20.19+（Vite 8 所需）及 npm。

```powershell
npm install
npm run dev
```

終端機顯示的本機網址通常為 `http://127.0.0.1:5173`。此指令同時啟動 Vite 前端與本機 Node 資料 API（`127.0.0.1:8788`），不需另裝 API 框架。停止伺服器請按 `Ctrl+C`。若只需獨立啟動資料 API，可執行 `npm run api`。

若要啟用 TDX 大眾運輸即時／定期班表查詢，請在專案根目錄建立 `.env` 並設定：

```env
TDX_CLIENT_ID=你的_TDX_CLIENT_ID
TDX_CLIENT_SECRET=你的_TDX_CLIENT_SECRET
```

## 公開部署

此專案提供 Render Web Service 設定（`render.yaml`），同一個 Node 服務會提供建置後的網站與 `/api/*` 資料 API。將程式推送到 GitHub 後，可透過 [Render Blueprint](https://render.com/deploy?repo=https://github.com/kdj2rvsrys-netizen/island-pulse-transit) 建立公開服務。首次部署需要在 Render 登入並授權連接 GitHub。免費方案閒置 15 分鐘後會休眠，下一位訪客需要等待服務喚醒；此方案適合原型預覽，不適合要求持續可用的正式服務。

部署環境不會包含本機 `.env`。測速清冊可先行運作；警廣道路事件目前受 Render 到官方來源的連線問題影響。TDX 班次需要在 Render 服務的 Environment 設定 `TDX_CLIENT_ID` 和 `TDX_CLIENT_SECRET`。請只在主機的密鑰設定頁輸入，勿提交到 GitHub。

本機 production 模式可先執行 `npm run build`，再執行 `npm start`；預設使用 `PORT`，未設定時使用 `8788`。

## 專案結構

```text
src/
  app/                 應用外殼、導覽與主題
  components/          共用圖示、狀態徽章及頁面標題
  config/              導覽、產品與地圖設定
  data/                Demo 事件、測速點及班次備援資料
  features/
    map/               Leaflet 地圖、動態聚合圖層、搜尋與詳情
    events/            道路事件篩選、已排除過濾與資料狀態
    transit/           高鐵/台鐵/捷運/公車/航班資訊（TDX 代理 + Demo 預覽切換）
    routes/             跨運具搜尋與 Demo 比較
    settings/           外觀、地圖、通知與資料來源揭露
  hooks/               本機偏好持久化
  services/            交通資料服務邊界（道路事件、測速、TDX 運輸與 Demo adapter）
  types/               共用資料型別與可信度模型
server/
  api.mjs              警廣即時路況 (15221)、警政署測速 (7320+13940) 與 TDX OAuth2 伺服器端代理
  csv.mjs              CSV/ZIP 解析、測速去重整併與警廣路況正規化
```

## 可操作功能

- **交通地圖**：Leaflet 地圖可平移、縮放，顯示警廣事件與官方測速設置點（7320+13940 去重整併）。道路事件來源不可用時顯示錯誤與 Demo 替代入口；不把空資料當成零事件。測速資料依縮放層級聚合，並支援搜尋地標、事件和測速路段，以及前景單次定位。
- **道路交通**：依事件類型（事故、施工、封路/管制、壅塞）、嚴重程度、關鍵字及「是否包含已排除／近期歷史事件」篩選；可切換官方即時資料或 Demo 示範資料，並支援「在地圖查看」跳轉聚焦。
- **大眾運輸**：高鐵、台鐵、捷運、公車、航班入口；未設定 TDX 金鑰時明確標示 `尚未設定憑證` 並提供「預覽 Demo 示意班次」開關，設定金鑰後自動透過伺服器端 OAuth2 代理拉取真實班次。
- **跨運具搜尋**：輸入起訖點和出發時間比較方案。設定 TDX 憑證且查到資料時才顯示高鐵／台鐵實際班次；自駕使用 OSRM 道路路徑估時，不代表即時塞車時間；捷運、公車與航班目前提供外部查詢入口，尚未計算真實轉乘。TDX 不可用時 Demo 預覽需由使用者明確勾選。
- **設定**：淺色/深色主題保存在本機；顯示目前前景定位狀態與官方資料來源授權連結。

## 工程檢查

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

## 已完成與尚未完成

**已完成**：多頁前端骨架、響應式導覽與主題、Leaflet 底圖、官方測速清冊去重整併、道路事件代理及資料失效狀態、TDX OAuth2 伺服器端代理、班次與路線可信度標示、Demo 預覽明確開關及外部地圖查詢入口。

**尚未完成**：修復 Render 到警廣來源的連線、設定正式環境 TDX 金鑰、擴大站點/地點支援、真正的捷運／公車／航班起訖路線與跨運具轉乘計算、收藏功能、背景提醒及測速接近提醒安全規則。

## 專案設計依據

- `AGENTS.md`、`DESIGN_SYSTEM.md`、`UI_UX_SPEC.md`、`PROJECT_PLAN.md`：Island Pulse 方向與跨裝置設計/階段規範。
- `REFERENCE_PROJECTS.md`：鐵道參考專案研究與 License 限制。
- `DATA_SOURCES.md`：政府開放資料（7320、13940、15221）與 TDX 比對、授權/時效及伺服器端接入契約。
