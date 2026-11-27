# ACP Parity Fixes — Implementation Plan

**Date:** 2026-11-22
**Status:** Rencana disetujui, belum diimplementasikan
**Scope:** `src/entrypoints/acp.ts`, `src/entrypoints/sdk/v2.ts`, `src/entrypoints/acp.test.ts`,
`studio/packages/acp/src/connection.ts`, `studio/packages/acp/test/connection.test.ts`
**Induk:** `2026-11-05-acp-terminal-parity.md`
**Acuan protokol:** `@agentclientprotocol/sdk@2.2.0` (schema ACP v1)

Rencana ini menindaklanjuti audit "ACP 1:1 dengan terminal". Pengguna memilih tiga grup:
**A. Bug server ACP**, **B. Elicitation jujur**, **C. `session/list` dari disk**.

Fase lanjutan (2026-11-23, lihat "Grup D"): sinkron mode agent→UI (`currentModeId`), chip
`locations`, @-mention / paste / drop, dan tombol fork/delete di UI — semuanya sudah
diimplementasikan.

## Keputusan desain

- **D-A3:** "Always allow" / "Always reject" disimpan ke `localSettings`
  (`.claude/settings.local.json` proyek), sama seperti terminal.
- **D-B:** Klien tidak mengiklankan capability `elicitation` selama belum ada dialog form/url.
- **D-C:** Sesi di memori menang atas entri disk dengan `sessionId` yang sama.

## Temuan yang mendasari

| # | Lokasi | Masalah |
|---|--------|---------|
| 1 | `acp.ts:1280` | Prompt yang di-cancel tetap dibalas `stopReason: 'end_turn'` |
| 2 | `acp.ts:1040`, `:1213` | Entri `pendingRequests` untuk permission tidak dibersihkan saat cancel/close |
| 3 | `acp.ts:906-910` | `reject_always` jatuh ke deny biasa (`user_reject`), tidak permanen |
| 4 | `v2.ts:537-554` | `respondToPermission` membuang `updatedPermissions` → `allow_always` juga tidak tersimpan |
| 5 | `acp.ts:1356-1382` | `session/fork` membuat sesi kosong, tanpa riwayat sesi asal |
| 6 | `connection.ts:366-378` | Klien mengiklankan `elicitation` tetapi selalu menjawab `cancel` |
| 7 | `acp.ts:1318-1323` | `session/list` hanya sesi di memori; terminal `/resume` membaca disk |
| 8 | `acp.test.ts:250` | Timeout 1 detik → flaky di bawah `--coverage` |

## Grup A — Bug server ACP

### A1. Cancel → `stopReason: 'cancelled'`

**File:** `src/entrypoints/acp.ts`

1. Tambah `cancelled: boolean` ke `SessionState` (`:271`). Inisialisasi `false` di
   `session/new` (`:1201`), `loadSession` (`:1124`), dan `session/fork`.
2. Di `session/prompt` (`:1232`), reset `state.cancelled = false` sebelum turn dimulai.
3. Di `session/cancel` (`:1213`), jika `state.active` tidak null, set `state.cancelled = true`
   lalu `state.session.interrupt()`.
4. Respons prompt (`:1280`): `{ stopReason: state.cancelled ? 'cancelled' : 'end_turn' }`.

**Tes:** prompt yang sedang berjalan + `session/cancel` → respons prompt `stopReason: 'cancelled'`;
prompt normal tetap `end_turn`.

### A2. Bersihkan permission tertunda saat cancel/close

**File:** `src/entrypoints/acp.ts`

1. Tambah `pendingPermissionIds: Set<JsonRpcId>` ke `SessionState`.
2. `requestPermission` (`:1034`): `state.pendingPermissionIds.add(id)`; di callback
   `pendingRequests` hapus id dari set sebelum `respondToPermission`.
3. Helper lokal `dropPendingPermissions(state)`: hapus setiap id dari `pendingRequests`, lalu
   `clear()` set. Dipanggil di `session/cancel` dan `closeSession` (`:1132`).
4. Penolakan prompt di sisi SDK sudah dilakukan `interruptWithSource` (`v2.ts:440-456`); balasan
   klien yang terlambat jatuh ke dispatcher biasa sebagai response tanpa method → diabaikan.
   Verifikasi bahwa response tanpa `method` tidak memicu `-32601` balik ke klien; jika iya,
   abaikan frame yang punya `result`/`error` tanpa `method`.

