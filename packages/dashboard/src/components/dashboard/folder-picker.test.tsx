// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParseProjectDialog } from "./parse-project-dialog";

interface DirectoryPayload {
  path: string | null;
  parent: string | null;
  entries: Array<{
    name: string;
    path: string;
    projectMarkers: string[];
    isSymlink: boolean;
  }>;
  truncated: boolean;
}

interface MountedView {
  container: HTMLDivElement;
  root: Root;
}

const mounted: MountedView[] = [];

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function render(element: ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => root.render(element));
  return container;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

async function keyDown(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function change(element: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(name: string, scope: ParentNode = document): HTMLButtonElement {
  const match = Array.from(scope.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!(match instanceof HTMLButtonElement))
    throw new Error(`Button not found: ${name}`);
  return match;
}

function directories(
  path: string | null,
  entries: DirectoryPayload["entries"],
  options: { parent?: string | null; truncated?: boolean } = {},
): DirectoryPayload {
  return {
    path,
    parent: options.parent === undefined ? null : options.parent,
    entries,
    truncated: options.truncated ?? false,
  };
}

function directoryEntry(
  name: string,
  path: string,
  projectMarkers: string[] = [],
  isSymlink = false,
): DirectoryPayload["entries"][number] {
  return { name, path, projectMarkers, isSymlink };
}

async function openIndexForm(): Promise<HTMLDivElement> {
  const container = await render(
    <ParseProjectDialog apiUrl="http://api.test" />,
  );
  await click(button("Index Project", container));
  return container;
}

async function openPicker(): Promise<HTMLDivElement> {
  const container = await openIndexForm();
  await click(button("Browse", container));
  await flush();
  return container;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) {
    const view = mounted.pop();
    if (!view) continue;
    await act(async () => view.root.unmount());
    view.container.remove();
  }
  document.body.innerHTML = "";
});

describe("folder picker", () => {
  it("opens a labelled dialog, descends with Enter, and navigates up by breadcrumb", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = url.searchParams.get("path");
      if (path === "/Users/randy") {
        return response(
          directories(
            "/Users/randy",
            [directoryEntry("code", "/Users/randy/code")],
            { parent: "/Users" },
          ),
        );
      }
      if (path === "/Users") {
        return response(
          directories("/Users", [directoryEntry("randy", "/Users/randy")]),
        );
      }
      return response(directories(null, [directoryEntry("Users", "/Users")]));
    });
    vi.stubGlobal("fetch", fetcher);

    await openPicker();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeInstanceOf(HTMLElement);
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    await click(button("Users", dialog ?? document));
    await flush();
    expect(
      Array.from((dialog ?? document).querySelectorAll("button")).some(
        (candidate) => candidate.textContent?.trim() === "Root",
      ),
    ).toBe(false);

    const randy = button("randy", dialog ?? document);
    randy.focus();
    await keyDown(randy, "Enter");
    await flush();

    expect(document.body.textContent).toContain("/Users/randy");
    expect(document.body.textContent).toContain("code");
    await click(button("Users", dialog ?? document));
    await flush();
    expect(document.body.textContent).toContain("randy");
  });

  it("selects the current folder, fills the path input, and closes the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          directories("/work/project", [], {
            parent: "/work",
          }),
        ),
      ),
    );

    const container = await openPicker();
    await click(button("Select this folder"));

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(
      (container.querySelector("#index-project-path") as HTMLInputElement)
        .value,
    ).toBe("/work/project");
  });

  it("renders project markers and a symlink label on directory rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          directories("/work", [
            directoryEntry(
              "codegraph",
              "/work/codegraph",
              [".git", "package.json", "Cargo.toml", "pyproject.toml"],
              true,
            ),
          ]),
        ),
      ),
    );

    await openPicker();

    expect(document.body.textContent).toContain("git");
    expect(document.body.textContent).toContain("node");
    expect(document.body.textContent).toContain("cargo");
    expect(document.body.textContent).toContain("python");
    expect(document.body.textContent).toContain("symlink");
  });

  it("refetches the current path when hidden folders are toggled", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      response(directories("/work", [])),
    );
    vi.stubGlobal("fetch", fetcher);

    await openPicker();
    const toggle = document.querySelector('input[type="checkbox"]');
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    await click(toggle as HTMLInputElement);
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get(
        "includeHidden",
      ),
    ).toBe("true");
  });

  it("announces loading and errors and exposes a retry action", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectRequest = reject;
          }),
      ),
    );

    const container = await openIndexForm();
    await click(button("Browse", container));
    expect(
      document.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("Loading");

    await act(async () => rejectRequest?.(new Error("Permission denied")));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Permission denied",
    );
    expect(button("Retry")).toBeInstanceOf(HTMLButtonElement);
  });

  it("renders honest empty and truncated states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          directories("/large", [], {
            parent: "/",
            truncated: true,
          }),
        ),
      ),
    );

    await openPicker();

    expect(document.body.textContent).toContain("No folders found");
    expect(document.body.textContent).toContain("Some folders are not shown");
  });

  it("closes on Escape and returns focus to Browse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(directories("/", []))),
    );
    const container = await openPicker();
    const browse = button("Browse", container);

    await keyDown(
      document.querySelector('[role="dialog"]') as HTMLElement,
      "Escape",
    );
    await flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(browse);
  });
});

describe("recent indexed paths", () => {
  it("persists a successful indexed path and selects it from the recent list", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return response({
            success: true,
            projectId: "one",
            projectName: "One",
          });
        }
        return response(directories("/", []));
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const container = await openIndexForm();
    const input = container.querySelector(
      "#index-project-path",
    ) as HTMLInputElement;
    await change(input, "/work/one");
    await click(button("Index", container));
    await flush();

    expect(
      window.localStorage.getItem("codegraph.recentProjectPaths"),
    ).toContain("/work/one");
    await change(input, "/different");
    await click(button("/work/one", container));
    expect(input.value).toBe("/work/one");
  });

  it("shows only the five most recent unique stored paths", async () => {
    window.localStorage.setItem(
      "codegraph.recentProjectPaths",
      JSON.stringify([
        "/six",
        "/five",
        "/four",
        "/three",
        "/two",
        "/one",
        "/six",
      ]),
    );
    const container = await openIndexForm();

    expect(button("/six", container)).toBeInstanceOf(HTMLButtonElement);
    expect(button("/two", container)).toBeInstanceOf(HTMLButtonElement);
    expect(container.textContent).not.toContain("/one");
    expect(container.querySelectorAll("[data-recent-path]")).toHaveLength(5);
  });
});
