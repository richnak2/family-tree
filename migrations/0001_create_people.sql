-- One row per person, stored in the shape family-chart uses.
CREATE TABLE people (
  id         TEXT PRIMARY KEY,
  data       TEXT NOT NULL,               -- JSON: {"first name": "...", "gender": "M" | "F", ...}
  rels       TEXT NOT NULL,               -- JSON: {"parents": [...], "spouses": [...], "children": [...]}
  unknown    INTEGER NOT NULL DEFAULT 0,  -- 1 = deleted person kept as a placeholder to connect relatives
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
