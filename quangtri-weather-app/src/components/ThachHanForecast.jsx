import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './DongTamForecast.css'; // dùng chung kiểu giao diện với Đồng Tâm

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

const TRAM = {
  dakrong: { ten: 'Đakrông', thamKhao: false, nguongMoHinh: 25 },
  thachhan: { ten: 'Thạch Hãn', thamKhao: false, nguongMoHinh: 1 },
};

// tram: 'dakrong' | 'thachhan' (mỗi trạm một khung riêng)
export default function ThachHanForecast({ onClose, tram = 'thachhan' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    fetch(`/.netlify/functions/forecast-thachhan?hesoHieuChinh=${encodeURIComponent(hs)}`)
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
              {tram === 'thachhan' && data.tram.dakrong && (
                <div className="dongtam-forecast-hiennay">
                  Đakrông hiện tại ({formatTimeVN(data.tram.dakrong.thoiDiemHienTai)}): <b>{data.tram.dakrong.hienTai}m</b>
                  {' '}· cường suất 6h qua: <b>{data.tram.dakrong.tocDo6h > 0 ? '+' : ''}{data.tram.dakrong.tocDo6h}m/h</b>
                </div>
              )}

              {duoiNguong && (
                <div className="dongtam-forecast-empty">
                  ✅ Hiện chưa có lũ ({cfg.ten} dưới {cfg.nguongMoHinh}m).{' '}
                  {tram === 'thachhan' ? 'Thạch Hãn chịu ảnh hưởng triều: dự báo dùng mô hình triều, không dùng mưa.' : 'Dự báo dùng mô hình riêng cho mực nước thấp.'}
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
                <div className="dongtam-forecast-row"><span>{tram === 'thachhan' ? 'Mưa lưu vực 24h đã qua (TB Đakrông, Thạch Hãn, Tà Rụt):' : 'Mưa Đakrông–Tà Rụt 24h đã qua (TB):'}</span><b>{t.rainDaQua24h}mm</b></div>
                <div className="dongtam-forecast-row"><span>Mưa Tà Rụt 24h đã qua:</span><b>{t.rainTaRutDaQua24h}mm</b></div>
                {data.mucMuaDuBao && [6, 12, 18, 24].map((h) => {
                  const m = data.mucMuaDuBao[h];
                  if (!m) return null;
                  return (
                    <div className="dongtam-forecast-row" key={h}>
                      <span>Mưa dự báo +{h}h ({tram === 'thachhan' ? 'Đakrông / Thạch Hãn / Tà Rụt' : 'Đakrông / Tà Rụt'}, đã hiệu chỉnh):</span>
                      <b>
                        {tram === 'thachhan'
                          ? `${m.dakrongTram.sauHieuChinh} / ${m.thachhanTram.sauHieuChinh} / ${m.taRut.sauHieuChinh}mm`
                          : `${m.dakrongTram.sauHieuChinh} / ${m.taRut.sauHieuChinh}mm`}
                      </b>
                    </div>
                  );
                })}
              </div>

              <div className="dongtam-forecast-note">
                📊 Phương trình riêng cho từng mốc, kiểm nghiệm bỏ-từng-năm (2013-2026).{' '}
                {tram === 'thachhan'
                  ? 'Thạch Hãn khi có lũ: đạt sai số cho phép khoảng 94–98% (+6…+24h), đỉnh lũ khoảng 78% (đỉnh thường bị dự báo thấp hơn thực tế); dùng mực nước Đakrông (truyền về sau ~8–9 giờ).'
                  : 'Đakrông: sai số trung bình khoảng 0.4–0.5m ở các mốc (trạm chưa có sai số cho phép chính thức).'}{' '}
                Kiểm nghiệm dùng mưa thực tế thay mưa dự báo nên thực tế vận hành có thể thấp hơn.
                Đây là thông tin tham khảo, không thay thế bản tin dự báo chính thức của Đài KTTV tỉnh Quảng Trị.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
