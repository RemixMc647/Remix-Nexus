// autoCleanup.js
// Automatically trims old messages when the database gets close to its storage cap.
// NEVER touches users, auth, or account data — only message collections.

const MB = 1024 * 1024;

/**
 * Runs a storage check and, if usage is above the threshold, deletes the
 * oldest messages (across one or more message collections) in batches
 * until usage drops back under the target. Never touches non-message
 * collections (users, auth, blocks, etc.) — only whatever you list in
 * `options.collections`.
 *
 * @param {import('mongodb').Db} db - your connected MongoDB db instance
 * @param {Object} options
 * @param {number} options.maxStorageMB - your plan's cap (e.g. 512 for free tier)
 * @param {number} options.triggerPercent - start cleanup at this % full (e.g. 85)
 * @param {number} options.targetPercent - stop cleanup once back under this % (e.g. 70)
 * @param {Array<{name: string, dateField: string}>} options.collections -
 *   the message collections to trim, e.g.
 *   [{ name: 'directmessages', dateField: 'time' }, { name: 'roommessages', dateField: 'time' }]
 * @param {number} options.batchSize - how many docs to delete per pass, per collection (default 500)
 * @param {boolean} options.dryRun - if true, logs what WOULD be deleted but doesn't delete
 */
async function runAutoCleanup(db, options = {}) {
  const {
    maxStorageMB = 512,
    triggerPercent = 85,
    targetPercent = 70,
    collections = [{ name: 'messages', dateField: 'createdAt' }],
    batchSize = 500,
    dryRun = false,
  } = options;

  const maxBytes = maxStorageMB * MB;
  const triggerBytes = maxBytes * (triggerPercent / 100);
  const targetBytes = maxBytes * (targetPercent / 100);

  const stats = await db.stats();
  const usedBytes = stats.dataSize + stats.indexSize;
  const usedPercent = ((usedBytes / maxBytes) * 100).toFixed(1);

  console.log(`[autoCleanup] DB usage: ${(usedBytes / MB).toFixed(1)}MB / ${maxStorageMB}MB (${usedPercent}%)`);

  if (usedBytes < triggerBytes) {
    console.log(`[autoCleanup] Below trigger threshold (${triggerPercent}%) — no action needed.`);
    return { triggered: false, deletedCount: 0 };
  }

  console.log(`[autoCleanup] Usage above ${triggerPercent}% — starting cleanup of: ${collections.map((c) => c.name).join(', ')}...`);

  let totalDeleted = 0;
  let currentUsedBytes = usedBytes;
  const maxIterations = 100; // safety cap so this can never run forever
  let iterations = 0;

  while (currentUsedBytes > targetBytes && iterations < maxIterations) {
    iterations++;
    let deletedThisRound = 0;

    // Delete an oldest-batch from each configured collection, one round at a
    // time, so cleanup is spread proportionally instead of draining just one.
    for (const { name, dateField } of collections) {
      const coll = db.collection(name);
      const oldestBatch = await coll
        .find({}, { projection: { _id: 1 } })
        .sort({ [dateField]: 1 })
        .limit(batchSize)
        .toArray();

      if (oldestBatch.length === 0) continue;

      const idsToDelete = oldestBatch.map((doc) => doc._id);

      if (dryRun) {
        console.log(`[autoCleanup] DRY RUN — would delete ${idsToDelete.length} docs from "${name}".`);
        deletedThisRound += idsToDelete.length;
        continue;
      }

      const result = await coll.deleteMany({ _id: { $in: idsToDelete } });
      deletedThisRound += result.deletedCount;
      console.log(`[autoCleanup] Deleted ${result.deletedCount} docs from "${name}" (pass ${iterations}).`);
    }

    totalDeleted += deletedThisRound;

    if (dryRun) break; // dry run only simulates one pass
    if (deletedThisRound === 0) {
      console.log('[autoCleanup] No more messages to delete in any collection.');
      break;
    }

    // Re-check storage after this round
    const newStats = await db.stats();
    currentUsedBytes = newStats.dataSize + newStats.indexSize;
  }

  const finalPercent = ((currentUsedBytes / maxBytes) * 100).toFixed(1);
  console.log(`[autoCleanup] Done. Deleted ${totalDeleted} messages total. Usage now ~${finalPercent}%.`);

  return { triggered: true, deletedCount: totalDeleted };
}

/**
 * Schedules the cleanup check to run on an interval (e.g. every hour).
 * Call this once at server startup.
 */
function scheduleAutoCleanup(db, options = {}, intervalMs = 60 * 60 * 1000) {
  runAutoCleanup(db, options).catch((err) => console.error('[autoCleanup] Error:', err));

  const handle = setInterval(() => {
    runAutoCleanup(db, options).catch((err) => console.error('[autoCleanup] Error:', err));
  }, intervalMs);

  return handle; // save this if you ever want to clearInterval()
}

module.exports = { runAutoCleanup, scheduleAutoCleanup };
