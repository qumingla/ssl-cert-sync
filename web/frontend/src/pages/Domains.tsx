import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Domain, DnsChannel } from "../types/api";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Label } from "../components/ui/label";
import { CheckSquare, MoreHorizontal, Plus, RefreshCw, UploadCloud, Trash, Play, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { format } from "date-fns";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useI18n } from "../components/LocaleProvider";

type FormValues = {
  id?: string;
  domain: string;
  dnsChannelId: string;
  enabled: boolean;
};

export function Domains() {
  const queryClient = useQueryClient();
  const { t, formatRelative, statusLabel, jobTypeLabel } = useI18n();
  const formSchema = useMemo(() => z.object({
    id: z.string().optional(),
    domain: z.string()
      .min(1, t("validation.domainRequired"))
      .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, t("validation.invalidDomain")),
    dnsChannelId: z.string().min(1, t("validation.dnsChannelRequired")),
    enabled: z.boolean(),
  }), [t]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const { data: domains = [], isLoading } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: () => api.get<Domain[]>('/admin/domains'),
  });

  const { data: channels = [] } = useQuery<DnsChannel[]>({
    queryKey: ['dns-channels'],
    queryFn: () => api.get<DnsChannel[]>('/admin/dns-channels'),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { domain: "", dnsChannelId: "", enabled: true },
  });

  const saveMutation = useMutation({
    mutationFn: (data: FormValues) => {
      if (data.id) return api.patch(`/admin/domains/${data.id}`, data);
      return api.post('/admin/domains', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setIsAddOpen(false);
      form.reset({ domain: "", dnsChannelId: "", enabled: true });
      toast.success(t("domains.saved"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("domains.saveFailed"))
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string, enabled: boolean }) => api.patch(`/admin/domains/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      toast.success(t("domains.statusUpdated"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("domains.updateFailed"))
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setDeleteId(null);
      toast.success(t("domains.deleted"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("domains.deleteFailed"))
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string, action: 'issue' | 'renew' | 'sync' }) => api.post(`/admin/domains/${id}/${action}`),
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(t("domains.startedAction", { action: jobTypeLabel(action) }));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("domains.actionFailed"))
  });

  const bulkActionMutation = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: 'issue' | 'renew' | 'sync' | 'enable' | 'disable' | 'delete' }) => {
      if (action === 'issue' || action === 'renew' || action === 'sync') {
        await api.post('/admin/domains/bulk-action', { ids, action });
        return;
      }
      for (const id of ids) {
        if (action === 'enable' || action === 'disable') {
          await api.patch(`/admin/domains/${id}`, { enabled: action === 'enable' });
          continue;
        }
        if (action === 'delete') {
          await api.delete(`/admin/domains/${id}`);
          continue;
        }
        await api.post(`/admin/domains/${id}/${action}`);
      }
    },
    onSuccess: (_, { action, ids }) => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setSelectedIds([]);
      setBulkDeleteOpen(false);
      if (action === 'enable' || action === 'disable') {
        toast.success(t("domains.bulkStatusUpdated", { count: ids.length }));
      } else if (action === 'delete') {
        toast.success(t("domains.bulkDeleted", { count: ids.length }));
      } else {
        toast.success(t("domains.bulkStartedAction", { count: ids.length, action: jobTypeLabel(action) }));
      }
    },
    onError: (err: unknown, { action }) => {
      if (action === 'delete') {
        toast.error((err as Error).message || t("domains.bulkDeleteFailed"));
      } else {
        toast.error((err as Error).message || t("domains.bulkActionFailed"));
      }
    }
  });

  const filteredDomains = useMemo(() => {
    return domains.filter((domain) => {
      const matchesStatus = (() => {
        if (statusFilter === "all") return true;
        if (statusFilter === "healthy") return domain.enabled && domain.status === "active";
        if (statusFilter === "attention") return !domain.enabled || domain.status !== "active";
        if (statusFilter === "disabled") return !domain.enabled;
        return domain.enabled && domain.status === statusFilter;
      })();

      const matchesChannel = channelFilter === "all" || domain.dnsChannelId === channelFilter;
      const matchesSearch = searchTerm.trim() === ""
        || domain.domain.toLowerCase().includes(searchTerm.trim().toLowerCase());
      return matchesStatus && matchesChannel && matchesSearch;
    });
  }, [channelFilter, domains, searchTerm, statusFilter]);

  const effectiveSelectedIds = useMemo(
    () => selectedIds.filter((id) => filteredDomains.some((domain) => domain.id === id)),
    [filteredDomains, selectedIds]
  );

  useEffect(() => {
    if (!selectAllRef.current) {
      return;
    }
    const total = filteredDomains.length;
    const selected = effectiveSelectedIds.length;
    selectAllRef.current.indeterminate = selected > 0 && selected < total;
  }, [filteredDomains.length, effectiveSelectedIds]);

  const onSubmit = (values: FormValues) => {
    saveMutation.mutate(values);
  };

  const openEdit = (d: Domain) => {
    form.reset({
      id: d.id,
      domain: d.domain,
      dnsChannelId: d.dnsChannelId,
      enabled: d.enabled
    });
    setIsAddOpen(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("domains.shaCopied"));
  };

  const isAllSelected = filteredDomains.length > 0 && effectiveSelectedIds.length === filteredDomains.length;
  const hasSelection = effectiveSelectedIds.length > 0;

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(isAllSelected ? [] : filteredDomains.map((domain) => domain.id));
  };

  const runBulkAction = (action: 'issue' | 'renew' | 'sync' | 'enable' | 'disable') => {
    if (!effectiveSelectedIds.length) {
      return;
    }
    bulkActionMutation.mutate({ ids: effectiveSelectedIds, action });
  };

  const renderSha = (sha: string | null) => {
    if (!sha) return <span className="text-muted-foreground">-</span>;
    return (
      <Tooltip>
        <TooltipTrigger>
          <span className="font-mono text-xs cursor-pointer hover:underline text-muted-foreground" onClick={() => copyToClipboard(sha)}>
            {sha.substring(0, 12)}...
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-mono text-xs">{sha}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="p-4 sm:p-6 w-full max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("domains.title")}</h1>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button className="w-full sm:w-auto" variant="outline" disabled={!hasSelection || bulkActionMutation.isPending}>
                <CheckSquare className="mr-2 h-4 w-4" />
                {t("domains.bulkActions")}
                {hasSelection ? ` (${effectiveSelectedIds.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => runBulkAction('issue')}>
                <Play className="mr-2 h-4 w-4" /> {t("domains.bulkIssue")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runBulkAction('renew')}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t("domains.bulkRenew")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runBulkAction('sync')}>
                <UploadCloud className="mr-2 h-4 w-4" /> {t("domains.bulkSync")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runBulkAction('enable')}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t("domains.bulkEnable")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runBulkAction('disable')}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t("domains.bulkDisable")}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setBulkDeleteOpen(true)}>
                <Trash className="mr-2 h-4 w-4" /> {t("domains.bulkDelete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="w-full sm:w-auto" onClick={() => { form.reset({ id: undefined, domain: "", dnsChannelId: "", enabled: true }); setIsAddOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> {t("domains.add")}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-3 lg:grid-cols-3 sm:gap-4">
          <div className="grid gap-2">
            <Label htmlFor="domain-search">{t("domains.searchLabel")}</Label>
            <Input
              id="domain-search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("domains.searchPlaceholder")}
              className="w-full sm:w-[240px]"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="domain-status-filter">{t("domains.statusFilter")}</Label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "all")}>
              <SelectTrigger id="domain-status-filter" className="w-full sm:w-[220px]">
                <SelectValue placeholder={t("domains.filterAllStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("domains.filterAllStatuses")}</SelectItem>
                <SelectItem value="healthy">{t("domains.filterHealthy")}</SelectItem>
                <SelectItem value="attention">{t("domains.filterAttention")}</SelectItem>
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="expiring">{t("status.expiring")}</SelectItem>
                <SelectItem value="pending">{t("status.pending")}</SelectItem>
                <SelectItem value="error">{t("status.error")}</SelectItem>
                <SelectItem value="disabled">{t("common.disabled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="domain-channel-filter">{t("domains.channelFilter")}</Label>
            <Select value={channelFilter} onValueChange={(value) => setChannelFilter(value ?? "all")}>
              <SelectTrigger id="domain-channel-filter" className="w-full sm:w-[240px]">
                <SelectValue placeholder={t("domains.filterAllChannels")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("domains.filterAllChannels")}</SelectItem>
                {channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("domains.filteredCount", { filtered: filteredDomains.length, total: domains.length })}
        </p>
      </div>

      {hasSelection ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {t("domains.selectedCount", { count: effectiveSelectedIds.length })}
          </p>
          <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => setSelectedIds([])}>
            {t("domains.clearSelection")}
          </Button>
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[44px]">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label={t("domains.selectAll")}
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    disabled={filteredDomains.length === 0}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </TableHead>
                <TableHead>{t("table.domain")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead>{t("table.dnsChannel")}</TableHead>
                <TableHead>SHA256</TableHead>
                <TableHead>{t("domains.expiresRemaining")}</TableHead>
                <TableHead>{t("domains.lastIssue")}</TableHead>
                <TableHead>{t("domains.lastSync")}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8">{t("common.loading")}</TableCell></TableRow>
              ) : filteredDomains.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">{domains.length === 0 ? t("domains.empty") : t("domains.noFilteredResults")}</TableCell></TableRow>
              ) : (
                filteredDomains.map((d) => (
                  <TableRow key={d.id} className={!d.enabled ? "opacity-50 grayscale" : ""}>
                    <TableCell>
                        <input
                          type="checkbox"
                          aria-label={t("domains.selectOne", { domain: d.domain })}
                          checked={effectiveSelectedIds.includes(d.id)}
                          onChange={() => toggleSelected(d.id)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                    </TableCell>
                    <TableCell className="font-medium">{d.domain}</TableCell>
                    <TableCell>
                      {!d.enabled ? <Badge variant="outline">{t("common.disabled")}</Badge> : (
                        <Badge variant={d.status === 'active' ? 'default' : d.status === 'expiring' ? 'secondary' : d.status === 'error' ? 'destructive' : 'outline'}>
                          {statusLabel(d.status)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {channels.find(c => c.id === d.dnsChannelId)?.name || d.dnsChannelId}
                    </TableCell>
                    <TableCell>
                      {renderSha(d.certSha256)}
                    </TableCell>
                    <TableCell>
                      {d.expiresAt ? (
                        <div className="text-sm">
                          <div>{format(new Date(d.expiresAt), 'yyyy-MM-dd')}</div>
                          {d.daysRemaining !== null && (
                            <div className={d.daysRemaining <= 7 ? "text-destructive font-medium text-xs" : "text-muted-foreground text-xs"}>
                              {t("common.daysLeft", { days: d.daysRemaining })}
                            </div>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.lastIssuedAt ? formatRelative(d.lastIssuedAt) : t("common.never")}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.lastSyncAt ? formatRelative(d.lastSyncAt) : t("common.never")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">{t("common.edit")}</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'issue' })}>
                            <Play className="mr-2 h-4 w-4" /> {t("domains.issue")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'renew' })}>
                            <RefreshCw className="mr-2 h-4 w-4" /> {t("domains.renew")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'sync' })}>
                            <UploadCloud className="mr-2 h-4 w-4" /> {t("domains.sync")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(d)}>
                            <Pencil className="mr-2 h-4 w-4" /> {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: d.id, enabled: !d.enabled })}>
                            <RefreshCw className="mr-2 h-4 w-4" /> {d.enabled ? t("domains.disable") : t("domains.enable")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(d.id)}>
                            <Trash className="mr-2 h-4 w-4" /> {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>{form.getValues('id') ? t("domains.editTitle") : t("domains.addTitle")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="domain">{t("domains.domainName")}</Label>
                <Input id="domain" placeholder={t("domains.domainPlaceholder")} {...form.register('domain')} />
                {form.formState.errors.domain && <p className="text-sm text-destructive">{form.formState.errors.domain.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dnsChannelId">{t("table.dnsChannel")}</Label>
                <Select onValueChange={(val) => val && form.setValue('dnsChannelId', val)} defaultValue={form.getValues('dnsChannelId')}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("domains.selectDns")} />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.provider})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.dnsChannelId && <p className="text-sm text-destructive">{form.formState.errors.dnsChannelId.message}</p>}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input type="checkbox" id="enabled" {...form.register('enabled')} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
                <Label htmlFor="enabled">{t("domains.enableAuto")}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("domains.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("domains.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? t("common.deleting") : t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={(open) => !open && !bulkActionMutation.isPending && setBulkDeleteOpen(false)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("domains.bulkDeleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("domains.bulkDeleteDescription", { count: effectiveSelectedIds.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={bulkActionMutation.isPending}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={() => bulkActionMutation.mutate({ ids: effectiveSelectedIds, action: 'delete' })} disabled={bulkActionMutation.isPending || !hasSelection}>
                {bulkActionMutation.isPending ? t("common.deleting") : t("domains.bulkDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
