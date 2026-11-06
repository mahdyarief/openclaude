# ACP ↔ Terminal 1:1 Parity — Milestone & Progress Check

**Date:** 2026-11-05
**Status:** Baseline + keputusan arah D1–D4 + kontrak arsitektur §5 tercatat; **M0, M1 & M2 selesai & terverifikasi 2026-11-05**; M3–M6 belum dimulai
**Scope:** `src/entrypoints/acp.ts`, `studio/packages/acp`, `studio/packages/ui`, `studio/apps/web`, `scripts/build.ts`
**Baseline:** commit `dc6f47d2` (pushed `29fa9a76..dc6f47d2`), root `bun run build` exit 0
**Acuan protokol:** `@agentclientprotocol/sdk@2.2.0` (schema ACP v1)
**Acuan desain:** `studio/docs/superpowers/specs/2026-10-31-openclaude-studio-design.md` §7–§8

Dokumen ini adalah satu-satunya tempat mencatat **milestone** dan **progress check** untuk upaya
membawa seluruh kapabilitas terminal (Ink CLI) ke ACP + OpenClaude Studio secara 1:1. Centang
`- [x]` hanya boleh ditambahkan setelah kriteria selesai pada milestone terkait terverifikasi
(bukan sekadar kode ditulis).

## 0. Ringkasan posisi

Server ACP (`src/entrypoints/acp.ts:435–567`) menangani **7 method request** dari 22 method
ACP v1: `initialize`, `session/new`, `session/load`, `session/cancel`, `session/prompt`,
`openclaude/config`, `openclaude/status`. (`openclaude/status_update` adalah notifikasi yang
*di-push* server ke klien, bukan request yang ditangani — hitungan "8" lama keliru mencampur
keduanya.) Method tak dikenal dibalas `-32601` (`:594`). Sejak M0 ketujuh method ini ada di
dispatch table `handlers` (`:435`) dengan satu fallback `-32601` di `handle` (`:569–598`).

Klien Studio justru **lebih siap** daripada server: `studio/packages/acp/src/updates.ts:101–203`
sudah menangani `plan`, `usage_update`, `notice`, `current_mode_update`,
`config_option_update`, `session_info_update`, dan `compaction_*`, tetapi server tidak pernah
memancarkannya. Sebagian besar gap adalah "pipa kosong", bukan "UI belum ada".

Kesimpulan: **bukan UI-nya yang kurang, melainkan server ACP yang belum memancarkan data yang
sudah bisa dirender klien.**

**Definisi "1:1" (D1):** paritas berarti *semua kapabilitas yang punya representasi di ACP*,
bukan *semua binary fitur CLI*. Fitur berbasis modul native / infrastruktur Anthropic
(computer-use, voice, Chrome MCP) dinyatakan terminal-only. Lihat §3.

**Koreksi baseline hasil verifikasi 2026-11-05:**
- Server **sudah multi-session**: `sessions = new Map()` (`acp.ts:189`), diisi `session/new`
  (`:422`) dan `session/load` (`:451`). Yang belum ada hanya `session/list`. Catatan design
  spec §8 tentang "one process per connection" menjelaskan topologi proses, bukan batas satu
  sesi (D3).
- `protocolVersion: 1` **bukan mismatch**: root export SDK 2.2.0 menunjuk `v1/stable`
  (`package.json:35–39`) dan klien mengimpor `PROTOCOL_VERSION` dari root
  (`connection.ts:5,15`). v2 berlabel `@experimental` (D2).
- Gate `isBridgeSafeCommand` / `REMOTE_SAFE_COMMANDS` (`src/commands.ts:683–755`) milik
  **Remote Control bridge**, bukan jalur ACP (D4).
- `featureFlagPreprocessPlugin` dipakai CLI (`:216`), SDK (`:557`), dan ACP (`:989`) — flag
  mati bukan amputasi khusus ACP (D1).
- Blok `if (!initialized)` di `acp.ts:399–402` (error `-32002`) adalah **dead code**: blok
  `:381–384` selalu men-set `initialized = true` sebelum method apa pun diproses. Tidak ada
  request yang benar-benar ditolak dengan `-32002`. M0 membersihkannya tanpa mengubah
  perilaku yang teramati.

## 1. Progress check saat ini

### Sudah selesai & terverifikasi (baseline `dc6f47d2`)

- [x] `QuestionPanel`: jawaban bebas "Other", multi-select + free answer, `collectAnswers()`
      3-arg (`studio/packages/ui/src/beautifui/QuestionPanel.tsx`, 6 tests di
      `QuestionPanel.test.tsx`)
- [x] `ChoiceRow`: checkmark multi-select muncul di semua opsi terpilih (`ChoiceRow.tsx`)
- [x] `PromptBar`: textarea tidak lagi `overflow-y-auto` (tinggi mengikuti konten)
- [x] `MessageBubble`: chip tool-call menampilkan status, argumen (`rawInput`), dan hasil
      (`content`) secara collapsible
- [x] `pnpm`/tsc langsung: `tsc --noEmit` exit 0, `vitest run` 26 file / 177 tests lulus
- [x] Root `bun run build` exit 0 → `dist/acp.mjs`, `dist/studio-server.mjs`,
      `dist/studio-web/` ter-refresh
- [x] Statusline terparitasikan lewat `openclaude/status_update`
      (`src/utils/statusLineSnapshot.ts`) + ~50 setting lewat `openclaude/config`
      (`src/utils/studioConfigSurface.ts`)

### Sudah selesai & terverifikasi (M0–M2, 2026-11-05)

- [x] M0 — Fondasi arsitektur: dispatch table, emit bertipe, satu klien (§5).
      Snapshot before/after identik: 4 pass / 16 `expect()` untuk `git HEAD:acp.ts` (direktori
      bayangan) maupun working tree. Detail bukti di checklist M0.
- [x] M1 — Pancarkan `session/update` yang sudah didukung klien. 11 kind baru dipancarkan
      server, diterima store klien, dan diuji (root 16 pass / 49 `expect()`, studio 181 pass).
      Detail bukti di checklist M1.
