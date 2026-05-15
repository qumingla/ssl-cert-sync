import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Settings as SettingsType } from "../types/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { Save, Bell, HardDrive, Terminal } from "lucide-react";

export function Settings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<SettingsType>({
    queryKey: ['settings'],
    queryFn: () => api.get('/admin/settings'),
  });

  const form = useForm<SettingsType>({
    defaultValues: {
      webdav: { url: '', auth: '' },
      telegram: { botToken: '', chatId: '' },
      acme: { acmeHome: '', stagingBase: '/tmp/acme_staging', defaultRenewDays: 30 }
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset(settings);
    }
  }, [settings, form]);

  const updateMutation = useMutation({
    mutationFn: (data: SettingsType) => api.patch('/admin/settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success("Settings saved");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to save settings")
  });

  const testWebDavMutation = useMutation({
    mutationFn: () => api.post('/admin/settings/webdav/test'),
    onSuccess: () => toast.success("WebDAV Connection OK"),
    onError: (err: unknown) => toast.error(`WebDAV Test Failed: ${(err as Error).message}`)
  });

  const testTgMutation = useMutation({
    mutationFn: () => api.post('/admin/settings/telegram/test'),
    onSuccess: () => toast.success("Telegram message sent"),
    onError: (err: unknown) => toast.error(`Telegram Test Failed: ${(err as Error).message}`)
  });

  const onSubmit = (values: SettingsType) => {
    updateMutation.mutate(values);
  };

  if (isLoading) return <div className="p-8">Loading settings...</div>;

  return (
    <div className="p-4 sm:p-6 w-full max-w-4xl max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">System Settings</h1>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" /> WebDAV Storage</CardTitle>
            <CardDescription>Configure central storage for synchronized certificates.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="webdav.url">WebDAV URL</Label>
              <Input id="webdav.url" placeholder="https://dav.example.com/certs" {...form.register('webdav.url')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="webdav.auth">Basic Auth (user:pass)</Label>
              <Input id="webdav.auth" type="password" placeholder="admin:password123" {...form.register('webdav.auth')} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <Button className="w-full sm:w-auto" variant="outline" type="button" onClick={() => testWebDavMutation.mutate()} disabled={testWebDavMutation.isPending}>
              {testWebDavMutation.isPending ? "Testing..." : "Test Connection"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Telegram Notifications</CardTitle>
            <CardDescription>Receive alerts for deployment failures or expirations.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="telegram.botToken">Bot Token</Label>
              <Input id="telegram.botToken" type="password" placeholder="123456789:ABCDefgh..." {...form.register('telegram.botToken')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telegram.chatId">Chat ID</Label>
              <Input id="telegram.chatId" placeholder="-10012345678" {...form.register('telegram.chatId')} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <Button className="w-full sm:w-auto" variant="outline" type="button" onClick={() => testTgMutation.mutate()} disabled={testTgMutation.isPending}>
              {testTgMutation.isPending ? "Testing..." : "Test Notification"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Terminal className="h-5 w-5" /> ACME Settings</CardTitle>
            <CardDescription>Configuration for the internal acme.sh process.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="acme.acmeHome">acme.sh Home Path</Label>
              <Input id="acme.acmeHome" placeholder="/root/.acme.sh" {...form.register('acme.acmeHome')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acme.defaultRenewDays">Default Renew Threshold (Days)</Label>
              <Input id="acme.defaultRenewDays" type="number" {...form.register('acme.defaultRenewDays', { valueAsNumber: true })} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-10">
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={() => form.reset(settings)}>Discard</Button>
          <Button className="w-full sm:w-auto" type="submit" disabled={updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" /> {updateMutation.isPending ? 'Saving...' : 'Save All Settings'}
          </Button>
        </div>
      </form>
    </div>
  );
}
