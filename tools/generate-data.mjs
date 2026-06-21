import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const dbPath = process.argv[2] || "/Users/mandinu/Downloads/recovered.sqlite";
const outPath = resolve(process.argv[3] || "data.js");

function query(sql) {
  const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  return JSON.parse(output || "[]");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function extractMeta(html, label) {
  const text = stripHtml(html);
  const pattern = new RegExp(`${label}\\s*-\\s*([^\\n]+)`, "i");
  return text.match(pattern)?.[1]?.trim() || "";
}

const artists = query(`
  SELECT
    c0 AS id,
    TRIM(c1) AS name,
    c2 AS active,
    c3 AS createdAt,
    COALESCE(c8, 0) AS favorite
  FROM lost_and_found
  WHERE nfield = 9
    AND c0 IS NOT NULL
    AND c1 IS NOT NULL
  GROUP BY c0
  ORDER BY name COLLATE NOCASE
`);

const artistMap = new Map(
  artists.map((artist) => [Number(artist.id), artist.name || "Unknown Artist"]),
);

const songs = query(`
  SELECT
    c0 AS id,
    TRIM(c1) AS title,
    c2 AS active,
    c3 AS songDate,
    c4 AS artistId,
    c5 AS html,
    c6 AS timeGap,
    COALESCE(c9, 0) AS favorite
  FROM lost_and_found
  WHERE nfield = 11
    AND c0 IS NOT NULL
    AND c1 IS NOT NULL
    AND c5 IS NOT NULL
    AND length(c5) > 50
  GROUP BY c0
  ORDER BY title COLLATE NOCASE
`).map((song) => {
  const html = String(song.html || "");
  const text = stripHtml(html);
  return {
    id: Number(song.id),
    title: song.title || "Untitled",
    artistId: song.artistId === null ? null : Number(song.artistId),
    artist: artistMap.get(Number(song.artistId)) || "Unknown Artist",
    date: song.songDate || "",
    key: extractMeta(html, "Key"),
    beat: extractMeta(html, "Beat"),
    timeGap: song.timeGap === null ? null : Number(song.timeGap),
    favorite: Number(song.favorite) === 1,
    html,
    text,
  };
});

const payload = {
  generatedAt: new Date().toISOString(),
  source: dbPath,
  artists,
  songs,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  `window.MCHORD_DATA = ${JSON.stringify(payload)};\n`,
  "utf8",
);

console.log(`Generated ${songs.length} songs and ${artists.length} artists at ${outPath}`);
