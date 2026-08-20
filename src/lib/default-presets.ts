import { PartPreset, PartItem, ProjectMaster } from "@/types";
import { generateId, getTodayDateString } from "./utils";

// 표준 반도체/디스플레이 메인 사업장 목록 (중복 제거 및 최적화)
export const DEFAULT_SITES = [
  // 1. SK하이닉스 (SKH)
  "SKH 이천 TSV",
  "SKH 이천 M16",
  "SKH 이천 M14",
  "SKH 이천 M10C",
  "SKH 이천 R3",
  "SKH 이천 P&T4",
  "SKH 이천",
  "SKH 청주 M15X Ph-3",
  "SKH 청주 M15X Ph-4",
  "SKH 청주 M15X",
  "SKH 청주 M11A",
  "SKH 청주 M11B",
  "SKH 청주 M11",
  "SKH 청주 M8",
  "SKH 청주",
  "SKH 우시",
  "SKH 용인",

  // 2. 삼성 (SEC / SDC)
  "SEC 평택",
  "SEC 천안",
  "SEC 화성",
  "SEC 화성 M1L",
  "SEC 화성 17L",
  "SEC 데모",
  "SDC 아산",

  // 3. 글로벌 메모리 / 디스플레이 / 고객사
  "Micron 대만",
  "난야 대만",
  "KIOXIA 일본",
  "LGD_파주 P10",
  "테크센드포토마스크",
  "젬백스엔카엘",
  "데모",
];

