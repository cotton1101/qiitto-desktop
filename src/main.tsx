import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";

// Tauri は file:// プロトコル上で動くので HashRouter を使う（BrowserRouter だと深いリンクで壊れる）
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster position="bottom-right" toastOptions={{ duration: 3000 }} />
    </HashRouter>
  </React.StrictMode>,
);
