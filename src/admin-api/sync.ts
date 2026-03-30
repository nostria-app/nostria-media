import HttpErrors from "http-errors";
import { IncomingMessage } from "node:http";
import mount from "koa-mount";
import { koaBody } from "koa-body";

import router from "./router.js";
import { blobDB } from "../db/db.js";
import logger from "../logger.js";
import { addFromUpload } from "../storage/index.js";
import { removeUpload, saveFromResponse, UploadDetails } from "../storage/upload.js";
import { makeHTTPRequest } from "../transport/http.js";

const log = logger.extend("admin-sync");
const DEFAULT_REMOTE_ADMIN_USERNAME = "admin";
const DEFAULT_PAGE_SIZE = 100;

type RemoteBlob = {
  id: string;
  sha256: string;
  type?: string;
  size: number;
  uploaded: number;
  owners?: string[];
  url?: string;
};

type FullSyncRequestBody = {
  url?: string;
  password?: string;
  username?: string;
};

type SyncFailure = {
  sha256: string;
  url: string;
  reason: string;
};

type FullSyncResult = {
  source: string;
  synced: number;
  skipped: number;
  ownersAdded: number;
  failed: number;
  failures: SyncFailure[];
};

let activeSync: Promise<FullSyncResult> | null = null;

function getRemoteAdminAuth(username: string, password: string) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
}

function normalizeRemoteOrigin(rawUrl: string) {
  let remote: URL;
  try {
    remote = new URL(rawUrl);
  } catch {
    throw new HttpErrors.BadRequest("Remote server URL must be absolute");
  }

  if (remote.protocol !== "http:" && remote.protocol !== "https:")
    throw new HttpErrors.BadRequest("Remote server URL must use http or https");

  return new URL(remote.origin);
}

function buildRemoteListUrl(remoteOrigin: URL, offset: number, pageSize: number) {
  const url = new URL("/api/blobs", remoteOrigin);
  url.searchParams.set("sort", JSON.stringify(["uploaded", "ASC"]));
  url.searchParams.set("range", JSON.stringify([offset, offset + pageSize]));
  return url;
}

function resolveRemoteBlobUrl(remoteOrigin: URL, blob: RemoteBlob) {
  if (blob.url) return new URL(blob.url, remoteOrigin).toString();
  return new URL(`/${blob.sha256}`, remoteOrigin).toString();
}

function getResponseStatus(error: unknown) {
  if (typeof error === "object" && error && "statusCode" in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number") return status;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "statusMessage" in error) {
    const statusMessage = (error as { statusMessage?: unknown }).statusMessage;
    if (typeof statusMessage === "string" && statusMessage.length > 0) return statusMessage;
  }
  return "Unknown error";
}

async function readResponseText(response: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readResponseJson<T>(response: IncomingMessage) {
  const text = await readResponseText(response);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpErrors.BadGateway("Remote instance returned invalid JSON");
  }
}

async function fetchRemoteBlobPage(remoteOrigin: URL, authHeader: string, offset: number, pageSize: number) {
  try {
    const response = await makeHTTPRequest(buildRemoteListUrl(remoteOrigin, offset, pageSize), {
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
    });

    const body = await readResponseJson<unknown>(response);
    if (!Array.isArray(body)) throw new HttpErrors.BadGateway("Remote instance returned an invalid blob list");

    return body as RemoteBlob[];
  } catch (error) {
    const status = getResponseStatus(error);

    if (status === 401 || status === 403) throw new HttpErrors.Unauthorized("Remote admin password was rejected");
    if (status === 404) throw new HttpErrors.BadGateway("Remote admin API does not expose /api/blobs");

    throw new HttpErrors.BadGateway(`Failed to load remote blobs: ${getErrorMessage(error)}`);
  }
}

function syncBlobOwners(blob: RemoteBlob) {
  let ownersAdded = 0;

  for (const owner of blob.owners ?? []) {
    if (typeof owner !== "string" || owner.length === 0) continue;
    if (blobDB.hasOwner(blob.sha256, owner)) continue;

    blobDB.addOwner(blob.sha256, owner);
    ownersAdded++;
  }

  return ownersAdded;
}

async function syncRemoteBlob(remoteOrigin: URL, blob: RemoteBlob) {
  if (!blob.sha256) throw new Error("Remote blob is missing sha256");

  if (blobDB.hasBlob(blob.sha256)) {
    return {
      synced: false,
      ownersAdded: syncBlobOwners(blob),
    };
  }

  let upload: UploadDetails | undefined = undefined;

  try {
    const response = await makeHTTPRequest(resolveRemoteBlobUrl(remoteOrigin, blob));
    upload = await saveFromResponse(response);

    if (upload.sha256 !== blob.sha256) throw new Error("Downloaded blob hash mismatch");

    await addFromUpload(upload, blob.type, { uploaded: blob.uploaded });

    return {
      synced: true,
      ownersAdded: syncBlobOwners(blob),
    };
  } catch (error) {
    if (upload) await removeUpload(upload);
    throw error;
  }
}

async function runFullSync(remoteOrigin: URL, username: string, password: string): Promise<FullSyncResult> {
  const authHeader = getRemoteAdminAuth(username, password);
  const failures: SyncFailure[] = [];
  let synced = 0;
  let skipped = 0;
  let ownersAdded = 0;
  let offset = 0;

  while (true) {
    const blobs = await fetchRemoteBlobPage(remoteOrigin, authHeader, offset, DEFAULT_PAGE_SIZE);
    if (blobs.length === 0) break;

    for (const blob of blobs) {
      try {
        const result = await syncRemoteBlob(remoteOrigin, blob);
        if (result.synced) synced++;
        else skipped++;
        ownersAdded += result.ownersAdded;
      } catch (error) {
        failures.push({
          sha256: blob.sha256,
          url: resolveRemoteBlobUrl(remoteOrigin, blob),
          reason: getErrorMessage(error),
        });
      }
    }

    if (blobs.length < DEFAULT_PAGE_SIZE) break;
    offset += blobs.length;
  }

  const result = {
    source: remoteOrigin.toString(),
    synced,
    skipped,
    ownersAdded,
    failed: failures.length,
    failures,
  };

  log(`Finished full sync from ${result.source}`, result);

  return result;
}

router.use(mount("/sync", koaBody()));

router.post("/sync/full", async (ctx) => {
  if (activeSync) throw new HttpErrors.Conflict("A full sync is already running");

  const body = (ctx.request.body ?? {}) as FullSyncRequestBody;
  const remoteUrl = body.url?.trim();
  const password = body.password?.trim();
  const username = body.username?.trim() || DEFAULT_REMOTE_ADMIN_USERNAME;

  if (!remoteUrl) throw new HttpErrors.BadRequest("Missing remote server URL");
  if (!password) throw new HttpErrors.BadRequest("Missing remote admin password");

  const remoteOrigin = normalizeRemoteOrigin(remoteUrl);

  const syncPromise = runFullSync(remoteOrigin, username, password);
  activeSync = syncPromise;

  try {
    ctx.status = 200;
    ctx.body = await syncPromise;
  } finally {
    if (activeSync === syncPromise) activeSync = null;
  }
});