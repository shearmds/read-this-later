import { Detail, ActionPanel, Action, Icon, Color } from "@raycast/api";
import { useEffect, useState } from "react";
import TurndownService from "turndown";
import { tables } from "turndown-plugin-gfm";
import { fetchArticle, OfflineArticle } from "./offline";
import { ReadLaterItem, hostname } from "./api";

// Raycast renders Markdown, not HTML, so the envelope's sanitized HTML has to
// be converted. The body was captured from a live logged-in page, so this is
// the full text — including past a paywall the URL itself would now show.
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Without this, turndown flattens every cell into its own paragraph and a data
// table reads as a meaningless run of values. GFM pipes survive either way,
// whether or not Raycast's renderer draws them as a real table.
turndown.use(tables);

// Non-content elements Readability didn't strip. Turndown would otherwise emit
// their text (or leave markup) inline in the article.
turndown.remove(["script", "style", "noscript", "iframe", "form", "button"]);

function toMarkdown(article: OfflineArticle): string {
  const body = turndown.turndown(article.html || "");
  const heading = article.title ? `# ${article.title}\n\n` : "";
  return heading + body;
}

export function Reader({ item }: { item: ReadLaterItem }) {
  const [article, setArticle] = useState<OfflineArticle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const fetched = await fetchArticle(item.url);
        if (fetched) setArticle(fetched);
        else setMissing(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [item.url]);

  const actions = (
    <ActionPanel>
      <Action.OpenInBrowser url={item.url} />
      <Action.CopyToClipboard
        title="Copy URL"
        content={item.url}
        shortcut={{ modifiers: ["cmd"], key: "c" }}
      />
    </ActionPanel>
  );

  if (error) {
    return (
      <Detail
        markdown={`# Couldn't open the article\n\n${error}`}
        actions={actions}
      />
    );
  }

  if (missing) {
    return (
      <Detail
        markdown={[
          "# No captured copy",
          "",
          "This link has no saved article body. It was probably saved before",
          "offline capture existed, or the page was paywalled when it was saved.",
          "",
          "Captures happen in the browser extension or the iOS app at save time —",
          "Raycast can't create one.",
        ].join("\n")}
        actions={actions}
      />
    );
  }

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={item.title}
      markdown={article ? toMarkdown(article) : ""}
      metadata={
        article ? (
          <Detail.Metadata>
            <Detail.Metadata.Label
              title="Site"
              text={article.siteName || hostname(item.url)}
            />
            {article.length ? (
              <Detail.Metadata.Label
                title="Length"
                text={`${Math.max(1, Math.round(article.length / 1000))}k characters`}
              />
            ) : null}
            {article.capturedAt ? (
              <Detail.Metadata.Label
                title="Captured"
                text={new Date(article.capturedAt).toLocaleDateString()}
              />
            ) : null}
            <Detail.Metadata.TagList title="Status">
              <Detail.Metadata.TagList.Item
                text={item.read ? "Read" : "Unread"}
                color={item.read ? Color.SecondaryText : Color.Blue}
              />
              {item.folder ? (
                <Detail.Metadata.TagList.Item
                  text={item.folder}
                  color={Color.Green}
                />
              ) : null}
            </Detail.Metadata.TagList>
            {item.notes ? (
              <Detail.Metadata.Label
                title="Note"
                icon={Icon.Pencil}
                text={item.notes}
              />
            ) : null}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Link
              title="Original"
              target={item.url}
              text={hostname(item.url)}
            />
          </Detail.Metadata>
        ) : null
      }
      actions={actions}
    />
  );
}
