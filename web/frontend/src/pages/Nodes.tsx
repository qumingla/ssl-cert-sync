import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { CertNode } from "../types/api";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Plus, Server, Trash, Copy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useForm } from "react-hook-form";

export function Nodes() {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newNodeToken, setNewNodeToken] = useState<string | null>(null);

  const { data: nodes = [], isLoading } = useQuery<CertNode[]>({
    queryKey: ['nodes'],
    queryFn: () => api.get('/admin/nodes'),
  });

  const form = useForm({
    defaultValues: { name: "", ip: "", certDir: "/etc/nginx/ssl" },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, string>) => api.post<{ token: string }>('/admin/nodes', data),
    onSuccess: (data: { token: string }) => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setNewNodeToken(data.token);
      toast.success("Node added successfully");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to add node")
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/nodes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      setDeleteId(null);
      toast.success("Node deleted");
    },
    onError: (err: unknown) => toast.error((err as Error).message || "Failed to delete node")
  });

  const onSubmit = (values: Record<string, string>) => {
    createMutation.mutate(values);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="p-4 sm:p-6 w-full max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Nodes</h1>
        <Button className="w-full sm:w-auto" onClick={() => setIsAddOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Node
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cert Directory</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Last Online</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : nodes.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No nodes registered.</TableCell></TableRow>
              ) : (
                nodes.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-medium">
                      <Link to={`/nodes/${n.id}`} className="hover:underline flex items-center gap-2">
                        <Server className="w-4 h-4 text-muted-foreground" />
                        {n.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{n.ip}</TableCell>
                    <TableCell>
                      <Badge variant={n.isOnline ? 'default' : 'destructive'}>
                        {n.isOnline ? 'Online' : 'Offline'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{n.certDir}</TableCell>
                    <TableCell>{n.assignedDomainsCount} domains</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {n.lastHeartbeatAt ? formatDistanceToNow(new Date(n.lastHeartbeatAt), { addSuffix: true }) : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(n.id)}>
                        <Trash className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={(open) => {
        setIsAddOpen(open);
        if (!open) {
          setNewNodeToken(null);
          form.reset();
        }
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          {!newNodeToken ? (
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>Add New Node</DialogTitle>
                <DialogDescription>Register a new node to distribute certificates to.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Node Name</Label>
                  <Input id="name" placeholder="web-01" required {...form.register('name')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ip">IP Address</Label>
                  <Input id="ip" placeholder="192.168.1.100" required {...form.register('ip')} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="certDir">Certificate Directory</Label>
                  <Input id="certDir" placeholder="/etc/nginx/ssl" required {...form.register('certDir')} />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Generating Token...' : 'Register Node'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Node Registered</DialogTitle>
                <DialogDescription>
                  Run the following command on the target node to connect it. This token will only be shown once.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <div className="relative">
                  <pre className="p-4 rounded-lg bg-muted font-mono text-sm overflow-x-auto border">
                    {`curl -sL ${import.meta.env.VITE_API_BASE_URL || 'http://YOUR_MASTER_IP/api'}/agent.sh | bash -s -- --token ${newNodeToken}`}
                  </pre>
                  <Button size="icon" variant="secondary" className="absolute top-2 right-2" onClick={() => copyToClipboard(`curl -sL ${import.meta.env.VITE_API_BASE_URL || 'http://YOUR_MASTER_IP/api'}/agent.sh | bash -s -- --token ${newNodeToken}`)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setIsAddOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this node? Certificates already deployed will remain on the node, but it will no longer receive updates.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Node'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
