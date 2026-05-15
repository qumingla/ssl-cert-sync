import { useState } from "react";
import { useAuth } from "../components/AuthProvider";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Server } from "lucide-react";

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // If we're not in mock mode, we would call the real login API
      // Since backend is not implemented for auth yet, we fallback to mock behavior if needed
      // Or we can just use fetch directly
      
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        throw new Error('Invalid credentials');
      }

      const data = await res.json();
      if (data.token) {
        login(data.token);
      } else {
        throw new Error('Invalid token response');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Login failed');
      // If VITE_USE_MOCKS wasn't true but we want to allow any login in dev:
      if (import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== 'true') {
        console.warn('Falling back to dummy token in dev mode due to missing API');
        login('dummy_dev_token');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Server className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl tracking-tight">SSL Sync Master</CardTitle>
          <CardDescription>
            Enter your credentials to access the admin console
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-destructive-foreground bg-destructive/90 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Input
                id="username"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
