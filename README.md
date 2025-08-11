## Mongo Advanced Search & Replace for MongoDB

Tools to:
- Scan all collections in a MongoDB database and report occurrences of a target URL.
- Replace the found URL with a new one, safely and controllably.

### Requirements
- Node.js 18+ (20+ recommended)
- npm
- Access to your MongoDB database

### Install
```bash
npm install
```

### Setup (.env)
Create your `.env` from the example:
```bash
cp .env.example .env
```
Environment variables:
- MONGODB_URI: MongoDB connection string.
- MONGODB_DB: Database name.
- SEARCH_URL: URL to search for in documents.
- REPLACE_URL: URL to replace with.
- BASE_URL: base URL to build a human-friendly doc URL from each document `slug` (default `https://bizee.com`).
- DRY_RUN: `true` (default) does not write changes; set `false` to apply changes.
- LIMIT: optional limit of documents to update (useful for testing).

Note: You do not need `MONGODB_COLLECTION`; the scripts iterate all collections in the DB.

### Commands

#### Analyze all collections
Scans all documents across all collections and generates reports.
```bash
npm run analyze
```
Outputs in `reports/`:
- `search-report-YYYYMMDD-HHMMSS.json`: summary + per-document details.
- `search-report-YYYYMMDD-HHMMSS.csv`: one row per document with fields and counts.
- `search-report-YYYYMMDD-HHMMSS.txt`: only the human-friendly URLs (one per line), e.g.:
  - `https://bizee.com/philadelphia-pennsylvania-llc`

Logs include the collection name and a "collection URL" (derived from the URI and collection name).

#### Replace found URLs
Reads the latest generated report and applies deep replacements (strings anywhere in the document/structure):
```bash
npm run replace
```
By default it is a dry run. To write changes:
```bash
npm run replace -- --dry-run=false
```
Options:
- `--from=/path/to/search-report-*.json`: use a specific report.
- `--dry-run=false|true`: force write or simulation mode.
- `--limit=100`: process only N documents (useful for testing).

### How it works
- Iterates all collections in the DB (`listCollections`).
- For each document, searches for `SEARCH_URL` in any string value (recursively visits objects and arrays) and counts occurrences.
- Report per document includes:
  - `collection`: collection name
  - `id`: `_id` as string
  - `slug`
  - `docUrl`: `BASE_URL` + `slug`
  - `totalOccurrences`
  - `fields`: list of `{ path, count }` for each field with matches
- Replacement:
  - Keeps `_id` unchanged.
  - Replaces all occurrences of `SEARCH_URL` with `REPLACE_URL` in strings.
  - Writes back using `replaceOne` for the whole document (preserves `_id`).
  - Logs are grouped per collection.

### Examples
- Run analysis and inspect the TXT URLs:
  ```bash
  npm run analyze
  ls reports/search-report-*.txt | tail -n 1 | xargs cat
  ```
- Apply real replacements using the latest report:
  ```bash
  npm run replace -- --dry-run=false
  ```
- Apply replacements with a limit of 50 docs and a specific report:
  ```bash
  npm run replace -- --from=reports/search-report-20250101-101500.json --limit=50 --dry-run=false
  ```

### Notes
- If your `_id`s are not 24-hex `ObjectId`s, the script will use the raw value from the report for lookup.
- `docUrl` is built with `BASE_URL` + `slug`. If a document has no `slug`, it falls back to `BASE_URL`.
- For large volumes, test first with `LIMIT` and `DRY_RUN=true`.

### Scripts
- Source code in `scripts/`:
  - `scripts/analyze.js`
  - `scripts/replace.js`
  - `scripts/lib.js`

### License
ISC
