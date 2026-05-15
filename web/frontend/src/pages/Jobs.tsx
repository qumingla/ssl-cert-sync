import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import type { Job } from "../types/api";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Terminal, RefreshCw, Eye, Copy } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export function Jobs() {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: jobs = [], isLoading, refetch } = useQuery<Job[]>({
    queryKey: ['jobs'],
    queryFn: () => api.get<Job[]>('/admin/jobs'),
    refetchInterval: 10000,
  });

  const filteredJobs = jobs.filter(j => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false;
    if (typeFilter !== 'all' && j.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="p-4 sm:p-6 w-full max-w-full overflow-x-hidden space-y-4 sm:space-y-6 flex flex-col h-full">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Jobs & Logs</h1>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v || 'all')}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v || 'all')}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="issue">Issue</SelectItem>
              <SelectItem value="renew">Renew</SelectItem>
              <SelectItem value="sync">Sync</SelectItem>
              <SelectItem value="deploy">Deploy</SelectItem>
            </SelectContent>
          </Select>
          <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardContent className="p-0 overflow-auto flex-1">
          <div className="min-w-[720px]">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : filteredJobs.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No jobs found.</TableCell></TableRow>
              ) : (
                filteredJobs.map((j) => (
                  <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedJob(j)}>
                    <TableCell className="font-medium capitalize">{j.type}</TableCell>
                    <TableCell>{j.targetName || j.targetId}</TableCell>
                    <TableCell>
                      <Badge variant={j.status === 'success' ? 'default' : j.status === 'running' ? 'secondary' : 'destructive'}>
                        {j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {j.startedAt ? format(new Date(j.startedAt), 'MMM dd, HH:mm:ss') : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {j.durationMs !== null ? `${(j.durationMs / 1000).toFixed(1)}s` : '-'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedJob(j); }}>
                        <Eye className="mr-2 h-4 w-4" /> View
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

      <JobLogSheet job={selectedJob} onClose={() => setSelectedJob(null)} />
    </div>
  );
}

function JobLogSheet({ job, onClose }: { job: Job | null, onClose: () => void }) {
  const logEndRef = useRef<HTMLDivElement>(null);
  
  const { data: logData, isLoading } = useQuery<{ logs: string }>({
    queryKey: ['job-logs', job?.id],
    queryFn: () => api.get<{ logs: string }>(`/admin/jobs/${job?.id}/logs`),
    enabled: !!job,
    refetchInterval: job?.status === 'running' ? 2000 : false,
  });

  useEffect(() => {
    if (logData?.logs) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logData?.logs]);

  const copyLogs = () => {
    if (logData?.logs) {
      navigator.clipboard.writeText(logData.logs);
      toast.success("Logs copied to clipboard");
    }
  };

  return (
    <Sheet open={!!job} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl flex flex-col h-full">
        <SheetHeader className="flex flex-row items-start justify-between">
          <div>
            <SheetTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" /> Job Logs
            </SheetTitle>
            <SheetDescription>
              {job?.type.toUpperCase()} for {job?.targetName || job?.targetId}
            </SheetDescription>
          </div>
          {logData?.logs && (
            <Button variant="outline" size="sm" onClick={copyLogs} className="mt-0">
              <Copy className="h-4 w-4 mr-2" /> Copy Logs
            </Button>
          )}
        </SheetHeader>
        
        <div className="flex-1 mt-6 bg-[#1e1e1e] text-gray-300 rounded-md p-4 overflow-y-auto font-mono text-sm shadow-inner relative">
          {isLoading && <div className="text-gray-500">Loading logs...</div>}
          <pre className="whitespace-pre-wrap break-words leading-relaxed">
            {logData?.logs || (job?.status === 'running' ? 'Waiting for output...' : 'No logs available.')}
          </pre>
          <div ref={logEndRef} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
