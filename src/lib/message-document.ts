import { safeWebUrl } from "./mail-links";

export interface MessageLink { href: string; label: string; }
export interface PreparedMessageDocument { html: string; links: MessageLink[]; }
export const messageSandbox = "allow-popups allow-popups-to-escape-sandbox";

/** Receives server-sanitized HTML; revalidates links and resource attributes before isolation. */
export function isolatedDocument(html: string): PreparedMessageDocument {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed,form,input,button,meta,base,link,svg,math,audio,video,template").forEach(node => node.remove());
  const links: MessageLink[] = [];
  parsed.querySelectorAll("*").forEach(node => {
    const href = node.tagName === "A" ? safeWebUrl(node.getAttribute("href") || "") : null;
    Array.from(node.attributes).forEach(attribute => {
      if (attribute.name.startsWith("on") || ["href", "srcset", "action", "formaction", "target", "rel", "ping", "download", "attributionsrc", "srcdoc", "background", "autofocus", "tabindex", "accesskey", "contenteditable"].includes(attribute.name)) node.removeAttribute(attribute.name);
    });
    if (node.hasAttribute("src") && (node.tagName !== "IMG" || !/^data:image\/(png|jpeg|gif|webp);/i.test(node.getAttribute("src") || ""))) node.removeAttribute("src");
    if (href) {
      node.setAttribute("href", href); node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); node.setAttribute("title", href); node.setAttribute("referrerpolicy", "no-referrer");
      if (!links.some(link => link.href === href)) links.push({ href, label: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 180) || "Open link" });
    }
  });
  return {
    links,
    html: `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html{color-scheme:light}body{font:14px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#303934;background:#fff;margin:18px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a[href]{color:#246b5d;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;cursor:pointer}a:focus-visible{outline:2px solid #246b5d;outline-offset:3px}pre{white-space:pre-wrap}*{box-sizing:border-box}</style></head><body>${parsed.body.innerHTML}</body></html>`,
  };
}
