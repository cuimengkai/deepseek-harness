# Agent Note: Explicit Web index paths and 404 static misses

Status: implemented

English | [中文](2026-08-20-explicit-web-index-paths.zh.md)

## Problem

An unconditional SPA fallback makes every unmatched GET or HEAD request look successful. A broken ordinary link and a missing JavaScript, stylesheet, source map, or manifest then receive the HTML shell with status 200, so browsers, caches, and monitoring cannot distinguish a valid page entry from an absent resource.

## Decision

`dsh-host-frontend-static` renders `index.html` when the normalized target is the dist root or the configured index path, or when a file miss lies under a configured `indexPaths` prefix. The shipped Web composition lists `/settings` so the client History route `/settings/:section?` survives refresh and deep link. Query strings do not change pathname matching, and URL fragments never reach the server. Existing files are served normally, while `ENOENT`, `EISDIR`, and `ENOTDIR` reads that are not allowlisted produce an empty 404 response with no content type. Other filesystem failures are rethrown to the webserver's request-failure handling instead of being mislabeled as absence.

GET and HEAD use the same status and content type for index entries, files, and misses. Named routes still match before the fallback, traversal outside the dist root remains 403, and non-GET/HEAD requests reaching the fallback remain 405. Every index response, including allowlisted misses, still passes Connection's `authorizeIndex`.

## Alternatives considered

**Infer page routes from the absence of a file extension.** A file extension does not declare a client route: this would still turn unknown ordinary paths into successful pages, reject any future dotted client route, and mishandle extensionless static files when they are absent.

**Use an `Accept: text/html` request header as the fallback rule.** The header expresses representation preference, not whether the pathname is a declared client route. Browser fetches, bots, and monitors may request HTML for an invalid path, so the same false-success behavior remains.

**Leave History routes without a server entry.** The client already registers `/settings/:section?`. Without a matching server rule, a first navigation or refresh on that pathname returns empty 404. Rejected once the route shipped.

## Consequences

Broken links and missing assets have distinct HTTP state that caches and monitoring can observe, and an asset loader cannot execute the HTML shell as JavaScript. Each new History API pathname route must add its `indexPaths` prefix (or equivalent) and real-composition coverage in the same change. The frontend-static real Loader test pins GET/HEAD parity for index entries, allowlisted History misses, existing assets, ordinary misses, and resource misses; it also covers API-like paths, traversal, malformed targets, unsupported methods, and fallback disposal.
