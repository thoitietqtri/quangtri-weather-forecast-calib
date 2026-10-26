// netlify/functions/forecast-benhai.js
//
// Dự báo mực nước 6/12/18/24h cho Gia Vòng (554900) và Hiền Lương (555000) — lưu vực sông Bến Hải.
// Hồi quy tuyến tính riêng cho từng mốc, huấn luyện từ số liệu giờ KTTV: mực nước Gia Vòng 2006-2026, Hiền Lương 08/2016-2026; mưa Gia Vòng, Hiền Lương 2011-2026, Vĩnh Ô 03/2019-2026.
//   Gia Vòng (không chịu triều):
//     Lũ (>= 3.0 m): mực nước, cường suất 3h/6h/12h, mưa đã qua 3/6/24/48h, mưa dự báo đến mốc.
//       Mô hình chính dùng mưa Vĩnh Ô (thượng nguồn; huấn luyện 03/2019-2026). Thiếu Vĩnh Ô thì dùng mô hình dự phòng theo mưa tại Gia Vòng (2011-2026).
//     Dưới 3.0 m: cùng dạng phương trình, huấn luyện riêng cho nước thấp (mưa tại Gia Vòng).
//   Hiền Lương (chịu triều):
//     Ngày thường (Gia Vòng < 3.0 m và Hiền Lương < 1.0 m): hàm điều hòa 12 phân triều của chính Hiền Lương + phần dư thực đo gần nhất
//       (xem khối "NGÀY THƯỜNG" bên dưới). Thiếu số liệu thì dùng hồi quy cũ: điều hòa 9 phân triều + mực nước Hiền Lương + cường suất 6h + Cửa Việt (554800).
//     Có lũ: thêm mực nước + cường suất Gia Vòng, mưa TB (Gia Vòng, Hiền Lương) và mưa Vĩnh Ô đã qua 6/24/48h, mưa dự báo đến mốc.
//       Thiếu Vĩnh Ô thì bỏ phần mưa Vĩnh Ô.
// Mưa dự báo = ECMWF IFS (Open-Meteo) x hệ số hiệu chỉnh.
// Kiểm nghiệm bỏ-từng-năm (mưa dự báo hoàn hảo; sai số cho phép Gia Vòng 83/100/100/100 cm, Hiền Lương 22/27/35/35 cm cho 6/12/18/24h):
//   Gia Vòng < 3 m: 99.8/99.7/99.6/99.5%.
//   Gia Vòng lũ >= 3 m: mưa Vĩnh Ô (2019-2026) 94.2/94.9/94.0/93.0%; dự phòng mưa Gia Vòng (2011-2026) 91.8/92.7/92.3/92.6%.
//     Khi mực nước hiện tại >= BĐ I (5 m): mưa Vĩnh Ô 81.8/83.2/82.3/78.8%; dự phòng 71.4/78.9/74.9/76.3%.
//     Đỉnh lũ (các đợt từ 2019, dự báo phát hành trước đỉnh thực 6/12/24h, sai số cho phép 100 cm): đỉnh >= 3 m (59 đợt) đạt 69/71/60%;
//       đỉnh >= BĐ I (27 đợt) chỉ đạt 27/27/8%, thấp hơn thực tế trung bình 1.6/1.8/2.5 m — nước lên nhanh từ dưới 3 m thường không được báo kịp.
//   Hiền Lương ngày thường: 98.1/98.7/99.1/99.0%; có lũ: 94.0/94.1/95.7/94.7% (có Vĩnh Ô), 92.3/92.5/94.8/93.5% (không có Vĩnh Ô).
//     Khi mực nước hiện tại >= BĐ I (1 m): 87–90% (có Vĩnh Ô).
//     Đỉnh lũ >= 1 m (28 đợt từ 2019, dự báo phát hành trước đỉnh thực 6/12/24h, sai số cho phép 29 cm): đạt 86/68/46%, thấp hơn thực tế trung bình 0.16/0.19/0.33 m.
// Chưa kiểm nghiệm với mưa dự báo ECMWF thực.

const KTTV_BASE_URL = 'http://203.209.181.170:2018/API_TTB/JSON/solieu.php';
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const HOURS_BACK = 60;
const LEADS = [6, 12, 18, 24];

const LEVEL = {
  giavong: { matram: '554900', ten_table: 'mucnuoc_oday', nguong: { bd1: 5, bd2: 8, bd3: 11 }, nguongMoHinh: 3.0 },
  hienluong: { matram: '555000', ten_table: 'mucnuoc_oday', nguong: { bd1: 1, bd2: 2, bd3: 2.5 }, nguongMoHinh: 1.0 },
};
const CUAVIET = { matram: '554800', ten_table: 'mucnuoc_oday' };
const RAIN_STATIONS = [
  { matram: '091458', ten_table: 'hanquoc_mua', lat: 16.9325, lng: 106.802, key: 'vo' },        // Vĩnh Ô
  { matram: '554900', ten_table: 'mua_oday_thuyvan', lat: 16.9564, lng: 106.951, key: 'gv' },  // Gia Vòng
  { matram: '555000', ten_table: 'mua_oday_thuyvan', lat: 17.006, lng: 107.055, key: 'hl' },   // Hiền Lương
];