**Tes:** request permission → cancel → `pendingRequests` kosong; balasan klien terlambat tidak
memanggil `respondToPermission` dan tidak menghasilkan frame error.

### A3. SDK v2 menerapkan & menyimpan `updatedPermissions`

**File:** `src/entrypoints/sdk/v2.ts`

`respondToPermission` (`:537`) saat ini meneruskan hanya `behavior`/`updatedInput`/`message`.
Ubah agar, sebelum `pending.resolve(...)`:

```ts
const updates = decision.updatedPermissions ?? []
if (updates.length > 0) {
  this.appStateStore.setState(prev => ({
    ...prev,
    toolPermissionContext: applyPermissionUpdatesToLiveContext(
      prev.toolPermissionContext,
      updates,
    ),
  }))
  persistPermissionUpdates(updates)
}
```

- `applyPermissionUpdatesToLiveContext` dari `utils/permissions/permissionSetup.ts:714`.
- `persistPermissionUpdates` dari `utils/permissions/PermissionUpdate.ts:362` (hanya menulis
  destination yang bisa dipersist; `session`/`cliArg` diabaikan).
- Pola ini identik dengan terminal di `hooks/toolPermission/PermissionContext.ts:242-246`.
- Cabang deny ikut menerapkan updates (agar `reject_always` bekerja).

**Risiko:** semua konsumen SDK v2 yang mengirim `updatedPermissions` kini benar-benar menyimpan
aturan. Ini perilaku yang dijanjikan tipe `PermissionResult`, tetapi cakupannya lebih luas dari
ACP. Catat di deskripsi PR.

**Tes (`v2` / `acp.test.ts`):** `respondToPermission` dengan `addRules` → aturan muncul di
`getAppState().toolPermissionContext`; `persistPermissionUpdates` dipanggil dengan update yang
sama (mock modul).

### A4. ACP membangun aturan permanen

**File:** `src/entrypoints/acp.ts`

1. `resolvePermission(result)` (`:878`) menerima konteks `{ toolName, input }` dari
   `requestPermission` (`message.tool_name`, `message.input`).
2. `allow_always` →
   ```ts
   { behavior: 'allow', decisionClassification: 'user_permanent',
     updatedPermissions: [{ type: 'addRules', destination: 'localSettings',
       behavior: 'allow', rules: [ruleFor(toolName, input)] }] }
   ```
3. `reject_always` →
   ```ts
   { behavior: 'deny', message: 'Permission permanently denied by ACP client',
     decisionClassification: 'user_reject',
     updatedPermissions: [{ type: 'addRules', destination: 'localSettings',
       behavior: 'deny', rules: [ruleFor(toolName, input)] }] }
   ```
   Pastikan cabang deny `PermissionResult` menerima `updatedPermissions`; jika tipe generated
   tidak mengizinkan, perluas di `coreSchemas.ts` lalu regenerasi `coreTypes.generated.ts`.
4. `ruleFor`: default `{ toolName }` (berlaku seluruh tool). Untuk Bash, cek apakah terminal
   memakai saran aturan per-prefix (`permissionSuggestions`); jika SDK permission request membawa
   `suggestions`, pakai itu agar cakupannya sama dengan terminal.
5. `reject` / `cancelled` / error tetap deny sementara tanpa `updatedPermissions`.

**Tes:** opsi `allow_always` dan `reject_always` menghasilkan `updatedPermissions` dengan
`destination: 'localSettings'` dan `behavior` yang benar; `allow`/`reject` tidak.
Perbarui ekspektasi lama di `acp.test.ts:320-357` dan `:467`.

### A5. Fork membawa riwayat

**File:** `src/entrypoints/acp.ts` (`session/fork`, `:1356-1382`)

1. Validasi `sessionId` sumber; `cwd` dari params atau `sessions.get(source)?.cwd`.
2. `const { sessionId: forkId } = await forkSession(source, { dir: cwd })`
   (`sdk/sessions.ts:325`). Jika sumber sedang `active`, tunggu turn selesai atau tolak dengan
   `-32005`, agar JSONL tidak dibaca setengah tertulis.
