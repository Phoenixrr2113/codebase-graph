import "server-only"
import { codeToHtml } from "shiki"

export type SupportedLang =
  | "json"
  | "ts"
  | "tsx"
  | "bash"
  | "shellscript"

let warmed: Promise<void> | null = null

async function warm(): Promise<void> {
  if (warmed) return warmed
  warmed = (async () => {
    await codeToHtml("", { lang: "ts", theme: "github-dark-default" })
  })()
  return warmed
}

export async function highlight(code: string, lang: SupportedLang): Promise<string> {
  await warm()
  return codeToHtml(code, {
    lang,
    theme: "github-dark-default",
    transformers: [
      {
        pre(node) {
          if (Array.isArray(node.properties.class)) {
            node.properties.class.push("shiki-block")
          } else if (typeof node.properties.class === "string") {
            node.properties.class = `${node.properties.class} shiki-block`
          } else {
            node.properties.class = "shiki-block"
          }
          // Strip the inline background — we want the surrounding card to bleed through.
          if (typeof node.properties.style === "string") {
            node.properties.style = node.properties.style
              .split(";")
              .filter((s) => !s.trim().toLowerCase().startsWith("background"))
              .join(";")
          }
          return node
        },
      },
    ],
  })
}