// Gia Vòng: [hằng số, mực nước, cường suất 3h, 6h, 12h, mưa 3h qua, 6h qua, 24h qua, 48h qua, mưa dự báo đến mốc]
const MODEL_GV_NT = {
  6: [0.0258118, 0.981951, 2.11676, -0.493616, -1.09301, 0.00841561, 0.00366784, 0.000294809, -0.000557456, 0.00819692],
  12: [0.0630589, 0.958231, 1.54396, -0.762649, -1.54144, 0.00521371, 0.00415085, -9.31103e-05, -0.00104131, 0.0128433],
  18: [0.0915517, 0.940306, 0.730788, -0.895156, -1.12543, 0.00152865, 0.00428553, -0.000629818, -0.00121943, 0.0129159],
  24: [0.115097, 0.925692, 0.311672, -0.749501, -0.815412, 0.000824186, 0.00429837, -0.00134676, -0.00129891, 0.0120901],
};
const MODEL_GV_LU_G = {
  6: [0.868628, 0.708655, 0.686819, -0.776416, -1.38295, 0.0230255, 0.00350911, -0.00362593, -9.12023e-05, 0.0236559],
  12: [1.35429, 0.536896, 0.230447, -0.705662, -1.57171, 0.00967501, -0.000815612, -0.00415365, -0.000232073, 0.0269957],
  18: [1.52874, 0.468892, 0.0967025, -0.392583, -1.76035, 0.000193848, -0.00120942, -0.00350845, -0.000632321, 0.0217214],
  24: [1.67434, 0.416142, -0.000215009, -0.536323, -1.53835, 0.00155562, 0.000485805, -0.00400811, -0.000788479, 0.0172268],
};
const MODEL_GV_LU_V = {
  6: [0.984231, 0.677464, 0.576852, -0.904673, -1.37285, 0.02705, -0.000837757, -0.003273, -2.35972e-05, 0.0190144],
  12: [1.33221, 0.551845, 0.133628, -0.597935, -1.81129, 0.00862054, -0.00246803, -0.00346056, -0.00026533, 0.0202923],
  18: [1.36342, 0.533474, -0.169003, -0.491909, -2.01112, -0.000544105, -0.000586766, -0.00336012, -0.000783237, 0.0158822],
  24: [1.36669, 0.528849, -0.130708, -0.721575, -1.42045, -0.00196927, -0.000301107, -0.00382009, -0.000892449, 0.0123844],
};
// Hiền Lương ngày thường: [hằng số, hl, cường suất 6h, cửa việt, 18 số điều hòa triều (sin/cos của 9 thành phần)]
const MODEL_HL_NT = {
  6: [0.0142348, 0.795495, -2.907, 0.151742, 0.209722, 0.00496486, 0.0366238, 0.0373623, 0.113252, 0.00201212, 0.229263, -0.11191, -0.0294102, 0.0325092, -0.0283413, -0.00847436, 0.0395326, -0.00554878, -0.0365178, 0.0513298, 0.00129378, -0.00182594],
  12: [0.013216, 0.846867, -1.33262, 0.0829779, 0.112469, -0.0125759, 0.02061, 0.0185683, 0.114725, -0.0481584, 0.19241, -0.222794, -0.0123105, 0.0207158, -0.0156539, -0.00379387, 0.0370275, -0.0238021, -0.0171455, 0.0724741, 0.00112364, -0.00283775],
  18: [0.0132656, 0.862045, -4.39598, 0.0948072, 0.117729, -0.0400469, 0.0183942, 0.0190371, 0.0152198, -0.0187851, -0.0176554, -0.109641, -0.0088534, 0.0289523, -0.0142104, -0.00484198, 0.00297455, -0.00839612, 0.0213822, 0.0277896, 0.00202944, -0.00455304],
  24: [0.012204, 0.904977, -0.701247, 0.0541194, 0.0751403, -0.0585954, 0.0111097, 0.00975827, 0.0145147, 0.00584483, -0.0121816, -0.0518102, 0.000398295, 0.0266118, -0.00811074, -0.00264426, 0.00424722, 0.000986036, 0.0162127, 0.0147124, 0.00214696, -0.00510755],
};
// Hiền Lương ngày thường, thiếu Cửa Việt: [hằng số, hl, cường suất 6h, 18 số điều hòa triều]
const MODEL_HL_NT_NOCV = {
  6: [0.00616104, 0.935268, -3.0178, 0.201431, -0.00128153, 0.0358014, 0.0345117, 0.113664, 0.00169292, 0.230229, -0.116385, -0.0271483, 0.0320801, -0.027394, -0.00737307, 0.0399355, -0.00614715, -0.0359879, 0.052511, 0.000504323, -0.00205157],
  12: [0.00880237, 0.923327, -1.39322, 0.116611, -0.00869917, 0.0210574, 0.0201254, 0.114557, -0.0483812, 0.19004, -0.22359, -0.013565, 0.0207424, -0.0161729, -0.00439616, 0.0367021, -0.0240254, -0.0164577, 0.0723006, 0.000728717, -0.00304652],
  18: [0.00822478, 0.949417, -4.46529, 0.11349, -0.0449605, 0.0178802, 0.0172611, 0.0149689, -0.018588, -0.0188592, -0.107051, -0.00743331, 0.0291561, -0.0136086, -0.00416036, 0.00271609, -0.00802553, 0.0213186, 0.0269845, 0.00164087, -0.00488205],
  24: [0.00932701, 0.954869, -0.740795, 0.077245, -0.0555526, 0.0114011, 0.0107715, 0.0146287, 0.00598705, -0.0107886, -0.0509636, -0.000380254, 0.026364, -0.0084551, -0.00303351, 0.00445555, 0.00113158, 0.015756, 0.0146708, 0.0019702, -0.00533653],
};
// Hiền Lương có lũ, không có Vĩnh Ô: [hằng số, hl, cường suất 6h, gv, gv cường suất 3h, gv cường suất 6h, mưa TB(Gia Vòng, Hiền Lương) 6h, 24h, 48h qua, mưa dự báo đến mốc, 18 số điều hòa triều]
const MODEL_HL_LU = {
  6: [-0.022101, 0.921773, -1.86899, 0.0101409, 0.193642, 0.00638746, 0.00252111, -0.000283577, -0.000242882, 0.00320769, 0.162417, -0.0224988, 0.0274831, 0.0352728, 0.084266, 0.0246462, 0.135725, -0.0760669, -0.0190666, 0.0247648, -0.0126163, -0.00362895, 0.0183122, 0.0154194, -0.0353802, 0.0325436, 0.00175994, -0.00369542],
  12: [0.0398261, 0.882791, -0.639662, -0.00790557, 0.18962, -0.122259, 0.00116476, -0.000403927, -0.00037252, 0.00470074, 0.0459815, -0.0234365, 0.00906226, 0.00747271, 0.100301, -0.024118, 0.112786, -0.161459, -0.00272149, 0.00636021, -0.00335465, 0.000646492, 0.0255495, 0.00736007, -0.0220312, 0.0590871, 0.0042173, -0.00296977],
  18: [0.0351385, 0.832978, -2.39926, -0.00599332, 0.117402, 0.0810305, 0.000719256, -0.000313079, -0.000629487, 0.00479866, 0.13509, -0.0267225, 0.0187968, 0.0235054, 0.0253911, -0.0306639, -0.00482201, -0.113092, -0.0164046, 0.0225526, -0.0118859, 0.00102283, 0.0122768, -0.00486664, 0.0139657, 0.0418222, 0.00411086, -0.00392354],
  24: [0.0883915, 0.798797, -0.340603, -0.0184797, 0.167785, -0.168991, 0.000404535, -0.000499391, -0.000639666, 0.00436901, 0.0515726, -0.0400731, 0.0052185, 0.00940109, 0.0192097, 0.00161145, -0.00461818, -0.049805, -0.00184746, 0.00932476, -0.0035016, 0.00257513, 0.00621075, -0.00112718, 0.0126742, 0.0190476, 0.00382218, -0.00308809],
};
// Hiền Lương có lũ, có Vĩnh Ô: như trên, thêm sau mưa dự báo: [mưa Vĩnh Ô 6h, 24h, 48h qua, mưa dự báo Vĩnh Ô đến mốc] rồi 18 số điều hòa triều
const MODEL_HL_LU_V = {
  6: [0.0310507, 0.927468, -1.85662, -0.00647761, 0.110923, -0.0437846, 0.00175037, -0.000237441, -0.000182797, 0.00144148, 0.0024639, -0.000410615, -2.33457e-06, 0.00120729, 0.159281, -0.0200649, 0.0319962, 0.0319137, 0.0810196, 0.0291581, 0.148342, -0.0809472, -0.022233, 0.0195083, -0.0154743, -0.00444667, 0.0259937, 0.0115569, -0.0355238, 0.0302214, -0.000119434, -0.00281712],
  12: [0.0568621, 0.878775, -0.862721, -0.0122243, 0.0868136, -0.160375, 0.000663712, -0.000136385, -0.000369346, 0.0020486, 0.00228121, -0.000815963, 9.56535e-05, 0.00195345, 0.05404, -0.0222609, 0.0143707, 0.0104085, 0.102549, -0.0163845, 0.113743, -0.177376, -0.00686419, 0.0088072, -0.0026771, -0.00276704, 0.0259769, 0.000110358, -0.0247696, 0.0568473, 0.00281731, -0.00210343],
  18: [0.0120906, 0.821452, -2.39802, 0.00485055, 0.0326036, -0.00784631, 0.00038533, 9.84171e-05, -0.000641966, 0.00235624, 0.00171534, -0.00104749, 0.0001226, 0.00183428, 0.129402, -0.0262327, 0.0180512, 0.0184166, 0.0358357, -0.0315958, -0.00673603, -0.119394, -0.0165614, 0.0176305, -0.0159013, 0.000865426, 0.0142845, -0.00196294, 0.0083118, 0.0448994, 0.0020105, -0.00380169],
  24: [0.0482107, 0.791376, -0.526685, -0.00366486, 0.11763, -0.20351, 0.000255194, -4.65747e-05, -0.000703415, 0.00217013, 0.000702706, -0.000845698, 0.000110467, 0.00166128, 0.055698, -0.037763, 0.00911684, 0.0131441, 0.0235886, -0.00161671, 0.00177816, -0.0490061, -0.00442099, 0.00851256, -0.00251162, 0.00147628, 0.0120607, 0.00174563, 0.0109316, 0.0236082, 0.00140735, -0.00256372],
};
// Pha gốc của các thành phần triều (giờ VN, 00:00 01/01/2013) và chu kỳ (giờ)
const T0_VN = Date.UTC(2013, 0, 1, 0, 0, 0);
const TIDE_PERIODS = [12.4206, 12.0, 23.9345, 25.8193, 12.6583, 11.9672, 24.0659, 26.8684, 6.2103];