- [x] M2 — Fidelitas `ToolCall` + diff view. Server memetakan `kind`/`locations`/`content`
      (`diff` + `terminal`), reducer klien mengawetkan blok struktural saat result teks datang,
      chip `MessageBubble` merender diff via primitive shadcn `collapsible`. Terverifikasi:
      root `acp.test.ts` 19 pass / 57 `expect()`, studio `vitest run` 27 file / 188 test,
      `pnpm -r typecheck` & `pnpm -r build` hijau. Detail bukti di checklist M2.

### Belum dimulai (seluruh milestone di bawah)

- [ ] M3 — Permission berstruktur
- [ ] M4 — Paritas slash command `local-jsx`
- [ ] M5 — Siklus sesi, filesystem, terminal, MCP, lampiran
- [ ] M6 — Build/deploy: dokumentasi terminal-only, Tauri desktop (Phase 4), deploy (Phase 5)

## 2. Milestone

Urutan didahului **M0** (fondasi arsitektur, kontraknya di §5) sebagai gerbang anti-spaghetti,
lalu diurutkan menurut **dampak per unit kerja**: M1 dan M2 memberi paritas terbesar paling
murah, sekaligus menuntaskan Phase 3 yang masih terbuka di design spec.

### M0 — Fondasi arsitektur (refactor, tanpa perubahan perilaku)

**Tujuan:** menyiapkan struktur agar M1–M5 bisa ditambah tanpa `handle` berubah jadi rantai
`if` raksasa dan tanpa handler klien diduplikasi. Aturan mengikatnya ada di §5. Ini murni
**refactor**: tidak ada method/emit/kind baru, perilaku JSON-RPC harus identik.

- [x] Server: rantai `if (message.method === …)` di `handle` diganti dispatch table
      `handlers: Record<string, AcpHandler>` (`acp.ts:435`) + fallback `-32601` tunggal
      (`:593–595`), diamankan `Object.hasOwn` terhadap `constructor`/`toString` (`:590`).
      Handler berupa **closure atas state server** (`sessions`/`pendingRequests`/`write`/
      `notify`/`respond`/`fail`), bukan objek `ctx` yang diteruskan.
- [x] Server: tipe union lokal ketat `AcpSessionUpdate` (`acp.ts:92–150`) — SDK tidak
      resolve dari root bundle, lihat §5.2. Satu `emitUpdate(sessionId, update)` (`:308`)
      sebagai **satu-satunya** penulis `session/update` (dibuktikan: hanya `:309`).
      `toolUpdates` mengembalikan `AcpToolUpdate[]` (sub-union) sesuai amandemen §5.1.
- [x] Server: dead code `if (!initialized)` (`-32002`) yang tak pernah tercapai dihapus.
      Yang tersisa di `:582` adalah inisialisasi `init()` SDK yang sah dan tetap diperlukan.
- [x] Klien: `registerHandlers(app, options, handlers)` (`connection.ts:220`) dipakai bersama
      `connectHandshake` (`:275`) dan `createAgentConnection` (`:350`); duplikasi 5 handler
      + 2 blok `clientCapabilities`/`initialize` hilang. Tiga `mcpServers: []` **tidak**
      dihapus (3 call site berbeda, lihat amandemen §5.1).
- [x] Klien: `FS_CAPABILITIES` + `registerHandlers` + `initializeConnection`
      (`connection.ts:218–256`) menurunkan flag `fs` dan stub handler `fs/*` dari satu
      berkas, sehingga negosiasi kapabilitas tidak bisa bohong soal implementasi.
- [x] Klien: reducer murni `applyUpdate` dipertahankan; switch dibuat **exhaustive**
      (`default` dihapus, `assertNever(update)` non-throwing ditambahkan di `updates.ts`),
      case no-op (`current_mode_update`, `compaction_*`) tetap eksplisit `return state`.
- [x] Performa: `appendChunk` (`updates.ts:70`) kini `parts = last.parts.slice()` + mutasi
      satu elemen, tanpa copy `messages`/spread per-chunk; state akhir identik.
      **Coalesce/debounce chunk sengaja dipindah ke M1** (lihat §5.3).
- [x] Test: characterization JSON-RPC untuk 7 method + `nope/method` + `constructor`
      (`acp.test.ts:191–241`, id 101–109, 16 `expect()`); 177 test studio tetap hijau.

**Bukti verifikasi (2026-11-05):**

| Cek | Hasil |
| --- | --- |
| `bun test …/acp.test.ts` (working tree) | 4 pass / 0 fail / 16 `expect()`, `EXIT=0` |
| Test sama terhadap `git HEAD:src/entrypoints/acp.ts` (direktori bayangan) | 4 pass / 0 fail / 16 `expect()`, `EXIT=0` — before/after identik |
| `tsc --noEmit` root | `EXIT=0` |
| `tsc --noEmit -p tsconfig.json` `studio/packages/acp` | `EXIT=0` |
| `vitest run` studio | 26 file / 177 test pass, `EXIT=0` |
| `bun run build` root | `EXIT=0` (`dist/studio-server.mjs`, `dist/studio-web/`, `dist/acp.mjs`) |
| `bun run check` root | `CHECK_EXIT=0` |

Catatan: ada beberapa baris `(fail)` per-test di log `bun run check` (fixture
`QueryEngine.autoCompactCooldown`, opsi `--method`) dan error `feature()` makro saat test
tunggal tanpa mock — semuanya **pre-existing**, berada di luar 5 file yang diubah M0, dan
tidak menurunkan exit code agregat. `acp.test.ts` ditambahi `mock.module` untuk
`studioConfigSurface` agar harness tidak terkena makro `bun:bundle` tersebut (khusus test).

**Selesai jika:** perilaku 7 method existing identik (snapshot fixture JSON-RPC sebelum/sesudah —
terbukti), `vitest run` + `bun run build` hijau (terbukti), dan menambah 1 method M5 cukup
1 baris tabel + 1 handler tanpa menyentuh `handle` maupun dua jalur koneksi (struktur
terpenuhi).

