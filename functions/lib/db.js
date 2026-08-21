const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const COLLECTION = 'cantina_kv';

async function kvGet(key) {
  const snap = await db.collection(COLLECTION).doc(key).get();
  return snap.exists ? snap.data().v : null;
}

async function kvSet(key, value) {
  await db.collection(COLLECTION).doc(key).set({ v: value });
}

async function kvListWithValues(prefix) {
  const snap = await db.collection(COLLECTION)
    .where(admin.firestore.FieldPath.documentId(), '>=', prefix)
    .where(admin.firestore.FieldPath.documentId(), '<', prefix + '')
    .get();
  return snap.docs.map(d => ({ key: d.id, value: d.data().v }));
}

module.exports = { admin, db, COLLECTION, kvGet, kvSet, kvListWithValues };
