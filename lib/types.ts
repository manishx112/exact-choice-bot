export interface Jean {
  s: number | string;   // style no
  size: string;         // "28X32"
  rate: number;
  g: string;            // group A / B / Male
  stock: number | null; // null = unknown/blank
  img: string;          // drive file id
}

export interface Intent {
  size: string | null;
  excludeSize?: string | null; // size exclusion e.g. "32X36 se alag"
  rateMin: number | null;
  rateMax: number | null;
  suggestedRateMin?: number | null; // bot suggested range e.g. 380
  suggestedRateMax?: number | null; // bot suggested range e.g. 430
  count: number;
  inStock: boolean;
  gender: "male" | "female" | null;
  style: string | null; // ek specific style/reference no. lookup (jaise "1841 size dikha do")
}
