# Nazstock

Scanner lonjakan volume dan simulator trading saham **Indonesia (IDX)** dan **Amerika (AS)** dengan uang virtual. Berjalan gratis di GitHub Pages, data diperbarui otomatis tiap hari oleh GitHub Actions.

> Simulasi edukasi, bukan saran investasi. Semua transaksi memakai uang virtual.

## Fitur

### 1. Dua saldo virtual terpisah
| Pasar | Mata uang | Saldo awal |
|---|---|---|
| IDX | Rupiah | Rp10.000.000 |
| AS | Dolar AS | US$1.000 |

Saldo tidak saling dikonversi. Saham IDX dibeli dengan saldo Rupiah, saham AS dengan saldo USD.

### 2. Daftar saham dan pencarian
- Tab **Indonesia**: daftar utama saham BUMN (BBRI, BMRI, BBNI, TLKM, PGAS, PTBA, ANTM, dll). Pencarian kode atau nama mencakup ±900 saham IDX.
- Tab **Amerika**: daftar utama saham besar (MSFT, GOOGL, NVDA, AAPL, AMZN, META, TSLA, dll). Pencarian mencakup ±670 saham AS, termasuk saham di bawah US$5 yang cukup likuid.

### 3. Detail saham
- Chart candlestick harian (100 hari) dengan volume, MA20, dan MA50.
- Ringkasan sinyal scanner untuk saham itu: rasio volume, skor, nilai transaksi, ATR14, jarak ke high 20 hari, level invalidasi.

### 4. Simulator trading
- Beli dan jual di harga terbaru (hasil Refresh) atau harga penutupan terakhir.
- **IDX**: transaksi per lot (1 lot = 100 lembar), biaya beli 0,15% dan jual 0,25%.
- **AS**: transaksi per lembar, tanpa biaya.
- **Jam bursa**: transaksi hanya bisa saat bursa buka (bisa dimatikan di Pengaturan).
  - IDX: Sen–Kam 09:00–12:00 dan 13:30–15:50 WIB; Jumat 09:00–11:30 dan 14:00–15:50 WIB.
  - AS: 09:30–16:00 waktu New York.
  - Hari libur bursa belum dideteksi.
- Stop loss dan take profit opsional, dieksekusi otomatis saat Refresh harga menyentuh levelnya.
- Portofolio per mata uang: kas, nilai saham, P/L belum terealisasi dan terealisasi, riwayat transaksi.
- Progres tersimpan otomatis di browser (localStorage). Ada tombol **Ekspor**, **Impor**, dan **Reset**.

### 5. Scanner lonjakan volume
Default memindai saham IDX di bawah Rp1.500 dan saham AS di bawah US$5 (bisa dimatikan).

Aturan:
1. Volume hari ini ≥ **2× / 3× / 5×** median volume 20 hari sebelumnya (bisa dipilih).
2. Candle hijau: tutup > buka dan tutup > kemarin.
3. Tutup di sepertiga atas range: `(close − low) / (high − low) ≥ 0,67`.
4. Nilai transaksi minimal: IDX lapis utama Rp10 miliar, lapis 2 Rp5 miliar; AS US$20 juta.
5. Kenaikan harian < 10% (IDX) atau < 8% (AS).
6. Tren: tutup > MA50 dan MA20 ≥ MA50.
7. Jarak tutup ke MA20 ≤ 15% (IDX) atau ≤ 10% (AS).

Label:
| Label | Arti |
|---|---|
| Akumulasi kuat | Lolos semua aturan, tutup ≥ 0,80 range, dan tembus high 20 hari |
| Akumulasi | Lolos semua aturan |
| Terkonfirmasi | Kemarin Akumulasi, hari ini tutup di atas high candle sinyal |
| Hampir lolos | Volume besar, gagal di satu aturan |
| Waspada | Volume besar tapi candle merah atau tutup lemah (bisa distribusi) |

Skor 0–100: rasio volume (maks 8×) 40, posisi tutup 20, tembus high 20 hari 20, tren 10, likuiditas 10. Volume ≥ 10× diberi catatan untuk cek berita atau aksi korporasi.

Kolom output: kode, label, skor, harga, % perubahan, rasio volume, nilai transaksi, level invalidasi (low candle sinyal) dan jaraknya, ATR14, posisi terhadap high 20 hari, catatan alasan gagal, dan tanda **lapis 2**.

