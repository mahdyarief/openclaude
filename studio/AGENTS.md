# AGENTS.md — OpenClaude Studio

## WAJIB: komponen UI hanya dari shadcn/ui + BeautifulUI

Aturan ini mengikat semua perubahan UI di repo ini.

### Dilarang
- Menulis komponen UI baru dari nol di `packages/ui/src/shell/` (markup + styling manual).
- Membuat tombol, input, card, tab, dialog, drawer, tooltip, badge, skeleton, scroll container, atau collapsible buatan sendiri.
- Menulis styling ulang (hand-rolled) untuk elemen yang sudah punya padanan primitif.
- Memakai `style={{ animation: ... }}` ad-hoc untuk elemen yang seharusnya memakai utility animasi dari `@theme`.

### Wajib
1. **Primitive dari `packages/ui/src/shadcn/`** — sumber kebenaran komponen dasar:
   `card`, `tabs`, `scroll-area`, `collapsible`, `separator`, `tooltip`, `sheet`, `skeleton`, `badge`.
2. **Komponen siap pakai dari `packages/ui/src/beautifui/`** — `Button`, `PromptBar`, `LoadingState`, `ThinkingState`, `Tooltip`, `SidebarNav`, dll.
3. Jika sebuah primitive belum ada, tambahkan **dengan pola shadcn asli** (Radix + `cn()` + `cva` bila perlu) ke `packages/ui/src/shadcn/`, lalu ekspor lewat `shadcn/index.ts`. Jangan menaruhnya di `shell/`.
4. Komponen di `packages/ui/src/shell/` hanya boleh menjadi **komposisi** dari primitive shadcn/beautifui. Boleh ada wrapper layout (grid/flex/region), tetapi tidak boleh ada kontrol interaktif buatan sendiri.
5. Semua warna, radius, shadow, easing, dan animasi **wajib memakai token** (`var(--color-*)`, `var(--radius-*)`, `var(--shadow-*)`, `--animate-*`). Tidak boleh nilai hex/oklch/`font-family` literal.
6. Semua state interaktif harus lengkap: default, hover, `:focus-visible`, active, disabled, loading, error, success.

### Cara menambah komponen
```bash
pnpm --filter @openclaude-studio/ui add @radix-ui/react-<paket>
```
Lalu buat `packages/ui/src/shadcn/<nama>.tsx` mengikuti pola file yang sudah ada, ekspor di `shadcn/index.ts`, dan impor lewat `@openclaude-studio/ui`.

### Verifikasi sebelum selesai
```bash
pnpm -r typecheck
pnpm exec vitest run
pnpm -r build
```
Ketiganya harus hijau.