**Catatan cakupan:** M0 = refactor struktur + pengaman tipe. Emit kind baru (M1), diff/permission
(M2/M3), dan method M5 sengaja **belum** disentuh di sini karena mengubah perilaku protokol.

### M1 — Pancarkan `session/update` yang sudah didukung klien ✅ 2026-11-05

**Tujuan:** mengisi pipa kosong di sisi server.

**Koreksi cakupan (ditemukan saat pengerjaan):** deskripsi awal menyatakan 8 handler klien
"hilang" dan `compaction_*` "di-ignore". Audit `updates.ts` menunjukkan mayoritas handler sudah
ada dan exhaustive; hanya 3 kind yang benar-benar no-op (`default: return state`). Handler
`compaction_update` (patch semantics: omitted=keep / `null`=clear / value=replace) dan
`compaction_summary_chunk` (append) sudah ditambahkan di sesi sebelumnya, lengkap dengan 13 test
di `test/updates.test.ts`. Jadi M1 yang tersisa murni **emit dari server** + test server.

- [x] Emit `user_message_chunk` dan `agent_thought_chunk` dari `src/entrypoints/acp.ts`
      (helper `userTextFromMessage` menolak replay/synthetic/tool-result/compact-summary;
      `thinkingFromMessage` membaca blok `thinking` + `stream_event` `thinking_delta`)
- [x] Emit `plan` (`planUpdate` meratakan `todos` per-agent, sintesis `priority: 'medium'`)
- [x] Emit `usage_update` dan satukan dengan jalur statusline `openclaude/status_update`
      (`statusUpdates()` memakai `StatusSnapshot` yang sama: `contextWindow.tokens/.size`,
      `session.costUsd`, `session.name`, `permissionMode`)
- [x] Emit `current_mode_update`, `config_option_update`, `session_info_update`, `notice`
      (`config_option_update` dipancarkan sekali per sesi di `session/new`/`session/load`,
      bukan tiap tick debounce 150ms; alasan performa: `buildConfigSettings` menyentuh makro `bun:bundle`)
- [x] Emit `compaction_update` / `compaction_summary_chunk` + handler klien
      (`compactionUpdates` memetakan `status: compacting` → `in_progress`, `compact_boundary` →
      `completed`; `compactSummaryFromMessage` memajukan ringkasan; handler klien sudah ada)
- [x] Kepatuhan spesifikasi: `compaction_*` hanya dikirim bila klien mengiklankan
      `session.compaction`, `notice` hanya bila `session.notices` — dijaga terpusat di
      `emitUpdate` lewat flag `supportsCompaction`/`supportsNotices` dari `initialize`
- [x] Jalur state-derived (`plan`, `notice`, `usage_update`, `current_mode_update`,
      `session_info_update`) memakai **satu** `subscribeAppState` per sesi dengan debounce 150ms,
      pull-based, unsubscribe disimpan di `SessionState.statusUnsubscribe`
- [x] Test: `src/entrypoints/acp.test.ts` (9 blok mapper + 3 blok fixture JSON-RPC:
      state-derived kinds, capability gating, dan per-message kinds) +
      `studio/packages/acp` (13 test `updates.test.ts` sudah hijau)

**Selesai jika:** setiap kind di atas muncul di fixture JSON-RPC dan diterima store tanpa
`default: return state` — ✅ terpenuhi. Bukti verifikasi 2026-11-05: root `bun test
src/entrypoints/acp.test.ts` **16 pass / 0 fail / 49 `expect()`**; root `tsc --noEmit` **0 error**;
root `bun run build` **exit 0**; root `bun run check` **exit 0**; studio `pnpm exec vitest run`
**181 pass / 26 file**; `pnpm -r typecheck` **exit 0**; `pnpm -r build` **exit 0**.

### M2 — Fidelitas `ToolCall` + diff view (Phase 3) ✅ 2026-11-05

**Tujuan:** akar keterbatasan chip `MessageBubble` yang baru kita perbaiki.

- [x] `toolUpdates()` (`acp.ts`) kirim `kind` nyata: `read|edit|delete|move|search|
      execute|think|fetch|switch_mode|other` lewat `toolKindFor()`; path permission juga
      memakainya, sehingga tidak ada lagi hardcoded `'other'`
- [x] Sertakan `locations` (`ToolCallLocation`) untuk edit/read lewat `toolPresentationFor()`
- [x] Sertakan `content` bertipe `diff` (`{path, oldText, newText}`) untuk Edit/Write/
      NotebookEdit/SedEdit (`_simulatedSedEdit`), dan `terminal` (`{terminalId}`) untuk
      Bash/PowerShell
- [x] Renderer diff di `studio/packages/ui` memakai primitive shadcn `collapsible`
      (`ToolDetail` + `DiffLines`), bukan `<details>/<summary>` hand-rolled
- [x] Rapikan chip `MessageBubble`: `<details>/<summary>` dan `max-w-[480px]` literal hilang,
      `style={{animation}}` diganti `animate-fade-up` / `.stream-caret` dari `@theme`
- [x] Test: mapping `tool_call` → state + pengawetan blok struktural di `updates.test.ts`
      (3 test baru), snapshot diff render di `MessageBubble.test.tsx` (4 test)

**Catatan desain:** `ToolCallUpdate.content` bersifat *replace*, bukan merge. Server tetap
mapper stateless (§5) yang memancarkan blok `diff`/`terminal` saat `tool_call` dibuka;
`mergeToolCall` di klien mengawetkan blok struktural itu saat result teks tiba. Update yang
sudah membawa blok struktural diperlakukan sebagai replace penuh (tanpa duplikasi).

**Bukti verifikasi 2026-11-05:** `bun test src/entrypoints/acp.test.ts` → 19 pass / 57
`expect()`; `corepack pnpm exec vitest run` → 27 file / 188 test; `pnpm -r typecheck` →
4 package hijau; `pnpm -r build` → hijau; root `bun run typecheck` & `bun run build` →
hijau (SDK 62 export sinkron, tanpa React/Ink leakage). `bun run check` masih gagal pada
`test:full` (`QueryEngine.autoCompactCooldown.test.ts`: `formatDescriptionWithSource` tidak
terbaca; `reactJsxDevRuntimeProductionShim.test.ts`). Kegagalan ini **pre-existing**:
ter reproduksi identik di worktree bersih `HEAD f70ae71a` (base sebelum M2) dengan
`node_modules` yang sama, dan tidak ada file terkait yang disentuh M2.