**Hasil backtest 3 tahun** (Okt 2023–Okt 2026, beli di harga buka besok, jual 10 hari bursa kemudian, belum termasuk biaya):

| Pasar | Versi | Sinyal | Rata-rata 10 hari | Menang |
|---|---|---|---|---|
| IDX < Rp1.500 | Pembanding (semua hari likuid) | 75.069 | −0,05% | 42% |
| IDX < Rp1.500 | 3× + tren | 771 | +0,86% (median −1,82%) | 41% |
| IDX < Rp1.500 | 5× Akumulasi kuat | 92 | +3,80% (median +0,24%) | 50% |
| AS < US$5 | 3× + tren | 52 | −2,31% | 25% |

Sinyal volume besar **bukan jaminan harga naik**. Pakai scanner sebagai alat pantau dan bahan eksperimen.

## Sumber data

| Data | Sumber | Kapan |
|---|---|---|
| Candle harian (scanner, chart) | Yahoo Finance via `yfinance` | Otomatis tiap hari bursa: ±17:00 WIB (IDX) dan ±04:30 WIB (AS) |
| Harga terbaru IDX | [GoAPI](https://goapi.io) (delay ±3–10 menit) | Saat tombol **Refresh harga** diklik |
| Harga terbaru AS | [OHLC.dev](https://ohlc.dev) via RapidAPI | Saat tombol **Refresh harga** diklik |

Tanpa API key, aplikasi tetap jalan dengan harga penutupan terakhir.

### Mengisi API key
Buka tab **Pengaturan**:
- **GoAPI key**: daftar di app.goapi.io, salin API key.
- **OHLC.dev**: berlangganan API-nya di RapidAPI, lalu isi RapidAPI key, host (`xxx.p.rapidapi.com`), dan path endpoint harga dengan `{symbol}`, misalnya `/quote?symbol={symbol}`. Salin host dan path dari contoh kode di halaman RapidAPI.

Key hanya disimpan di browser kamu, tidak pernah masuk ke repo. Jangan menaruh API key di file repo karena repo ini publik.

## Cara kerja

```
GitHub Actions (cron) ──> scripts/update.py ──> data/IDX.json, data/US.json ──> commit ke repo
                                                           │
GitHub Pages: index.html + app.js  <──────── dibaca saat halaman dibuka
        │
        └── tombol Refresh ──> GoAPI / OHLC.dev (langsung dari browser)
```

Scanner dihitung di browser dari data harian, jadi ganti pengali volume (2×/3×/5×) langsung terlihat.

## Struktur repo

| File | Isi |
|---|---|
| `index.html`, `style.css`, `app.js` | Aplikasi web |
| `data/IDX.json`, `data/US.json` | 100 candle harian terakhir per saham |
| `data/meta.json` | Tanggal data dan jumlah saham |
| `scripts/update.py` | Pengambil data harian |
| `scripts/universe_idx.csv` | Daftar saham IDX (kolom `utama` = BUMN, `lapis1` = lapis utama) |
| `scripts/universe_us.csv` | Daftar saham AS (kolom `utama` = daftar utama) |
| `.github/workflows/update.yml` | Jadwal update otomatis |

## Menjalankan

**GitHub Pages**: Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save. Situs muncul di `https://<user>.github.io/Nazstock/`.

**Update manual**: tab Actions → *Update data harian* → *Run workflow* → pilih `IDX`, `US`, atau `ALL`.

**Lokal**:
```bash
pip install yfinance pandas numpy
python scripts/update.py ALL
python -m http.server 8000   # buka http://localhost:8000
```

**Menambah atau mengurangi saham**: edit `scripts/universe_idx.csv` atau `scripts/universe_us.csv`, lalu jalankan workflow. Disarankan meninjau daftar ini sebulan sekali.

## Batasan
- Data Yahoo Finance gratis dan tidak resmi; kadang terlambat atau kosong untuk beberapa saham.
- Jadwal GitHub Actions bisa molor saat GitHub sibuk.
- Harga Refresh tertunda beberapa menit, bukan tick real-time.
- Simulator tidak memodelkan antrean order, ARA/ARB, atau slippage.
