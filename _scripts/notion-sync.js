/**
 * Notion Database → Jekyll Markdown Exporter
 */

const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const moment = require("moment");
const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

// Initialize clients
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

// Convert Notion-hosted images to Notion proxy URLs
n2m.setCustomTransformer("image", async (block) => {
  const { image } = block;

  // Resolve the original image URL
  const imageUrl = image.type === "file" ? image.file.url : image.external.url;

  // Build a Notion proxy URL
  const blockId = block.id;
  const encodedUrl = encodeURIComponent(imageUrl);
  const proxyUrl = `https://www.notion.so/image/${encodedUrl}?table=block&id=${blockId}&cache=v2`;

  return `![image](${proxyUrl})`;
});

/**
 * Shift Markdown headings down by one level within a Notion-to-Markdown block tree.
 * - heading_1: "# "   -> "## "
 * - heading_2: "## "  -> "### "
 * - heading_3: "### " -> "#### "
 */
function shiftHeadings(blocks) {
  for (const block of blocks) {
    // Shift the Markdown heading prefix by one level based on the Notion block type
    if (block.type === "heading_1") {
      block.parent = block.parent.replace(/^# /, "## ");
    } else if (block.type === "heading_2") {
      block.parent = block.parent.replace(/^## /, "### ");
    } else if (block.type === "heading_3") {
      block.parent = block.parent.replace(/^### /, "#### ");
    }

    // Recursively process nested children (e.g., headings inside a toggle)
    if (block.children && block.children.length > 0) {
      shiftHeadings(block.children);
    }
  }
}

(async () => {
  // Read required environment variables
  const databaseId = process.env.DATABASE_ID;
  if (!databaseId) {
    throw new Error("Missing required environment variable: DATABASE_ID");
  }
  if (!process.env.NOTION_TOKEN) {
    throw new Error("Missing required environment variable: NOTION_TOKEN");
  }

  // Query only published pages
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: "published",
      checkbox: { equals: true },
    },
    sorts: [
      {
        property: "date",
        direction: "ascending",
      },
    ],
  });

  console.log(`Converting ${response.results.length} post(s)...`);

  // Output directory
  const folder = "_posts"; // TODO: update if exporting to a different collection/menu
  mkdirSync(folder, { recursive: true });

  // Convert each page to Markdown and write to `_posts`
  for (const page of response.results) {
    // Title (title property)
    const title = page.properties?.title?.title?.[0]?.plain_text || "Untitled";

    // Page ID (permalink slug); fall back to the Notion page ID
    const pageId =
      page.properties?.page_id?.rich_text?.[0]?.plain_text ||
      page.id.replace(/-/g, "");

    // Description (rich_text)
    const description =
      page.properties?.description?.rich_text?.[0]?.plain_text || "";

    // Thumbnail URL (rich_text)
    // Include `image:` front matter only if a thumbnail URL exists
    const thumbnailUrl =
      page.properties?.thumbnail_url?.rich_text?.[0]?.plain_text;
    const imageFrontmatter = thumbnailUrl
      ? `image:
  path: "${thumbnailUrl}"
  alt: "preview image"
`
      : "";

    // Category (select)
    const category = page.properties?.category?.select?.name || "blog";

    // Tags (multi_select)
    const tags = (page.properties?.tags?.multi_select || []).map((t) => t.name);

    // Date (date)
    const date =
      page.properties?.date?.date?.start || moment().format("YYYY-MM-DD");

    // Convert Notion blocks to Markdown
    const mdBlocks = await n2m.pageToMarkdown(page.id);
    shiftHeadings(mdBlocks); // Shift Markdown headings

    const mdString = n2m.toMarkdownString(mdBlocks);

    const frontmatter = `---
title: "${title}"
date: ${date}
categories: ["${category}"]
tags: ["${tags.join('", "')}"]
description: "${description}"
permalink: /posts/${pageId}
math: true
${imageFrontmatter}---

`;

    // Filename: YYYY-MM-DD-<pageId>.md
    const filename = `${date}-${pageId}.md`;
    const filepath = join(folder, filename);

    // Write file
    writeFileSync(filepath, frontmatter + mdString.parent);
    console.log(`Generated: ${filename}`);
  }
})().catch((err) => {
  // Standard error reporting
  console.error("Export failed:", err);
  process.exitCode = 1;
});