// ===== NGÀY THƯỜNG (chịu triều): HÀM ĐIỀU HÒA CỦA CHÍNH HIỀN LƯƠNG =====
// Hằng số và hệ số sinh từ tinh-he-so-dongha-hienluong.py (he-so-dongha-hienluong.json). Gốc thời gian: 00h 01/01/2000 giờ VN.
// Mực nước dự báo = triều điều hòa tại thời điểm dự báo + hồi quy theo phần dư thực đo gần nhất (giờ 0/3/6/12/24, TB 24 giờ) + mưa lưu vực
// (qm: mưa 24 giờ đã qua; sm: mưa dự báo đến mốc, đã nhân hệ số hiệu chỉnh).
// Ngày thường = Hiền Lương dưới 1,0 m và Gia Vòng dưới 3,0 m. Mưa lưu vực = trung bình Gia Vòng và Hiền Lương. Không dùng Cửa Việt (kiểm nghiệm cho thấy thêm Cửa Việt không cải thiện).
// Thiếu số liệu mực nước thì tự hạ xuống tầng rút gọn; thiếu phần dư, thiếu mưa đã qua (dưới 19/24 giờ) hoặc mưa dự báo thì dùng mô hình hồi quy cũ.
const PHAN_TRIEU_NT = [
  { ten: 'Q1', w: 13.3986609, a: 0.0396126319498779, b: 0.0009566797482125785 },
  { ten: 'O1', w: 13.9430356, a: 0.007269395485186025, b: -0.15819135522998432 },
  { ten: 'P1', w: 14.9589314, a: -0.01034667971238482, b: 0.023504754725834184 },
  { ten: 'K1', w: 15.0410686, a: -0.01523217973932356, b: 0.06864900469218632 },
  { ten: 'N2', w: 28.4397295, a: 0.029686875770569002, b: -0.03302386404353962 },
  { ten: 'M2', w: 28.9841042, a: -0.17147515745708142, b: -0.13237214134494227 },
  { ten: 'S2', w: 30.0, a: 0.0366737564805619, b: 0.03858960052596837 },
  { ten: 'K2', w: 30.0821373, a: -0.013477123663544767, b: -0.024258575502211187 },
  { ten: 'M4', w: 57.9682084, a: 0.007131177122051972, b: -0.00013809401068116996 },
  { ten: 'MS4', w: 58.9841042, a: -0.004124146947012582, b: -0.0007439858921240931 },
  { ten: 'MN4', w: 57.4238337, a: 6.899746682804487e-05, b: 0.002847993345036843 },
  { ten: 'M6', w: 86.9523127, a: 0.002773607155791491, b: 0.0004040145073741794 },
];
const HE_SO_NT = {
  day_du: {
    6: { intercept: -0.0004167224673741487, Hf: 1.0012163448528806, zt: 2.212473870351731, r0: 0.323697074699618, r3: -0.2516068419756724, r6: -0.24684835777144895, r12: -0.6450234472264443, r24: -0.4509529063066544, qm: 0.0005272216339133471, sm: 0.002574415642973073 },
    12: { intercept: -0.0008226463706828067, Hf: 0.998342802975679, zt: 0.48309241199606395, r0: 0.4112810613773353, r3: 0.04713540046857425, r6: -0.1960747875294193, r12: 0.4659624819920836, r24: -0.29414817228960016, qm: 0.0003593011285521183, sm: 0.0030047789042317594 },
    18: { intercept: -0.0014183867956994774, Hf: 0.9997351310899569, zt: 0.4494919419237106, r0: 0.3210094932097451, r3: -0.3220002726704341, r6: 0.6911826032744622, r12: -0.03387477219899454, r24: -0.21401984376385078, qm: 0.00018422850385924825, sm: 0.0031162026057431646 },
    24: { intercept: -0.0014305750023018537, Hf: 0.9968627259154168, zt: 0.06775278608723853, r0: 0.6679253447079304, r3: 0.29079024043127716, r6: -0.04532213372287298, r12: 0.0278653028794709, r24: -0.12244855495703616, qm: -0.00017607122827030926, sm: 0.002894199331122165 },
  },
  rut_gon: {
    6: { intercept: -0.0015110999642005598, Hf: 0.9966034921829694, zt: 0.7815361345642368, r0: 0.15085707104910545, qm: 0.0007463484209267805, sm: 0.0028513952850475486 },
    12: { intercept: -0.0023503827100551577, Hf: 0.9953511414990803, zt: 0.5744847190077071, r0: 0.339673458134344, qm: 0.0006221738493607564, sm: 0.003028296467592912 },
    18: { intercept: -0.0032021583514253993, Hf: 0.9962074284182427, zt: 0.8176983217485176, r0: 0.05857711816974093, qm: 0.0004870955807320167, sm: 0.003275663604406901 },
    24: { intercept: -0.0022822305206617235, Hf: 0.9981273194718088, zt: 0.133678897306583, r0: 0.7475982413834263, qm: -5.251907571870077e-05, sm: 0.0029399349614249487 },
  },
};
const DAC_TRUNG_NT = {
  day_du: ['Hf', 'zt', 'r0', 'r3', 'r6', 'r12', 'r24', 'qm', 'sm'],
  rut_gon: ['Hf', 'zt', 'r0', 'qm', 'sm'],
};
const T0_DIEU_HOA_MS = Date.UTC(2000, 0, 1) - 7 * 3600000; // 00h 01/01/2000 giờ VN, ms UTC thật
const RAD = Math.PI / 180;

