import { asc, and, eq } from "drizzle-orm";
import { db, providerKeysTable } from "@workspace/db";
import { decryptProviderKey } from "./secretVault";
import { classifyProviderResponse } from "./providerRegistry";

type MediaKind = "image" | "video" | "audio";
type MediaSource = "openverse" | "wikimedia" | "archive" | "pexels" | "pixabay" | "unsplash";
export type MediaOrientation = "landscape" | "portrait" | "square" | undefined;
export type CatalogItem = {
  id: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string | null;
  source: string;
  license: string;
  licenseUrl: string | null;
  creator: string | null;
  mediaType: MediaKind;
};

function publicUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function cleanResult(
  item: CatalogItem,
  requestedKind: MediaKind,
): CatalogItem[] {
  const url = publicUrl(item.url);
  if (!url) return [];
  return [{
    ...item,
    url,
    thumbnailUrl: publicUrl(item.thumbnailUrl),
    mediaType: requestedKind,
    title: item.title.slice(0, 1000) || "Untitled media",
    description: item.description.slice(0, 4000),
  }];
}

async function jsonRequest(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "AI-Cinema-Studio/1.0", ...headers },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The caller receives a clear upstream failure below.
  }
  return { response, text, payload };
}

function openverseUrl(kind: MediaKind, term: string, page: number): URL {
  const endpoint = kind === "audio" ? "audio" : `${kind}s`;
  const url = new URL(`https://api.openverse.org/v1/${endpoint}/`);
  url.searchParams.set("q", term);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", "24");
  return url;
}

async function searchOpenverse(term: string, kind: MediaKind, page: number) {
  const { response, text, payload } = await jsonRequest(openverseUrl(kind, term, page));
  if (!response.ok) throw new Error(`Openverse search failed (HTTP ${response.status}).`);
  const rows = Array.isArray(payload.results) ? payload.results as Array<Record<string, unknown>> : [];
  const results = rows.flatMap((item, index) => cleanResult({
    id: typeof item.id === "string" ? item.id : `${page}-${index}`,
    title: typeof item.title === "string" ? item.title : "Untitled media",
    description: typeof item.description === "string" ? item.description : "",
    url: typeof item.url === "string" ? item.url : "",
    thumbnailUrl: typeof item.thumbnail === "string" ? item.thumbnail : null,
    source: typeof item.source === "string" ? item.source : "Openverse",
    license: typeof item.license === "string" ? item.license : "Check source page",
    licenseUrl: typeof item.license_url === "string" ? item.license_url : null,
    creator: typeof item.creator === "string" ? item.creator : null,
    mediaType: kind,
  }, kind));
  return {
    results,
    total: Number(payload.result_count ?? 0),
    source: "Openverse",
    upstreamBody: text.slice(0, 4000),
  };
}

