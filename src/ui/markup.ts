/**
 * Splits body text into the blocks it is actually made of.
 *
 * Kept apart from the DOM so it can be tested directly: the imported SRD
 * text carries tables as pipe markdown padded out to a few hundred
 * characters a line, and getting that wrong is what turns an entry into a
 * wall of dashes.
 */
export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "table"; caption: string | null; header: string[]; rows: string[][] };

const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The `| --- | --- |` line under a table's header. */
const TABLE_RULE = /^\s*\|[\s:|-]+\|\s*$/;
/** Upstream captions its tables like this; it is a heading, not content. */
const TABLE_CAPTION = /^\s*_Table:\s*(.+?)\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");

  let paragraph: string[] = [];
  let caption: string | null = null;

  const flush = () => {
    const joined = paragraph.join("\n").trim();
    if (joined) blocks.push({ kind: "paragraph", text: joined });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const captionMatch = TABLE_CAPTION.exec(line);
    // Only a caption if a table actually follows; otherwise the line is
    // ordinary prose and is kept verbatim, underscore and all.
    if (captionMatch && TABLE_ROW.test(lines[i + 1] ?? "")) {
      flush();
      caption = captionMatch[1];
      continue;
    }

    if (TABLE_ROW.test(line)) {
      flush();
      const block: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) block.push(lines[i++]);
      i--;

      const rows = block.filter((l) => !TABLE_RULE.test(l)).map(cells);
      blocks.push({ kind: "table", caption, header: rows[0] ?? [], rows: rows.slice(1) });
      caption = null;
      continue;
    }

    paragraph.push(line);
  }

  flush();
  return blocks;
}
