import { Outlet, Navigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAuth } from "../AuthProvider";

export function Layout() {
  const { token } = useAuth();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 w-full">
        <Topbar />
        <main className="flex-1 overflow-auto bg-muted/30 w-full max-w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