async function searchWikimedia(term: string, kind: MediaKind, page: number) {
  if (kind !== "image") {
    throw new Error("Wikimedia Commons image search is available here; use Openverse or Internet Archive for audio and video.");
  }
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", term);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "24");
  url.searchParams.set("gsroffset", String((page - 1) * 24));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "480");
  url.searchParams.set("format", "json");
  const { response, payload } = await jsonRequest(url);
  if (!response.ok) throw new Error(`Wikimedia Commons search failed (HTTP ${response.status}).`);
  const query = payload.query as { pages?: Record<string, Record<string, unknown>> } | undefined;
  const pages = Object.values(query?.pages ?? {});
  const results = pages.flatMap((item) => {
    const info = (item.imageinfo as Array<Record<string, unknown>> | undefined)?.[0];
    const meta = info?.extmetadata as Record<string, { value?: string }> | undefined;
    const title = typeof item.title === "string" ? item.title.replace(/^File:/, "") : "Untitled image";
    const fileUrl = publicUrl(info?.url);
    if (!fileUrl) return [];
    return cleanResult({
      id: String(item.pageid ?? title),
      title,
      description: "",
      url: fileUrl,
      thumbnailUrl: typeof info?.thumburl === "string" ? info.thumburl : fileUrl,
      source: "Wikimedia Commons",
      license: meta?.LicenseShortName?.value ?? "Check file page",
      licenseUrl: meta?.LicenseUrl?.value ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(item.title ?? ""))}`,
      creator: meta?.Artist?.value?.replace(/<[^>]*>/g, "") ?? null,
      mediaType: "image",
    }, "image");
  });
  return { results, total: results.length, source: "Wikimedia Commons" };
}

async function searchArchive(term: string, kind: MediaKind, page: number) {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", `${term} AND mediatype:${kind === "image" ? "image" : kind === "video" ? "movies" : "audio"}`);
  for (const field of ["identifier", "title", "creator"]) url.searchParams.append("fl[]", field);
  url.searchParams.set("rows", "20");
  url.searchParams.set("page", String(page));
  url.searchParams.set("output", "json");
  const { response, payload } = await jsonRequest(url);
  if (!response.ok) throw new Error(`Internet Archive search failed (HTTP ${response.status}).`);
  const responseRoot = payload.response as { docs?: Array<Record<string, unknown>>; numFound?: number } | undefined;
  const docs = responseRoot?.docs ?? [];
  const results = await Promise.all(docs.map(async (item): Promise<CatalogItem[]> => {
    const identifier = typeof item.identifier === "string" ? item.identifier : "";
    if (!/^[a-zA-Z0-9._-]{1,200}$/.test(identifier)) return [];
    const metadataUrl = new URL(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const metadataRequest = await jsonRequest(metadataUrl).catch(() => null);
    if (!metadataRequest?.response.ok) return [];
    const files = (metadataRequest.payload.files as Array<Record<string, unknown>> | undefined) ?? [];
    const file = files.find((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
      const format = typeof candidate.format === "string" ? candidate.format.toLowerCase() : "";
      return kind === "image"
        ? /\.(jpg|jpeg|png|webp)$/.test(name) || format.includes("jpeg")
        : kind === "video"
          ? /\.(mp4|m4v|webm|ogv)$/.test(name) || format.includes("mpeg4")
          : /\.(mp3|ogg|flac|wav|m4a)$/.test(name) || format.includes("mp3");
    });
    if (!file || typeof file.name !== "string") return [];
    const fileUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${file.name.split("/").map(encodeURIComponent).join("/")}`;
    const itemUrl = `https://archive.org/details/${encodeURIComponent(identifier)}`;
    return cleanResult({
      id: identifier,
      title: typeof item.title === "string" ? item.title : identifier,
      description: "Rights vary by item. Review the item record before reuse.",
      url: fileUrl,
      thumbnailUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
      source: "Internet Archive",
      license: "Rights vary; check item record",
      licenseUrl: itemUrl,
      creator: typeof item.creator === "string" ? item.creator : null,
      mediaType: kind,
    }, kind);
  }));
  return {
    results: results.flat(),
    total: Number(responseRoot?.numFound ?? 0),
    source: "Internet Archive",
  };
}

async function userMediaKey(userId: string, provider: "pexels" | "pixabay" | "unsplash") {
  const rows = await db.select().from(providerKeysTable).where(and(
    eq(providerKeysTable.userId, userId),
    eq(providerKeysTable.provider, provider),
    eq(providerKeysTable.serviceType, "media"),
    eq(providerKeysTable.enabled, true),
  )).orderBy(asc(providerKeysTable.priority), asc(providerKeysTable.createdAt));
  const now = Date.now();
  return rows.find((row) => row.status !== "invalid" && (!row.cooldownUntil || row.cooldownUntil.getTime() <= now));
}

