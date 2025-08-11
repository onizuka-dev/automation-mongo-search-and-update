const {
  getEnv,
  connectToDb,
  getCollectionUrl,
  buildDocumentUrl,
  ensureReportsDir,
  walkAndReplace,
  parseArgs,
  readJson,
  findLatestReportFile,
  parseId,
} = require('./lib');
const path = require('path');

(async () => {
  const args = parseArgs(process.argv);
  const envDryRun = String(getEnv('DRY_RUN', 'true')).toLowerCase() !== 'false';
  const dryRun = args['dry-run'] !== undefined ? String(args['dry-run']).toLowerCase() !== 'false' : envDryRun;
  const envLimit = getEnv('LIMIT', '');
  const limit = args.limit ? Number(args.limit) : (envLimit ? Number(envLimit) : undefined);

  const searchUrl = getEnv('SEARCH_URL', undefined, true);
  const replaceUrl = getEnv('REPLACE_URL', undefined, true);

  const reportPath = args.from ? path.resolve(String(args.from)) : (findLatestReportFile() || '');
  if (!reportPath) {
    throw new Error('No report file found. Provide with --from=path/to/search-report-*.json');
  }

  const { client, db, config } = await connectToDb();
  console.log(`[replace] Connected to DB: ${config.dbName}`);
  console.log(`[replace] Using report: ${reportPath}`);
  console.log(`[replace] Replacing ${searchUrl} -> ${replaceUrl} | dryRun=${dryRun} | limit=${limit ?? 'none'}`);

  const report = readJson(reportPath);
  const entries = report.entries || [];

  let processed = 0;
  let updatedDocuments = 0;
  let totalReplacements = 0;

  // Group by collection for nicer logs
  const byCollection = new Map();
  for (const e of entries) {
    if (!byCollection.has(e.collection)) byCollection.set(e.collection, []);
    byCollection.get(e.collection).push(e);
  }

  for (const [collectionName, group] of byCollection.entries()) {
    const collection = db.collection(collectionName);
    const collectionUrl = getCollectionUrl(process.env.MONGODB_URI, config.dbName, collectionName);
    console.log(`[replace] Processing collection: ${collectionName} (URL: ${collectionUrl})`);

    for (const e of group) {
      if (limit !== undefined && processed >= limit) break;
      processed += 1;

      const queryId = parseId(e.id);
      const doc = await collection.findOne({ _id: queryId }).catch(() => null);
      if (!doc) continue;

      const { updated, replacements } = walkAndReplace(doc, searchUrl, replaceUrl);
      if (replacements > 0) {
        const docUrl = buildDocumentUrl(updated.slug ?? doc.slug);
        console.log(`[replace] ${collectionName} doc ${e.id} (${docUrl}) -> ${replacements} replacement(s)`);

        totalReplacements += replacements;
        if (!dryRun) {
          await collection.replaceOne({ _id: doc._id }, updated, { upsert: false });
          updatedDocuments += 1;
        }
      }
    }
  }

  console.log(`[replace] Completed. Updated documents: ${updatedDocuments} | Total replacements: ${totalReplacements} | Processed (from report): ${processed}`);

  await client.close();
})().catch((err) => {
  console.error('[replace] Error:', err);
  process.exitCode = 1;
});