3. Buka sesi baru lewat jalur `loadSession` (refactor kecil: ekstrak inti `loadSession` menjadi
   `openStoredSession(sessionId, cwd, params)` yang dipakai `session/load`, `session/resume`,
   dan `session/fork`). Ini otomatis menjalankan `replayHistory`, `advertiseCommands`,
   `configOptionsUpdate`, `subscribeSessionStatus`.
4. Respons `{ sessionId: forkId }`.

**Tes:** fork sesi dengan ≥1 pesan → `forkId` berbeda dari sumber; `session/update` riwayat
dipancarkan untuk `forkId`; sumber tetap utuh.

### A6. Penanganan response terlambat & tes flaky

1. Di `handle` (`:1394`): frame yang punya `id` tetapi tidak punya `method` dan tidak ada di
   `pendingRequests` adalah response basi → `return` tanpa membalas. Saat ini frame itu jatuh ke
   `fail(-32601)` dan mengirim error ke klien untuk sebuah response.
2. `acp.test.ts:250`: naikkan timeout 1 s → 5 s.

## Grup B — Elicitation jujur

**File:** `studio/packages/acp/src/connection.ts`, `studio/packages/acp/test/connection.test.ts`

1. Hapus `elicitation: { ...ELICITATION_CAPABILITIES }` dari capability yang diiklankan (`:378`).
   Hapus konstanta `ELICITATION_CAPABILITIES` jika tidak dipakai lagi.
2. Handler `elicitation_create` (`:366`) dipertahankan sebagai pengaman (tetap `cancel`), dengan
   komentar bahwa capability sengaja tidak diiklankan sampai ada dialog.
3. Server (`acp.ts:1171`) sudah mengecek `isRecord(capabilities.elicitation)`; tanpa capability,
   `forwardElicitation` tidak dipakai dan MCP mengambil jalur non-elicitation. Verifikasi jalur
   fallback itu di `acp.ts` (cari pemakaian `supportsClientElicitation`).
4. Tes `connection.test.ts:334-339`: ganti ekspektasi `elicitation: { form: {}, url: {} }` menjadi
   `expect(capabilities.elicitation).toBeUndefined()`. Probe `:295` + `:347` tetap valid
   (handler masih menjawab `cancel`).

## Grup C — `session/list` dari disk

**File:** `src/entrypoints/acp.ts` (`:1318-1323`), `src/entrypoints/acp.test.ts`

1. Baca `cwd` (opsional) dan `cursor` dari params.
2. `const stored = await listSessions({ dir: cwd })` (`sdk/sessions.ts:67`; opsi di
   `sdk/shared.ts:308`). Bungkus `try/catch`: gagal baca disk → pakai daftar memori saja.
3. Petakan `SDKSessionInfo` → `{ sessionId, cwd: info.cwd ?? cwd, title: info.customTitle ??
   info.summary ?? info.firstPrompt, updatedAt: new Date(info.lastModified).toISOString() }`
   (field opsional dibuang bila kosong, sesuai `exactOptionalPropertyTypes`).
4. Gabung dengan sesi memori: `Map` per `sessionId`, entri memori menimpa entri disk.
5. Urutkan `updatedAt` menurun; entri tanpa `updatedAt` di akhir.
6. Pagination: `cursor`/`nextCursor` ditunda; kirim daftar penuh (perilaku sekarang juga tanpa
   paging). Catat sebagai follow-up bila daftar besar.

**Tes:** fixture direktori sesi sementara (pakai helper yang sudah dipakai tes `sessions.ts`, atau
set config dir ke tmp) berisi satu JSONL → `session/list` memuatnya; sesi memori dengan id sama
tidak terduplikasi; urutan terbaru di atas.

## Urutan pengerjaan

1. A6.2 (timeout) — trivial, menstabilkan baseline tes.
2. A3 (`v2.ts`) + tesnya — fondasi untuk A4.
3. A4 (`resolvePermission`) + update ekspektasi lama.
4. A1 + A2 + A6.1 (cancel & response basi) + tes.
5. A5 (fork, termasuk refactor `openStoredSession`) + tes.
6. C (`session/list`) + tes.
7. B (Studio) + tes.
8. Gate penuh.

## Verifikasi (wajib hijau)

Root (`/home/dy/code/openclaude`):

