'use client';

/**
 * ParseProjectDialog Component
 * Dialog for parsing/indexing a project directory
 */

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
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
import { CheckCircle, Loader2 } from 'lucide-react';

interface ParseProjectDialogProps {
  onProjectParsed?: (projectPath: string) => void;
}

export function ParseProjectDialog({ onProjectParsed }: ParseProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [includeExternals, setIncludeExternals] = useState(false);
  const queryClient = useQueryClient();

  const parseMutation = useMutation({
    mutationFn: (projectPath: string) => api.parse.project(projectPath, undefined, deepAnalysis, includeExternals),
    onSuccess: (_result, projectPath) => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      // Notify parent about the parsed project
      onProjectParsed?.(projectPath);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.parse.clear(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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

  const handleClose = () => {
    setOpen(false);
    // Reset state when closing
    setTimeout(() => {
      setPath('');
      setDeepAnalysis(false);
      setIncludeExternals(false);
      parseMutation.reset();
      clearMutation.reset();
    }, 200);
  };

  const isPending = parseMutation.isPending || clearMutation.isPending;
  const isSuccess = parseMutation.isSuccess && parseMutation.data?.status === 'complete';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs">
          Parse Project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-slate-900 border-slate-800">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-slate-100">
              {isSuccess ? 'Project Indexed Successfully' : 'Parse Project'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {isSuccess
                ? 'Your project has been indexed and is ready to explore.'
                : 'Enter the absolute path to a TypeScript/JavaScript project directory.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {!isSuccess && (
              <>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/path/to/your/project"
                  className="bg-slate-950 border-slate-700 text-slate-100"
                  disabled={isPending}
                />

                {/* Deep Analysis Option */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="deepAnalysis"
                      checked={deepAnalysis}
                      onCheckedChange={(checked) => setDeepAnalysis(!!checked)}
                      disabled={isPending}
                    />
                    <label htmlFor="deepAnalysis" className="text-sm text-slate-300 cursor-pointer">
                      Deep analysis (function calls, component renders)
                    </label>
                  </div>
                  {deepAnalysis && (
                    <div className="text-xs text-amber-400/80 pl-6">
                      ⚠️ Increases parsing time significantly for large codebases.
                    </div>
                  )}
                </div>

                {/* Include Externals Option */}
                {deepAnalysis && (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="includeExternals"
                        checked={includeExternals}
                        onCheckedChange={(checked) => setIncludeExternals(!!checked)}
                        disabled={isPending}
                      />
                      <label htmlFor="includeExternals" className="text-sm text-slate-300 cursor-pointer">
                        Include external library references
                      </label>
                    </div>
                    {includeExternals && (
                      <div className="text-xs text-amber-400/80 pl-6">
                        ⚠️ External refs will appear as orphan nodes (no source code).
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {parseMutation.isPending && (
              <div className="flex items-center gap-2 mt-3 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Parsing files...</span>
              </div>
            )}

            {parseMutation.isError && (
              <p className="text-red-400 text-sm mt-2">
                {parseMutation.error instanceof Error ? parseMutation.error.message : 'Parse failed'}
              </p>
            )}

            {isSuccess && parseMutation.data.stats && (
              <div className="bg-emerald-950/50 border border-emerald-800 rounded-lg p-4 mt-2">
                <div className="flex items-center gap-2 text-emerald-400 mb-2">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-medium">Indexing Complete</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-slate-400">Files parsed:</div>
                  <div className="text-slate-200 font-mono">{parseMutation.data.stats.files}</div>
                  <div className="text-slate-400">Entities found:</div>
                  <div className="text-slate-200 font-mono">{parseMutation.data.stats.entities}</div>
                  <div className="text-slate-400">Edges created:</div>
                  <div className="text-slate-200 font-mono">{parseMutation.data.stats.edges}</div>
                  <div className="text-slate-400">Duration:</div>
                  <div className="text-slate-200 font-mono">{(parseMutation.data.stats.durationMs / 1000).toFixed(2)}s</div>
                </div>
              </div>
            )}

            {clearMutation.isSuccess && (
              <p className="text-amber-400 text-sm mt-2">✓ Graph cleared</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {!isSuccess && (
              <>
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
                  onClick={handleClose}
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
              </>
            )}

            {isSuccess && (
              <Button
                type="button"
                onClick={handleClose}
                className="bg-emerald-600 hover:bg-emerald-700 w-full"
              >
                Done - View Graph
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