// (f, u[rad]) hiệu chỉnh nút (Schureman rút gọn)
function heSoNut(h, ten) {
  const d = (h - 19) / 24;
  const N = (125.0445479 - 0.0529539222 * d) * RAD;
  const c1 = Math.cos(N); const c2 = Math.cos(2 * N); const c3 = Math.cos(3 * N);
  const s1 = Math.sin(N); const s2 = Math.sin(2 * N); const s3 = Math.sin(3 * N);
  const m2 = () => [1.0004 - 0.0373 * c1 + 0.0002 * c2, -2.14 * s1 * RAD];
  switch (ten) {
    case 'M2': case 'N2': case 'MS4': return m2();
    case 'O1': case 'Q1': return [1.0089 + 0.1871 * c1 - 0.0147 * c2 + 0.0014 * c3, (10.80 * s1 - 1.34 * s2 + 0.19 * s3) * RAD];
    case 'K1': return [1.0060 + 0.1150 * c1 - 0.0088 * c2 + 0.0006 * c3, (-8.86 * s1 + 0.68 * s2 - 0.07 * s3) * RAD];
    case 'K2': return [1.0241 + 0.2863 * c1 + 0.0083 * c2 - 0.0015 * c3, (-17.74 * s1 + 0.68 * s2 - 0.04 * s3) * RAD];
    case 'M4': case 'MN4': { const [f, u] = m2(); return [f * f, 2 * u]; }
    case 'M6': { const [f, u] = m2(); return [f * f * f, 3 * u]; }
    default: return [1, 0];
  }
}
// Thủy triều điều hòa tại Hiền Lương (m, quanh mực nền) tại thời điểm tMs (ms UTC thật)
function trieuDieuHoa(tMs) {
  const h = (tMs - T0_DIEU_HOA_MS) / 3600000;
  let tong = 0;
  for (const c of PHAN_TRIEU_NT) {
    const [f, u] = heSoNut(h, c.ten);
    const x = c.w * RAD * h + u;
    tong += f * (c.a * Math.cos(x) + c.b * Math.sin(x));
  }
  return tong;
}
// Bỏ số liệu lỗi: ngoài khoảng hợp lý và đoạn >= 8 giờ liên tiếp không đổi (máy treo) — giống lúc huấn luyện
function loaiLoiNT(series, cao = 4) {
  const ok = series.map((p) => p.v >= -1.6 && p.v <= cao);
  let i = 0;
  while (i < series.length) {
    let j = i;
    while (j + 1 < series.length && series[j + 1].v === series[i].v) j++;
    if (j - i + 1 >= 8) for (let k = i; k <= j; k++) ok[k] = false;
    i = j + 1;
  }
  return series.filter((_, k) => ok[k]);
}
function theoGioMap(series) {
  const m = new Map(); const lech = new Map();
  for (const p of series) {
    const k = Math.round(p.t / 3600000);
    const d = Math.abs(p.t - k * 3600000);
    if (!lech.has(k) || d < lech.get(k)) { m.set(k, p.v); lech.set(k, d); }
  }
  return m;
}
// Phần dư thực đo so với triều điều hòa tại giờ phát tin Tc (chỉ số giờ UTC thật). null nếu chưa đủ số liệu.
function phanDuTram(series) {
  const sach = loaiLoiNT(series);
  if (sach.length === 0) return null;
  const last = sach[sach.length - 1];
  const Tc = Math.round(last.t / 3600000);
  if (Math.abs(last.t - Tc * 3600000) > 30 * 60000) return null;
  const m = theoGioMap(sach);
  const pd = (lag) => { const v = m.get(Tc - lag); return v == null ? null : v - trieuDieuHoa((Tc - lag) * 3600000); };
  const r0 = pd(0);
  if (r0 == null) return null;
  const cuaSo = [];
  for (let k = 0; k < 24; k++) { const r = pd(k); if (r != null) cuaSo.push(r); }
  if (cuaSo.length < 12) return null;
  return { Tc, r0, r3: pd(3), r6: pd(6), r12: pd(12), r24: pd(24), zt: cuaSo.reduce((a, b) => a + b, 0) / cuaSo.length };
}
// Mưa lưu vực 24 giờ đã qua đến giờ Tc: qm = tổng (mm); du = false nếu thiếu quá 20% số giờ có số liệu (mô hình được huấn luyện trên mẫu đủ mưa)
function mua24NT(byHour, Tc) {
  let n = 0;
  for (let h = 0; h < 24; h++) { const v = byHour.get((Tc - h) * 3600000); if (v && v.length) n++; }
  return { qm: sumRainPast(byHour, Tc * 3600000, 24), du: n >= 19 };
}
// Dự báo ngày thường theo hàm điều hòa; sm = mưa dự báo đến mốc L (mm, đã nhân hệ số). Trả { y, moHinh } hoặc null nếu thiếu mưa
function duBaoNgayThuongDieuHoa(d, L, sm) {
  if (!d.du || sm == null) return null;
  const tang = [d.r3, d.r6, d.r12, d.r24].every((v) => v != null) ? 'day_du' : 'rut_gon';
  const c = HE_SO_NT[tang][L];
  const x = { Hf: trieuDieuHoa((d.Tc + L) * 3600000), zt: d.zt, r0: d.r0, r3: d.r3, r6: d.r6, r12: d.r12, r24: d.r24, qm: d.qm, sm };
  let y = c.intercept;
  for (const ten of DAC_TRUNG_NT[tang]) y += c[ten] * x[ten];
  return { y, moHinh: `dieu_hoa_${tang}` };
}