**Selesai jika:** satu edit file menampilkan diff before/after di Studio, bukan cuma JSON
`rawInput`/`rawOutput`. ✅ Terpenuhi: `DiffLines` merender baris `- old`/`+ new` dengan
token `bg-red-tint text-red` / `bg-green-tint text-green` di dalam `collapsible` yang
terbuka secara default.

### M3 — Permission berstruktur

**Tujuan:** dari dua tombol `allow`/`reject` (`acp.ts:340–345`) ke ~26 dialog terminal
(`src/components/permissions/`).

- [x] Tambah `allow_always` / `reject_always` (enum `PermissionOption.kind` mendukungnya)
- [x] Kirim diff/preview/plan lewat `_meta` mengikuti pola `AskUserQuestion`
      (`_meta.questions` → `_meta.answers` → `updatedInput.answers`, `acp.ts:336–363`)
- [x] Petakan dialog: Bash, FileEdit/Write, NotebookEdit, SedEdit, WebFetch, Skill, Sandbox,
      ComputerUse, Enter/ExitPlanMode, Monitor, Fallback, PowerShell, ReviewArtifact
- [x] `QuestionPanel` free-text "Other" pakai primitive shadcn input, bukan `<input>` buatan
      sendiri (`QuestionPanel.tsx:174`)
- [x] Test: tiap opsi kind + round-trip `_meta`

**Selesai jika:** approval menampilkan "file ini akan diubah begini, setuju / selalu izinkan /
tolak", bukan sekadar judul tool. ✅ Terpenuhi: dialog `Workbench` merender
`PermissionPreviewPanel` (judul + ringkasan + field + diff before/after + plan) dan empat
tombol `Allow` / `Always allow` / `Reject` / `Always reject`.

**Catatan M3 (implementasi & keterbatasan):**

- Server ACP tetap *stateless mapper* (Keputusan §5): `permissionPresentationFor(name,
  toolCallId, input)` di `acp.ts` menurunkan preview murni dari `message.input`, karena
  `session/request_permission` tidak membawa tool result. Preview dikirim sebagai
  `_meta.preview` (berdampingan `_meta.questions`); kunci top-level selain `_meta` akan
  dibuang Zod parser SDK, jadi `_meta` satu-satunya kanal ekstensi.
- Pemetaan eksplisit: `Bash`/`PowerShell`, `Edit`/`Write`/`NotebookEdit`, `WebFetch`,
  `Skill`, `EnterPlanMode`/`ExitPlanMode`, `Monitor`, `ReviewArtifact`, `Read`/`Glob`/`Grep`.
  `SedEdit` bukan tool tersendiri melainkan perintah `Bash sed -i` dengan marker
  `_simulatedSedEdit`; diff-nya sudah dihasilkan `toolPresentationFor` (M2) dan diteruskan
  lewat kasus `Bash`. `Sandbox`/`ComputerUse`/`Workflow`/`Fallback` tidak punya nama tool
  khusus di dispatcher terminal (`PermissionRequest.tsx`), sehingga jatuh ke fallback
  generik `Run <nama>` + daftar field skalar + diff bila ada — ini memang bentuk dialog
  Fallback terminal, bukan dialog terpisah yang hilang.
- Klien: `PermissionPreview` (`packages/acp/src/types.ts`) → parser boundary
  `parsePermissionPreview` (`use-agent-session.ts`) → normalisasi antrean
  (`session-store.ts`) → `PermissionPreviewPanel` hanya komposisi primitif
  shadcn/beautifui (`Card`, `Collapsible`, `Badge`, `Button`, `DiffLines`) tanpa kontrol
  buatan sendiri, semua warna/radius via token.
- **Keterbatasan `allow_always` (jujur, di luar scope M3):** opsi ini menghasilkan
  `decisionClassification: 'user_permanent'` (label telemetri/UI), tetapi **tidak** membuat
  aturan izin persisten lintas-panggilan. `PermissionResolveDecision`
  (`src/entrypoints/sdk/permissions.ts:112–115`) hanya mendukung `behavior: allow|deny` +
  `updatedInput`, dan `v2.ts respondToPermission` (baris 512–530) meng-hardcode
  `decisionReason` serta membuang `updatedPermissions`. Persistensi aturan butuh perubahan
  layer SDK di luar M3; M3 hanya menyampaikan niat "selalu izinkan" dengan benar.

**Verifikasi M3 (semua `EXIT=0`, output tidak dipipe/truncate):**

- `bun test src/entrypoints/acp.test.ts` → 39 pass / 0 fail (4 kind + round-trip `_meta` +
  15 baris pemetaan preview).
- `corepack pnpm -r typecheck` (dari `studio/`) → 4 workspace Done.
- `corepack pnpm exec vitest run` (dari `studio/`) → 28 file / 191 test pass, termasuk
  `PermissionPreviewPanel.test.tsx` (3) & `QuestionPanel.test.tsx` (6).
- `corepack pnpm -r build` (dari `studio/`) → Done.
- `bun run typecheck` → `EXIT=0`; `bun run build` → `EXIT=0` (dist cli/sdk/acp/acp-web +
  Studio).
- `bun run check` → `CHECK_EXIT=0`. Satu baris `(fail)` pada fixture bersarang
  `formatDescriptionWithSource` (`QueryEngine.autoCompactCooldown.test.ts`) adalah kegagalan
  pre-existing yang sudah direproduksi di base `f70ae71a` dan tidak memengaruhi exit code;
  bukan regresi M3.

### M4 — Paritas slash command `local-jsx`

