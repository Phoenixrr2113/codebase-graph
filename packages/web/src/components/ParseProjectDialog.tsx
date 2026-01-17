'use client';

/**
 * ParseProjectDialog Component
 * Dialog for parsing/indexing a project directory
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/services/api';

export function ParseProjectDialog() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const queryClient = useQueryClient();

  const parseMutation = useMutation({
    mutationFn: (projectPath: string) => api.parse.project(projectPath),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      if (result.status === 'complete') {
        setOpen(false);
        setPath('');
      }
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.parse.clear(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (path.trim()) {
      parseMutation.mutate(path.trim());
    }
  };

  const handleClear = () => {
    if (confirm('Clear all graph data? This cannot be undone.')) {
      clearMutation.mutate();
    }
  };

  const isPending = parseMutation.isPending || clearMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs">
          Parse Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-slate-800">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-slate-100">Parse Project</DialogTitle>
            <DialogDescription className="text-slate-400">
              Enter the absolute path to a TypeScript/JavaScript project directory.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/path/to/your/project"
              className="bg-slate-950 border-slate-700 text-slate-100"
              disabled={isPending}
            />
            {parseMutation.isError && (
              <p className="text-red-400 text-sm mt-2">
                {parseMutation.error instanceof Error ? parseMutation.error.message : 'Parse failed'}
              </p>
            )}
            {parseMutation.isSuccess && parseMutation.data.stats && (
              <p className="text-emerald-400 text-sm mt-2">
                ✓ Parsed {parseMutation.data.stats.files} files, {parseMutation.data.stats.entities} entities
              </p>
            )}
            {clearMutation.isSuccess && (
              <p className="text-amber-400 text-sm mt-2">✓ Graph cleared</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="destructive"
              onClick={handleClear}
              disabled={isPending}
              className="mr-auto"
            >
              {clearMutation.isPending ? 'Clearing...' : 'Clear Graph'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!path.trim() || isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {parseMutation.isPending ? 'Parsing...' : 'Parse'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
