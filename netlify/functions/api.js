// SFP Maintenance System — Netlify Function
const crypto = require("crypto");
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbySWpkDC8MJ0-2VBtPVRptP-jCpT_yBcD92s874XfAQMg03a4zUyNizpEIh9PECkDOx/exec";
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (code, body) => ({
  statusCode: code,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── Sign-in check (Google ID token from the app's sign-in) ────────────────────
const GOOGLE_CLIENT_ID = "991806177035-4icb3cllat3m6rhul5jovjkhjdcrjqd0.apps.googleusercontent.com";
const ALLOWED_DOMAIN   = "sequoiafp.com";
const ALLOWED_EMAILS   = (process.env.ALLOWED_EMAILS || process.env.VITE_ALLOWED_EMAILS || "peter.stroble@gmail.com")
  .split(",").map(e=>e.trim()).filter(Boolean);

async function verifyUser(event) {
  const auth  = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Not signed in");
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const claims = await r.json().catch(()=>({}));
  if (!r.ok || claims.aud !== GOOGLE_CLIENT_ID || claims.email_verified !== "true")
    throw new HttpError(401, "Sign-in expired — reload the page and try again");
  const email = claims.email || "";
  if (!email.endsWith("@"+ALLOWED_DOMAIN) && !ALLOWED_EMAILS.includes(email))
    throw new HttpError(403, "Access restricted to Sequoia Forest Products accounts");
  return { email, name: claims.name || email };
}

// ── Google Drive (machine documents) ──────────────────────────────────────────
// Files live in a Shared Drive folder (DRIVE_FOLDER_ID), one subfolder per PM machine,
// written by the app's Google service account (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY),
// which must be a Content Manager on that Shared Drive. Service accounts have no My Drive quota, so it must be a Shared Drive.
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
// Netlify env vars usually hold the PEM key with literal "\n" escapes
const GOOGLE_PRIVATE_KEY  = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const DRIVE_FOLDER_ID    = process.env.DRIVE_FOLDER_ID;
const DRIVE_SHARE_DOMAIN = process.env.DRIVE_SHARE_DOMAIN ?? ALLOWED_DOMAIN;
const DRIVE_FILE_FIELDS  = "id,name,mimeType,size,webViewLink,createdTime,appProperties,trashed";
const DIRECT_UPLOAD_MAX  = 4 * 1024 * 1024; // keeps base64 under Netlify's 6 MB request limit

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");
let driveTokenCache = null;

async function driveToken() {
  if (driveTokenCache && driveTokenCache.exp > Date.now() + 60_000) return driveTokenCache.token;
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY || !DRIVE_FOLDER_ID)
    throw new HttpError(500, "Document storage isn't set up — GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY and DRIVE_FOLDER_ID must be set in Netlify env vars");
  const now = Math.floor(Date.now()/1000);
  const unsigned = b64url(JSON.stringify({ alg:"RS256", typ:"JWT" })) + "." + b64url(JSON.stringify({
    iss: GOOGLE_CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(GOOGLE_PRIVATE_KEY);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Google auth failed: " + JSON.stringify(data));
  driveTokenCache = { token: data.access_token, exp: Date.now() + data.expires_in*1000 };
  return data.access_token;
}

async function drive(path, { method="GET", body, headers={}, raw=false } = {}) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://www.googleapis.com${path}${sep}supportsAllDrives=true`, {
    method,
    headers: { Authorization: `Bearer ${await driveToken()}`, "Content-Type": "application/json", ...headers },
    body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  if (raw) return r;
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, "Google Drive error: " + (data.error?.message || r.status));
  return data;
}

const qStr = (s) => String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'");

// Find (or create) the subfolder for a PM machine, tagged with its pmId
async function machineFolder(pmId, machine) {
  const q = `'${qStr(DRIVE_FOLDER_ID)}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false` +
    ` and appProperties has { key='pmId' and value='${qStr(pmId)}' }`;
  const found = await drive(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&includeItemsFromAllDrives=true&corpora=allDrives`);
  if (found.files?.length) return found.files[0].id;
  const folder = await drive("/drive/v3/files?fields=id", { method: "POST", body: {
    name: machine || pmId, mimeType: "application/vnd.google-apps.folder",
    parents: [DRIVE_FOLDER_ID], appProperties: { pmId },
  }});
  if (DRIVE_SHARE_DOMAIN) {
    // Let anyone at the company open the files from the app; files inherit this from the folder
    await drive(`/drive/v3/files/${folder.id}/permissions?sendNotificationEmail=false`, { method: "POST",
      body: { type: "domain", role: "reader", domain: DRIVE_SHARE_DOMAIN } })
      .catch(e => console.warn("Domain share failed (Shared Drive members can still open files):", e.message));
  }
  return folder.id;
}

const fileMeta = (body, user, folderId) => ({
  name: String(body.name || "Untitled").slice(0, 250),
  parents: [folderId],
  appProperties: { pmId: String(body.pmId), uploadedBy: user.email },
});

const toDoc = (f) => ({ fileId: f.id, name: f.name, mimeType: f.mimeType, size: +f.size || 0, url: f.webViewLink, createdTime: f.createdTime });

// Only touch files this app created — they carry a pmId appProperty
async function appFile(fileId, pmId) {
  const f = await drive(`/drive/v3/files/${encodeURIComponent(fileId)}?fields=${DRIVE_FILE_FIELDS}`);
  if (!f.appProperties?.pmId || (pmId && f.appProperties.pmId !== String(pmId)))
    throw new HttpError(403, "That file isn't a machine document");
  return f;
}

const DOC_ACTIONS = {
  // Step 1: open a resumable upload session; the browser PUTs the file straight to Google
  async docUploadStart(body, user, event) {
    if (!body.pmId) throw new HttpError(400, "pmId required");
    const folderId = await machineFolder(body.pmId, body.machine);
    const origin   = event.headers?.origin || event.headers?.Origin;
    const r = await drive(`/upload/drive/v3/files?uploadType=resumable&fields=${DRIVE_FILE_FIELDS}`, {
      method: "POST", raw: true, body: fileMeta(body, user, folderId),
      headers: {
        "X-Upload-Content-Type": body.mimeType || "application/octet-stream",
        ...(body.size ? { "X-Upload-Content-Length": String(body.size) } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
    });
    if (!r.ok) throw new HttpError(502, "Google Drive error: " + (await r.text()).slice(0,200));
    return { uploadUrl: r.headers.get("location") };
  },

  // Step 2: confirm the uploaded file and return its link
  async docUploadFinish(body) {
    return toDoc(await appFile(body.fileId, body.pmId));
  },

  // Fallback for small files if the browser can't reach Google's upload URL directly
  async docUploadDirect(body, user) {
    const data = Buffer.from(body.base64 || "", "base64");
    if (!data.length) throw new HttpError(400, "Empty file");
    if (data.length > DIRECT_UPLOAD_MAX) throw new HttpError(413, "File too large");
    const folderId = await machineFolder(body.pmId, body.machine);
    const boundary = "sfp" + crypto.randomBytes(8).toString("hex");
    const multipart = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(fileMeta(body, user, folderId))}\r\n` +
        `--${boundary}\r\nContent-Type: ${body.mimeType || "application/octet-stream"}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    return toDoc(await drive(`/upload/drive/v3/files?uploadType=multipart&fields=${DRIVE_FILE_FIELDS}`, {
      method: "POST", body: multipart, headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    }));
  },

  // Moves the file to the Shared Drive's trash (recoverable for 30 days)
  async docDelete(body) {
    try { await appFile(body.fileId, body.pmId); }
    catch (e) { if (e.status === 404) return { ok: true }; throw e; }
    await drive(`/drive/v3/files/${encodeURIComponent(body.fileId)}?fields=id`, { method: "PATCH", body: { trashed: true } });
    return { ok: true };
  },
};

async function proxyGet(action, extra = {}) {
  const params = new URLSearchParams({ action, ...extra });
  const r = await fetch(`${APPS_SCRIPT_URL}?${params}`);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Bad Apps Script response: " + text.slice(0,200)); }
}

async function proxyPost(body) {
  const r = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error("Bad Apps Script response: " + text.slice(0,200)); }
}

async function extractPassDownItems(base64pdf) {
  if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set in Netlify env vars");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64pdf }},
          { type: "text", text: `This is a handwritten maintenance pass down sheet from a sawmill.
Extract each individual task or note from the handwriting.
Return ONLY a JSON array of strings, one per item. No preamble, no markdown, no explanation.
Example: ["Check lubrication on twin infeed", "Replace belt on green chain #2"]
If you cannot read the handwriting clearly, make your best guess.` }
        ]
      }]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Claude API error: " + JSON.stringify(data));
  const text = data.content?.[0]?.text || "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 200, headers: CORS, body: "" };

  try {
    const action = event.queryStringParameters?.action;

    // Extract pass down items via Claude (server-side, avoids CORS)
    if (action === "extractPassDown" && event.httpMethod === "POST") {
      const { base64 } = JSON.parse(event.body || "{}");
      const items = await extractPassDownItems(base64);
      return json(200, { items });
    }

    // Machine documents in Google Drive (signed-in users only)
    if (DOC_ACTIONS[action] && event.httpMethod === "POST") {
      const user = await verifyUser(event);
      const data = await DOC_ACTIONS[action](JSON.parse(event.body || "{}"), user, event);
      return json(200, data);
    }

    if (event.httpMethod === "GET") {
      const fileId = event.queryStringParameters?.fileId;
      const extra  = fileId ? { fileId } : {};
      const data   = await proxyGet(action, extra);
      return json(200, data);
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const data = await proxyPost(body);
      return json(200, data);
    }

    return json(400, { error: "Unknown method" });

  } catch(e) {
    console.error("Function error:", e.message);
    return json(e.status || 500, { error: e.message || "Server error" });
  }
};
