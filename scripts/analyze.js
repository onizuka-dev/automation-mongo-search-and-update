const fs = require('fs');
const path = require('path');
const {
  getEnv,
  connectToDb,
  getCollectionUrl,
  buildDocumentUrl,
  ensureReportsDir,
  getTimestamp,
  walkAndCountOccurrences,
  listCollectionNames,
} = require('./lib');

(async () => {
  const searchUrl = getEnv('SEARCH_URL', undefined, true);

  const { client, db, config } = await connectToDb();
  const collectionNames = await listCollectionNames(db);

  console.log(`[analyze] Connected to DB: ${config.dbName}`);
  console.log(`[analyze] Searching for occurrences of: ${searchUrl}`);

  const reportsDir = ensureReportsDir();
  const timestamp = getTimestamp();
  const jsonReportPath = path.join(reportsDir, `search-report-${timestamp}.json`);
  const csvReportPath = path.join(reportsDir, `search-report-${timestamp}.csv`);
  const txtReportPath = path.join(reportsDir, `search-report-${timestamp}.txt`);

  let totalDocuments = 0;
  let totalDocumentsWithMatches = 0;
  let totalOccurrences = 0;
  const entries = [];
  const perCollection = {};

  for (const name of collectionNames) {
    const collection = db.collection(name);
    const collectionUrl = getCollectionUrl(process.env.MONGODB_URI, config.dbName, name);
    console.log(`[analyze] Scanning collection: ${name} (URL: ${collectionUrl})`);

    let colDocs = 0;
    let colMatchDocs = 0;
    let colOccurrences = 0;

    const cursor = collection.find({}, { noCursorTimeout: false });
    for await (const doc of cursor) {
      totalDocuments += 1;
      colDocs += 1;
      const { totalCount, fieldCounts } = walkAndCountOccurrences(doc, searchUrl);
      if (totalCount > 0) {
        totalOccurrences += totalCount;
        colOccurrences += totalCount;
        totalDocumentsWithMatches += 1;
        colMatchDocs += 1;
        const slug = doc.slug ?? null;
        const docUrl = buildDocumentUrl(slug);
        const fields = Array.from(fieldCounts.entries())
          .map(([pathKey, count]) => ({ path: pathKey, count }));
        entries.push({ collection: name, id: String(doc._id), slug, docUrl, totalOccurrences: totalCount, fields });

        console.log(`[analyze] Match in ${name} doc ${doc._id} (${docUrl}) with ${totalCount} occurrence(s)`);
      }
    }

    perCollection[name] = {
      collection: name,
      collectionUrl,
      documents: colDocs,
      documentsWithMatches: colMatchDocs,
      occurrences: colOccurrences,
    };
  }

  const summary = {
    database: config.dbName,
    searchUrl,
    totalDocuments,
    totalDocumentsWithMatches,
    totalOccurrences,
    perCollection,
    generatedAt: new Date().toISOString(),
  };

  const report = { summary, entries };
  fs.writeFileSync(jsonReportPath, JSON.stringify(report, null, 2));

  const csvHeader = ['collection', 'id', 'slug', 'docUrl', 'totalOccurrences', 'fields'].join(',');
  const csvLines = [csvHeader];
  for (const e of entries) {
    const fieldsStr = e.fields.map((f) => `${f.path}:${f.count}`).join(';');
    const line = [
      JSON.stringify(e.collection),
      JSON.stringify(e.id),
      JSON.stringify(e.slug ?? ''),
      JSON.stringify(e.docUrl),
      String(e.totalOccurrences),
      JSON.stringify(fieldsStr),
    ].join(',');
    csvLines.push(line);
  }
  fs.writeFileSync(csvReportPath, csvLines.join('\n'));

  // Write TXT with only URLs (one per line)
  const urlLines = entries.map((e) => e.docUrl).join('\n');
  fs.writeFileSync(txtReportPath, urlLines + (urlLines.endsWith('\n') ? '' : '\n'));

  console.log(`[analyze] Report written: ${jsonReportPath}`);
  console.log(`[analyze] CSV written: ${csvReportPath}`);
  console.log(`[analyze] TXT written: ${txtReportPath}`);
  console.log(`[analyze] Summary: ${totalDocumentsWithMatches}/${totalDocuments} documents with matches, total occurrences: ${totalOccurrences}`);

  await client.close();
})().catch((err) => {
  console.error('[analyze] Error:', err);
  process.exitCode = 1;
});
