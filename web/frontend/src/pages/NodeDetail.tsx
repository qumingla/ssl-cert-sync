import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { api } from "../lib/api";
import type { NodeDetailResponse, Domain } from "../types/api";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { ArrowLeft, Play, Pencil, Activity } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useForm } from "react-hook-form";
import { useI18n } from "../components/LocaleProvider";

export function NodeDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { t, formatRelative, statusLabel } = useI18n();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const { data: node, isLoading } = useQuery<NodeDetailResponse>({
    queryKey: ['nodes', id],
    queryFn: () => api.get<NodeDetailResponse>(`/admin/nodes/${id}`),
    enabled: !!id,
  });

  const { data: domains = [] } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: () => api.get<Domain[]>('/admin/domains'),
  });

  const runNowMutation = useMutation({
    mutationFn: () => api.post(`/admin/nodes/${id}/run-now`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast.success(t("nodeDetail.startedJob"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("nodeDetail.runFailed"))
  });

  const assignmentMutation = useMutation({
    mutationFn: (domainIds: string[]) => api.put(`/admin/nodes/${id}/assignments`, { domainIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes', id] });
      setIsEditOpen(false);
      toast.success(t("nodeDetail.assignmentsUpdated"));
    },
    onError: (err: unknown) => toast.error((err as Error).message || t("nodeDetail.assignmentsFailed"))
  });

  const form = useForm<{ domainIds: string[] }>({
    defaultValues: { domainIds: [] }
  });

  const openEdit = () => {
    form.reset({
      domainIds: node?.assignments.map(a => a.domainId) || []
    });
    setIsEditOpen(true);
  };

  const onSubmit = (values: { domainIds: string[] }) => {
    assignmentMutation.mutate(values.domainIds);
  };

  if (isLoading) return <div className="p-8">{t("nodeDetail.loading")}</div>;
  if (!node) return <div className="p-8 text-destructive">{t("nodeDetail.notFound")}</div>;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t("domains.shaCopied"));
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
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{node.name}</h1>
          <p className="text-muted-foreground text-sm font-mono">{node.ip}</p>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <Badge variant={node.isOnline ? 'default' : 'destructive'} className="text-sm px-3 py-1">
            {node.isOnline ? t("status.online") : t("status.offline")}
          </Badge>
          <Button className="w-full sm:w-auto" onClick={() => runNowMutation.mutate()} disabled={runNowMutation.isPending || !node.isOnline}>
            <Play className="mr-2 h-4 w-4" /> {t("nodeDetail.runNow")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("nodeDetail.basicInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground mb-1">{t("nodeDetail.targetDirectory")}</p>
                <p className="font-mono">{node.certDir}</p>
              </div>
              <div>
                <p className="text-muted-foreground mb-1">{t("table.lastHeartbeat")}</p>
                <p>{node.lastHeartbeatAt ? formatRelative(node.lastHeartbeatAt) : t("common.never")}</p>
              </div>
              <div className="col-span-2">
                <p className="text-muted-foreground mb-1">{t("nodeDetail.latestError")}</p>
                {node.lastError ? (
                  <p className="text-destructive bg-destructive/10 p-2 rounded text-xs font-mono">{node.lastError}</p>
                ) : (
                  <p className="text-muted-foreground">{t("common.none")}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> {t("nodeDetail.recentEvents")}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[200px] overflow-y-auto">
            {node.recentEvents?.length > 0 ? (
              <div className="space-y-4">
                {node.recentEvents.map(e => (
                  <div key={e.id} className="text-sm border-l-2 border-border pl-4 pb-2">
                    <p className="font-medium">{e.message}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(e.createdAt), 'MMM dd, HH:mm:ss')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("nodeDetail.noRecentEvents")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <CardTitle>{t("nodeDetail.assignedDomains")}</CardTitle>
            <CardDescription>{t("nodeDetail.assignedDescription")}</CardDescription>
          </div>
          <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={openEdit}>
            <Pencil className="mr-2 h-4 w-4" /> {t("nodeDetail.editAssignments")}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.domain")}</TableHead>
                <TableHead>{t("nodeDetail.desiredSha")}</TableHead>
                <TableHead>{t("nodeDetail.deployedSha")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead>{t("nodeDetail.lastDeploy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {node.assignments?.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("nodeDetail.noAssignments")}</TableCell></TableRow>
              ) : (
                node.assignments?.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.domainName || a.domainId}</TableCell>
                    <TableCell>{renderSha(a.desiredSha256)}</TableCell>
                    <TableCell>{renderSha(a.deployedSha256)}</TableCell>
                    <TableCell>
                      <Badge variant={a.status === 'synced' ? 'default' : a.status === 'pending' ? 'secondary' : 'destructive'}>
                        {statusLabel(a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {a.lastDeployAt ? formatRelative(a.lastDeployAt) : t("common.never")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>{t("nodeDetail.editAssignments")}</DialogTitle>
              <DialogDescription>{t("nodeDetail.selectDomains", { node: node.name })}</DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4 max-h-[300px] overflow-y-auto">
              {domains.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("nodeDetail.noAvailableDomains")}</p>
              ) : (
                domains.map(d => (
                  <div key={d.id} className="flex items-center space-x-3">
                    <input 
                      type="checkbox" 
                      id={`domain-${d.id}`} 
                      value={d.id}
                      {...form.register('domainIds')}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label htmlFor={`domain-${d.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                      {d.domain}
                    </label>
                  </div>
                ))
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={assignmentMutation.isPending}>
                {assignmentMutation.isPending ? t("common.saving") : t("nodeDetail.saveAssignments")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
