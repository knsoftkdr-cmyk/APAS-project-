// tools/feature-docs/sync.mjs
// Decides what to write to app_feature_docs and does it. All I/O is injected so it can be tested without a database.

/**
 * @param docs      generated documents for ONE role
 * @param existing  Map(feature_key -> { content_hash, status, embedding_model })
 * @param o         { model, embed }  embed=false skips (re-)embedding
 */
export function planSync(docs, existing, { model, embed = true }) {
  const upsert = [];
  const retire = [];
  let unchanged = 0;
  const seen = new Set(docs.map((d) => d.key));
  for (const d of docs) {
    const row = existing.get(d.key);
    const changed = !row || row.content_hash !== d.contentHash || row.status !== "active";
    const needsVector = embed && (changed || row.embedding_model !== model);
    if (changed || needsVector) upsert.push({ doc: d, why: !row ? "new" : changed ? "changed" : "embedding" });
    else unchanged++;
  }
  for (const [key, row] of existing) if (!seen.has(key) && row.status === "active") retire.push(key);
  return { upsert, retire, unchanged };
}

export function toRow(doc, role, vec, model, toPgVector) {
  return {
    role,
    feature_key: doc.key,
    name: doc.name,
    aliases: doc.aliases,
    keywords: doc.keywords,
    route: doc.route,
    kind: doc.kind,
    content: doc.content,
    search_text: doc.searchText,
    confidence: doc.confidence,
    needs_review: doc.needsReview,
    status: "active",
    removed_at: null,
    content_hash: doc.contentHash,
    // A vector is stored only if it was made for THIS content. If embedding failed, clear any old vector: a stale
    // vector for new text would send students to the wrong feature. Text search still finds the row.
    embedding: vec ? toPgVector(vec) : null,
    embedding_model: vec ? model : null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * @returns {{ upserted:number, embedded:number, embeddingPending:number, retired:number, unchanged:number, plan:object }}
 */
export async function runSync({ supabase, role, docs, embedBatch, toPgVector, model, dryRun = false, embed = true, log = () => {} }) {
  const { data, error } = await supabase.from("app_feature_docs").select("feature_key, content_hash, status, embedding_model").eq("role", role);
  if (error) throw new Error(`could not read app_feature_docs (is the migration applied?): ${error.message}`);
  const existing = new Map((data ?? []).map((r) => [r.feature_key, r]));
  const plan = planSync(docs, existing, { model, embed });
  const summary = { upserted: 0, embedded: 0, embeddingPending: 0, retired: 0, unchanged: plan.unchanged, plan };
  for (const u of plan.upsert) log(`  ${u.why.toUpperCase().padEnd(9)} ${u.doc.name}`);
  for (const k of plan.retire) log(`  RETIRE    ${k}`);
  if (dryRun) return summary;

  const vectors = embed && plan.upsert.length ? await embedBatch(plan.upsert.map((u) => u.doc.searchText)) : plan.upsert.map(() => null);
  const rows = plan.upsert.map((u, i) => toRow(u.doc, role, vectors[i], model, toPgVector));
  summary.embedded = vectors.filter(Boolean).length;
  summary.embeddingPending = embed ? rows.length - summary.embedded : 0;

  for (let i = 0; i < rows.length; i += 25) {
    const { error: e } = await supabase.from("app_feature_docs").upsert(rows.slice(i, i + 25), { onConflict: "role,feature_key" });
    if (e) throw new Error(`upsert failed: ${e.message}`);
    summary.upserted += Math.min(25, rows.length - i);
  }
  if (plan.retire.length) {
    const { error: e } = await supabase.from("app_feature_docs").update({ status: "removed", removed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("role", role).in("feature_key", plan.retire);
    if (e) throw new Error(`retire failed: ${e.message}`);
    summary.retired = plan.retire.length;
  }
  return summary;
}
