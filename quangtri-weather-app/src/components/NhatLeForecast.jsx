import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './DongTamForecast.css'; // dùng chung kiểu giao diện với Đồng Tâm

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

const TRAM = {
  kiengiang: { ten: 'Kiến Giang', thamKhao: true, nguongMoHinh: 7 },
  lethuy: { ten: 'Lệ Thủy', thamKhao: false, nguongMoHinh: 1 },
};

// tram: 'kiengiang' | 'lethuy' (mỗi trạm một khung riêng)
export default function NhatLeForecast({ onClose, tram = 'lethuy' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    fetch(`/.netlify/functions/forecast-nhatle?hesoHieuChinh=${encodeURIComponent(hs)}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(heSo); }, []);

  const t = data && data.available ? data.tram && data.tram[tram] : null;
  const cfg = TRAM[tram];
  const coDuBao = !!(t && t.duBaoTheoMoc);
  const duoiNguong = !!(t && t.cheDo === 'ngay_thuong');

  return (
    <div className="dongtam-forecast-overlay" onClick={onClose}>
      <div className="dongtam-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dongtam-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước {cfg.ten}</h3>
            <div className="dongtam-forecast-wip">Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị</div>
          </div>
          <button className="dongtam-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="dongtam-forecast-body">
          <div className="dongtam-forecast-hesobox">
            <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ/đới gió đông kết hợp KKL):</label>
            <div className="dongtam-forecast-hesobox-row">
              <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
              <button onClick={() => load(heSo)}>Áp dụng</button>
            </div>
          </div>

          {cfg.thamKhao && (
            <div className="dongtam-forecast-note" style={{ marginBottom: 8 }}>
              ⚠️ Kiến Giang là trạm thượng nguồn, mô hình đạt sai số cho phép chỉ khoảng 50–70%. <b>Chỉ mang tính tham khảo</b>, đỉnh lũ thường bị dự báo thấp hơn thực tế.
            </div>
          )}

          {error && <div className="dongtam-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="dongtam-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="dongtam-forecast-empty">ℹ️ {data.reason}</div>}
          {data && data.available && !t && <div className="dongtam-forecast-empty">ℹ️ Chưa có số liệu {cfg.ten}.</div>}

          {t && (
            <>
              <div className="dongtam-forecast-hiennay">
                {cfg.ten} hiện tại ({formatTimeVN(t.thoiDiemHienTai)}): <b>{t.hienTai}m</b>
                {' '}· cường suất 6h qua: <b>{t.tocDo6h > 0 ? '+' : ''}{t.tocDo6h}m/h</b>
              </div>

              {duoiNguong && (
                <div className="dongtam-forecast-empty">
                  ✅ Hiện chưa có lũ ({cfg.ten} dưới {cfg.nguongMoHinh}m). Mô hình xây từ mẫu mùa lũ nên khi mực nước thấp, kết quả dưới đây chỉ mang tính tham khảo (có thể lệch cao nhẹ).
                </div>
              )}

              {coDuBao && (
                <>
                  <table className="dongtam-forecast-table">
                    <thead>
                      <tr><th></th><th>+6h</th><th>+12h</th><th>+18h</th><th>+24h</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Giờ</td>
                        {[6, 12, 18, 24].map((h) => <td key={h}>{formatTimeVN(t.thoiDiemHienTai + h * 3600000)}</td>)}
                      </tr>
                      <tr className="dongtam-forecast-table-value">
                        <td>Mực nước</td>
                        {[6, 12, 18, 24].map((h) => <td key={h}><b>{t.duBaoTheoMoc[h]}m</b></td>)}
                      </tr>
                    </tbody>
                  </table>

                  <DuBaoChart
                    hienTaiT={t.thoiDiemHienTai}
                    hienTaiV={t.hienTai}
                    duBaoTheoMoc={t.duBaoTheoMoc}
                    nguong={t.nguong}
                  />

                  {t.nhanDinhDinh && (
                    <div className="dongtam-forecast-dinh">
                      {t.nhanDinhDinh.coDinh ? (
                        <>🔴 Dự kiến đạt <b>ĐỈNH {t.nhanDinhDinh.giaTriDinh.toFixed(2)}m</b> trong khoảng {formatTimeVN(t.thoiDiemHienTai + t.nhanDinhDinh.gioTruoc * 3600000)} đến {formatTimeVN(t.thoiDiemHienTai + t.nhanDinhDinh.gioDinh * 3600000)}</>
                      ) : t.nhanDinhDinh.dangTiepTucLen ? (
                        <>📈 Sau +24h vẫn còn xu hướng <b>TIẾP TỤC LÊN</b>, chưa xác định được đỉnh trong 24h tới</>
                      ) : (
                        <>📉 Xu hướng giảm/ổn định trong 24h tới, không có đỉnh mới</>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="dongtam-forecast-inputs">
                <div className="dongtam-forecast-row"><span>Mưa tại trạm 24h đã qua:</span><b>{t.rainDaQua24h}mm</b></div>
                {tram === 'kiengiang' && (
                  <div className="dongtam-forecast-row"><span>Mưa Trường Sơn 24h đã qua:</span><b>{t.rainTruongSonDaQua24h}mm</b></div>
                )}
                {data.mucMuaDuBao && [6, 12, 18, 24].map((h) => {
                  const m = data.mucMuaDuBao[h];
                  if (!m) return null;
                  return (
                    <div className="dongtam-forecast-row" key={h}>
                      <span>Mưa dự báo +{h}h {tram === 'kiengiang' ? '(tại trạm / Trường Sơn)' : '(tại trạm)'}:</span>
                      <b>
                        {m.vungThap.sauHieuChinh}mm{tram === 'kiengiang' && m.truongSon ? ` / ${m.truongSon.sauHieuChinh}mm` : ''}
                      </b>
                    </div>
                  );
                })}
              </div>

              <div className="dongtam-forecast-note">
                📊 Phương trình riêng cho từng mốc, kiểm nghiệm theo từng năm (mùa lũ). Tỉ lệ đạt sai số cho phép:{' '}
                {tram === 'lethuy' ? 'Lệ Thủy khoảng 88–96%.' : 'Kiến Giang khoảng 50–70%.'}{' '}
                Kiểm nghiệm dùng mưa thực tế thay mưa dự báo nên thực tế vận hành có thể thấp hơn.
                Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
