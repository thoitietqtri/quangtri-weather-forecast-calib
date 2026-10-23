import { useEffect, useRef, useState } from 'react';
import MaiHoaForecast from './MaiHoaForecast';
import DongTamForecast from './DongTamForecast';
import NhatLeForecast from './NhatLeForecast';
import DongHoiForecast from './DongHoiForecast';
import TanMyForecast from './TanMyForecast';
import CuaVietForecast from './CuaVietForecast';
import ThachHanForecast from './ThachHanForecast';
import DongHaForecast from './DongHaForecast';
import BenHaiForecast from './BenHaiForecast';
import './DuBaoMucNuoc.css';

// Cửa sổ "Dự báo Mực nước 6/12/18/24h tới": thanh chọn trạm (xếp theo sông) nằm ngay
// trên khung dự báo của trạm đang xem. Bấm tên trạm là đổi sang trạm đó, không phải
// đóng cửa sổ. Khung dự báo của từng trạm (bảng, biểu đồ, hệ số mưa) giữ nguyên.
//   id     = khóa nội bộ (cũng là giá trị nhớ "trạm xem gần nhất")
//   ten    = tên hiện trên thanh
//   matram = mã trạm KTTV, khớp id "kttv_<matram>" của hàm mucnuoc (để tô chấm màu báo động)
//   ready  = false: chưa có chức năng dự báo (hiện mờ, không bấm được)
const LUU_VUC_TRAM = [
  { song: 'Sông Gianh', trams: [
    { id: 'dongtam', ten: 'Đồng Tâm', matram: '555300', ready: true },
    { id: 'maihoa', ten: 'Mai Hóa', matram: '555400', ready: true },
    { id: 'tanmy', ten: 'Tân Mỹ', matram: '555800', ready: true },
  ] },
  { song: 'Sông Nhật Lệ', trams: [
    { id: 'kiengiang', ten: 'Kiến Giang', matram: '555500', ready: true },
    { id: 'lethuy', ten: 'Lệ Thủy', matram: '556100', ready: true },
    { id: 'donghoi', ten: 'Đồng Hới', matram: '557600', ready: true },
  ] },
  { song: 'Sông Bến Hải', trams: [
    { id: 'giavong', ten: 'Gia Vòng', matram: '554900', ready: true },
    { id: 'hienluong', ten: 'Hiền Lương', matram: '555000', ready: true },
  ] },
  { song: 'Sông Thạch Hãn', trams: [
    { id: 'dakrong', ten: 'Đakrông', matram: '554500', ready: true },
    { id: 'dongha', ten: 'Đông Hà', matram: '554700', ready: true },
    { id: 'thachhan', ten: 'Thạch Hãn', matram: '554600', ready: true },
    { id: 'cuaviet', ten: 'Cửa Việt', matram: '554800', ready: true },
  ] },
];

const KHOA_NHO_TRAM = 'dubaoMucNuoc.tramXemGanNhat';
const TRAM_MO_DUOC = LUU_VUC_TRAM.flatMap((lv) => lv.trams).filter((t) => t.ready).map((t) => t.id);

// Trạm xem gần nhất (lưu trong trình duyệt); chưa có hoặc đọc lỗi thì mở trạm đầu tiên.
function docTramGanNhat() {
  try {
    const v = window.localStorage.getItem(KHOA_NHO_TRAM);
    if (TRAM_MO_DUOC.includes(v)) return v;
  } catch { /* trình duyệt chặn lưu trữ: bỏ qua */ }
  return TRAM_MO_DUOC[0];
}

function luuTramGanNhat(id) {
  try { window.localStorage.setItem(KHOA_NHO_TRAM, id); } catch { /* bỏ qua */ }
}

// Khung dự báo của một trạm — chính các khung đang dùng, chỉ chọn đúng khung theo id.
function KhungTram({ id, onClose }) {
  switch (id) {
    case 'dongtam': return <DongTamForecast onClose={onClose} />;
    case 'maihoa': return <MaiHoaForecast onClose={onClose} />;
    case 'kiengiang':
    case 'lethuy': return <NhatLeForecast tram={id} onClose={onClose} />;
    case 'donghoi': return <DongHoiForecast onClose={onClose} />;
    case 'tanmy': return <TanMyForecast onClose={onClose} />;
    case 'cuaviet': return <CuaVietForecast onClose={onClose} />;
    case 'dakrong':
    case 'thachhan': return <ThachHanForecast tram={id} onClose={onClose} />;
    case 'dongha': return <DongHaForecast onClose={onClose} />;
    case 'giavong':
    case 'hienluong': return <BenHaiForecast tram={id} onClose={onClose} />;
    default: return null;
  }
}