**Tujuan:** command `local-jsx` tidak bisa dirender Ink di klien ACP (`acp.ts:261`).
Perhatikan: `isBridgeSafeCommand` / `REMOTE_SAFE_COMMANDS` (`src/commands.ts:683–755`)
adalah gate **Remote Control bridge / mobile**, bukan jalur ACP. Jalur ACP memakai
`available_commands_update` yang mengiklankan command + `_meta.type` (`acp.ts:251–270`).
Keputusan D4: **jangan** mengubah gate bridge untuk paritas ACP.

- [ ] Perluas panel di `Workbench.tsx:526–532` dari 4 (`config|provider|model|theme`) ke
      `/permissions`, `/mcp`, `/status`, `/diff`, `/tasks`, `/usage`, `/resume`, `/sessions`
- [ ] Manfaatkan hook `_meta.type` yang sudah dikirim `available_commands_update`
      (`acp.ts:251–270`)
- [ ] Command yang benar-benar terminal-only: beri pesan eksplisit, jangan di-swallow tanpa
      feedback
- [ ] Test: tiap command yang dipetakan membuka panel yang benar

**Selesai jika:** tidak ada command yang diketik user berujung prompt kosong tanpa penjelasan.

### M5 — Siklus sesi, filesystem, terminal, MCP, lampiran

- [ ] Method server: `authenticate`, `session/set_mode`, `session/set_config_option`,
      `session/list`, `session/delete`, `session/resume`, `session/fork`, `session/close`,
      `fs/read_text_file`, `fs/write_text_file`, seluruh `terminal/*`, `elicitation/*`
- [ ] Mode permission bisa diubah mid-session (saat ini hanya `_meta.permissionMode` saat
      `session/new`, `connection.ts:246`)
- [ ] `session/load` replay riwayat (`use-agent-session.ts:308` mencatat ACP tidak mereplay)
- [ ] `clientCapabilities.fs` dari `false` + handler nyata (`connection.ts:232–236`,
      `:221–229`, `:332/:335` masih `throw 'not implemented yet'`)
- [ ] `mcpServers` tidak lagi hardcoded `[]` (`connection.ts:245`); status/approval MCP
- [ ] Attachment: `promptCapabilities` masih semua `false` (`acp.ts:392`), `textFromPrompt()`
      text-only (`:105–115`), `updates.ts:103/117/128` drop blok non-teks, `PromptBar.onAttach`
      tidak pernah di-pass `Workbench` → tombol disabled
- [ ] Multi-session: server **sudah** menyimpan `sessions = new Map()` (`acp.ts:189`) +
      `session/new`/`session/load` men-set key (`acp.ts:422`, `:451`). Tambahkan `session/list`
      untuk mengeksposnya dan **betulkan** baris design spec §8 "one process per connection"
      yang kini menyesatkan (D3 final: bukan keputusan terbuka lagi).
- [ ] Protokol: **tetap ACP v1** (D2). `protocolVersion: 1` (`acp.ts:69`) sudah cocok dengan
      root export SDK yang menunjuk `dist/v1/stable/acp.js`; v2 masih `@experimental`.

**Selesai jika:** daftar sesi, fork/resume, ubah mode di tengah sesi, kirim gambar, dan baca/tulis
file lewat klien berfungsi.

### M6 — Build & deploy

- [ ] Stub native **khusus bundle ACP** (`scripts/build.ts:991–1029`, hanya dipakai di
      `acpResult` `:988–989`): Chrome MCP, computer-use (Swift/input), `audio-capture-napi`,
      `image-processor-napi`, `color-diff-napi`, `asciichart`, `cacache`, `fuse`. D1:
      dinyatakan terminal-only, bukan diport.
- [ ] Feature flag yang mati (`scripts/build.ts:84–105`): `VOICE_MODE`, `PROACTIVE`, `KAIROS`,
      `BRIDGE_MODE`, `DAEMON`, `AGENT_TRIGGERS`, `WEB_BROWSER_TOOL`, `CHICAGO_MCP`,
      `UDS_INBOX`, `REPO_MAP`. **Koreksi:** `featureFlagPreprocessPlugin` dipakai CLI (`:216`),
      SDK (`:557`), dan ACP (`:989`) — ini keputusan build **global**, bukan amputasi khusus
      ACP. D1: jangan dibuka untuk paritas ACP; alasannya "butuh infrastruktur Anthropic /
      source tidak ada" (`:85`), bukan "karena ACP".
- [ ] `REPO_MAP` sudah bisa opt-in runtime via `REPO_MAP=1` (`build.ts:105`) — tidak perlu
      perubahan build.
- [ ] Phase 4: `apps/desktop` (Tauri v2) belum ada
- [ ] Phase 5: deploy aspire menggantikan `acp-web.mjs` tanpa autentikasi
- [ ] Open item upstream `rayss868/openclaude#1` + kerapuhan shim `queryAsync`
      (design spec §8)

**Selesai jika:** design spec §7 fase 1–5 seluruhnya tercentang, §8 sudah dibetulkan untuk
catatan multi-session (D3), dan daftar fitur terminal-only (D1) terdokumentasi. Open item
upstream `rayss868/openclaude#1` boleh tetap terbuka karena bergantung pihak ketiga.

## 3. Keputusan (D1–D4)

Dibahas 2026-11-05 berbasis verifikasi kode. Rekomendasi di bawah bersifat final untuk
cakupan paritas 1:1; mengubahnya butuh bukti baru, bukan sekadar preferensi.

### D1 — Native / voice / computer-use: **terminal-only, tidak diport ke web**

**Keputusan:** fitur di belakang stub native dan flag mati dinyatakan di luar cakupan
paritas ACP. Tidak ada unstub, tidak ada Web Audio/browser port, tidak ada flag yang dibuka
demi ACP. Yang dikerjakan: dokumentasikan daftar eksplisit fitur terminal-only.

**Alasan:**
- `acp-missing-stub` (`scripts/build.ts:991–1029`) hanya dipasang pada `acpResult` (`:988`).
  Modulnya adalah `@ant/computer-use-*` (native Swift), `audio-capture-napi`,
  `image-processor-napi`, `color-diff-napi`, `chrome-mcp` — tidak punya padanan di browser.
