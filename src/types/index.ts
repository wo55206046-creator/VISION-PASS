// 1. 부품 단위 아이템
export interface PartItem {
  id: string;
  category?: string;       // 모듈/섹션 구분 (예: [ MAIN ], [ MG ], [ WOA-683 ], [ COSMOS-100 ] 등)
  partName: string;         // 품명 (예: Syringe Pump, HPLC Pump, Injector, PC 등)
  subSpec?: string;         // 세부 사항 (예: 용액 자동화 장치, Thomas-P, 흡수액 (10mL), UNO-2484G 등)
  spec: string;             // 규격 (예: C3000, P/N 10013, Series-2 (301), RAM16G, SSD 256G 등)
  detectedSerial: string;   // OCR 추출 및 작업자가 최종 확인/수정한 시리얼 번호
  isVerified: boolean;      // 작업자 검증 체크 여부
  scannedAt?: string;       // 인식 시각 (ISO string)
  confidence?: number;      // OCR 신뢰도 (0~100)
}

// 2. 개별 설비 호기 단위 (수량만큼 동적 생성)
export interface EquipmentUnit {
  unitIndex: number;            // 호기 번호 (1호기, 2호기...)
  equipmentSerial: string;      // 설비 자체 시리얼 번호 (ex. SOTSU-SK26-1004)
  parts: PartItem[];            // 해당 호기에 장착된 부품 리스트
}

// 3. 최상위 프로젝트 메인 정보
export interface ProjectMaster {
  id?: string;                  // 프로젝트 고유 ID
  site: string;                 // 사업장 (ex. SEC_천안, SEC_화성, SKH_이천 등)
  pjtCode: string;              // PJT CODE (ex. S26-01-14)
  equipmentName: string;        // 설비명 (ex. SOT-200S)
  quantity: number;             // 설비 수량 (ex. 2)
  equipmentUnits: EquipmentUnit[]; // 수량에 맞춰 동적으로 생성/관리되는 개별 설비 리스트
  inspectorName: string;        // 검사자/작업자명
  inspectionDate: string;       // 검사일자 (YYYY-MM-DD)
  notes?: string;               // 특이사항 / 비고
  updatedAt?: string;           // 최근 수정 시각
}

// 4. 전처리 및 OCR 옵션
export interface PreprocessingOptions {
  grayscale: boolean;
  contrastStretch: boolean;
  adaptiveThreshold: boolean;
  invert: boolean;
  blurReduction: boolean;
  windowSize: number; // Adaptive thresholding window (e.g. 15~35)
  thresholdDelta: number; // Adaptive thresholding delta percentage
}

// 5. OCR 스캔 결과
export interface OcrResult {
  rawText: string;
  cleanedSerial: string;
  confidence: number;
  lines: string[];
  candidates: string[];
}

// 6. 표준 부품 BOM 프리셋
export interface PartPreset {
  id: string;
  category: string;
  partName: string;
  subSpec?: string;
  spec: string;
  description?: string;
}

// 7. 모델별 표준 PJT 양식 템플릿
export interface PjtModelTemplate {
  id: string;
  modelName: string;
  pjtCodeHint?: string;
  description: string;
  moduleCount?: number;
  partsCount?: number;
  parts: PartItem[];
  isCustom?: boolean;
}

