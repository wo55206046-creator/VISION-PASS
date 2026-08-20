// Global Ambient Types for External Libraries

declare namespace ExcelJS {
  export type Fill = any;
  export type Borders = any;
  export type Alignment = any;
  export type Font = any;
  export type Workbook = any;
  export type Worksheet = any;
  export type Row = any;
  export type Cell = any;
  export interface WorkbookModel {
    [key: string]: any;
  }
}

declare module "exceljs" {
  const ExcelJS: any;
  export default ExcelJS;
}

declare module "tesseract.js" {
  export interface Worker {
    recognize(image: any): Promise<any>;
    setParameters(params: any): Promise<any>;
    terminate(): Promise<any>;
  }
  export function createWorker(lang?: string, oem?: number, options?: any): Promise<Worker>;
}
