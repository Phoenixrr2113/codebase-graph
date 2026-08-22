import { useEffect, useState } from "react";
import { ChevronRight, Folder, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  loadDirectories,
  projectBadgeLabels,
  type DirectoryListing,
  type PathCrumb,
} from "@/lib/folder-picker";

type PickerState =
  | { status: "loading" }
  | { status: "success"; listing: DirectoryListing }
  | { status: "error"; message: string };

interface FolderPickerProps {
  apiUrl: string;
  open: boolean;
  initialPath: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

function folderLabel(path: string): string {
  const label = path
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1);
  return label ?? (path === "/" ? "Root" : path);
}

export function FolderPicker({
  apiUrl,
  open,
  initialPath,
  onOpenChange,
  onSelect,
}: FolderPickerProps) {
  const [path, setPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<PickerState>({ status: "loading" });
  const [crumbs, setCrumbs] = useState<PathCrumb[]>([]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    loadDirectories(apiUrl, path, showHidden, controller.signal)
      .then((listing) => {
        if (!active) return;
        setState({ status: "success", listing });
        setCrumbs((current) => {
          if (!listing.path) return [];
          const currentIndex = current.findIndex(
            (crumb) => crumb.path === listing.path,
          );
          const currentCrumb = {
            label: folderLabel(listing.path),
            path: listing.path,
          };
          if (currentIndex >= 0) {
            const next = current.slice(0, currentIndex + 1);
            if (currentIndex === 0 && listing.parent) {
              return [
                { label: folderLabel(listing.parent), path: listing.parent },
                ...next,
              ];
            }
            return next;
          }
          return listing.parent
            ? [
                { label: folderLabel(listing.parent), path: listing.parent },
                currentCrumb,
              ]
            : [currentCrumb];
        });
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "Unable to load folders",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [apiUrl, open, path, retryKey, showHidden]);

  const listing = state.status === "success" ? state.listing : null;

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      const nextPath = initialPath.trim() || null;
      setPath(nextPath);
      setCrumbs(
        nextPath ? [{ label: folderLabel(nextPath), path: nextPath }] : [],
      );
      setShowHidden(false);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
        >
          Browse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div className="pr-8">
          <DialogTitle className="text-base font-semibold">
            Choose a project folder
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-subtle">
            Browse directories on this machine. Project badges identify likely
            code roots.
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Current folder" className="min-w-0 flex-1">
              {crumbs.length > 0 ? (
                <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
                  {crumbs.map((crumb, index) => (
                    <li
                      key={crumb.path}
                      className="flex min-w-0 items-center gap-1"
                    >
                      {index > 0 && (
                        <ChevronRight
                          className="size-3.5 shrink-0 text-subtle"
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setCrumbs((current) => {
                            const index = current.findIndex(
                              (candidate) => candidate.path === crumb.path,
                            );
                            return index >= 0
                              ? current.slice(0, index + 1)
                              : [crumb];
                          });
                          setPath(crumb.path);
                        }}
                        className="max-w-48 truncate rounded px-1.5 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {crumb.label}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-sm text-subtle">Browse roots</span>
              )}
            </nav>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-subtle">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(event) => setShowHidden(event.target.checked)}
                className="size-4 rounded border-input accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              Show hidden folders
            </label>
          </div>

          {listing?.path && (
            <code className="truncate rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
              {listing.path}
            </code>
          )}

          <div className="min-h-64 overflow-hidden rounded-md border border-border bg-background/60">
            {state.status === "loading" && (
              <div
                aria-live="polite"
                aria-busy="true"
                className="grid min-h-64 place-items-center text-sm text-subtle"
              >
                Loading folders...
              </div>
            )}

            {state.status === "error" && (
              <div
                role="alert"
                aria-live="assertive"
                className="grid min-h-64 place-items-center p-6 text-center"
              >
                <div>
                  <p className="text-sm font-medium text-red-400">
                    Unable to load folders
                  </p>
                  <p className="mt-1 text-xs text-subtle">{state.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRetryKey((value) => value + 1)}
                    className="mt-3"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {listing && listing.entries.length === 0 && (
              <div className="grid min-h-64 place-items-center p-6 text-center text-sm text-subtle">
                No folders found
              </div>
            )}

            {listing && listing.entries.length > 0 && (
              <ul aria-label="Folders" className="max-h-80 overflow-y-auto p-1">
                {listing.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => {
                        setCrumbs((current) => [
                          ...current,
                          { label: entry.name, path: entry.path },
                        ]);
                        setPath(entry.path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        setCrumbs((current) => [
                          ...current,
                          { label: entry.name, path: entry.path },
                        ]);
                        setPath(entry.path);
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <Folder
                        className="size-4 shrink-0 text-subtle"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {entry.name}
                      </span>
                      {entry.isSymlink && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
                          <Link2 className="size-3" aria-hidden="true" />
                          symlink
                        </span>
                      )}
                      {projectBadgeLabels(entry.projectMarkers).map(
                        (marker) => (
                          <Badge
                            key={marker}
                            variant="outline"
                            className="border-emerald-400/40 text-[10px] text-emerald-400"
                          >
                            {marker}
                          </Badge>
                        ),
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {listing?.truncated && (
            <p role="status" className="text-xs text-amber-400">
              Some folders are not shown. Choose a more specific folder to
              continue.
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!listing?.path}
              onClick={() => {
                if (!listing?.path) return;
                onSelect(listing.path);
                onOpenChange(false);
              }}
            >
              Select this folder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