const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000);
const fmtVN = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const r2 = (x) => Math.round(x * 100) / 100;

function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchKttvSeries(station, tinhtong) {
  const end = vnNow();
  const start = new Date(end.getTime() - (HOURS_BACK + 1) * 3600 * 1000);
  const url = `${KTTV_BASE_URL}?matram=${station.matram}&ten_table=${station.ten_table}&sophut=60&tinhtong=${tinhtong}`
    + `&thoigianbd='${fmtVN(start)}'&thoigiankt='${fmtVN(end)}'`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const js = await res.json();
    if (!Array.isArray(js) || js.length === 0) return [];
    const sampleKeys = Object.keys(js[0]).reduce((acc, k) => ({ ...acc, [k.toLowerCase()]: k }), {});
    const valKey = sampleKeys['solieu'] || 'Solieu';
    const timeKey = sampleKeys['thoigian_sl'] || 'Thoigian_SL';
    return js
      .map((r) => ({ t: new Date(`${r[timeKey]}Z`.replace(' ', 'T')).getTime() - 7 * 3600 * 1000, v: parseFloat(r[valKey]) }))
      .filter((r) => Number.isFinite(r.v))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

function findValueAt(series, targetT, toleranceMs = 90 * 60 * 1000) {
  let best = null; let bestDiff = Infinity;
  for (const p of series) {
    const diff = Math.abs(p.t - targetT);
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best && bestDiff <= toleranceMs ? best.v : null;
}

// Mưa lưu vực theo giờ = trung bình các trạm có số liệu trong giờ đó.
function rainBasinByHour(seriesArr) {
  const byHour = new Map();
  for (const series of seriesArr) {
    for (const p of series) {
      const b = Math.floor(p.t / 3600000) * 3600000;
      if (!byHour.has(b)) byHour.set(b, []);
      byHour.get(b).push(p.v);
    }
  }
  return byHour;
}
function sumRainPast(byHour, endT, hours) {
  let sum = 0;
  for (let h = 0; h < hours; h++) {
    const vals = byHour.get(Math.floor((endT - h * 3600000) / 3600000) * 3600000);
    if (vals && vals.length) sum += vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return sum;
}

// Nhận diện đỉnh trong 4 mốc: giống Đồng Tâm / Mai Hóa.
function nhanDienDinh(hienTaiV, duBaoTheoMoc) {
  const diem = [{ h: 0, v: hienTaiV }, ...LEADS.map((h) => ({ h, v: duBaoTheoMoc[h] }))];
  for (let i = 1; i < diem.length - 1; i++) {
    if (diem[i].v >= diem[i - 1].v && diem[i].v >= diem[i + 1].v && diem[i].v > diem[i - 1].v) {
      return { coDinh: true, gioTruoc: diem[i - 1].h, gioDinh: diem[i].h, giaTriDinh: diem[i].v };
    }
  }
  const max = diem.reduce((a, b) => (b.v > a.v ? b : a));
  if (max.h === 24 && diem[diem.length - 2].v <= max.v) return { coDinh: false, dangTiepTucLen: true };
  return { coDinh: false, dangTiepTucLen: diem[diem.length - 1].v >= diem[diem.length - 2].v };
}


const sum = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const dot = (c, x) => c.reduce((a, b, i) => a + b * x[i], 0);

function tideTerms(tMs) {
  const h = (tMs + 7 * 3600 * 1000 - T0_VN) / 3600000;
  const out = [];
  for (const p of TIDE_PERIODS) out.push(Math.sin((2 * Math.PI * h) / p), Math.cos((2 * Math.PI * h) / p));
  return out;
}

// Giá trị mực nước tại điểm gần thời điểm tRef nhất (dung sai 90 phút) + cường suất 3h/6h/12h; thiếu thì null.
function levelAt(series, tRef) {
  let best = null; let bd = Infinity;
  for (const p of series) { const d = Math.abs(p.t - tRef); if (d < bd) { bd = d; best = p; } }
  if (!best || bd > 90 * 60 * 1000) return null;
  const v3 = findValueAt(series, best.t - 3 * 3600000, 45 * 60000); const v6 = findValueAt(series, best.t - 6 * 3600000);
  const v12 = findValueAt(series, best.t - 12 * 3600000);
  return { t: best.t, v: best.v, r3: v3 != null ? (best.v - v3) / 3 : 0, r6: v6 != null ? (best.v - v6) / 6 : 0, r12: v12 != null ? (best.v - v12) / 12 : 0 };
}

// Mưa đã qua 3/6/24/48h từ một hay nhiều chuỗi (trung bình các trạm có số liệu trong giờ đó).
function pastRain(seriesArr, t) {
  const by = rainBasinByHour(seriesArr);
  return { h3: sumRainPast(by, t, 3), h6: sumRainPast(by, t, 6), h24: sumRainPast(by, t, 24), h48: sumRainPast(by, t, 48) };
}

// Mô hình được huấn luyện trên các mẫu có số liệu mưa gần đầy đủ trong từng cửa sổ (>= 80% số giờ); thiếu nhiều thì không dùng mô hình đó.
const WIN_GV = [[3, 2], [6, 4], [24, 19], [48, 38]];
const WIN_HL = [[6, 4], [24, 19], [48, 38]];
function rainCoverageOk(series, t, windows) {
  const hours = new Set(series.map((p) => Math.floor(p.t / 3600000)));
  return windows.every(([w, need]) => {
    let n = 0;
    for (let h = 0; h < w; h++) if (hours.has(Math.floor((t - h * 3600000) / 3600000))) n++;
    return n >= need;
  });
}

// Mưa dự báo ECMWF theo giờ cho từng điểm; điểm nào lỗi thì bỏ qua (null).
async function fetchForecastHourly() {
  const results = await Promise.all(RAIN_STATIONS.map(async (s) => {
    try {
      const url = `${OPENMETEO_FORECAST_URL}?latitude=${s.lat}&longitude=${s.lng}`
        + `&hourly=precipitation&forecast_days=3&timezone=Asia%2FBangkok&models=ecmwf_ifs`;
      const res = await fetchWithTimeout(url, 8000);
      if (!res.ok) return null;
      const js = await res.json();
      if (!js?.hourly?.time || !js?.hourly?.precipitation) return null;
      return { key: s.key, hr: js.hourly };
    } catch { return null; }
  }));
  const out = {};
  for (const r of results) if (r) out[r.key] = r.hr;
  return out;
}
// 24 giá trị mưa giờ SAU thời điểm số liệu tObs (giờ VN theo nhãn Open-Meteo); thiếu khung giờ -> null.
function fcAfter(hr, tObs) {
  if (!hr) return null;
  const base = Math.floor(tObs / 3600000) * 3600000 + 7 * 3600 * 1000;
  const arr = [];
  for (let h = 1; h <= 24; h++) {
    const lb = fmtVN(new Date(base + h * 3600000)).slice(0, 13).replace(' ', 'T');
    const i = hr.time.findIndex((x) => x.startsWith(lb));
    if (i < 0 || hr.precipitation[i] == null) return null;
    arr.push(hr.precipitation[i]);
  }
  return arr;
}

function duBaoGiaVong(gv, rain, fc, heSo) {
  const lu = gv.v >= LEVEL.giavong.nguongMoHinh;
  let key = 'gv'; let M = lu ? MODEL_GV_LU_G : MODEL_GV_NT; let moHinh = lu ? 'giaVong' : 'nen';
  if (lu && rain.voOk && fc.vo) { key = 'vo'; M = MODEL_GV_LU_V; moHinh = 'vinhO'; }
  if (!fc[key]) return { loi: key === 'vo' ? 'Không lấy được mưa dự báo Vĩnh Ô' : 'Không lấy được mưa dự báo Gia Vòng' };
  const p = rain[key];
  const out = {};
  for (const L of LEADS) out[L] = r2(dot(M[L], [1, gv.v, gv.r3, gv.r6, gv.r12, p.h3, p.h6, p.h24, p.h48, sum(fc[key], L) * heSo]));
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', moHinh, rainDaQua24h: p.h24, nhanDinhDinh: nhanDienDinh(gv.v, out) };
}

function duBaoHienLuong(hl, gv, cv, ctx, heSo) {
  const lu = hl.v >= LEVEL.hienluong.nguongMoHinh || (gv && gv.v >= LEVEL.giavong.nguongMoHinh);
  const coCV = cv != null;
  const out = {};
  let moHinh = 'nen';
  let moHinhNT = null;
  if (lu) {
    if (!gv) return { loi: 'Có lũ nhưng thiếu mực nước Gia Vòng' };
    if (!ctx.fcM) return { loi: 'Không lấy được mưa dự báo ECMWF' };
    const dungV = ctx.voOk && !!ctx.fcV;
    moHinh = dungV ? 'vinhO' : 'khongVinhO';
    for (const L of LEADS) {
      const x = [1, hl.v, hl.r6, gv.v, gv.r3, gv.r6, ctx.rainM.h6, ctx.rainM.h24, ctx.rainM.h48, sum(ctx.fcM, L) * heSo,
        ...(dungV ? [ctx.rainV.h6, ctx.rainV.h24, ctx.rainV.h48, sum(ctx.fcV, L) * heSo] : []), ...tideTerms(hl.t + L * 3600000)];
      out[L] = r2(dot((dungV ? MODEL_HL_LU_V : MODEL_HL_LU)[L], x));
    }
  } else {
    // ngày thường: hàm điều hòa của Hiền Lương + phần dư thực đo gần nhất + mưa; thiếu phần dư hoặc mưa thì dùng mô hình hồi quy cũ
    const dh = ctx.dhc ? LEADS.map((L) => duBaoNgayThuongDieuHoa(ctx.dhc, L, ctx.fcM ? sum(ctx.fcM, L) * heSo : null)) : null;
    if (dh && dh.every(Boolean)) {
      LEADS.forEach((L, k) => { out[L] = r2(dh[k].y); });
      moHinhNT = dh[0].moHinh;
    } else {
      for (const L of LEADS) {
        const x = [1, hl.v, hl.r6, ...(coCV ? [cv] : []), ...tideTerms(hl.t + L * 3600000)];
        out[L] = r2(dot((coCV ? MODEL_HL_NT : MODEL_HL_NT_NOCV)[L], x));
      }
      moHinhNT = 'hoi_quy_cu';
    }
  }
  return { duBaoTheoMoc: out, cheDo: lu ? 'lu' : 'ngay_thuong', moHinh, ...(lu ? {} : { moHinhNT }), rainDaQua24h: ctx.rainM.h24, nhanDinhDinh: nhanDienDinh(hl.v, out) };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const heSoParam = parseFloat(url.searchParams.get('hesoHieuChinh'));
    const heSoHieuChinh = Number.isFinite(heSoParam) && heSoParam > 0 ? heSoParam : 1.0;

    const [gvSeries, hlSeries, cvSeries, ...rainSeries] = await Promise.all([
      fetchKttvSeries(LEVEL.giavong, '0'),
      fetchKttvSeries(LEVEL.hienluong, '0'),
      fetchKttvSeries(CUAVIET, '0'),
      ...RAIN_STATIONS.map((s) => fetchKttvSeries(s, '1')),
    ]);
    if (gvSeries.length === 0 && hlSeries.length === 0) return json({ available: false, reason: 'Không lấy được mực nước Gia Vòng và Hiền Lương' });
    const rainBy = Object.fromEntries(RAIN_STATIONS.map((s, i) => [s.key, rainSeries[i]]));
    const fcHourly = await fetchForecastHourly();
    const r1d = (x) => Math.round(x * 10) / 10;
    const out = { available: true, heSoHieuChinh, tram: {}, loi: {}, mucMuaDuBao: {} };

    const gv = gvSeries.length ? levelAt(gvSeries, gvSeries[gvSeries.length - 1].t) : null;
    const hl = hlSeries.length ? levelAt(hlSeries, hlSeries[hlSeries.length - 1].t) : null;

    if (gv) {
      const rain = { vo: pastRain([rainBy.vo], gv.t), gv: pastRain([rainBy.gv], gv.t), voOk: rainCoverageOk(rainBy.vo, gv.t, WIN_GV) };
      const fc = { vo: fcAfter(fcHourly.vo, gv.t), gv: fcAfter(fcHourly.gv, gv.t) };
      const r = duBaoGiaVong(gv, rain, fc, heSoHieuChinh);
      if (r.loi) out.loi.giavong = r.loi;
      else out.tram.giavong = {
        thoiDiemHienTai: gv.t, hienTai: r2(gv.v), tocDo6h: Math.round(gv.r6 * 1000) / 1000,
        nguong: LEVEL.giavong.nguong, nguongMoHinh: LEVEL.giavong.nguongMoHinh, ...r, rainDaQua24h: r1d(r.rainDaQua24h),
      };
    } else out.loi.giavong = 'Không lấy được mực nước Gia Vòng';

    if (hl) {
      const cvPt = findValueAt(cvSeries, hl.t);
      const gvAtHl = gvSeries.length ? levelAt(gvSeries, hl.t) : null;
      const rainM = pastRain([rainBy.gv, rainBy.hl], hl.t);
      const fcGv = fcAfter(fcHourly.gv, hl.t); const fcHl = fcAfter(fcHourly.hl, hl.t);
      const fcM = fcGv && fcHl ? fcGv.map((v, i) => (v + fcHl[i]) / 2) : null;
      const voOk = rainCoverageOk(rainBy.vo, hl.t, WIN_HL);
      const dhc = phanDuTram(hlSeries); // phần dư so với triều điều hòa + mưa 24 giờ qua (null -> dùng mô hình cũ)
      if (dhc) Object.assign(dhc, mua24NT(rainBasinByHour([rainBy.gv, rainBy.hl]), dhc.Tc));
      const r = duBaoHienLuong(hl, gvAtHl, cvPt, { rainM, fcM, voOk, dhc, rainV: pastRain([rainBy.vo], hl.t), fcV: fcAfter(fcHourly.vo, hl.t) }, heSoHieuChinh);
      if (r.loi) out.loi.hienluong = r.loi;
      else out.tram.hienluong = {
        thoiDiemHienTai: hl.t, hienTai: r2(hl.v), tocDo6h: Math.round(hl.r6 * 1000) / 1000,
        nguong: LEVEL.hienluong.nguong, nguongMoHinh: LEVEL.hienluong.nguongMoHinh, ...r, rainDaQua24h: r1d(r.rainDaQua24h),
        giaVongHienTai: gvAtHl ? r2(gvAtHl.v) : null, giaVongToc6h: gvAtHl ? Math.round(gvAtHl.r6 * 1000) / 1000 : null, giaVongThoiDiem: gvAtHl ? gvAtHl.t : null,
      };
    } else out.loi.hienluong = 'Không lấy được mực nước Hiền Lương';

    // Tổng mưa dự báo theo mốc (mm), đã nhân hệ số hiệu chỉnh — dùng để hiển thị
    const tRef = (gv || hl).t;
    const fa = { vo: fcAfter(fcHourly.vo, tRef), gv: fcAfter(fcHourly.gv, tRef), hl: fcAfter(fcHourly.hl, tRef) };
    for (const L of LEADS) {
      out.mucMuaDuBao[L] = {};
      for (const [k, name] of [['vo', 'vinhO'], ['gv', 'giaVong'], ['hl', 'hienLuong']]) {
        if (fa[k]) out.mucMuaDuBao[L][name] = { goc: r1d(sum(fa[k], L)), sauHieuChinh: r1d(sum(fa[k], L) * heSoHieuChinh) };
      }
    }
    if (!out.tram.giavong && !out.tram.hienluong) return json({ available: false, reason: out.loi.giavong || out.loi.hienluong });
    return json(out);
  } catch (e) {
    return json({ available: false, reason: `Lỗi: ${e.message}` });
  }
};

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
