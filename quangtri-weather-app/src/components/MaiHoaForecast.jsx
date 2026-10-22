import { useEffect, useState } from 'react';
import DuBaoChart from './DuBaoChart';
import './MaiHoaForecast.css';

function formatTimeVN(t) {
  const d = new Date(t + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}h ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}

export default function MaiHoaForecast({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showBacktest, setShowBacktest] = useState(false);
  const [asofInput, setAsofInput] = useState('');
  const [heSo, setHeSo] = useState('1.0');

  const load = (asof, hs) => {
    setData(null);
    setError(null);
    const params = new URLSearchParams();
    if (asof) params.set('asof', asof);
    if (hs) params.set('hesoHieuChinh', hs);
    fetch(`/.netlify/functions/forecast-maihoa?${params.toString()}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => { load(null, heSo); }, []);

  return (
    <div className="maihoa-forecast-overlay" onClick={onClose}>
      <div className="maihoa-forecast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="maihoa-forecast-header">
          <div>
            <h3>🔮 Dự báo mực nước Mai Hóa</h3>
            <div className="maihoa-forecast-wip">Tham khảo - Không thay thế bản tin chính thức từ Đài KTTV tỉnh Quảng Trị</div>
          </div>
          <button className="maihoa-forecast-close" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        <div className="maihoa-forecast-body">
          {!showBacktest && (
            <div className="dongtam-forecast-hesobox">
              <label>Hệ số hiệu chỉnh mưa dự báo ECMWF (mặc định 1.0 — chỉnh lên 2-2.5 nếu đang có bão/ATNĐ):</label>
              <div className="dongtam-forecast-hesobox-row">
                <input type="number" step="0.1" min="0.1" value={heSo} onChange={(e) => setHeSo(e.target.value)} />
                <button onClick={() => load(null, heSo)}>Áp dụng</button>
              </div>
            </div>
          )}

          <button className="maihoa-forecast-backtest-toggle" onClick={() => setShowBacktest((v) => !v)}>
            🔧 Chế độ kiểm nghiệm (kỹ thuật)
          </button>
          {showBacktest && (
            <div className="maihoa-forecast-backtest-box">
              <label>Giả lập "bây giờ" là (giờ VN):</label>
              <input type="text" placeholder="2026-09-14 05:00:00" value={asofInput} onChange={(e) => setAsofInput(e.target.value)} />
              <div className="maihoa-forecast-backtest-btns">
                <button onClick={() => load(asofInput)}>Kiểm tra</button>
                <button onClick={() => { setAsofInput(''); load(null, heSo); }}>Về chế độ thật</button>
              </div>
            </div>
          )}

          {data && data.backtestMode && (
            <div className="maihoa-forecast-backtest-note">🕑 Đang xem lại quá khứ — mốc: {data.asof} (mưa "dự báo" là mưa thật đã xảy ra sau mốc này, giả lập dự báo hoàn hảo)</div>
          )}

          {error && <div className="maihoa-forecast-error">⚠️ Lỗi: {error}</div>}
          {!error && !data && <div className="maihoa-forecast-loading">⏳ Đang tải...</div>}
          {data && !data.available && <div className="maihoa-forecast-empty">ℹ️ {data.reason}</div>}

          {data && data.available && data.cheDo === 'dieu_hoa' && (
            <>
              <div className="dongtam-forecast-hiennay">
                Mai Hóa hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b>
                {' | '}Đồng Tâm: {data.dongtamHienTai != null ? <b>{data.dongtamHienTai}m</b> : <b style={{ color: '#FFB74D' }}>mất số liệu</b>}
                {data.dongtamHienTai != null && ' (dưới ngưỡng lũ — dùng mô hình triều)'}
              </div>

              {data.canhBaoMua === 'do' && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFCDD2', background: 'rgba(211,47,47,0.16)', border: '1px solid rgba(239,83,80,0.7)' }}>
                  🔴 Mưa lưu vực dự báo 24 giờ tới {data.mucMuaDuBao[24].sauHieuChinh}mm (từ 100mm): có nguy cơ lũ lên — khoảng một phần ba đến một nửa trường hợp như vậy Mai Hóa vượt báo động I (3m) trong 24 giờ tới. Mô hình triều thường THẤP hơn thực tế (sai số trung bình khoảng 0,9m). Theo dõi Đồng Tâm; khi Đồng Tâm từ 5.6m hệ thống tự chuyển sang mô hình lũ.
                </div>
              )}
              {data.canhBaoMua === 'vang' && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' }}>
                  ⚠️ Mưa lưu vực dự báo 24 giờ tới {data.mucMuaDuBao[24].sauHieuChinh}mm (từ 30mm): mô hình triều chưa phản ánh đủ ảnh hưởng của mưa, sai số có thể tới 0,3 đến 0,5m.
                </div>
              )}
              {data.thieuMuaDuBao && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' }}>
                  ⚠️ Không lấy được mưa dự báo ECMWF — kết quả tính với mưa dự báo bằng 0, có thể thấp hơn thực tế nếu sắp có mưa.
                </div>
              )}
              {data.thieuDongTam && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' }}>
                  ⚠️ Đồng Tâm đang mất số liệu nên chưa kiểm tra được ngưỡng lũ. Mai Hóa đang dưới 3m nên vẫn tính bằng mô hình triều, nhưng cần xem lại khi Đồng Tâm có số liệu.
                </div>
              )}
              {data.tang === 'rut_gon' && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12 }}>
                  ℹ️ Mai Hóa thiếu một số số liệu giờ trong 24 giờ qua nên dùng mô hình rút gọn (sai số tăng thêm khoảng 0,01 đến 0,02m).
                </div>
              )}

              <table className="dongtam-forecast-table">
                <thead>
                  <tr><th></th><th>+6h</th><th>+12h</th><th>+18h</th><th>+24h</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Giờ</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}>{formatTimeVN(data.thoiDiemHienTai + h * 3600000)}</td>)}
                  </tr>
                  <tr className="dongtam-forecast-table-value">
                    <td>Mực nước</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}><b>{data.duBaoTheoMoc[h]}m</b></td>)}
                  </tr>
                </tbody>
              </table>

              <DuBaoChart
                hienTaiT={data.thoiDiemHienTai}
                hienTaiV={data.duongTrieu[0].v}
                duBaoTheoMoc={data.duBaoTheoMoc}
                duongCong={data.duongTrieu}
                diemCuc={[
                  { ...data.trieuCao, loai: 'cao' },
                  { ...data.trieuThap, loai: 'thap' },
                ]}
              />

              <div className="dongtam-forecast-dinh">
                🌊 Trong 24 giờ tới, triều cao nhất <b>{data.trieuCao.v}m</b> lúc {formatTimeVN(data.trieuCao.t)}; thấp nhất <b>{data.trieuThap.v}m</b> lúc {formatTimeVN(data.trieuThap.t)}
              </div>

              <div className="maihoa-forecast-inputs">
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (ECMWF→HC):</span>
                    <b>{data.mucMuaDuBao[h].goc != null ? `${data.mucMuaDuBao[h].goc}mm → ${data.mucMuaDuBao[h].sauHieuChinh}mm` : 'không có'}</b>
                  </div>
                ))}
              </div>

              <div className="maihoa-forecast-note">
                📊 Mô hình ngày thường: hàm điều hòa thủy triều dựng từ chính số liệu Mai Hóa 2020-2025, hiệu chỉnh theo mực nước thực đo 24 giờ gần nhất và mưa lưu vực. Sai số trung bình (kiểm chứng ngoài mẫu): +6h 0.08m, +12h 0.09m, +18h 0.10m, +24h 0.10m. Chỉ dùng khi Mai Hóa dưới 3m và Đồng Tâm dưới 5.6m — khi có lũ hệ thống tự chuyển sang mô hình lũ (quan hệ với Đồng Tâm và mưa lưu vực), vì lũ phá vỡ quy luật triều. Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}

          {data && data.available && data.cheDo !== 'dieu_hoa' && (
            <>
              <div className="dongtam-forecast-hiennay">
                Mai Hóa hiện tại ({formatTimeVN(data.thoiDiemHienTai)}): <b>{data.maihoaHienTai}m</b>
                {' | '}Đồng Tâm: <b>{data.dongtamHienTai}m</b>
                {' | '}Tân Lâm: {data.tanlamHienTai != null ? <b>{data.tanlamHienTai}m</b> : <b style={{ color: '#FFB74D' }}>mất số liệu</b>}
              </div>

              {data.khongDungTanLam && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFE082', background: 'rgba(249,168,37,0.14)', border: '1px solid rgba(249,168,37,0.6)' }}>
                  ⚠️ {data.tanlamHienTai == null ? 'Tân Lâm đang mất số liệu' : 'Đang chạy thử không dùng Tân Lâm'}
                  {data.tanlamHienTai == null && data.tanlamMoiNhat ? ` (số liệu cuối ${data.tanlamMoiNhat.v}m lúc ${formatTimeVN(data.tanlamMoiNhat.t)})` : ''}
                  {data.tanlamHienTai == null && !data.tanlamMoiNhat && data.tanlamLyDo ? ` (${data.tanlamLyDo})` : ''}
                  {' '}— dự báo dưới đây tính bằng công thức dự phòng không dùng Tân Lâm (chỉ dùng mực nước Mai Hóa, Đồng Tâm và mưa lưu vực).
                </div>
              )}
              {data.mucNuocThap && (
                <div className="maihoa-forecast-note" style={{ marginTop: 10, fontSize: 12, color: '#FFCDD2', background: 'rgba(211,47,47,0.16)', border: '1px solid rgba(239,83,80,0.7)' }}>
                  ⚠️ Mai Hóa đang dưới báo động I (3m): công thức lũ không phù hợp với mực nước thấp (còn chịu ảnh hưởng triều), kết quả thường THẤP hơn thực tế khoảng 0,7 đến 1m. Chỉ tham khảo.
                  {data.dieuHoaLyDo ? <><br />Mô hình triều (ngày thường) chưa dùng được: {data.dieuHoaLyDo}.</> : null}
                </div>
              )}

              <table className="dongtam-forecast-table">
                <thead>
                  <tr><th></th><th>+6h</th><th>+12h</th><th>+18h</th><th>+24h</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Giờ</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}>{formatTimeVN(data.thoiDiemHienTai + h * 3600000)}</td>)}
                  </tr>
                  <tr className="dongtam-forecast-table-value">
                    <td>Mực nước</td>
                    {[6, 12, 18, 24].map((h) => <td key={h}><b>{data.duBaoTheoMoc[h]}m</b></td>)}
                  </tr>
                </tbody>
              </table>

              <DuBaoChart
                hienTaiT={data.thoiDiemHienTai}
                hienTaiV={data.maihoaHienTai}
                duBaoTheoMoc={data.duBaoTheoMoc}
                nguong={{ bd1: 3, bd2: 5, bd3: 6.5 }}
              />

              <div className="dongtam-forecast-dinh">
                {data.nhanDinhDinh.coDinh ? (
                  <>🔴 Dự kiến đạt <b>ĐỈNH {data.nhanDinhDinh.giaTriDinh.toFixed(2)}m</b> trong khoảng {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioTruoc * 3600000)} đến {formatTimeVN(data.thoiDiemHienTai + data.nhanDinhDinh.gioDinh * 3600000)}</>
                ) : data.nhanDinhDinh.dangTiepTucLen ? (
                  <>📈 Sau +24h vẫn còn xu hướng <b>TIẾP TỤC LÊN</b>, chưa xác định được đỉnh trong 24h tới</>
                ) : (
                  <>📉 Xu hướng giảm/ổn định trong 24h tới, không có đỉnh mới</>
                )}
              </div>

              <div className="maihoa-forecast-inputs">
                <div className="maihoa-forecast-row"><span>Mưa lưu vực 24h đã qua:</span><b>{data.rainDaQua24h}mm</b></div>
                {[6, 12, 18, 24].map((h) => (
                  <div className="maihoa-forecast-row" key={h}>
                    <span>Mưa dự báo +{h}h (ECMWF→HC):</span>
                    <b>{data.mucMuaDuBao[h].goc}mm → {data.mucMuaDuBao[h].sauHieuChinh}mm</b>
                  </div>
                ))}
              </div>

              <div className="maihoa-forecast-note">
                {data.khongDungTanLam
                  ? '📊 Công thức dự phòng không dùng Tân Lâm, học lại từ cùng 212 mẫu giờ mùa lũ (2010-2025). Kiểm chứng chéo theo năm (ngoài mẫu) — đạt chuẩn sai số ±1m: 91.5% (+6h), 70.3% (+12h), 67.5% (+18h), 78.8% (+24h); sai số trung bình ngang công thức có Tân Lâm khi so cùng cách ngoài mẫu.'
                  : '📊 Phương trình riêng cho từng mốc, xây từ 212 mẫu giờ mùa lũ (2010-2025) — đạt chuẩn sai số ±1m: 91.5% (+6h), 76% (+12h), 74.5% (+18h), 81.6% (+24h).'}
                {' '}Đây là tham khảo hỗ trợ, không thay thế đánh giá chuyên môn của dự báo viên.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
