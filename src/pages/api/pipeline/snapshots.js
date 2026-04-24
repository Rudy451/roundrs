// /pages/api/pipeline/snapshots.js
//
// GET /api/pipeline/snapshots              → latest 10 snapshots
// GET /api/pipeline/snapshots?limit=N      → last N snapshots
// GET /api/pipeline/snapshots?window=6     → only 6h-window snapshots
// GET /api/pipeline/snapshots?id=abc123    → single snapshot by ID
// GET /api/pipeline/snapshots?stats=1      → store stats only
// GET /api/pipeline/snapshots?diff=id1,id2 → diff two snapshots

import {
  getLatestSnapshot,
  getSnapshotById,
  getSnapshots,
  getStoreStats,
} from "@/lib/pipeline/snapshotStore";
import { diffSnapshots } from "@/lib/pipeline/snapshot";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Store stats
  if (req.query.stats === "1") {
    return res.status(200).json({ stats: getStoreStats() });
  }

  // Single snapshot by ID
  if (req.query.id) {
    const snapshot = getSnapshotById(req.query.id);
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
    return res.status(200).json({ snapshot });
  }

  // Diff two snapshots
  if (req.query.diff) {
    const [id1, id2] = req.query.diff.split(",");
    const s1 = getSnapshotById(id1);
    const s2 = getSnapshotById(id2);
    if (!s1 || !s2) return res.status(404).json({ error: "One or both snapshots not found" });
    try {
      const delta = diffSnapshots(s1, s2);
      return res.status(200).json({ diff: delta, from: s1.snapshotId, to: s2.snapshotId });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  // List snapshots
  const limit      = Math.min(parseInt(req.query.limit || "10", 10), 96);
  const windowHours = req.query.window ? parseInt(req.query.window, 10) : undefined;

  const snapshots = getSnapshots({ limit, windowHours });
  return res.status(200).json({ snapshots, count: snapshots.length });
}