// 반도체 설비 표준 부품 프리셋 (서브시스템별 BOM 템플릿)
export const STANDARD_PART_PRESETS: PartPreset[] = [
  // 1. Gas Delivery & Flow Control
  {
    id: "preset-mfc-01",
    category: "Gas & Flow",
    partName: "MFC (Mass Flow Controller) - SiH4",
    spec: "Horiba STEC / 0-500 sccm / DeviceNet",
    description: "공정 가스 정밀 유량 제어기",
  },
  {
    id: "preset-mfc-02",
    category: "Gas & Flow",
    partName: "MFC (Mass Flow Controller) - NF3",
    spec: "Brooks GF120 / 0-2000 sccm / EtherCAT",
    description: "챔버 세정 가스 제어기",
  },
  {
    id: "preset-mfc-03",
    category: "Gas & Flow",
    partName: "MFC (Mass Flow Controller) - Ar/N2",
    spec: "Unit Instruments / 0-5000 sccm / RS485",
    description: "불활성 퍼지 가스 제어기",
  },

  // 2. Vacuum & Pumping Subsystem
  {
    id: "preset-vac-01",
    category: "Vacuum & Exhaust",
    partName: "Dry Vacuum Pump",
    spec: "Edwards iXH1820 / 1800 m3/h / 200V 3Ph",
    description: "챔버 고진공 백킹 드라이 펌프",
  },
  {
    id: "preset-vac-02",
    category: "Vacuum & Exhaust",
    partName: "Turbo Molecular Pump (TMP)",
    spec: "Shimadzu TMP-2003LM / Mag-lev / DN250",
    description: "공정 챔버 초고진공 터보 분자 펌프",
  },
  {
    id: "preset-vac-03",
    category: "Vacuum & Exhaust",
    partName: "Baratron Capacitance Manometer",
    spec: "MKS 627D / 0.1 Torr / Heated 45°C",
    description: "초정밀 챔버 압력 측정 게이지",
  },
  {
    id: "preset-vac-04",
    category: "Vacuum & Exhaust",
    partName: "Pirani Vacuum Gauge",
    spec: "Inficon PSG500 / 5x10-4 ~ 1000 mbar",
    description: "포어라인 저진공 측정 게이지",
  },

  // 3. RF & Plasma Generator
  {
    id: "preset-rf-01",
    category: "RF & Plasma",
    partName: "RF Generator (High Freq)",
    spec: "Advanced Energy Paramount / 13.56MHz 3kW",
    description: "플라즈마 발생용 고주파 전원 장치",
  },
  {
    id: "preset-rf-02",
    category: "RF & Plasma",
    partName: "Auto Matcher (RF Impedance Matcher)",
    spec: "Comdel CX-3000 / Dynamic Auto Tuning",
    description: "RF 임피던스 자동 정합기",
  },

  // 4. Thermal & Temperature Control
  {
    id: "preset-thm-01",
    category: "Thermal & Cooling",
    partName: "Recirculating Chiller Unit",
    spec: "SMC Thermo-chiller HRSH090 / -20~+80°C",
    description: "웨이퍼 척 및 챔버 온도 제어 칠러",
  },
  {
    id: "preset-thm-02",
    category: "Thermal & Cooling",
    partName: "Heat Exchanger",
    spec: "Alfa Laval CB60 / SS316L / 10bar",
    description: "공정 열교환기",
  },

  // 5. Valves & Pneumatics
  {
    id: "preset-vlv-01",
    category: "Valves & Air",
    partName: "Pendulum Throttle Valve",
    spec: "VAT Series 65.0 / DN 250 / Integrated Controller",
    description: "챔버 압력 자동 조절 밸브",
  },
  {
    id: "preset-vlv-02",
    category: "Valves & Air",
    partName: "Fast Shut-off Gate Valve",
    spec: "VAT Series 12.1 / DN 200 / Pneumatic",
    description: "로드락-챔버 분리 격리 밸브",
  },
  {
    id: "preset-vlv-03",
    category: "Valves & Air",
    partName: "ALD Ultra-Fast Diaphragm Valve",
    spec: "Swagelok ALD3 / Pneumatic Actuator",
    description: "원자층 증착 전구체 초고속 밸브",
  },

  // 6. Sensors & Safety
  {
    id: "preset-sns-01",
    category: "Sensors & Safety",
    partName: "Optical Emission Spectroscopy (OES)",
    spec: "Horiba Jobin Yvon / 200-800nm CCD",
    description: "식각/증착 공정 종말점(EPD) 검출 센서",
  },
  {
    id: "preset-sns-02",
    category: "Sensors & Safety",
    partName: "Safety Interlock Controller",
    spec: "Pilz PNOZ Multi 2 / SIL 3, PL e",
    description: "설비 EMO 및 도어 안전 제어기",
  },

  // 7. Motion & Wafer Transfer
  {
    id: "preset-rob-01",
    category: "Wafer Transfer",
    partName: "Atmospheric Dual-Arm Robot",
    spec: "Yaskawa SR100 / 300mm FOUP Transfer",
    description: "EFEM 대기 환경 웨이퍼 이송 로봇",
  },
  {
    id: "preset-rob-02",
    category: "Wafer Transfer",
    partName: "Vacuum Transfer Robot (VTR)",
    spec: "Brooks MagnaTran 7 / Direct Drive",
    description: "진공 트랜스퍼 챔버 이송 로봇",
  },
];

