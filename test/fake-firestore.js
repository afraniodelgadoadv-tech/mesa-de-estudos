// Firestore falso em memória para testes (mesma API usada pelo app).
const docs = new Map(); const subs = new Set();
const clone = o => JSON.parse(JSON.stringify(o));
const parts = p => p.split("/");
export const __docs = docs;
export function doc(base, ...segs){ const path = (typeof base === "object" && base.path ? [base.path, ...segs] : segs).join("/"); return {path, id: segs[segs.length-1]}; }
export function collection(db, ...segs){ return {path: segs.join("/"), col: true}; }
function snapDoc(path){ const d = docs.get(path); return {id: path.split("/").pop(), exists: () => !!d, data: () => d ? clone(d) : undefined, metadata: {fromCache: false, hasPendingWrites: false}}; }
function snapCol(path){ const n = parts(path).length + 1; const ds = [...docs.keys()].filter(k => k.startsWith(path + "/") && parts(k).length === n).map(snapDoc); return {docs: ds, size: ds.length, empty: !ds.length, metadata: {}}; }
function notify(){ for (const s of subs) s.fire(); }
export function onSnapshot(ref, cb){ const s = {fire: () => cb(ref.col ? snapCol(ref.path) : snapDoc(ref.path))}; subs.add(s); setTimeout(s.fire, 0); return () => subs.delete(s); }
export function onSnapshotsInSync(db, cb){ setTimeout(cb, 0); return () => {}; }
export async function setDoc(ref, data){ docs.set(ref.path, clone(data)); notify(); }
export async function deleteDoc(ref){ docs.delete(ref.path); notify(); }
export function writeBatch(){ const ops = []; return {set: (r, d) => ops.push([r, d]), commit: async () => { ops.forEach(([r, d]) => docs.set(r.path, clone(d))); notify(); }}; }
