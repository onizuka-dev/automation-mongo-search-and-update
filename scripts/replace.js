const {
  getEnv,
  connectToCollection,
  getCollectionUrl,
  buildDocumentUrl,
  ensureReportsDir,
  walkAndReplace,
  parseArgs,
  readJson,
  findLatestReportFile,
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

  const { client, collection, config } = await connectToCollection();
  const collectionUrl = getCollectionUrl(config.uri, config.dbName, config.collectionName);
  console.log(`[replace] Connected to collection: ${config.collectionName} (URL: ${collectionUrl})`);
  console.log(`[replace] Using report: ${reportPath}`);
  console.log(`[replace] Replacing ${searchUrl} -> ${replaceUrl} | dryRun=${dryRun} | limit=${limit ?? 'none'}`);

  const report = readJson(reportPath);
  const ids = report.entries.map((e) => e.id);

  let processed = 0;
  let updatedDocuments = 0;
  let totalReplacements = 0;

  for (const id of ids) {
    if (limit !== undefined && processed >= limit) break;
    processed += 1;

    const doc = await collection.findOne({ _id: require('mongodb').ObjectId.createFromHexString(id) }).catch(() => null);
    if (!doc) continue;

    const { updated, replacements } = walkAndReplace(doc, searchUrl, replaceUrl);
    if (replacements > 0) {
      const docUrl = buildDocumentUrl(updated.slug ?? doc.slug);
      console.log(`[replace] Doc ${id} (${docUrl}) -> ${replacements} replacement(s)`);

      totalReplacements += replacements;
      if (!dryRun) {
        // Replace the entire document, preserving the _id
        await collection.replaceOne({ _id: doc._id }, updated, { upsert: false });
        updatedDocuments += 1;
      }
    }
  }

  console.log(`[replace] Completed. Updated documents: ${updatedDocuments} | Total replacements: ${totalReplacements} | Processed (from report): ${processed}`);

  await client.close();
})().catch((err) => {
  console.error('[replace] Error:', err);
  process.exitCode = 1;
});
