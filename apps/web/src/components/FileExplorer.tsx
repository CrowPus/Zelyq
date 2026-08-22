import type { FileEntry } from "@zelyq/core";
import { ChevronRight, File, FolderClosed, FolderOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IconButton, Spinner } from "./ui";

interface Props {
  entries: FileEntry[];
  selected: string | null;
  loading: boolean;
  onSelect(path: string): void;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children: TreeNode[];
}

export function FileExplorer({ entries, selected, loading, onSelect }: Props) {
  // The API returns a flat list of paths; the hierarchy is rebuilt here so the
  // server never has to model a tree.
  const tree = useMemo(() => buildTree(entries), [entries]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [initialised, setInitialised] = useState(false);

  // Open the top level once files first arrive. Doing it on every change would
  // fight the user every time the agent touches a file.
  useEffect(() => {
    if (initialised || tree.length === 0) return;
    setExpanded(new Set(tree.filter((node) => node.type === "directory").map((node) => node.path)));
    setInitialised(true);
  }, [tree, initialised]);

  // A file opened from elsewhere should reveal itself rather than stay hidden
  // inside a collapsed folder.
  useEffect(() => {
    if (!selected) return;
    const segments = selected.split("/").slice(0, -1);
    if (segments.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      let prefix = "";
      for (const segment of segments) {
        prefix = prefix ? `${prefix}/${segment}` : segment;
        next.add(prefix);
      }
      return next;
    });
  }, [selected]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const allDirectories = useMemo(() => collectDirectories(tree), [tree]);
  const anyExpanded = allDirectories.some((path) => expanded.has(path));

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-fg-muted">
        <Spinner /> Reading files…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border-default px-3">
        <span className="text-2xs font-medium tracking-[0.06em] text-fg-muted uppercase">
          Files
        </span>
        {allDirectories.length > 0 && (
          <IconButton
            size="sm"
            label={anyExpanded ? "Collapse all folders" : "Expand all folders"}
            onClick={() => setExpanded(anyExpanded ? new Set() : new Set(allDirectories))}
          >
            <ChevronRight
              size={13}
              strokeWidth={1.75}
              className={`transition-transform ${anyExpanded ? "rotate-90" : ""}`}
            />
          </IconButton>
        )}
      </div>

      {/*
        A list of disclosure buttons rather than role="tree". A real ARIA tree
        promises roving tabindex and arrow-key navigation; claiming the role
        without them is worse for a screen reader than not claiming it. Folders
        announce their state through aria-expanded, which is accurate.
      */}
      <nav
        aria-label="Project files"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
      >
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            selected={selected}
            onToggle={toggle}
            onSelect={onSelect}
          />
        ))}
        {tree.length === 0 && <p className="px-3 py-3 text-xs text-fg-muted">No files yet.</p>}
      </nav>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle(path: string): void;
  onSelect(path: string): void;
}) {
  const isDirectory = node.type === "directory";
  const isOpen = isDirectory && expanded.has(node.path);
  const isSelected = node.path === selected;

  return (
    <>
      <button
        type="button"
        data-kind={isDirectory ? "directory" : "file"}
        aria-expanded={isDirectory ? isOpen : undefined}
        aria-current={!isDirectory && isSelected ? "true" : undefined}
        onClick={() => (isDirectory ? onToggle(node.path) : onSelect(node.path))}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={`flex w-full items-center gap-1.5 py-[3px] pr-2 text-left transition-colors ${
          isSelected
            ? "bg-surface-active text-fg"
            : "text-fg-secondary hover:bg-surface-hover hover:text-fg"
        }`}
      >
        {isDirectory ? (
          <ChevronRight
            size={12}
            strokeWidth={2}
            className={`shrink-0 text-fg-muted transition-transform duration-100 ${isOpen ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-3 shrink-0" aria-hidden />
        )}
        {isDirectory ? (
          isOpen ? (
            <FolderOpen size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
          ) : (
            <FolderClosed size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
          )
        ) : (
          <File size={12} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
        )}
        <span className="truncate text-xs">{node.name}</span>
      </button>

      {isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

/**
 * Turns `["src", "src/App.tsx"]` into a nested structure. Intermediate
 * directories are created on demand, so a deep path still renders even if the
 * listing omitted its parents.
 */
export function buildTree(entries: FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();

  const ensureDirectory = (path: string): TreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;

    const segments = path.split("/");
    const node: TreeNode = {
      name: segments[segments.length - 1] ?? path,
      path,
      type: "directory",
      children: [],
    };
    byPath.set(path, node);

    if (segments.length === 1) roots.push(node);
    else ensureDirectory(segments.slice(0, -1).join("/")).children.push(node);

    return node;
  };

  for (const entry of entries) {
    if (entry.type === "directory") {
      ensureDirectory(entry.path);
      continue;
    }

    const segments = entry.path.split("/");
    const node: TreeNode = {
      name: segments[segments.length - 1] ?? entry.path,
      path: entry.path,
      type: "file",
      size: entry.size,
      children: [],
    };
    byPath.set(entry.path, node);

    if (segments.length === 1) roots.push(node);
    else ensureDirectory(segments.slice(0, -1).join("/")).children.push(node);
  }

  const sort = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) sort(node.children);
    return nodes;
  };

  return sort(roots);
}

function collectDirectories(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === "directory") {
        paths.push(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
}
