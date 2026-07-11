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
  rateMin: number | null;
  rateMax: number | null;
  count: number;
  inStock: boolean;
  gender: "male" | "female" | null;
}
