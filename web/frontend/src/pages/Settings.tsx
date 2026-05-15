import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Settings as SettingsType } from "../types/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { Save, Bell, HardDrive, Terminal, Languages } from "lucide-react";
import { type Language, useI18n } from "../components/LocaleProvider";

export function Settings() {
  const queryClient = useQueryClient();
  const { language, setLanguage, t } = useI18n();

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
      toast.success(t("settings.saved"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("settings.saveFailed"))
  });

  const testWebDavMutation = useMutation({
    mutationFn: (payload: SettingsType["webdav"]) => api.post('/admin/settings/webdav/test', payload),
    onSuccess: () => toast.success(t("settings.webdavOk")),
    onError: (err: unknown) => toast.error(t("settings.webdavFailed", { message: (err as Error).message }))
  });

  const testTgMutation = useMutation({
    mutationFn: (payload: SettingsType["telegram"]) => api.post('/admin/settings/telegram/test', payload),
    onSuccess: () => toast.success(t("settings.telegramOk")),
    onError: (err: unknown) => toast.error(t("settings.telegramFailed", { message: (err as Error).message }))
  });

  const onSubmit = (values: SettingsType) => {
    updateMutation.mutate(values);
  };

  if (isLoading) return <div className="p-8">{t("common.loading")}</div>;

  return (
    <div className="p-4 sm:p-6 w-full max-w-4xl overflow-x-hidden space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Languages className="h-5 w-5" /> {t("settings.interface")}</CardTitle>
          <CardDescription>{t("settings.interfaceDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <Label htmlFor="language">{t("settings.language")}</Label>
          <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
            <SelectTrigger id="language" className="w-full sm:w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{t("language.zh")}</SelectItem>
              <SelectItem value="en-US">{t("language.en")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">{t("settings.languageDescription")}</p>
        </CardContent>
      </Card>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" /> {t("settings.webdav")}</CardTitle>
            <CardDescription>{t("settings.webdavDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="webdav.url">{t("settings.webdavUrl")}</Label>
              <Input id="webdav.url" placeholder="https://dav.example.com/certs" {...form.register('webdav.url')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="webdav.auth">{t("settings.webdavAuth")}</Label>
              <Input id="webdav.auth" type="password" placeholder="admin:password123" {...form.register('webdav.auth')} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <Button className="w-full sm:w-auto" variant="outline" type="button" onClick={() => testWebDavMutation.mutate(form.getValues("webdav"))} disabled={testWebDavMutation.isPending}>
              {testWebDavMutation.isPending ? t("common.testing") : t("settings.testConnection")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> {t("settings.telegram")}</CardTitle>
            <CardDescription>{t("settings.telegramDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="telegram.botToken">{t("settings.botToken")}</Label>
              <Input id="telegram.botToken" type="password" placeholder="123456789:ABCDefgh..." {...form.register('telegram.botToken')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telegram.chatId">{t("settings.chatId")}</Label>
              <Input id="telegram.chatId" placeholder="-10012345678" {...form.register('telegram.chatId')} />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <Button className="w-full sm:w-auto" variant="outline" type="button" onClick={() => testTgMutation.mutate(form.getValues("telegram"))} disabled={testTgMutation.isPending}>
              {testTgMutation.isPending ? t("common.testing") : t("settings.testNotification")}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Terminal className="h-5 w-5" /> {t("settings.acme")}</CardTitle>
            <CardDescription>{t("settings.acmeDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="acme.acmeHome">{t("settings.acmeHome")}</Label>
              <Input id="acme.acmeHome" placeholder="/root/.acme.sh" {...form.register('acme.acmeHome')} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="acme.defaultRenewDays">{t("settings.renewDays")}</Label>
              <Input id="acme.defaultRenewDays" type="number" {...form.register('acme.defaultRenewDays', { valueAsNumber: true })} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-10">
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={() => form.reset(settings)}>{t("settings.discard")}</Button>
          <Button className="w-full sm:w-auto" type="submit" disabled={updateMutation.isPending}>
            <Save className="mr-2 h-4 w-4" /> {updateMutation.isPending ? t("common.saving") : t("settings.saveAll")}
          </Button>
        </div>
      </form>
    </div>
  );
}
