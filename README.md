# Dự báo thời tiết phường xã Quảng Trị

## Test trên local (có trạm mưa real-time)

Trạm mưa real-time chạy qua **Netlify Function**
(`quangtri-weather-app/netlify/functions/rainfall.js`) — hàm này KHÔNG chạy
được nếu chỉ gõ `npm run dev` (Vite dev server bình thường không biết gì về
Netlify Functions). Phải dùng **Netlify CLI**:

### 1. Cài Netlify CLI (chỉ cần làm 1 lần)

```bash
npm install -g netlify-cli
```

### 2. Tạo file `.env` khai báo biến môi trường VRain

Trong thư mục `quangtri-weather-app/` (cùng cấp `package.json`), tạo file
`.env` (không commit lên GitHub — thêm vào `.gitignore`):

```
VRAIN_USERNAME=<tài khoản VRain của anh>
VRAIN_PASSWORD=<mật khẩu VRain của anh>
```

`VRAIN_ORG_UUID` không cần khai báo nếu vẫn dùng đúng tổ chức Quảng Trị mặc
định (`74a14178-9fcd-4511-8e18-75e50dd71707`) — chỉ cần thêm dòng
`VRAIN_ORG_UUID=...` vào `.env` nếu UUID khác.

### 3. Chạy

Đứng ở **thư mục gốc repo** (nơi có `netlify.toml`, không phải trong
`quangtri-weather-app/`):

```bash
netlify dev
```

Lần đầu chạy, Netlify CLI có thể hỏi "link site" — chọn **"Don't run any
tests"** hoặc bỏ qua bằng cách chọn site đã deploy (`dubao-thoitiet-phuongxa-quangtri`)
nếu được hỏi, hoặc chọn "No" nếu chỉ muốn chạy local độc lập, không cần link.

Netlify CLI sẽ tự đọc `netlify.toml` (base = `quangtri-weather-app`), tự
chạy `vite dev` cho frontend VÀ phục vụ luôn function tại
`http://localhost:8888/.netlify/functions/rainfall`. Mở
`http://localhost:8888` để xem toàn bộ app (frontend + trạm mưa hoạt động
đầy đủ).

### 4. Kiểm tra nhanh function độc lập (không cần mở UI)

```bash
curl "http://localhost:8888/.netlify/functions/rainfall" | head -c 2000
```

Nếu thấy JSON có `"stations": [...]` là API chạy được. Trường `"errors"`
trong JSON sẽ liệt kê trạm nào lỗi (KTTV mất kết nối, VRain sai mật khẩu...)
mà không làm hỏng các trạm còn lại.

## Deploy lên Netlify (production)

Vào **Netlify → Site settings → Environment variables** của site
`dubao-thoitiet-phuongxa-quangtri`, thêm đúng 2 biến `VRAIN_USERNAME` /
`VRAIN_PASSWORD` (và `VRAIN_ORG_UUID` nếu khác mặc định) — KHÔNG dùng file
`.env` trên production, Netlify tự inject biến môi trường lúc build.
