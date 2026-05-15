import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { MoreHorizontal, Plus, RefreshCw, UploadCloud, Trash, Play, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

const formSchema = z.object({
  id: z.string().optional(),
  domain: z.string().min(3).regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid domain format (do not include protocol)"),
  dnsChannelId: z.string().min(1, "DNS Channel is required"),
  enabled: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export function Domains() {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
      toast.success("Domain saved successfully");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to save domain")
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string, enabled: boolean }) => api.patch(`/admin/domains/${id}`, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      toast.success("Domain status updated");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to update domain")
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/domains/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setDeleteId(null);
      toast.success("Domain deleted");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to delete domain")
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string, action: 'issue' | 'renew' | 'sync' }) => api.post(`/admin/domains/${id}/${action}`),
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(`Started ${action} job`);
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Action failed")
  });

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
    toast.success("Copied SHA256");
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
        <h1 className="text-2xl font-bold tracking-tight">Domains</h1>
        <Button className="w-full sm:w-auto" onClick={() => { form.reset({ id: undefined, domain: "", dnsChannelId: "", enabled: true }); setIsAddOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Domain
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>DNS Channel</TableHead>
                <TableHead>SHA256</TableHead>
                <TableHead>Expires / Remaining</TableHead>
                <TableHead>Last Issue</TableHead>
                <TableHead>Last Sync</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : domains.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No domains found. Add one to get started.</TableCell></TableRow>
              ) : (
                domains.map((d) => (
                  <TableRow key={d.id} className={!d.enabled ? "opacity-50 grayscale" : ""}>
                    <TableCell className="font-medium">{d.domain}</TableCell>
                    <TableCell>
                      {!d.enabled ? <Badge variant="outline">Disabled</Badge> : (
                        <Badge variant={d.status === 'active' ? 'default' : d.status === 'expiring' ? 'secondary' : d.status === 'error' ? 'destructive' : 'outline'}>
                          {d.status}
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
                              {d.daysRemaining} days left
                            </div>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.lastIssuedAt ? formatDistanceToNow(new Date(d.lastIssuedAt), { addSuffix: true }) : 'Never'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.lastSyncAt ? formatDistanceToNow(new Date(d.lastSyncAt), { addSuffix: true }) : 'Never'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'issue' })}>
                            <Play className="mr-2 h-4 w-4" /> Issue Cert
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'renew' })}>
                            <RefreshCw className="mr-2 h-4 w-4" /> Renew Cert
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => actionMutation.mutate({ id: d.id, action: 'sync' })}>
                            <UploadCloud className="mr-2 h-4 w-4" /> Sync to Nodes
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(d)}>
                            <Pencil className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: d.id, enabled: !d.enabled })}>
                            <RefreshCw className="mr-2 h-4 w-4" /> {d.enabled ? 'Disable' : 'Enable'}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteId(d.id)}>
                            <Trash className="mr-2 h-4 w-4" /> Delete
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
              <DialogTitle>{form.getValues('id') ? 'Edit Domain' : 'Add Domain'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="domain">Domain Name</Label>
                <Input id="domain" placeholder="example.com" {...form.register('domain')} />
                {form.formState.errors.domain && <p className="text-sm text-destructive">{form.formState.errors.domain.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dnsChannelId">DNS Channel</Label>
                <Select onValueChange={(val) => val && form.setValue('dnsChannelId', val)} defaultValue={form.getValues('dnsChannelId')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select DNS provider channel" />
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
                <Label htmlFor="enabled">Enable Automatic Renew & Sync</Label>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Are you absolutely sure?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the domain configuration.
              Certificates on nodes will not be deleted but will no longer be synced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