```bash
bun test src/entrypoints/acp.test.ts
bun test src/entrypoints/sdk
bun run typecheck
bun run check
```

Studio (`/home/dy/code/openclaude/studio`):

```bash
pnpm -r typecheck
pnpm exec vitest run
pnpm -r build
```

## Progress

- [x] A1 Cancel → `cancelled`
- [x] A2 Bersihkan permission tertunda
- [x] A3 SDK v2 menerapkan `updatedPermissions`
- [x] A4 ACP membangun aturan permanen (`localSettings`)
- [x] A5 Fork membawa riwayat
- [x] A6 Response basi diabaikan + timeout tes 5 s
- [x] B Elicitation tidak diiklankan
- [x] C `session/list` dari disk
- [x] D1 Mode agent→UI: `session/new`/`session/load` menyimpan `modes`, selector composer memakai `availableModes` + `currentModeId`
- [x] D2 Chip `locations` pada tool call (maks. 4 + penghitung luapan)
- [x] D3 `@`-mention, paste, dan drag-drop di composer
- [x] D4 Tombol fork dan delete sesi (delete dengan dialog konfirmasi)
- [x] Gate Studio hijau; gate root `typecheck`/ACP/SDK-targeted pass, full SDK suites ada dua baseline failure `mcp-cleanup.test.ts`

## Hasil verifikasi

- `bun test src/entrypoints/acp.test.ts` — 50 pass.
- `bun test src/entrypoints/sdk` — 3 pass.
- `bun test tests/sdk/sdk-v2-lifecycle.test.ts` — 25 pass.
- `bun test tests/sdk/sdk-v2-permissions.test.ts` — 3 pass; aturan allow/deny diterapkan ke live context dan dipersist, keputusan sementara tidak dipersist.
- `bun test tests/sdk/` — 297 pass / 2 fail; kegagalan `mcp-cleanup.test.ts` juga terjadi di HEAD.
- Combined ACP + SDK gate — satu run pada working tree: 322 pass / 30 fail; di HEAD: 322 pass / 24 fail. Jumlah failure bervariasi antar-run, dan kegagalan baseline direproduksi tanpa perubahan ini.
- `bun run typecheck` — bersih.
- `bun run check` pada working tree sukses: build, smoke, deadcode, dan `test:full`.
- Studio `vitest run` — 33 file / 252 tes pass.
- Studio `tsc -b` untuk semua paket — bersih.
- Grup D (2026-11-23): Studio `pnpm -r typecheck` bersih, `vitest run` 34 file / 263 tes pass,
  `pnpm -r build` sukses. Tes baru: `connection.test.ts` (mode dari `session/load`),
  `PromptBar.test.tsx`, `ChatPane.test.tsx` (aksi sesi), `MessageBubble.test.tsx` (chip lokasi).

## Grup D — UI parity (2026-11-23)

| # | Perubahan | File |
|---|-----------|------|
| D1 | `ActiveSessionLike.modes` diisi dari respons `session/load`; store sesi di-seed dari `session/new`/`session/load`; `Workbench` memakai `state.modes.availableModes` dan `currentModeId`, jatuh ke `PERMISSION_MODE_OPTIONS` bila agen tidak mengiklankan mode | `packages/acp/src/connection.ts`, `apps/web/src/use-agent-session.ts`, `apps/web/src/Workbench.tsx` |
| D2 | Chip path(+baris) per tool call, 4 pertama lalu `+N` | `packages/ui/src/shell/MessageBubble.tsx` |
| D3 | Menu `@`-mention memfilter file workspace, `onPaste` menangkap file klip, kartu composer menerima drag-drop | `packages/ui/src/beautifui/PromptBar.tsx`, `apps/web/src/Workbench.tsx` |
| D4 | Tombol Fork/Delete di header `ChatPane`; delete melewati `Dialog` konfirmasi; sukses memanggil `closeTab` + refresh rail | `packages/ui/src/shell/ChatPane.tsx`, `packages/ui/src/shadcn/button.tsx` (varian `danger`), `apps/web/src/Workbench.tsx` |

Catatan: cabang `deny` di `coreSchemas.ts` diperluas agar menerima `updatedPermissions`, lalu
`coreTypes.generated.ts` diregenerasi melalui `bun scripts/generate-sdk-types.ts`.
