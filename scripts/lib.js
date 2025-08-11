const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
require('dotenv').config();

function getEnv(name, defaultValue, required = false) {
  const value = process.env[name] ?? defaultValue;
  if (required && (value === undefined || value === '')) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function redactMongoUri(uri) {
  try {
    const url = new URL(uri);
    if (url.username || url.password) {
      url.username = '<redacted>';
      url.password = '';
    }
    return url.toString();
  } catch (e) {
    return uri.replace(/:\/\/[^@]+@/, '://<redacted>@');
  }
}

function getMongoConfig() {
  const uri = getEnv('MONGODB_URI', undefined, true);
  const dbName = getEnv('MONGODB_DB', undefined, true);
  const collectionName = getEnv('MONGODB_COLLECTION', undefined, true);
  return { uri, dbName, collectionName };
}

async function connectToCollection() {
  const { uri, dbName, collectionName } = getMongoConfig();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(collectionName);
  return { client, db, collection, config: { uri, dbName, collectionName } };
}

function getCollectionUrl(uri, dbName, collectionName) {
  const sanitized = redactMongoUri(uri);
  const base = sanitized.split('?')[0];
  return `${base}/${dbName}.${collectionName}`;
}

function buildDocumentUrl(slug) {
  const baseUrl = getEnv('BASE_URL', 'https://bizee.com');
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (!slug) return `${normalizedBase}`;
  const normalizedSlug = String(slug).startsWith('/') ? String(slug).slice(1) : String(slug);
  return `${normalizedBase}/${normalizedSlug}`;
}

function ensureReportsDir() {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  return reportsDir;
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const MM = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const HH = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${MM}${dd}-${HH}${mm}${ss}`;
}

function countOccurrencesInString(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function walkAndCountOccurrences(value, searchUrl, currentPath = '') {
  let totalCount = 0;
  const fieldCounts = new Map();

  function visit(node, pathSoFar) {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      const c = countOccurrencesInString(node, searchUrl);
      if (c > 0) {
        totalCount += c;
        fieldCounts.set(pathSoFar, (fieldCounts.get(pathSoFar) || 0) + c);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        visit(node[i], `${pathSoFar}[${i}]`);
      }
      return;
    }

    if (typeof node === 'object') {
      for (const [key, val] of Object.entries(node)) {
        const nextPath = pathSoFar ? `${pathSoFar}.${key}` : key;
        visit(val, nextPath);
      }
    }
  }

  visit(value, currentPath);

  return { totalCount, fieldCounts };
}

function walkAndReplace(value, searchUrl, replaceUrl) {
  let replacements = 0;

  function visit(node) {
    if (node === null || node === undefined) return node;

    if (typeof node === 'string') {
      if (node.includes(searchUrl)) {
        const count = countOccurrencesInString(node, searchUrl);
        replacements += count;
        return node.split(searchUrl).join(replaceUrl);
      }
      return node;
    }

    if (Array.isArray(node)) {
      return node.map((item) => visit(item));
    }

    if (typeof node === 'object') {
      const result = Array.isArray(node) ? [] : {};
      for (const [key, val] of Object.entries(node)) {
        // Never attempt to replace _id value
        if (key === '_id') {
          result[key] = val;
          continue;
        }
        result[key] = visit(val);
      }
      return result;
    }

    return node;
  }

  const updated = visit(value);
  return { updated, replacements };
}

function parseArgs(argv) {
  const args = {};
  for (const part of argv.slice(2)) {
    const [k, v] = part.split('=');
    const key = k.replace(/^--/, '');
    if (v === undefined) {
      args[key] = true;
    } else {
      args[key] = v;
    }
  }
  return args;
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function findLatestReportFile() {
  const reportsDir = ensureReportsDir();
  const files = fs.readdirSync(reportsDir)
    .filter((f) => f.startsWith('search-report-') && f.endsWith('.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(reportsDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(reportsDir, files[0].f) : null;
}

module.exports = {
  getEnv,
  redactMongoUri,
  getMongoConfig,
  connectToCollection,
  getCollectionUrl,
  buildDocumentUrl,
  ensureReportsDir,
  getTimestamp,
  walkAndCountOccurrences,
  walkAndReplace,
  parseArgs,
  readJson,
  findLatestReportFile,
};