function ThanhChonTram({ tramDangXem, onChon, mauTheoMaTram }) {
  const hopRef = useRef(null);
  const lanDauRef = useRef(true);
  const [mo, setMo] = useState({ trai: false, phai: false }); // còn chip bị che bên trái / bên phải

  const capNhatMo = () => {
    const h = hopRef.current;
    if (!h) return;
    const trai = h.scrollLeft > 4;
    const phai = h.scrollLeft + h.clientWidth < h.scrollWidth - 4;
    setMo((cu) => (cu.trai === trai && cu.phai === phai ? cu : { trai, phai }));
  };

  // Đổi trạm (và lúc mở) thì cuộn thanh để chip đang xem nằm giữa.
  useEffect(() => {
    const h = hopRef.current;
    if (!h) return;
    const chip = h.querySelector('[data-dang-xem="true"]');
    if (chip) {
      const dich = Math.max(0, chip.offsetLeft - (h.clientWidth - chip.offsetWidth) / 2);
      if (typeof h.scrollTo === 'function') h.scrollTo({ left: dich, behavior: lanDauRef.current ? 'auto' : 'smooth' });
      else h.scrollLeft = dich;
    }
    lanDauRef.current = false;
    capNhatMo();
  }, [tramDangXem]);

  // Máy tính: lăn chuột (chiều dọc) trên thanh thì cuộn ngang thanh.
  useEffect(() => {
    const h = hopRef.current;
    if (!h) return undefined;
    const onWheel = (e) => {
      if (h.scrollWidth <= h.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      h.scrollLeft += e.deltaY;
    };
    h.addEventListener('wheel', onWheel, { passive: false });
    return () => h.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="dbm-bar-wrap" onClick={(e) => e.stopPropagation()}>
      <div
        className="dbm-bar"
        role="group"
        aria-label="Chọn trạm dự báo mực nước"
        title="Chấm màu: mực nước hiện tại so với mức báo động (cùng màu với trạm trên bản đồ)"
      >
        <div className="dbm-hop" ref={hopRef} onScroll={capNhatMo}>
          {LUU_VUC_TRAM.map((lv) => (
            <div className="dbm-nhom" key={lv.song}>
              <span className="dbm-nhan">{lv.song}</span>
              <div className="dbm-chips">
                {lv.trams.map((tr) => {
                  const dangXem = tr.id === tramDangXem;
                  const mau = tr.ready && mauTheoMaTram ? mauTheoMaTram[tr.matram] : null;
                  return (
                    <button
                      type="button"
                      key={tr.id}
                      className={`dbm-chip${dangXem ? ' dbm-chip--on' : ''}`}
                      data-dang-xem={dangXem ? 'true' : undefined}
                      aria-pressed={dangXem}
                      disabled={!tr.ready}
                      onClick={() => onChon(tr.id)}
                    >
                      {mau && <span className="dbm-cham" style={{ background: mau }} />}
                      {tr.ten}{tr.ready ? '' : ' (chưa có)'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {mo.trai && <div className="dbm-mo dbm-mo--trai" />}
        {mo.phai && <div className="dbm-mo dbm-mo--phai" />}
      </div>
    </div>
  );
}

// mauTheoMaTram: { '<mã trạm KTTV>': '#màu' } — màu cấp báo động hiện tại, lấy từ MapComponent.
export default function DuBaoMucNuoc({ onClose, mauTheoMaTram }) {
  const [tram, setTram] = useState(docTramGanNhat);

  const chonTram = (id) => {
    setTram(id);
    luuTramGanNhat(id);
  };

  return (
    <div className="dubao-co-thanh-chon" onClick={onClose}>
      <ThanhChonTram tramDangXem={tram} onChon={chonTram} mauTheoMaTram={mauTheoMaTram} />
      {/* key: đổi trạm là dựng lại khung và tải số liệu của trạm đó, giống khi mở từ menu */}
      <KhungTram key={tram} id={tram} onClose={onClose} />
    </div>
  );
}
