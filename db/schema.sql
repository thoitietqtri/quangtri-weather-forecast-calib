-- Schema cho hệ thống hiệu chỉnh sai số dự báo mưa/nhiệt độ Quảng Trị.
-- Chạy 1 lần duy nhất trong Neon SQL Editor (dashboard Neon > SQL Editor)
-- trước khi function thu thập dữ liệu chạy lần đầu.

-- ============ BẢNG 1: Danh mục phường/xã ============
CREATE TABLE IF NOT EXISTS xa_phuong (
  ma_xa   INTEGER PRIMARY KEY,       -- = OBJECTID trong PX_QUANGTRI.geojson
  ten_xa  TEXT NOT NULL,
  lat     DOUBLE PRECISION NOT NULL, -- tâm bbox, PHẢI khớp cách tính centroid
  lng     DOUBLE PRECISION NOT NULL  -- Leaflet getBounds().getCenter() dùng ở frontend
);

-- ============ BẢNG 2: Dự báo hàng ngày (toàn bộ vector 15-16 ngày) ============
CREATE TABLE IF NOT EXISTS du_bao_hang_ngay (
  id             BIGSERIAL PRIMARY KEY,
  ngay_du_bao    DATE NOT NULL,      -- ngày cron chạy (giờ VN) = ngày phát hành dự báo
  ngay_ap_dung   DATE NOT NULL,      -- ngày mà giá trị dự báo áp dụng cho
  han_du_bao     SMALLINT NOT NULL,  -- số ngày hạn dự báo: 0=hôm nay,1=ngày mai,...,15
  ma_xa          INTEGER NOT NULL REFERENCES xa_phuong(ma_xa),
  mua_mm         DOUBLE PRECISION,   -- precipitation_sum (mm/ngày)
  nhietdo_max    DOUBLE PRECISION,
  nhietdo_min    DOUBLE PRECISION,
  tao_luc        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ngay_du_bao, ma_xa, han_du_bao)
);

CREATE INDEX IF NOT EXISTS idx_dubao_ap_dung ON du_bao_hang_ngay (ngay_ap_dung, ma_xa, han_du_bao);

-- ============ BẢNG 3: Thực đo hàng ngày (mưa + nhiệt độ, theo phường/xã) ============
CREATE TABLE IF NOT EXISTS thuc_do_hang_ngay (
  id                      BIGSERIAL PRIMARY KEY,
  ngay                    DATE NOT NULL,
  ma_xa                   INTEGER NOT NULL REFERENCES xa_phuong(ma_xa),
  mua_24h_mm              DOUBLE PRECISION,
  mua_tram_id             TEXT,             -- id trạm mưa gần nhất đã dùng
  mua_khoang_cach_km      DOUBLE PRECISION, -- khoảng cách tới trạm đó (để đánh giá độ tin cậy)
  nhietdo_max             DOUBLE PRECISION,
  nhietdo_min             DOUBLE PRECISION,
  nhietdo_tram_id         TEXT,             -- id trạm nhiệt độ gần nhất đã dùng (chỉ 6 trạm toàn tỉnh)
  nhietdo_khoang_cach_km  DOUBLE PRECISION,
  tao_luc                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ngay, ma_xa)
);

CREATE INDEX IF NOT EXISTS idx_thucdo_ngay ON thuc_do_hang_ngay (ngay, ma_xa);

-- ============ BẢNG 4: Bảng phân vị hiệu chỉnh nhiệt độ (Giai đoạn 2) ============
CREATE TABLE IF NOT EXISTS bang_phan_vi_hieu_chinh (
  id              BIGSERIAL PRIMARY KEY,
  ma_xa           INTEGER NOT NULL REFERENCES xa_phuong(ma_xa),
  cum_han_du_bao  TEXT NOT NULL,
  bien            TEXT NOT NULL,
  phan_vi_pct     SMALLINT NOT NULL,
  gia_tri_du_bao  DOUBLE PRECISION NOT NULL,
  gia_tri_thuc_do DOUBLE PRECISION NOT NULL,
  cap_nhat_luc    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ma_xa, cum_han_du_bao, bien, phan_vi_pct)
);

CREATE INDEX IF NOT EXISTS idx_phanvi_tra_cuu ON bang_phan_vi_hieu_chinh (ma_xa, cum_han_du_bao, bien);