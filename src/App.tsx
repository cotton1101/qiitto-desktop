import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { Home, Sparkles, FileText, Globe, Settings as SettingsIcon } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import DraftEditor from "./pages/DraftEditor";
import Drafts from "./pages/Drafts";
import Generate from "./pages/Generate";
import Published from "./pages/Published";
import Settings from "./pages/Settings";

const NAV = [
  { to: "/", icon: Home, label: "ダッシュボード" },
  { to: "/generate", icon: Sparkles, label: "新規生成" },
  { to: "/drafts", icon: FileText, label: "下書き" },
  { to: "/published", icon: Globe, label: "公開済み" },
  { to: "/settings", icon: SettingsIcon, label: "設定" },
] as const;

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
        <div className="px-4 py-5 border-b border-gray-100">
          <div className="text-xl font-bold text-qiitto-600">qiitto</div>
          <div className="text-xs text-gray-500">desktop · Cotton-Web</div>
        </div>
        <nav className="p-2 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 rounded px-3 py-2 text-sm transition",
                  isActive
                    ? "bg-qiitto-50 text-qiitto-700 font-medium"
                    : "text-gray-700 hover:bg-gray-100",
                ].join(" ")
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/generate" element={<Generate />} />
          <Route path="/drafts" element={<Drafts />} />
          <Route path="/drafts/:id" element={<DraftEditor />} />
          <Route path="/published" element={<Published />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
