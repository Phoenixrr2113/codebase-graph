import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ParseProjectDialog } from "./parse-project-dialog";

describe("recent project paths during static rendering", () => {
  it("does not access browser storage or log a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const html = renderToStaticMarkup(<ParseProjectDialog apiUrl="" />);

    expect(html).toContain("Index Project");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