async function searchKeyedSource(
  userId: string,
  provider: "pexels" | "pixabay" | "unsplash",
  term: string,
  kind: MediaKind,
  page: number,
  orientation?: MediaOrientation,
) {
  const keyRow = await userMediaKey(userId, provider);
  if (!keyRow) {
    const title = provider === "pexels" ? "Pexels" : provider === "pixabay" ? "Pixabay" : "Unsplash";
    throw new Error(`Add an enabled ${title} API key in Provider settings to search this source.`);
  }
  const key = decryptProviderKey(keyRow.encryptedKey);
  const perPage = 24;
  let url: URL;
  let headers: Record<string, string> = {};
  if (provider === "pexels") {
    if (kind === "audio") throw new Error("Pexels provides image and video search here, not audio.");
    const isVideo = kind === "video";
    url = new URL(isVideo ? "https://api.pexels.com/videos/search" : "https://api.pexels.com/v1/search");
    url.searchParams.set("query", term);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (orientation) url.searchParams.set("orientation", orientation);
    headers = { Authorization: key };
  } else if (provider === "pixabay") {
    if (kind === "audio") throw new Error("Pixabay image and video search is available; use Openverse for audio.");
    url = new URL(`https://pixabay.com/api/${kind === "video" ? "videos/" : ""}`);
    url.searchParams.set("key", key);
    url.searchParams.set("q", term);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (orientation) url.searchParams.set("orientation", orientation === "landscape" ? "horizontal" : orientation === "portrait" ? "vertical" : "all");
  } else {
    if (kind !== "image") throw new Error("Unsplash search is available for photos; use Openverse for audio and video.");
    url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", term);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    if (orientation) url.searchParams.set("orientation", orientation);
    url.searchParams.set("client_id", key);
  }

  const { response, text, payload } = await jsonRequest(url, headers);
  if (!response.ok) {
    const classification = classifyProviderResponse(response.status, text);
    const cooldownUntil = ["quota_limited", "rate_limited"].includes(classification.status)
      ? new Date(Date.now() + 60_000)
      : null;
    await db.update(providerKeysTable).set({
      status: classification.status,
      testMessage: classification.message,
      cooldownUntil,
    }).where(eq(providerKeysTable.id, keyRow.id));
    throw new Error(classification.message);
  }

  const rows = provider === "pexels"
    ? (kind === "video" ? payload.videos : payload.photos) as Array<Record<string, unknown>> | undefined
    : provider === "pixabay"
      ? (kind === "video" ? payload.hits : payload.hits) as Array<Record<string, unknown>> | undefined
      : (payload.results as Array<Record<string, unknown>> | undefined);
  const results = (rows ?? []).flatMap((item, index) => {
    let id: string;
    let title: string;
    let imageUrl: string | null;
    let thumbnail: string | null;
    let creator: string | null;
    let license: string;
    let sourcePage: string | null;
    if (provider === "pexels") {
      const videoFiles = item.video_files as Array<{ link?: string }> | undefined;
      const imageSources = item.src as Record<string, string> | undefined;
      id = String(item.id ?? index);
      title = typeof item.url === "string" ? `Pexels ${kind}` : `Pexels ${kind}`;
      imageUrl = kind === "video"
        ? videoFiles?.find((file) => publicUrl(file.link))?.link ?? null
        : imageSources?.original ?? imageSources?.large ?? null;
      thumbnail = typeof item.image === "string" ? item.image : imageSources?.medium ?? imageUrl;
      creator = (item.user as { name?: string } | undefined)?.name ?? null;
      license = "Pexels License";
      sourcePage = typeof item.url === "string" ? item.url : "https://www.pexels.com/license/";
    } else if (provider === "pixabay") {
      id = String(item.id ?? index);
      title = typeof item.tags === "string" ? item.tags : `Pixabay ${kind}`;
      imageUrl = kind === "video"
        ? ((item.videos as Record<string, { url?: string }> | undefined)?.large?.url
          ?? (item.videos as Record<string, { url?: string }> | undefined)?.medium?.url
          ?? null)
        : (typeof item.largeImageURL === "string" ? item.largeImageURL : null);
      thumbnail = typeof item.previewURL === "string" ? item.previewURL : null;
      creator = typeof item.user === "string" ? item.user : null;
      license = "Pixabay Content License";
      sourcePage = typeof item.pageURL === "string" ? item.pageURL : "https://pixabay.com/service/license-summary/";
    } else {
      id = typeof item.id === "string" ? item.id : String(index);
      title = typeof item.alt_description === "string" ? item.alt_description : "Unsplash photo";
      const images = item.urls as Record<string, string> | undefined;
      imageUrl = images?.full ?? images?.regular ?? null;
      thumbnail = images?.small ?? null;
      creator = (item.user as { name?: string } | undefined)?.name ?? null;
      license = "Unsplash License";
      sourcePage = typeof item.links === "object" && item.links
        ? (item.links as { html?: string }).html ?? "https://unsplash.com/license"
        : "https://unsplash.com/license";
    }
    if (!imageUrl) return [];
    return cleanResult({
      id,
      title,
      description: "",
      url: imageUrl,
      thumbnailUrl: thumbnail,
      source: provider === "pexels" ? "Pexels" : provider === "pixabay" ? "Pixabay" : "Unsplash",
      license,
      licenseUrl: sourcePage,
      creator,
      mediaType: kind,
    }, kind);
  });
  const total = provider === "pexels"
    ? Number(kind === "video" ? payload.total_results ?? 0 : payload.total_results ?? 0)
    : provider === "pixabay"
      ? Number(payload.totalHits ?? 0)
      : Number(payload.total ?? 0);
  await db.update(providerKeysTable).set({
    status: "valid",
    usedCount: keyRow.usedCount + 1,
    cooldownUntil: null,
  }).where(eq(providerKeysTable.id, keyRow.id));
  return { results, total, source: provider };
}

export async function searchMediaCatalog({
  userId,
  q,
  mediaType,
  source,
  page,
  orientation,
}: {
  userId: string;
  q: string;
  mediaType: MediaKind;
  source: MediaSource;
  page: number;
  orientation?: MediaOrientation;
}) {
  if (source === "openverse") return searchOpenverse(q, mediaType, page);
  if (source === "wikimedia") return searchWikimedia(q, mediaType, page);
  if (source === "archive") return searchArchive(q, mediaType, page);
  return searchKeyedSource(userId, source, q, mediaType, page, orientation);
}
