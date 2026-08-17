import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { supabase, MISSING_ENV } from "./lib/supabase";
import CheckIn from "./pages/CheckIn";
import Login from "./pages/teacher/Login";
import Dashboard from "./pages/teacher/Dashboard";
import Timetable from "./pages/teacher/Timetable";
import Classes from "./pages/teacher/Classes";
import Locations from "./pages/teacher/Locations";
import Tag from "./pages/teacher/Tag";

function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, ready };
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, ready } = useSession();
  const loc = useLocation();
  if (!ready) return null;
  if (!session) return <Navigate to="/login" state={{ from: loc }} replace />;
  return children;
}

// Shown instead of the app when the deploy is missing its Supabase config.
// Without this the first Supabase call throws at import time and every page —
// including the student check-in — renders as a blank white screen.
function SetupNeeded() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 font-body">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 p-8">
        <h1 className="font-display text-xl font-bold text-navy">
          Setup needed
        </h1>
        <p className="text-slate-600 text-sm mt-2">
          This deployment is missing its environment variables, so it can't
          reach Supabase. Add these and redeploy:
        </p>
        <ul className="mt-4 space-y-1.5">
          {MISSING_ENV.map((name) => (
            <li
              key={name}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 break-all"
            >
              {name}
            </li>
          ))}
        </ul>
        <p className="text-slate-500 text-xs mt-4 leading-relaxed">
          Set them in your Vercel project settings (or in a local{" "}
          <code>.env.local</code> — see <code>.env.example</code>). The README's
          setup section lists where each value comes from.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  if (MISSING_ENV.length) return <SetupNeeded />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Public: student check-in */}
        <Route path="/t/:tagCode" element={<CheckIn />} />

        {/* Teacher */}
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/timetable"
          element={
            <RequireAuth>
              <Timetable />
            </RequireAuth>
          }
        />
        <Route
          path="/classes"
          element={
            <RequireAuth>
              <Classes />
            </RequireAuth>
          }
        />
        <Route
          path="/locations"
          element={
            <RequireAuth>
              <Locations />
            </RequireAuth>
          }
        />
        <Route
          path="/tag"
          element={
            <RequireAuth>
              <Tag />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