// TM100L 표준 시리얼 리스트 BOM 템플릿 (8개 모듈 전체 43개 항목)
export const TM100L_PARTS_TEMPLATE: PartItem[] = [
  // [ MAIN ]
  { id: "tm-01", category: "[ MAIN ]", partName: "Syringe Pump", subSpec: "용액 자동화 장치", spec: "C3000, P/N 10013", detectedSerial: "673644", isVerified: true },
  { id: "tm-02", category: "[ MAIN ]", partName: "Cleaning Pump", subSpec: "Thomas-P", spec: "2680CGUI44, 230V, 50/60Hz", detectedSerial: "092402204027", isVerified: true },

  // [ MG ]
  { id: "tm-03", category: "[ MG ]", partName: "HPLC Pump", subSpec: "흡수액 (10mL)", spec: "Series-2 (301)", detectedSerial: "Z0065234", isVerified: true },
  { id: "tm-04", category: "[ MG ]", partName: "HPLC Pump", subSpec: "ELUENT (10mL)", spec: "Series-3 (426)", detectedSerial: "Z0065155", isVerified: true },
  { id: "tm-05", category: "[ MG ]", partName: "Injector", subSpec: "-", spec: "C52-2346I", detectedSerial: "25X-0049H", isVerified: true },
  { id: "tm-06", category: "[ MG ]", partName: "Switching Valve", subSpec: "-", spec: "C65Z-3186IA", detectedSerial: "25W-0296L", isVerified: true },
  { id: "tm-07", category: "[ MG ]", partName: "MFC", subSpec: "-", spec: "M3030V, Air, 10SLPM", detectedSerial: "M26044740", isVerified: true },
  { id: "tm-08", category: "[ MG ]", partName: "Vacuum Pump", subSpec: "838", spec: "PM28180-838 230V, 50/60Hz", detectedSerial: "25309826", isVerified: true },
  { id: "tm-09", category: "[ MG ]", partName: "Vacuum Pump", subSpec: "830", spec: "PM27597-NMP830 12V", detectedSerial: "16.24893336", isVerified: true },
  { id: "tm-10", category: "[ MG ]", partName: "Guard Column", subSpec: "DIONEX", spec: "AG14(2x50mm)", detectedSerial: "260518269", isVerified: true },
  { id: "tm-11", category: "[ MG ]", partName: "Analysis Column", subSpec: "DIONEX", spec: "AS14(2x250mm)", detectedSerial: "250218316", isVerified: true },
  { id: "tm-12", category: "[ MG ]", partName: "SRS", subSpec: "DIONEX", spec: "ADRS 600 2mm", detectedSerial: "260119092", isVerified: true },
  { id: "tm-13", category: "[ MG ]", partName: "Syringe Pump", subSpec: "분석부", spec: "C3000, P/N 10013", detectedSerial: "673648", isVerified: true },
  { id: "tm-14", category: "[ MG ]", partName: "FEP TUBE(1/8\")", subSpec: "샘플러 코일", spec: "FEP 3*2*100M", detectedSerial: "FF220207-13", isVerified: true },

  // [ WOA-683 ]
  { id: "tm-15", category: "[ WOA-683 ]", partName: "Delivery Pump", subSpec: "815", spec: "PM28238-815, 230V", detectedSerial: "25002481", isVerified: true },
  { id: "tm-16", category: "[ WOA-683 ]", partName: "Calibration Pump", subSpec: "-", spec: "107CCD18-621", detectedSerial: "012600037067", isVerified: true },
  { id: "tm-17", category: "[ WOA-683 ]", partName: "Ozone Analyzer", subSpec: "-", spec: "49i-B1NAA", detectedSerial: "CM26227022", isVerified: true },
  { id: "tm-18", category: "[ WOA-683 ]", partName: "Calibration", subSpec: "-", spec: "49iPS-BZAA", detectedSerial: "CM26227052", isVerified: true },

  // [ COSMOS-100 ]
  { id: "tm-19", category: "[ COSMOS-100 ]", partName: "Delivery Pump", subSpec: "815", spec: "PM28238-815, 230V", detectedSerial: "25002467", isVerified: true },
  { id: "tm-20", category: "[ COSMOS-100 ]", partName: "NH3 DETECTOR", subSpec: "DGtech", spec: "HEROS", detectedSerial: "KD26030201-013", isVerified: true },
  { id: "tm-21", category: "[ COSMOS-100 ]", partName: "NH3 DETECTOR Pump", subSpec: "Vacuubrand", spec: "MD1", detectedSerial: "131279307", isVerified: true },

  // [ MAIN(AutoSol) ]
  { id: "tm-22", category: "[ MAIN(AutoSol) ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "260225-09", isVerified: true },
  { id: "tm-23", category: "[ MAIN(AutoSol) ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "251021-49", isVerified: true },

  // [ COSMOS ]
  { id: "tm-24", category: "[ COSMOS ]", partName: "PC", subSpec: "UNO-2484G", spec: "RAM16G, SSD 256G", detectedSerial: "NXTWH-Y993C-8MFGG-8BTK2-YKRC3", isVerified: true },
  { id: "tm-25", category: "[ COSMOS ]", partName: "PC", subSpec: "UNO-2484G", spec: "WIN11 ENT LTSC", detectedSerial: "1 212003 031205", isVerified: true },
  { id: "tm-26", category: "[ COSMOS ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN1 MAC", detectedSerial: "CC-82-7F-C7-10-BC", isVerified: true },
  { id: "tm-27", category: "[ COSMOS ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN2 MAC", detectedSerial: "CC-82-7F-C7-10-BD", isVerified: true },
  { id: "tm-28", category: "[ COSMOS ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "260225-14", isVerified: true },
  { id: "tm-29", category: "[ COSMOS ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "251021-48", isVerified: true },

  // [ WOA ]
  { id: "tm-30", category: "[ WOA ]", partName: "PC", subSpec: "UNO-2484G", spec: "RAM16G, SSD 256G", detectedSerial: "2MMMG-K6B88-V4X94-J9TPC-YKRC3", isVerified: true },
  { id: "tm-31", category: "[ WOA ]", partName: "PC", subSpec: "UNO-2484G", spec: "WIN11 ENT LTSC", detectedSerial: "1 212003 031151", isVerified: true },
  { id: "tm-32", category: "[ WOA ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN1 MAC", detectedSerial: "CC-82-7F-C7-11-D8", isVerified: true },
  { id: "tm-33", category: "[ WOA ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN2 MAC", detectedSerial: "CC-82-7F-C7-11-D9", isVerified: true },
  { id: "tm-34", category: "[ WOA ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "260225-02", isVerified: true },
  { id: "tm-35", category: "[ WOA ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "260226-04", isVerified: true },

  // [ MG1 ]
  { id: "tm-36", category: "[ MG1 ]", partName: "PC", subSpec: "UNO-2484G", spec: "RAM16G, SSD 256G", detectedSerial: "NX4XY-DHXMG-RPJDW-PR3T6-8T4C3", isVerified: true },
  { id: "tm-37", category: "[ MG1 ]", partName: "PC", subSpec: "UNO-2484G", spec: "WIN11 ENT LTSC", detectedSerial: "1 212003 031106", isVerified: true },
  { id: "tm-38", category: "[ MG1 ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN1 MAC", detectedSerial: "CC-82-7F-AD-5D-89", isVerified: true },
  { id: "tm-39", category: "[ MG1 ]", partName: "PC", subSpec: "UNO-2484G", spec: "LAN2 MAC", detectedSerial: "CC-82-7F-AD-5D-8A", isVerified: true },
  { id: "tm-40", category: "[ MG1 ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "260225-16", isVerified: true },
  { id: "tm-41", category: "[ MG1 ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "260226-08", isVerified: true },
  { id: "tm-42", category: "[ MG1 ]", partName: "Detector", subSpec: "Analyzer", spec: "WCD-100", detectedSerial: "WCD1-TM1L-HK26-1002", isVerified: true },
  { id: "tm-43", category: "[ MG1 ]", partName: "LABJACK", subSpec: "A/D Converter", spec: "U6-PRO", detectedSerial: "360025493", isVerified: true },
];

// 모델별 표준 PJT 양식 템플릿 컬렉션
export interface PjtModelTemplate {
  id: string;
  modelName: string;
  pjtCodeHint: string;
  description: string;
  moduleCount: number;
  partsCount: number;
  parts: PartItem[];
}

export const PJT_MODEL_TEMPLATES: PjtModelTemplate[] = [
  {
    id: "tpl-tm100l",
    modelName: "TM100L (NaVi-TM100L-0312)",
    pjtCodeHint: "S26-15-10",
    description: "사내 표준 TM100L 8개 모듈 전체 시리얼 리스트 양식",
    moduleCount: 8,
    partsCount: 43,
    parts: TM100L_PARTS_TEMPLATE,
  },
  {
    id: "tpl-cosmos100",
    modelName: "COSMOS-100 (COSMOS-100-0340)",
    pjtCodeHint: "S26-15-12",
    description: "40 Port 대구경 챔버 진공/칠러/제어 보드 표준 양식",
    moduleCount: 4,
    partsCount: 7,
    parts: [
      { id: "cos-1", category: "[ VACUUM ]", partName: "Turbo Molecular Pump (TMP)", subSpec: "Shimadzu", spec: "TMP-2003LM / Mag-lev", detectedSerial: "", isVerified: false },
      { id: "cos-2", category: "[ VACUUM ]", partName: "Dry Vacuum Pump", subSpec: "Edwards", spec: "iXH1820 / 1800 m3/h", detectedSerial: "", isVerified: false },
      { id: "cos-3", category: "[ VACUUM ]", partName: "Baratron Capacitance Manometer", subSpec: "MKS", spec: "627D / 0.1 Torr", detectedSerial: "", isVerified: false },
      { id: "cos-4", category: "[ CHILLER ]", partName: "Recirculating Chiller Unit", subSpec: "SMC", spec: "Thermo-chiller 5kW", detectedSerial: "", isVerified: false },
      { id: "cos-5", category: "[ VALVE ]", partName: "Pendulum Throttle Valve", subSpec: "VAT", spec: "Series 65 / DN 250", detectedSerial: "", isVerified: false },
      { id: "cos-6", category: "[ CONTROL ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "", isVerified: false },
      { id: "cos-7", category: "[ CONTROL ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "", isVerified: false },
    ],
  },
  {
    id: "tpl-voice200",
    modelName: "VOICE200ultra-SOT200S (VOICE200ultra-SOT200S-0124)",
    pjtCodeHint: "S26-01-04",
    description: "24 Port 가스 유량 및 고진공 배기계 표준 양식",
    moduleCount: 3,
    partsCount: 6,
    parts: [
      { id: "voi-1", category: "[ GAS FLOW ]", partName: "MFC (Mass Flow Controller) - SiH4", subSpec: "Horiba STEC", spec: "0-500 sccm / DeviceNet", detectedSerial: "", isVerified: false },
      { id: "voi-2", category: "[ GAS FLOW ]", partName: "MFC (Mass Flow Controller) - Ar/N2", subSpec: "Unit Instruments", spec: "0-5000 sccm / RS485", detectedSerial: "", isVerified: false },
      { id: "voi-3", category: "[ VACUUM ]", partName: "Dry Vacuum Pump", subSpec: "Edwards", spec: "iXH1820 / 1800 m3/h", detectedSerial: "", isVerified: false },
      { id: "voi-4", category: "[ VACUUM ]", partName: "Pirani Vacuum Gauge", subSpec: "Inficon", spec: "PSG500 / 5x10-4 ~ 1000 mbar", detectedSerial: "", isVerified: false },
      { id: "voi-5", category: "[ SENSOR ]", partName: "Baratron Capacitance Manometer", subSpec: "MKS", spec: "627D / 0.1 Torr", detectedSerial: "", isVerified: false },
      { id: "voi-6", category: "[ CONTROL ]", partName: "Industrial PC", subSpec: "Advantech", spec: "UNO-2484G / Win11", detectedSerial: "", isVerified: false },
    ],
  },
  {
    id: "tpl-woa683",
    modelName: "WOA-683 (WOA-683-0208)",
    pjtCodeHint: "S26-01-05",
    description: "8 Port 세정/분석 전달 펌프 및 오존 분석기 표준 양식",
    moduleCount: 2,
    partsCount: 6,
    parts: [
      { id: "woa-1", category: "[ WOA-683 ]", partName: "Delivery Pump", subSpec: "815", spec: "PM28238-815, 230V", detectedSerial: "", isVerified: false },
      { id: "woa-2", category: "[ WOA-683 ]", partName: "Calibration Pump", subSpec: "-", spec: "107CCD18-621", detectedSerial: "", isVerified: false },
      { id: "woa-3", category: "[ WOA-683 ]", partName: "Ozone Analyzer", subSpec: "-", spec: "49i-B1NAA", detectedSerial: "", isVerified: false },
      { id: "woa-4", category: "[ WOA-683 ]", partName: "Calibration", subSpec: "-", spec: "49iPS-BZAA", detectedSerial: "", isVerified: false },
      { id: "woa-5", category: "[ CONTROL ]", partName: "Control Board", subSpec: "UCON-161", spec: "Main S/N", detectedSerial: "", isVerified: false },
      { id: "woa-6", category: "[ CONTROL ]", partName: "Control Board", subSpec: "UCON-107", spec: "I/O S/N", detectedSerial: "", isVerified: false },
    ],
  },
  {
    id: "tpl-mg200",
    modelName: "NaVi-MG200 (NaVi-MG200)",
    pjtCodeHint: "S26-45-01",
    description: "초정밀 광학 검사 및 X-Y 스테이지 모션 컨트롤 표준 양식",
    moduleCount: 3,
    partsCount: 6,
    parts: [
      { id: "mg-1", category: "[ OPTICAL ]", partName: "Optical Inspection Camera", subSpec: "Basler", spec: "5MP GigE CMOS", detectedSerial: "", isVerified: false },
      { id: "mg-2", category: "[ OPTICAL ]", partName: "Telecentric Lens", subSpec: "Moritex", spec: "2.0x / WD 110mm", detectedSerial: "", isVerified: false },
      { id: "mg-3", category: "[ MOTION ]", partName: "X-Y Precision Stage", subSpec: "THK", spec: "Linear Motor / 300x300mm", detectedSerial: "", isVerified: false },
      { id: "mg-4", category: "[ MOTION ]", partName: "Z-Axis Auto Focus Stage", subSpec: "Suruga", spec: "Micro Stepper / 0.1um", detectedSerial: "", isVerified: false },
      { id: "mg-5", category: "[ CONTROLLER ]", partName: "Motion Controller", subSpec: "ACS", spec: "4-Axis EtherCAT", detectedSerial: "", isVerified: false },
      { id: "mg-6", category: "[ CONTROLLER ]", partName: "Industrial PC", subSpec: "Advantech", spec: "i7-12700 / 32GB RAM", detectedSerial: "", isVerified: false },
    ],
  },
];

// 초기 빈 프로젝트 생성
export function createEmptyProject(): ProjectMaster {
  return {
    site: "SKH 이천 TSV",
    pjtCode: "S26-15-10",
    equipmentName: "TM100L (NaVi-TM100L-0312)",
    quantity: 1,
    inspectorName: "김형태, 유병준",
    inspectionDate: getTodayDateString(),
    notes: "TM100L 표준 시리얼 리스트 양식 (8개 모듈)",
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "TM1L-HK26-1007",
        parts: TM100L_PARTS_TEMPLATE.map((p) => ({ ...p, id: generateId() })),
      },
    ],
  };
}

export function createSampleProject(): ProjectMaster {
  return createEmptyProject();
}

// 엑셀 양식 기반 5개 표준 프로젝트 목록 (PJT List 용)
export const INITIAL_PROJECT_LIST: ProjectMaster[] = [
  // 1. SKH 이천 TSV | S26-15-10 | TM100L (NaVi-TM100L-0312) | 수량: 1 | TM1L-HK26-1007 | 담당자: 김형태, 유병준
  {
    id: "pjt-001",
    site: "SKH 이천 TSV",
    pjtCode: "S26-15-10",
    equipmentName: "TM100L (NaVi-TM100L-0312)",
    quantity: 1,
    inspectorName: "김형태, 유병준",
    inspectionDate: getTodayDateString(),
    notes: "TM100L 표준 시리얼 리스트 양식 (8개 모듈)",
    updatedAt: new Date().toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "TM1L-HK26-1007",
        parts: TM100L_PARTS_TEMPLATE.map((p) => ({ ...p, id: generateId() })),
      },
    ],
  },
  // 2. SKH 우시 | S26-15-12 | COSMOS-100 (COSMOS-100-0340) | 수량: 3 | COS1-HC26-0703 ~ 0705 | 담당자: 정재헌, 손홍렬
  {
    id: "pjt-002",
    site: "SKH 우시",
    pjtCode: "S26-15-12",
    equipmentName: "COSMOS-100 (COSMOS-100-0340)",
    quantity: 3,
    inspectorName: "정재헌, 손홍렬",
    inspectionDate: getTodayDateString(),
    notes: "40 Port 대구경 챔버 / 진공 게이지 및 칠러 시리얼 스캔 진행 중",
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "COS1-HC26-0703",
        parts: [
          { id: "p2-1-1", partName: "Turbo Molecular Pump (TMP)", spec: "Shimadzu TMP-2003LM", detectedSerial: "SHI-TMP-8831A", isVerified: true, scannedAt: new Date().toISOString(), confidence: 97 },
          { id: "p2-1-2", partName: "Recirculating Chiller Unit", spec: "SMC Thermo-chiller 5kW", detectedSerial: "SMC-CHL-9921", isVerified: true, scannedAt: new Date().toISOString(), confidence: 93 },
          { id: "p2-1-3", partName: "Pendulum Throttle Valve", spec: "VAT Series 65 / DN 250", detectedSerial: "", isVerified: false },
        ]
      },
      {
        unitIndex: 2,
        equipmentSerial: "COS1-HC26-0704",
        parts: [
          { id: "p2-2-1", partName: "Turbo Molecular Pump (TMP)", spec: "Shimadzu TMP-2003LM", detectedSerial: "", isVerified: false },
          { id: "p2-2-2", partName: "Recirculating Chiller Unit", spec: "SMC Thermo-chiller 5kW", detectedSerial: "", isVerified: false },
        ]
      },
      {
        unitIndex: 3,
        equipmentSerial: "COS1-HC26-0705",
        parts: [
          { id: "p2-3-1", partName: "Turbo Molecular Pump (TMP)", spec: "Shimadzu TMP-2003LM", detectedSerial: "", isVerified: false },
          { id: "p2-3-2", partName: "Recirculating Chiller Unit", spec: "SMC Thermo-chiller 5kW", detectedSerial: "", isVerified: false },
        ]
      }
    ]
  },
  // 3. SEC 평택 | S26-01-04 | VOICE200ultra-SOT200S (VOICE200ultra-SOT200S-0124) | 수량: 3 | SOTSU-SK26-0701 ~ 0703 | 담당자: 정재헌, 손홍렬
  {
    id: "pjt-003",
    site: "SEC 평택",
    pjtCode: "S26-01-04",
    equipmentName: "VOICE200ultra-SOT200S (VOICE200ultra-SOT200S-0124)",
    quantity: 3,
    inspectorName: "정재헌, 손홍렬",
    inspectionDate: getTodayDateString(),
    notes: "24 Port 3개 호기 연속 라인 설치 검수 완료",
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "SOTSU-SK26-0701",
        parts: [
          { id: "p3-1-1", partName: "MFC (Mass Flow Controller) - SiH4", spec: "Horiba STEC / 0-500 sccm", detectedSerial: "STEC-2026-H8821", isVerified: true, scannedAt: new Date().toISOString(), confidence: 98 },
          { id: "p3-1-2", partName: "Dry Vacuum Pump", spec: "Edwards iXH1820 / 1800 m3/h", detectedSerial: "EDW-IXH-99420A", isVerified: true, scannedAt: new Date().toISOString(), confidence: 96 },
        ]
      },
      {
        unitIndex: 2,
        equipmentSerial: "SOTSU-SK26-0702",
        parts: [
          { id: "p3-2-1", partName: "MFC (Mass Flow Controller) - SiH4", spec: "Horiba STEC / 0-500 sccm", detectedSerial: "STEC-2026-H8822", isVerified: true, scannedAt: new Date().toISOString(), confidence: 97 },
          { id: "p3-2-2", partName: "Dry Vacuum Pump", spec: "Edwards iXH1820 / 1800 m3/h", detectedSerial: "EDW-IXH-99421B", isVerified: true, scannedAt: new Date().toISOString(), confidence: 95 },
        ]
      },
      {
        unitIndex: 3,
        equipmentSerial: "SOTSU-SK26-0703",
        parts: [
          { id: "p3-3-1", partName: "MFC (Mass Flow Controller) - SiH4", spec: "Horiba STEC / 0-500 sccm", detectedSerial: "STEC-2026-H8823", isVerified: true, scannedAt: new Date().toISOString(), confidence: 96 },
          { id: "p3-3-2", partName: "Dry Vacuum Pump", spec: "Edwards iXH1820 / 1800 m3/h", detectedSerial: "EDW-IXH-99422C", isVerified: true, scannedAt: new Date().toISOString(), confidence: 94 },
        ]
      }
    ]
  },
  // 4. SEC 평택 | S26-01-05 | WOA-683 (WOA-683-0208) | 수량: 2 | WOA-SK26-0703 ~ 0704 | 담당자: 정재헌, 손홍렬
  {
    id: "pjt-004",
    site: "SEC 평택",
    pjtCode: "S26-01-05",
    equipmentName: "WOA-683 (WOA-683-0208)",
    quantity: 2,
    inspectorName: "정재헌, 손홍렬",
    inspectionDate: getTodayDateString(),
    notes: "8 Port 세정 시스템 / 부품 시리얼 검증 대기",
    updatedAt: new Date(Date.now() - 10800000).toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "WOA-SK26-0703",
        parts: [
          { id: "p4-1-1", partName: "Atmospheric Dual-Arm Robot", spec: "Yaskawa SR100 300mm", detectedSerial: "", isVerified: false },
          { id: "p4-1-2", partName: "Recirculating Chiller Unit", spec: "SMC Thermo-chiller", detectedSerial: "", isVerified: false },
          { id: "p4-1-3", partName: "Safety Interlock Controller", spec: "Pilz PNOZ Multi 2 / SIL 3", detectedSerial: "", isVerified: false },
        ]
      },
      {
        unitIndex: 2,
        equipmentSerial: "WOA-SK26-0704",
        parts: [
          { id: "p4-2-1", partName: "Atmospheric Dual-Arm Robot", spec: "Yaskawa SR100 300mm", detectedSerial: "", isVerified: false },
          { id: "p4-2-2", partName: "Recirculating Chiller Unit", spec: "SMC Thermo-chiller", detectedSerial: "", isVerified: false },
        ]
      }
    ]
  },
  // 5. 난야 대만 | S26-45-01 | NaVi-MG200 (NaVi-MG200) | 수량: 1 | MG20-NT26-1102 | 담당자: 김형태, 유병준
  {
    id: "pjt-005",
    site: "난야 대만",
    pjtCode: "S26-45-01",
    equipmentName: "NaVi-MG200 (NaVi-MG200)",
    quantity: 1,
    inspectorName: "김형태, 유병준",
    inspectionDate: getTodayDateString(),
    notes: "핸들러 설비 검수 준비",
    updatedAt: new Date(Date.now() - 14400000).toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "MG20-NT26-1102",
        parts: [
          { id: "p5-1", partName: "MFC (Mass Flow Controller) - NF3", spec: "Brooks GF120 / 0-2000 sccm", detectedSerial: "BRK-NF3-4410", isVerified: true, scannedAt: new Date().toISOString(), confidence: 95 },
          { id: "p5-2", partName: "Fast Shut-off Gate Valve", spec: "VAT Series 12.1 / DN 200", detectedSerial: "", isVerified: false },
          { id: "p5-3", partName: "Safety Interlock Controller", spec: "Pilz PNOZ Multi 2 / SIL 3", detectedSerial: "", isVerified: false },
        ]
      }
    ]
  }
];

export function createBlankProject(): ProjectMaster {
  return {
    id: generateId(),
    site: "",
    pjtCode: "",
    equipmentName: "",
    quantity: 1,
    inspectorName: "",
    inspectionDate: getTodayDateString(),
    notes: "",
    updatedAt: new Date().toISOString(),
    equipmentUnits: [
      {
        unitIndex: 1,
        equipmentSerial: "",
        parts: [
          {
            id: generateId(),
            partName: "MFC (Mass Flow Controller) - SiH4",
            spec: "Horiba STEC / 0-500 sccm",
            detectedSerial: "",
            isVerified: false,
          },
          {
            id: generateId(),
            partName: "Dry Vacuum Pump",
            spec: "Edwards iXH1820 / 1800 m3/h",
            detectedSerial: "",
            isVerified: false,
          }
        ],
      },
    ],
  };
}
