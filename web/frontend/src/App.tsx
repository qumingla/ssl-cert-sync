import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider } from "./components/AuthProvider";
import { Layout } from "./components/layout/Layout";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";

// Pages
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Domains } from "./pages/Domains";
import { Nodes } from "./pages/Nodes";
import { NodeDetail } from "./pages/NodeDetail";
import { DnsChannels } from "./pages/DnsChannels";
import { Jobs } from "./pages/Jobs";
import { Settings } from "./pages/Settings";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="ssl-sync-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/domains" element={<Domains />} />
                  <Route path="/nodes" element={<Nodes />} />
                  <Route path="/nodes/:id" element={<NodeDetail />} />
                  <Route path="/dns-channels" element={<DnsChannels />} />
                  <Route path="/jobs" element={<Jobs />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </AuthProvider>
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
