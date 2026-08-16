import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import CheckIn from "./pages/CheckIn";
import Login from "./pages/teacher/Login";
import Dashboard from "./pages/teacher/Dashboard";
import Timetable from "./pages/teacher/Timetable";
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

export default function App() {
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
