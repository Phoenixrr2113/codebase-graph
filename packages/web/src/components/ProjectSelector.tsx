'use client';

/**
 * ProjectSelector Component
 * Dropdown to select which project to view in the graph
 * 
 * Handles synchronization between project list and selection:
 * - Auto-selects first project when none selected
 * - Validates selection against current project list
 * - Handles delete with proper sequencing
 */

import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjects, graphKeys, projectKeys } from '@/hooks/useGraphData';
import { api } from '@/services/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function ProjectSelector({ selectedProjectId, onSelectProject }: ProjectSelectorProps) {
  const { data, isLoading } = useProjects();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Track if we're in a delete operation to prevent race conditions
  const isDeleting = useRef(false);

  const projects = data?.projects ?? [];
  const selectedProject = projects.find(p => p.id === selectedProjectId);

  // Derive if current selection is valid (exists in loaded projects)
  const isSelectionValid = selectedProjectId === null || projects.some(p => p.id === selectedProjectId);

  // Track if we've already set null (to prevent infinite loops)
  const hasSetNull = useRef(false);

  // Auto-select logic: run when projects change or selection becomes invalid
  useEffect(() => {
    // Skip if we're in a delete operation (will be handled by handleDelete)
    if (isDeleting.current) return;

    // Skip if still loading
    if (isLoading) return;

    const firstProject = projects[0];

    // Case 1: No selection and projects exist -> select first
    // Case 2: Selection is invalid (project was deleted elsewhere) -> select first or null
    if (!selectedProjectId || !isSelectionValid) {
      if (firstProject) {
        hasSetNull.current = false; // Reset when we have projects
        onSelectProject(firstProject.id);
      } else if (!hasSetNull.current) {
        // No projects available - only call once to prevent loops
        hasSetNull.current = true;
        onSelectProject(null);
      }
    }
  }, [projects, selectedProjectId, isSelectionValid, isLoading, onSelectProject]);

  const handleValueChange = (value: string) => {
    onSelectProject(value);
    // Invalidate graph data to trigger refetch with new project filter
    queryClient.invalidateQueries({ queryKey: graphKeys.all });
  };

  const handleDelete = async () => {
    if (!selectedProjectId) return;

    const deleteId = selectedProjectId;
    isDeleting.current = true;
    setDeletingId(deleteId);
    setDeleteDialogOpen(false);

    try {
      // 1. Delete the project via API
      await api.projects.delete(deleteId);

      // 2. Fetch fresh project list
      const freshData = await queryClient.fetchQuery({
        queryKey: projectKeys.all,
        staleTime: 0,
      }) as { projects: Array<{ id: string; name: string }> };

      const remainingProjects = freshData?.projects ?? [];

      // 3. Select next project or null
      const nextProject = remainingProjects[0];
      onSelectProject(nextProject?.id ?? null);

      // 4. Invalidate graph data with new selection
      queryClient.invalidateQueries({ queryKey: graphKeys.all });
    } finally {
      setDeletingId(null);
      isDeleting.current = false;
    }
  };

  if (projects.length === 0 && !isLoading) {
    return (
      <span className="text-xs text-slate-500 italic">No projects indexed</span>
    );
  }

  if (isLoading) {
    return (
      <span className="text-xs text-slate-500">Loading projects...</span>
    );
  }

  // Determine the display value: use selectedProjectId only if it's valid
  // This prevents the Select from showing blank when ID doesn't match any option
  const selectValue = isSelectionValid && selectedProjectId ? selectedProjectId : '';

  return (
    <div className="flex items-center gap-1">
      <Select
        value={selectValue}
        onValueChange={handleValueChange}
      >
        <SelectTrigger size="sm" className="w-[160px] text-xs bg-slate-900/50 border-slate-700">
          <SelectValue placeholder="Select project" />
        </SelectTrigger>
        <SelectContent className="bg-slate-900 border-slate-700">
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id} className="text-xs">
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedProjectId && isSelectionValid && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-red-400"
              disabled={deletingId === selectedProjectId}
              title="Delete project"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-slate-900 border-slate-800">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Delete Project</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Are you sure you want to delete <span className="font-semibold text-slate-300">{selectedProject?.name}</span>?
                This will remove all indexed data for this project. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