- Komentar `build.ts:85` menyebut alasan flag mati: "require Anthropic infrastructure or
  missing source" (`VOICE_MODE` butuh OAuth `claude.ai`, `PROACTIVE`/`KAIROS`/`DAEMON` butuh
  backend cloud, `WEB_BROWSER_TOOL` "source not mirrored", `CHICAGO_MCP` native Swift).
- **Koreksi penting:** `featureFlagPreprocessPlugin` dipakai **ketiga build** — CLI (`:216`),
  SDK (`:557`), ACP (`:989`). Jadi ini bukan amputasi khusus ACP; membukanya mengubah CLI/SDK
  juga dan berisiko memunculkan jalur yang source-nya memang tidak ada. Di luar scope paritas.
- `REPO_MAP` tidak perlu disentuh: `:105` mencatat runtime gate `REPO_MAP=1` tetap aktif walau
  build flag `false`.

**Konsekuensi:** target "1:1" didefinisikan ulang sebagai *semua kapabilitas yang punya
representasi ACP*, bukan *semua binary fitur CLI*. Ini harus ditulis di dokumen paritas agar
tidak ada yang mengira ini janji port komputer-use.

### D2 — Protokol: **tetap ACP v1, jangan naik ke v2**

**Keputusan:** `protocolVersion` tetap `1` (`acp.ts:69`). Tidak ada migrasi ke
`experimental/v2` selama paritas dikejar.

**Alasan:**
- Root export SDK 2.2.0 menunjuk `./dist/v1/stable/acp.js` (`package.json:35–39`). Klien
  `studio/packages/acp/src/connection.ts:5,15` mengimpor `PROTOCOL_VERSION` dari root → v1.
  Server mengirim `1`. **Keduanya sudah konsisten; tidak ada mismatch yang perlu diperbaiki.**
- Header `dist/v2/stable/acp.d.ts:1–10` eksplisit: "ACP v2 is still a draft … may change
  incompatibly in any SDK release", `@experimental`, dan "The stable package entry point
  remains ACP v1".
- v2 mengubah model menjadi *aggregate snapshots* idempotent dengan aturan `_meta` patch
  (`:12–24`) dan mengganti bentuk method (`auth/login`/`auth/logout`, tanpa `terminal/*`,
  `fork`, `set_mode` di `methods` `:130–160`). Migrasi akan membatalkan M1/M2/M3/M5 yang
  sedang dirancang — biaya besar, nol manfaat untuk paritas.
- Seluruh method yang kita butuhkan (`session/list|fork|resume|set_mode|set_config_option`,
  `fs/*`, `terminal/*`, `elicitation/*`) **sudah ada di v1** (`dist/v1/acp.d.ts:49–93`).

**Konsekuensi:** M1–M5 ditulis terhadap schema v1. Catatan evaluasi v2 ditutup.

### D3 — Multi-session: **sudah multi-session; yang kurang cuma `session/list`**

**Keputusan:** pertahankan `sessions: Map` yang ada. Jangan membangun "satu proses per
koneksi" dan jangan menulis ulang manajemen sesi. Tambahkan `session/list` agar daftar
sesi terekspos ke klien. Perbaiki baris design spec §8 yang kini menyesatkan.

**Alasan:**
- `acp.ts:189` sudah `const sessions = new Map<string, SessionState>()`.
- `session/new` melakukan `sessions.set(session.sessionId, …)` (`:422`), `session/load` juga
  (`:451`). Beberapa `sessionId` hidup berdampingan dalam satu proses, masing-masing punya
  `subscribeSessionStatus` sendiri (`:427`, `:454`).
- Design spec §8 berkata "one process per connection is the simplest correct baseline …
  multiple concurrent sessions per agent process is deferred". Itu menjelaskan **topologi
  proses** (satu proses per koneksi klien), bukan berarti server hanya boleh satu sesi.
  Implementasinya sudah lebih jauh dari catatan tersebut.

**Konsekuensi:** hapus sub-item "Putuskan multi-session per proses" dari M5; ganti dengan
`session/list` + koreksi teks §8. Tidak ada keputusan arsitektur yang tersisa di sini.

### D4 — `local-jsx`: **kategoris tiga jalur, dan jangan sentuh gate bridge**

**Keputusan:** klasifikasikan tiap command ke salah satu dari tiga perlakuan, lalu petakan
melalui `_meta.type` yang sudah dikirim `available_commands_update` (`acp.ts:251–270`):

1. **Panel web** — setting/state yang relevan di Studio: `config`, `provider`, `model`,
   `theme` (sudah ada) + `permissions`, `mcp`, `status`, `diff`, `tasks`, `usage`, `cost`,
   `context`, `effort`, `resume`, `sessions`, `memory`.
2. **Pesan terminal-only eksplisit** — butuh interaksi OS/terminal yang tak punya padanan
   web: `vim`, `keybindings`, `terminalSetup`, `copy`, `logo`, `color`, `stickers`, `ide`,
   `mobile`, `bridge`. Klien menampilkan alasan, bukan prompt kosong.
3. **Tetap no-op tapi dilaporkan** — murni visual Ink: `help`, `clear`, `btw`, `feedback`.

**Alasan:**
- `acp.ts:261` dan `:535` sudah menyatakan `local-jsx` "render terminal UI and are no-ops
  over ACP" dan menyarankan klien merender panel sendiri. Mekanismenya sudah ada.
- **Koreksi penting:** `isBridgeSafeCommand` (`src/commands.ts:741–745`),
  `REMOTE_SAFE_COMMANDS` (`:683–704`), `BRIDGE_SAFE_COMMANDS` (`:718–729`) adalah gate
  **Remote Control bridge / mobile** (`useReplBridge.tsx`, `REPL.tsx:1547`), bukan jalur ACP.
  `isBridgeSafeCommand` memblokir `local-jsx` di bridge, tapi ACP tidak memakai gate itu.
  Mengubahnya untuk "membuka command di ACP" adalah perbaikan di tempat yang salah.

