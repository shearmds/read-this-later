// Publisher furniture that Readability leaves behind.
//
// Readability keeps ad slots and section markers because they're structurally
// part of the article, and DOMPurify won't touch them because they're
// legitimate markup containing legitimate text. So "Advertisement" and
// "SKIP ADVERTISEMENT" end up as the first thing you read in a captured NYT
// story.
//
// Deliberately kept dependency-free: the reader imports this, and the reader is
// pulled into the list command's bundle. Anything heavy here (linkedom,
// Readability) would be bundled into a command that never parses HTML.

// Matched against a whole line / a whole element's text, never a substring — a
// sentence that merely mentions advertising must survive untouched.
const BOILERPLATE = new Set([
  "advertisement",
  "advertisements",
  "skip advertisement",
  "continue reading the main story",
  "supported by",
  "sponsored",
  "sponsored content",
]);

export function isBoilerplate(text: string): boolean {
  return BOILERPLATE.has(text.trim().toLowerCase().replace(/\s+/g, " "));
}

// Strips boilerplate lines from converted Markdown. Applied at read time so it
// also cleans bodies captured by the browser extension or iOS, which this
// extension can't re-capture — they already contain the ad text.
export function stripBoilerplateMarkdown(markdown: string): string {
  const kept = markdown
    .split("\n")
    // Headings are stripped too: turndown renders NYT's ad slots as "## Advertisement".
    .filter((line) => !isBoilerplate(line.replace(/^#{1,6}\s*/, "")));

  // Removing lines leaves runs of blank lines where the ad slots were.
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
