# Agent Note: The project-insight document moves to a per-type `.dsh/insight/` layout (formatVersion 2)

Status: implemented

English | [中文](2026-08-24-insight-per-type-layout.zh.md)

## Problem

The develop-mode workspace scan committed as a single `project-insight.json` file under `.dsh/`. The user's request — "将扫描到的结果维护在该项目的 .dsh 文件夹下面，根据类型创建对应的文件夹来维护" — asks for scan results maintained per type in their own folders under `.dsh`. A single file also couples the six sections: no consumer can read one section without parsing the whole document, and the whole-document byte guard applies to everything at once.

## Decision

Split the on-disk layout into a meta file plus typed section files under `.dsh/insight/`, keeping the in-memory document and the wire vocabulary unchanged. The shipped layout (as of the shared documents pool, [[2026-08-26-insight-shared-documents-pool]]) carries seven sections:

```
.dsh/insight/
  meta.json                 # { formatVersion, rootName, contentFingerprint, statSignature, scannedAt }
  tech-stack/data.json
  module-topology/data.json
  component-dependencies/data.json
  components/data.json
  prompts/data.json
  agent-tech/data.json
  documents/data.json
```

- `PROJECT_INSIGHT_FORMAT_VERSION` goes 1 → 2; per the pre-release stance a v1 document is rejected by read — no migration, no compatibility. The reader refuses the wrong version and reports `error`; a v1 document is re-scanned.
- `writeDocument` writes each section file, then the meta file — the meta write is the commit point a reader can rely on, so a read during the write observes the previous document (or none), never a new meta with missing sections. It then deletes the legacy `.dsh/project-insight.json`.
- `readDocument` reads the meta (absent → `undefined`), refuses a wrong-version or over-cap or unparsable meta, reads every section file (any missing, over-cap, or unparsable → throw → read reports `error`), and reassembles the `ProjectInsightDoc`. The stat-only freshness comparison is unchanged ([[2026-08-24-read-freshness-stat-signature]]).
- The constants `PROJECT_INSIGHT_FILE` and `PROJECT_INSIGHT_DOC_REL` are replaced by `PROJECT_INSIGHT_DIR_REL` (`.dsh/insight`) and `PROJECT_INSIGHT_META_REL` (`.dsh/insight/meta.json`); the service's model-facing scan `path` is now the meta path, so the `scan_project` tool reports `.dsh/insight/meta.json`.
- `MAX_DOC_BYTES` becomes a per-file byte guard rather than a whole-document one; each stored file is bounded individually.
- The section-key → folder-name mapping is the only place the layout is declared: `techStack → tech-stack`, `moduleTopology → module-topology`, `componentDependencies → component-dependencies`, `components → components`, `prompts → prompts`, `agentTech → agent-tech`, `documents → documents`.

## Alternatives considered

- **Keep a single `project-insight.json` file** — rejected: it does not answer the per-type-folder request and keeps the sections coupled under one byte guard.
- **One meta file with per-section filenames embedded** — rejected: a fixed directory layout is simpler, gives consumers direct per-section reads, and keeps the type-to-folder mapping a single constant.

## Consequences

- A scan commits the meta plus one file per section (eight files with the documents section); a reader mid-write sees the previous document or `none`, never a partial one, because the meta file lands last.
- A v1 document reads as `error` until re-scanned, and the legacy file disappears after the first v2 write; both behaviors are covered by keyless regression tests.
- Each section's data is directly readable by path, and a per-section read is bounded by `MAX_DOC_BYTES` on that file alone.
