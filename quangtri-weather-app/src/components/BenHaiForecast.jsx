import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './DongTamForecast.css'; // dùng chung kiểu giao diện với Đồng Tâm

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

const TRAM = {
  giavong: { ten: 'Gia Vòng', nguongMoHinh: 3 },
  hienluong: { ten: 'Hiền Lương', nguongMoHinh: 1 },
};

// tram: 'giavong' | 'hienluong' (mỗi trạm một khung riêng)
export default function BenHaiForecast({ onClose, tram = 'giavong' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [heSo, setHeSo] = useState('1.0');

  const load = (hs) => {
    setData(null);
    setError(null);
    fetch(`/.netlify/functions/forecast-benhai?hesoHieuChinh=${encodeURIComponent(hs)}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(heSo); }, []);

  const t = data && data.available ? data.tram && data.tram[tram] : null;
  const cfg = TRAM[tram];
  const coDuBao = !!(t && t.duBaoTheoMoc);
  const duoiNguong = !!(t && t.cheDo === 'ngay_thuong');
  const coLu = !!(t && t.cheDo === 'lu');
  const lyDoThieu = data && data.available && !t && data.loi ? data.loi[tram] : null;

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
          {data && data.available && !t && <div className="dongtam-forecast-empty">ℹ️ Chưa có dự báo {cfg.ten}{lyDoThieu ? `: ${lyDoThieu}` : '.'}</div>}

          {t && (
            <>
              <div className="dongtam-forecast-hiennay">
                {cfg.ten} hiện tại ({formatTimeVN(t.thoiDiemHienTai)}): <b>{t.hienTai}m</b>
                {' '}· cường suất 6h qua: <b>{t.tocDo6h > 0 ? '+' : ''}{t.tocDo6h}m/h</b>
              </div>
              {tram === 'hienluong' && t.giaVongHienTai != null && (
                <div className="dongtam-forecast-hiennay">
                  Gia Vòng hiện tại ({formatTimeVN(t.giaVongThoiDiem)}): <b>{t.giaVongHienTai}m</b>
                  {' '}· cường suất 6h qua: <b>{t.giaVongToc6h > 0 ? '+' : ''}{t.giaVongToc6h}m/h</b>
                </div>
              )}

              {duoiNguong && (
                <div className="dongtam-forecast-empty">
                  ✅ Hiện chưa có lũ.{' '}
                  {tram === 'hienluong'
                    ? 'Hiền Lương chịu ảnh hưởng triều: dự báo dùng mô hình triều + mực nước Cửa Việt, không dùng mưa.'
                    : `Gia Vòng dưới ${cfg.nguongMoHinh}m: dự báo dùng mô hình riêng cho mực nước thấp.`}
                </div>
              )}
              {tram === 'giavong' && t.moHinh === 'giaVong' && (
                <div className="dongtam-forecast-empty">
                  ⚠️ Chưa có số liệu mưa Vĩnh Ô: đang dùng mô hình dự phòng theo mưa tại Gia Vòng, độ chính xác thấp hơn.
                </div>
              )}
              {tram === 'hienluong' && t.moHinh === 'khongVinhO' && (
                <div className="dongtam-forecast-empty">
                  ⚠️ Chưa có số liệu mưa Vĩnh Ô: đang dùng mô hình không có Vĩnh Ô, độ chính xác thấp hơn một chút.
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

                  {coLu && t.nhanDinhDinh && (
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
                <div className="dongtam-forecast-row">
                  <span>
                    {tram === 'giavong'
                      ? `Mưa 24h đã qua (${t.moHinh === 'vinhO' ? 'Vĩnh Ô' : 'Gia Vòng'}):`
                      : 'Mưa 24h đã qua (TB Gia Vòng, Hiền Lương):'}
                  </span>
                  <b>{t.rainDaQua24h}mm</b>
                </div>
                {data.mucMuaDuBao && [6, 12, 18, 24].map((h) => {
                  const m = data.mucMuaDuBao[h];
                  if (!m) return null;
                  const dong = tram === 'giavong'
                    ? (m.vinhO && m.giaVong ? `${m.vinhO.sauHieuChinh} / ${m.giaVong.sauHieuChinh}mm` : null)
                    : (m.vinhO && m.giaVong && m.hienLuong ? `${m.vinhO.sauHieuChinh} / ${m.giaVong.sauHieuChinh} / ${m.hienLuong.sauHieuChinh}mm`
                      : (m.giaVong && m.hienLuong ? `${m.giaVong.sauHieuChinh} / ${m.hienLuong.sauHieuChinh}mm` : null));
                  if (!dong) return null;
                  return (
                    <div className="dongtam-forecast-row" key={h}>
                      <span>Mưa dự báo +{h}h ({tram === 'giavong' ? 'Vĩnh Ô / Gia Vòng' : (m.vinhO ? 'Vĩnh Ô / Gia Vòng / Hiền Lương' : 'Gia Vòng / Hiền Lương')}, đã hiệu chỉnh):</span>
                      <b>{dong}</b>
                    </div>
                  );
                })}
              </div>

              <div className="dongtam-forecast-note">
                📊 Phương trình riêng cho từng mốc, kiểm nghiệm bỏ-từng-năm.{' '}
                {tram === 'giavong'
                  ? 'Gia Vòng khi có lũ (từ 3m): đạt sai số cho phép khoảng 93–95% (+6…+24h); khi mực nước từ BĐ I (5m) trở lên khoảng 79–83%. Mô hình chính dùng mưa Vĩnh Ô (số liệu từ 03/2019). Lưu ý đỉnh lũ: các đợt lũ từ 2019, dự báo phát hành trước đỉnh 6–12h đạt sai số cho phép của đỉnh (±1m) khoảng 70% với đỉnh từ 3m, nhưng chỉ khoảng 27% với đỉnh từ BĐ I trở lên (thường thấp hơn thực tế 1,6–1,8m, nhất là khi nước lên nhanh từ dưới 3m).'
                  : 'Hiền Lương: ngày thường (triều) đạt sai số cho phép khoảng 98–99%; khi có lũ khoảng 94–96%; khi mực nước từ BĐ I (1m) trở lên khoảng 87–90% (số liệu mực nước từ 08/2016). Đỉnh lũ từ 1m trở lên: dự báo phát hành trước đỉnh 6/12/24h đạt sai số cho phép (±0,29m) khoảng 86/68/46%.'}{' '}
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
