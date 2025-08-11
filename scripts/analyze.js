const fs = require('fs');
const path = require('path');
const {
  getEnv,
  connectToCollection,
  getCollectionUrl,
  buildDocumentUrl,
  ensureReportsDir,
  getTimestamp,
  walkAndCountOccurrences,
} = require('./lib');

(async () => {
  const searchUrl = getEnv('SEARCH_URL', undefined, true);

  const { client, collection, config } = await connectToCollection();
  const collectionUrl = getCollectionUrl(config.uri, config.dbName, config.collectionName);

  console.log(`[analyze] Connected to collection: ${config.collectionName} (URL: ${collectionUrl})`);
  console.log(`[analyze] Searching for occurrences of: ${searchUrl}`);

  const cursor = collection.find({}, { noCursorTimeout: false });

  const reportsDir = ensureReportsDir();
  const timestamp = getTimestamp();
  const jsonReportPath = path.join(reportsDir, `search-report-${timestamp}.json`);
  const csvReportPath = path.join(reportsDir, `search-report-${timestamp}.csv`);

  let totalDocuments = 0;
  let totalDocumentsWithMatches = 0;
  let totalOccurrences = 0;
  const entries = [];

  for await (const doc of cursor) {
    totalDocuments += 1;
    const { totalCount, fieldCounts } = walkAndCountOccurrences(doc, searchUrl);
    if (totalCount > 0) {
      totalOccurrences += totalCount;
      totalDocumentsWithMatches += 1;
      const slug = doc.slug ?? null;
      const docUrl = buildDocumentUrl(slug);
      const fields = Array.from(fieldCounts.entries())
        .map(([pathKey, count]) => ({ path: pathKey, count }));
      entries.push({ id: String(doc._id), slug, docUrl, totalOccurrences: totalCount, fields });

      console.log(`[analyze] Match in doc ${doc._id} (${docUrl}) with ${totalCount} occurrence(s)`);
    }
  }

  const summary = {
    collection: config.collectionName,
    collectionUrl,
    searchUrl,
    totalDocuments,
    totalDocumentsWithMatches,
    totalOccurrences,
    generatedAt: new Date().toISOString(),
  };

  const report = { summary, entries };
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));

  const csvHeader = ['id', 'slug', 'docUrl', 'totalOccurrences', 'fields'].join(',');
  const csvLines = [csvHeader];
  for (const e of entries) {
    const fieldsStr = e.fields.map((f) => `${f.path}:${f.count}`).join(';');
    const line = [
      JSON.stringify(e.id),
      JSON.stringify(e.slug ?? ''),
      JSON.stringify(e.docUrl),
      String(e.totalOccurrences),
      JSON.stringify(fieldsStr),
    ].join(',');
    csvLines.push(line);
  }
  fs.writeFileSync(csvReportPath, csvLines.join('\n'));

  console.log(`[analyze] Report written: ${jsonReportPath}`);
  console.log(`[analyze] CSV written: ${csvReportPath}`);
  console.log(`[analyze] Summary: ${totalDocumentsWithMatches}/${totalDocuments} documents with matches, total occurrences: ${totalOccurrences}`);

  await client.close();
})().catch((err) => {
  console.error('[analyze] Error:', err);
  process.exitCode = 1;
});
