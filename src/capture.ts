// Capturing article bodies for offline reading.
//
// Mirrors the browser extension's "capture-moment" model (dia-read-later's
// offline.js): run Readability against the live, logged-in DOM at save time.
// That's what gets the full text of a page you're authenticated to — refetching
// the URL later would just return the paywalled stub.
//
// Raycast has no DOM of its own, so the live HTML comes from the Raycast
// browser extension (BrowserExtension.getContent) and is parsed here in Node.
// Without that extension connected there is no capture path at all.

import { BrowserExtension, getPreferenceValues } from "@raycast/api";
import { randomBytes, createCipheriv } from "node:crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import createDOMPurify, { WindowLike } from "dompurify";
import { deriveKey, OfflineArticle } from "./offline";
import { OfflineStatus } from "./api";

const BASE_URL = "https://readlater-sync.shearm.workers.dev";

// Frozen, and shared with the other clients: envelope shape and the stub
// threshold both come from dia-read-later/offline.js. Anything shorter than
// this is a paywall stub or a non-article page — store nothing rather than
// cache junk that would render as an empty page on another device.
const PAYLOAD_VERSION = 1;
const MIN_LENGTH = 1500;

export interface Extracted {
  title: string;
  html: string;
  length: number;
  excerpt: string;
  siteName: string;
}

// `pageUrl` is load-bearing: Readability resolves relative hrefs and image
// srcs against it. The browser extension gets this for free by running inside
// the page; parsing detached HTML here does not, so without a base URL every
// relative image would break on whichever device later reads the copy.
export function extract(html: string, pageUrl: string): Extracted | null {
  const dom = new JSDOM(html, { url: pageUrl });
  // Readability rarely returns null — handed a page with no article it still
  // hands back a tiny result (e.g. just the nav text). Treat this as a guard
  // against outright parse failure; isStub() is what actually rejects junk.
  const article = new Readability(dom.window.document).parse();
  if (!article?.content) return null;

  const purify = createDOMPurify(dom.window as unknown as WindowLike);
  const clean = purify.sanitize(article.content, {
    USE_PROFILES: { html: true },
  });

  return {
    title: article.title || "",
    html: clean,
    length: article.length || (article.textContent || "").length,
    excerpt: article.excerpt || "",
    siteName: article.siteName || "",
  };
}

export function isStub(extracted: Extracted): boolean {
  return extracted.length < MIN_LENGTH;
}

export function buildEnvelope(url: string, e: Extracted): OfflineArticle {
  return {
    v: PAYLOAD_VERSION,
    url,
    title: e.title,
    siteName: e.siteName,
    excerpt: e.excerpt,
    length: e.length,
    html: e.html,
    capturedAt: Date.now(),
  };
}

// wire = base64( iv ‖ ciphertext ‖ tag ), random iv per body — never reuse one
// with the same key. Inverse of decryptBody in offline.ts.
export function encryptBody(plaintext: string, syncToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(syncToken), iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64");
}

async function uploadBody(url: string, wire: string): Promise<boolean> {
  const { syncToken } = getPreferenceValues<Preferences>();
  const response = await fetch(`${BASE_URL}/body`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${syncToken}`,
    },
    body: JSON.stringify({
      url,
      ciphertext: wire,
      meta: { v: PAYLOAD_VERSION },
    }),
  });
  return response.ok;
}

// Reads the live DOM of the tab we just saved. Returns null when the Raycast
// browser extension isn't connected — the only way Raycast can see a page.
async function liveHtml(pageUrl: string): Promise<string | null> {
  try {
    const tabs = await BrowserExtension.getTabs();
    const tab =
      tabs.find((t) => t.url === pageUrl) ?? tabs.find((t) => t.active);
    if (!tab) return null;
    return await BrowserExtension.getContent({ tabId: tab.id, format: "html" });
  } catch {
    return null;
  }
}

// Best-effort: a capture failure must never fail the save itself. The link is
// already stored; the body is a bonus. Returns the status to record on the item.
export async function captureBody(pageUrl: string): Promise<OfflineStatus> {
  const html = await liveHtml(pageUrl);
  if (!html) return "none";

  let extracted: Extracted | null;
  try {
    extracted = extract(html, pageUrl);
  } catch {
    return "unavailable";
  }
  if (!extracted) return "unavailable";
  if (isStub(extracted)) return "unavailable";

  const { syncToken } = getPreferenceValues<Preferences>();
  try {
    const wire = encryptBody(
      JSON.stringify(buildEnvelope(pageUrl, extracted)),
      syncToken,
    );
    return (await uploadBody(pageUrl, wire)) ? "saved" : "none";
  } catch {
    return "none";
  }
}
