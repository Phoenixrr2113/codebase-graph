import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FolderPicker } from "./folder-picker";

interface ParseProjectDialogProps {
  apiUrl: string;
  onProjectParsed?: (project: ParsedProject) => void;
}

export interface ParsedProject {
  projectId: string;
  projectName: string;
}

interface ParseResult {
  success: boolean;
  projectId?: string;
  projectName?: string;
  stats?: {
    files: number;
    entities: number;
    edges: number;
    errors: number;
    durationMs: number;
  };
  errorMessages?: string[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSuccessfulProject(value: unknown): ParsedProject {
  if (
    !isRecord(value) ||
    value.success !== true ||
    typeof value.projectId !== "string" ||
    typeof value.projectName !== "string"
  ) {
    throw new Error("Invalid parse response");
  }
  return { projectId: value.projectId, projectName: value.projectName };
}

function parseStats(value: unknown): ParseResult["stats"] {
  if (!isRecord(value)) return undefined;
  const fields = [
    "files",
    "entities",
    "edges",
    "errors",
    "durationMs",
  ] as const;
  if (
    fields.some(
      (field) =>
        typeof value[field] !== "number" || !Number.isFinite(value[field]),
    )
  ) {
    return undefined;
  }
  return {
    files: value.files as number,
    entities: value.entities as number,
    edges: value.edges as number,
    errors: value.errors as number,
    durationMs: value.durationMs as number,
  };
}

interface ParseProjectFormProps {
  apiUrl?: string;
  path: string;
  loading: boolean;
  result: ParseResult | null;
  recentPaths?: string[];
  onPathChange: (path: string) => void;
  onRecentPathSelect?: (path: string) => void;
  onParse: () => void;
  onCancel: () => void;
}

export function ParseProjectForm({
  apiUrl = "",
  path,
  loading,
  result,
  recentPaths = [],
  onPathChange,
  onRecentPathSelect = onPathChange,
  onParse,
  onCancel,
}: ParseProjectFormProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex max-w-[min(70vw,56rem)] flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label htmlFor="index-project-path" className="sr-only">
          Project path
        </label>
        <Input
          id="index-project-path"
          type="text"
          placeholder="/path/to/project"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onParse();
            if (event.key === "Escape") onCancel();
          }}
          className="h-7 w-64 text-xs"
          autoFocus
        />
        <FolderPicker
          apiUrl={apiUrl}
          open={pickerOpen}
          initialPath={path}
          onOpenChange={setPickerOpen}
          onSelect={onPathChange}
        />
        <Button
          size="sm"
          onClick={onParse}
          disabled={!path.trim() || loading}
          className="h-7 text-xs"
        >
          {loading ? "Indexing..." : "Index"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-7 text-xs"
        >
          Cancel
        </Button>
        {result &&
          (result.success ? (
            <Badge
              variant="outline"
              className="text-[10px] text-emerald-400 border-emerald-400/30"
            >
              {result.stats?.files} files, {result.stats?.entities} symbols (
              {((result.stats?.durationMs ?? 0) / 1000).toFixed(1)}s)
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] text-red-400 border-red-400/30"
            >
              {result.error}
            </Badge>
          ))}
      </div>
      {recentPaths.length > 0 && (
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1 text-[11px]">
          <span className="text-subtle">Recent:</span>
          {recentPaths.map((recentPath) => (
            <button
              key={recentPath}
              type="button"
              data-recent-path
              title={recentPath}
              onClick={() => onRecentPathSelect(recentPath)}
              className="max-w-40 truncate rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {recentPath}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const RECENT_PROJECT_PATHS_STORAGE_KEY = "codegraph.recentProjectPaths";

export function normalizeRecentPaths(paths: readonly string[]): string[] {
  return Array.from(
    new Set(paths.map((entry) => entry.trim()).filter(Boolean)),
  ).slice(0, 5);
}

function readRecentPaths(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(RECENT_PROJECT_PATHS_STORAGE_KEY) ?? "[]",
    );
    if (
      !Array.isArray(stored) ||
      stored.some((entry) => typeof entry !== "string")
    )
      return [];
    return normalizeRecentPaths(stored as string[]);
  } catch (error) {
    console.warn("Unable to read recent project paths", error);
    return [];
  }
}

function saveRecentPaths(paths: readonly string[]): void {
  try {
    window.localStorage.setItem(
      RECENT_PROJECT_PATHS_STORAGE_KEY,
      JSON.stringify(normalizeRecentPaths(paths)),
    );
  } catch (error) {
    console.warn("Unable to save recent project paths", error);
  }
}

export function ParseProjectDialog({
  apiUrl,
  onProjectParsed,
}: ParseProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>(readRecentPaths);

  const handleParse = useCallback(async () => {
    const trimmed = path.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${apiUrl}/api/parse/project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      const data: unknown = await res.json();

      // A failed index can still arrive as a well-formed body, so the payload's
      // own verdict matters as much as the status code.
      if (!res.ok || !isRecord(data) || data.error || data.success === false) {
        setResult({
          success: false,
          error:
            isRecord(data) && typeof data.error === "string"
              ? data.error
              : isRecord(data) &&
                  Array.isArray(data.errorMessages) &&
                  typeof data.errorMessages[0] === "string"
                ? data.errorMessages[0]
                : `HTTP ${res.status}`,
        });
      } else {
        const parsedProject = parseSuccessfulProject(data);
        const stats = parseStats(data.stats);
        const errorMessages = Array.isArray(data.errorMessages)
          ? data.errorMessages.filter(
              (message): message is string => typeof message === "string",
            )
          : undefined;
        setResult({ success: true, ...parsedProject, stats, errorMessages });
        const nextRecentPaths = normalizeRecentPaths([trimmed, ...recentPaths]);
        setRecentPaths(nextRecentPaths);
        saveRecentPaths(nextRecentPaths);
        onProjectParsed?.(parsedProject);
      }
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : "Parse failed",
      });
    } finally {
      setLoading(false);
    }
  }, [path, apiUrl, onProjectParsed, recentPaths]);

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 text-xs"
      >
        Index Project
      </Button>
    );
  }

  const closeForm = () => {
    setOpen(false);
    setResult(null);
  };

  return (
    <ParseProjectForm
      apiUrl={apiUrl}
      path={path}
      loading={loading}
      result={result}
      recentPaths={recentPaths}
      onPathChange={setPath}
      onRecentPathSelect={setPath}
      onParse={() => void handleParse()}
      onCancel={closeForm}
    />
  );
}