**Konsekuensi:** M4 cukup memperluas `Workbench.tsx:526–532` dan menambah pesan eksplisit.
Sub-item "Tinjau `isBridgeSafeCommand` / allowlist" dihapus.

### Ringkasan keputusan

| ID | Area | Keputusan | Dampak ke milestone |
|---|---|---|---|
| D1 | Native/voice/computer-use | Terminal-only, tidak diunstub/diport | M6: dokumentasi, bukan coding |
| D2 | Protokol | Tetap ACP v1 (sudah konsisten) | M5: tutup evaluasi v2 |
| D3 | Multi-session | Sudah `Map`; tambah `session/list`, betulkan §8 | M5: hapus item keputusan |
| D4 | `local-jsx` | 3 kategori via `_meta.type`; jangan ubah gate bridge | M4: hapus item gate bridge |

## 4. Cara update dokumen ini

1. Centang `- [x]` pada sub-item **hanya setelah** kriteria "Selesai jika" milestone terpenuhi
   dan verifikasi (`tsc`, `vitest run`, `bun run build`) lulus.
2. Tambah baris di §1 "Sudah selesai" dengan nomor commit + rentang push bila sudah di-push.
3. Jangan mengubah daftar gap tanpa bukti `file:line` baru; baseline di dokumen ini diambil
   dari kondisi `dc6f47d2`.
4. Jika ada temuan baru (method/emit/kind bertambah), perbarui §0 dan milestone terkait
   sebelum mengubah checklist.
5. Keputusan §3 (D1–D4) hanya boleh diubah dengan bukti `file:line` baru yang bertentangan;
   cantumkan alasan dan tanggal perubahan. premise yang sudah diverifikasi: root export SDK
   = v1, server = `Map` multi-session, gate bridge ≠ ACP, plugin flag = global.
6. Kontrak §5 bersifat **mengikat** untuk M0–M6. Menambah milestone/method tidak boleh
   melanggar satu pun aturan di sana; kalau terpaksa melanggar, ubah kontraknya dulu
   (dengan alasan + tanggal) sebelum menulis kode, bukan sebaliknya.

## 5. Kontrak arsitektur implementasi (best-practice, performance first, no spaghetti)

D1–D4 memutuskan **apa**; §5 memutuskan **bagaimana**. Tiga syarat di bawah diterjemahkan
menjadi aturan yang bisa diuji, berakar pada kondisi kode saat ini (bukan angan-angan).

### 5.1 No spaghetti — satu pintu masuk, satu jalur emit, satu klien

Masalah nyata yang harus dicegah sebelum M5 menyuntik 14+ method:

- `handle` (`acp.ts:368–530`) adalah rantai `if (message.method === …)` flat ~160 baris.
  Menambah method M5 di sini menghasilkan ~400 baris bercabang. **Aturan:** dispatch table
  `Record<method, handler>` + satu fallback `-32601` (`:529`). Menambah 1 method = 1 entri
  tabel + 1 fungsi, tanpa menyentuh `handle`.
- `connectHandshake` (`connection.ts:202–230`) dan `createAgentConnection` (`:309–336`)
  mendaftarkan **5 handler identik** (`session_update`, `status_update`, `request_permission`,
  2× `fs/*`). M5 (fs/terminal/elicitation nyata) kalau ditulis langsung akan diduplikasi dua
  kali dan mudah setengah terpasang. **Aturan:** satu `registerHandlers(app, options)` dipakai
  kedua jalur. **Amandemen 2026-11-05:** `mcpServers: []` muncul di 3 tempat
  (`:286`, `:362`, `:391`) tetapi ketiganya adalah 3 call site berbeda yang menyusun params
  berbeda (`startSession`, `session/load`, `buildSession`), bukan duplikasi handler. Menyatukannya
  menambah helper satu-kali tanpa manfaat, jadi kontrak ini **tidak** mewajibkan penghapusannya;
  yang dihapus M0 adalah duplikasi 5 handler + 2 blok `clientCapabilities`/`initialize`.
- `clientCapabilities.fs` di-hardcode `false` (`:234`, `:341`) sementara handler `fs/*` sudah
  ada (meski `throw`). **Aturan:** kapabilitas dan tabel handler diturunkan dari **satu
  registry** sehingga negosiasi tidak bisa berbohong soal apa yang benar-benar terimplementasi.
  M0 mewujudkannya lewat `FS_CAPABILITIES` + `registerHandlers` + `initializeConnection`
  (`connection.ts:218–256`): flag `fs` dan stub handler `fs/*` berada di berkas yang sama.
- Penulis `session/update` tersebar: `toolUpdates` (`:151–183`), `advertiseCommands` (`:254`),
  `agent_message_chunk` (`:483`), `subscribeSessionStatus` (`:297`, jalur `openclaude/*`).
  **Aturan:** satu `emitUpdate(sessionId, update)` bertipe sebagai satu-satunya jalur notifikasi
  sesi; mapper mengembalikan tipe union lokal yang ketat (§5.2), bukan `Record<string,
  unknown>`. **Amandemen 2026-11-05:** `toolUpdates` secara khusus mengembalikan
  `AcpToolUpdate[]` (sub-union `AcpSessionUpdate`), karena ia hanya memetakan tool call —
  memaksanya ke `AcpSessionUpdate[]` melemahkan presisi tipe tanpa menambah keamanan. Semua
  pemanggil tetap lewat `emitUpdate(sessionId, update: AcpSessionUpdate)` (`acp.ts:308`).
- Reducer klien `applyUpdate` (`updates.ts:100–204`) jangan berubah jadi efek samping /
  pemanggilan I/O. Tetap fungsi murni `state → state`; `default: return state` (`:201`) dan
  case no-op (`current_mode_update` `:182`, `compaction_*` `:197/:199`) wajib diisi eksplisit
  di M1, bukan dibiarkan menelan update secara diam-diam.

### 5.2 Best-practice — tipe, pola existing, verifikasi

