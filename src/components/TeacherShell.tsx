import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/dashboard", label: "Attendance" },
  { to: "/timetable", label: "Timetable" },
  { to: "/locations", label: "Locations" },
  { to: "/tag", label: "My tag" },
];

export default function TeacherShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    nav("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-body">
      <header className="bg-navy text-white">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-20">
          <div className="flex items-center gap-3">
            <img
              src="/aupp-logo-cropped.png"
              alt="AUPP"
              className="w-[60px] h-[60px] bg-white rounded-lg p-0.5"
            />
            <span className="font-display font-semibold leading-tight">
              Attendance
              <span className="block text-[11px] font-body font-normal text-white/60">
                American University of Phnom Penh
              </span>
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  loc.pathname === n.to
                    ? "bg-white text-navy"
                    : "text-white/75 hover:bg-white/10"
                }`}
              >
                {n.label}
              </Link>
            ))}
            <button
              onClick={signOut}
              className="ml-2 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:bg-white/10"
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