- **Bertipe ketat, bukan `unknown`.** Server saat ini mengetik notifikasi sebagai
  `Record<string, unknown>` (`acp.ts:92`, `:151`) sehingga `kind: 'other'` (`:164`) lolos tanpa
  pernah dicek. **Koreksi verifikasi 2026-11-05:** `@agentclientprotocol/sdk` tidak resolve dari
  root bundle CLI (`require.resolve` gagal, tidak ada symlink `node_modules/@agentclientprotocol`);
  SDK hanya ada di workspace `studio/packages/acp`. Menambah dependensi root dilarang
  `AGENTS.md` dan berisiko menarik kode klien ke bundle CLI. Maka server memakai **tipe union
  lokal yang ketat** (`AcpSessionUpdate`, `ToolCallKind`, dll.) di `acp.ts`, klien tetap memakai
  tipe SDK. Tujuannya sama: `kind`, `diff` (`{path, oldText, newText}`), dan `terminal`
  (`{terminalId}`) tervalidasi saat compile. Duplikasi tipe disengaja dan tercatat di sini.
- **Ikuti pola yang sudah ada, jangan ciptakan yang baru.** `_meta.questions` →
  `_meta.answers` → `updatedInput.answers` (`acp.ts:336–363`, `:208–235`) adalah preseden
  untuk M3 (diff/preview/plan). `subscribeSessionStatus` (`:285–320`) adalah preseden debounce.
  `studio/AGENTS.md` mewajibkan primitive shadcn (`collapsible`, `input`), bukan
  `<details>/<summary>` (M2) atau `<input>` buatan sendiri (`QuestionPanel.tsx:174`, M3).
- **Tanpa feature flag / shim kompatibilitas.** Instruksi repo: ubah kode langsung, jangan
  tambah lapisan "biar lama tetap jalan". Tidak ada `// removed`, re-export tipe usang, atau
  `_var` yang dinamai ulang.
- **Verifikasi sebelum centang.** `pnpm -r typecheck`, `pnpm exec vitest run`, `pnpm -r build`
  + root `bun run build`/`bun run check`/`bun run typecheck` (validasi pra-push
  `CONTRIBUTING.md § Validation`). M0 wajib punya snapshot fixture JSON-RPC before/after yang
  identik supaya "refactor tanpa ubah perilaku" benar-benar terbukti, bukan cuma klaim.
- **Ujung ekstensi lewat `_meta`.** Semua payload di luar schema ACP (questions, command type,
  preview) wajib lewat `_meta`, mengikuti catatan `acp.ts:360–362` bahwa field top-level
  akan dibuang parser Zod SDK.

### 5.3 Performance first — jalur panas adalah streaming chunk

- Jalur terpanas bukan `session/new`, melainkan **setiap chunk** di loop
  `for await (… sendMessage …)` (`acp.ts:480–491`): tiap `text_delta` memicu 1 notifikasi +
  `appendChunk` (`updates.ts:53–79`) yang melakukan `messages.slice`, spread array, dan
  `nextId()` untuk tiap chunk. **Aturan:** M0 hanya menyatukan duplikasi salinan array
  per-chunk (murni struktural, hasil identik); coalesce/debounce notifikasi berfrekuensi tinggi
  (thought/usage) masuk **M1** memakai preseden timer 150ms `subscribeSessionStatus`
  (`:293–306`), karena mengurangi jumlah pesan = perubahan perilaku yang tidak boleh
  terjadi di refactor M0. Ukur, jangan tebak: catat jumlah notifikasi per detach
  sebelum/sesudah M1.
- **Satu langganan per sesi, dibersihkan.** `subscribeSessionStatus` sudah benar: satu
  `subscribeAppState` + `statusUnsubscribe` (`:308–315`) dipanggil saat `close` (`:669`).
  Pola init/cleanup ini wajib dipakai untuk subscription M1 (usage/mode/plan) agar tidak
  bocor antar `session/new`/`session/load` yang hidup berdampingan (D3, `:189`).
- **Jangan polling apa yang sudah di-push.** Statusline sudah push lewat
  `openclaude/status_update`; `session/load` replay (M5) harus sekali di awal, bukan
  fetch berulang. `promptCapabilities` (`:392`) dan attachment (M5) jangan memaksa
  base64 gambar masuk tiap chunk teks.
- **Best-effort tidak boleh menumbangkan loop.** `advertiseCommands` (`:271`) dan emit status
  (`:301`) sudah `try/catch` + komentar "must not tear down". Mapper M1/M2 yang gagal
  memetakan 1 blok pesan wajib melewatkan blok itu, bukan menggagalkan seluruh prompt.
- **Tanpa kerja sinkron di hot path.** `readConfigSnapshot` (`:539`) dan
  `buildStatusSnapshot` (`:297`) berada di jalur request/subscription, bukan per-chunk;
  jangan pindahkan ke dalam loop `sendMessage`.

### 5.4 Urutan eksekusi & gerbang

```
M0 (refactor, snapshot identik, 177 test hijau)
 └─> M1 (emit + reducer case) ──┬─> M2 (ToolCall + diff) ──> M3 (permission _meta)
                                └─> M4 (command _meta.type)
                                     M5 (method tabel + fs/terminal/elicitation/attachment)
                                     M6 (dokumentasi terminal-only + deploy)
```

M0 adalah **gerbang**: M1–M5 tidak boleh dimulai sebelum checklist M0 tercentang. Alasannya
konkret — tanpa dispatch table dan `registerHandlers` tunggal, M1 menambah emit ke rantai
`if` dan M5 menduplikasi handler fs di dua koneksi, lalu perbaikannya harus mengubah semua
milestone sekaligus (biaya berulang = spaghetti). M1 dan M2 boleh paralel setelah M0 karena
keduanya hanya menyentuh mapper/`emitUpdate` yang berbeda; M3 bergantung pada M2 (`diff`
dipakai preview approval); M4 independen; M5/M6 menyusul.

**Selesai secara keseluruhan jika:** seluruh M0–M6 tercentang, kontrak §5 tidak dilanggar
(cek saat review: tidak ada handler ganda, tidak ada `Record<string, unknown>` untuk update,
tidak ada reducer ber-efek samping), dan seluruh perintah validasi `CONTRIBUTING.md § Validation`
hijau.
