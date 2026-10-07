import type { lab } from '@hms/shared';

/**
 * A starter catalogue of common Indian OPD lab tests with adult reference ranges, so a new
 * hospital can start in one click. Prices are typical small-city rates and meant to be edited.
 * Ranges follow common textbook adult values; each lab should review them against its analyser.
 */
type T = Omit<lab.TestInput, 'ranges'> & { ranges?: lab.RangeInput[] };

const any = (low: number, high: number, extra: Partial<lab.RangeInput> = {}): lab.RangeInput => ({ gender: 'any', low, high, ...extra });
const m = (low: number, high: number, extra: Partial<lab.RangeInput> = {}): lab.RangeInput => ({ gender: 'male', low, high, ...extra });
const f = (low: number, high: number, extra: Partial<lab.RangeInput> = {}): lab.RangeInput => ({ gender: 'female', low, high, ...extra });
const posNeg = { resultType: 'option' as const, options: ['Negative', 'Positive'], decimals: 0 };

export const STARTER_TESTS: T[] = [
  // Haematology (CBC parts)
  { code: 'HB', name: 'Haemoglobin', section: 'haematology', unit: 'g/dL', price: 100, container: 'EDTA (purple)', ranges: [m(13, 17, { criticalLow: 7, criticalHigh: 20 }), f(12, 15, { criticalLow: 7, criticalHigh: 20 })] },
  { code: 'TLC', name: 'Total leucocyte count', section: 'haematology', unit: '/cumm', decimals: 0, price: 100, container: 'EDTA (purple)', ranges: [any(4000, 11000, { criticalLow: 2000, criticalHigh: 30000 })] },
  { code: 'NEUT', name: 'Neutrophils', section: 'haematology', unit: '%', decimals: 0, container: 'EDTA (purple)', ranges: [any(40, 75)] },
  { code: 'LYMPH', name: 'Lymphocytes', section: 'haematology', unit: '%', decimals: 0, container: 'EDTA (purple)', ranges: [any(20, 45)] },
  { code: 'EOS', name: 'Eosinophils', section: 'haematology', unit: '%', decimals: 0, container: 'EDTA (purple)', ranges: [any(1, 6)] },
  { code: 'MONO', name: 'Monocytes', section: 'haematology', unit: '%', decimals: 0, container: 'EDTA (purple)', ranges: [any(2, 10)] },
  { code: 'BASO', name: 'Basophils', section: 'haematology', unit: '%', decimals: 0, container: 'EDTA (purple)', ranges: [any(0, 1)] },
  { code: 'RBC', name: 'RBC count', section: 'haematology', unit: 'million/cumm', decimals: 2, container: 'EDTA (purple)', ranges: [m(4.5, 5.5), f(3.8, 4.8)] },
  { code: 'PCV', name: 'Packed cell volume (PCV)', section: 'haematology', unit: '%', container: 'EDTA (purple)', ranges: [m(40, 50), f(36, 46)] },
  { code: 'PLT', name: 'Platelet count', section: 'haematology', unit: 'lakh/cumm', decimals: 2, price: 150, container: 'EDTA (purple)', ranges: [any(1.5, 4.1, { criticalLow: 0.2, criticalHigh: 10 })] },
  { code: 'ESR', name: 'ESR', section: 'haematology', unit: 'mm/1st hr', decimals: 0, price: 100, container: 'Citrate (black)', method: 'Westergren', ranges: [m(0, 15), f(0, 20)] },
  // Biochemistry
  { code: 'FBS', name: 'Blood sugar (fasting)', section: 'biochemistry', sampleType: 'plasma', unit: 'mg/dL', decimals: 0, price: 60, container: 'Fluoride (grey)', method: 'GOD-POD', ranges: [any(70, 100, { criticalLow: 40, criticalHigh: 450 })] },
  { code: 'PPBS', name: 'Blood sugar (post-prandial)', section: 'biochemistry', sampleType: 'plasma', unit: 'mg/dL', decimals: 0, price: 60, container: 'Fluoride (grey)', method: 'GOD-POD', ranges: [any(70, 140, { criticalLow: 40, criticalHigh: 450 })] },
  { code: 'RBS', name: 'Blood sugar (random)', section: 'biochemistry', sampleType: 'plasma', unit: 'mg/dL', decimals: 0, price: 60, container: 'Fluoride (grey)', method: 'GOD-POD', ranges: [any(70, 140, { criticalLow: 40, criticalHigh: 450 })] },
  { code: 'HBA1C', name: 'HbA1c', section: 'biochemistry', unit: '%', price: 450, container: 'EDTA (purple)', method: 'HPLC', ranges: [any(4, 5.6, { text: '< 5.7 normal, 5.7–6.4 prediabetes, ≥ 6.5 diabetes' })] },
  { code: 'UREA', name: 'Blood urea', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 0, price: 120, container: 'Plain (red)', ranges: [any(15, 40)] },
  { code: 'CREAT', name: 'Serum creatinine', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 2, price: 150, container: 'Plain (red)', ranges: [m(0.7, 1.3, { criticalHigh: 7 }), f(0.6, 1.1, { criticalHigh: 7 })] },
  { code: 'URIC', name: 'Serum uric acid', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', price: 150, container: 'Plain (red)', ranges: [m(3.5, 7.2), f(2.6, 6)] },
  { code: 'NA', name: 'Sodium', section: 'biochemistry', sampleType: 'serum', unit: 'mmol/L', decimals: 0, price: 150, container: 'Plain (red)', ranges: [any(135, 145, { criticalLow: 120, criticalHigh: 160 })] },
  { code: 'K', name: 'Potassium', section: 'biochemistry', sampleType: 'serum', unit: 'mmol/L', price: 150, container: 'Plain (red)', ranges: [any(3.5, 5.1, { criticalLow: 2.8, criticalHigh: 6.2 })] },
  { code: 'TBIL', name: 'Bilirubin total', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 2, container: 'Plain (red)', ranges: [any(0.2, 1.2, { criticalHigh: 15 })] },
  { code: 'DBIL', name: 'Bilirubin direct', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 2, container: 'Plain (red)', ranges: [any(0, 0.3)] },
  { code: 'SGOT', name: 'SGOT (AST)', section: 'biochemistry', sampleType: 'serum', unit: 'U/L', decimals: 0, container: 'Plain (red)', ranges: [any(0, 40)] },
  { code: 'SGPT', name: 'SGPT (ALT)', section: 'biochemistry', sampleType: 'serum', unit: 'U/L', decimals: 0, container: 'Plain (red)', ranges: [any(0, 41)] },
  { code: 'ALP', name: 'Alkaline phosphatase', section: 'biochemistry', sampleType: 'serum', unit: 'U/L', decimals: 0, container: 'Plain (red)', ranges: [any(40, 130)] },
  { code: 'TP', name: 'Total protein', section: 'biochemistry', sampleType: 'serum', unit: 'g/dL', container: 'Plain (red)', ranges: [any(6.4, 8.3)] },
  { code: 'ALB', name: 'Albumin', section: 'biochemistry', sampleType: 'serum', unit: 'g/dL', container: 'Plain (red)', ranges: [any(3.5, 5.2)] },
  { code: 'CHOL', name: 'Total cholesterol', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 0, container: 'Plain (red)', ranges: [any(0, 200, { text: '< 200 desirable' })] },
  { code: 'TG', name: 'Triglycerides', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 0, container: 'Plain (red)', ranges: [any(0, 150, { text: '< 150 normal' })] },
  { code: 'HDL', name: 'HDL cholesterol', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 0, container: 'Plain (red)', ranges: [any(40, 60, { text: '> 40 desirable' })] },
  { code: 'LDL', name: 'LDL cholesterol', section: 'biochemistry', sampleType: 'serum', unit: 'mg/dL', decimals: 0, container: 'Plain (red)', ranges: [any(0, 100, { text: '< 100 optimal' })] },
  // Hormones
  { code: 'TSH', name: 'TSH', section: 'hormones', sampleType: 'serum', unit: 'µIU/mL', decimals: 2, price: 300, container: 'Plain (red)', method: 'CLIA', ranges: [any(0.4, 4.2)] },
  { code: 'FT4', name: 'Free T4', section: 'hormones', sampleType: 'serum', unit: 'ng/dL', decimals: 2, price: 300, container: 'Plain (red)', method: 'CLIA', ranges: [any(0.8, 1.8)] },
  // Serology
  { code: 'WIDAL', name: 'Widal test', section: 'serology', sampleType: 'serum', resultType: 'text', price: 150, container: 'Plain (red)', ranges: [{ gender: 'any', text: 'Titre < 1:80 not significant' }] },
  { code: 'DENGUE-NS1', name: 'Dengue NS1 antigen', section: 'serology', sampleType: 'serum', ...posNeg, price: 600, container: 'Plain (red)', method: 'Card test', ranges: [{ gender: 'any', text: 'Negative' }] },
  { code: 'MP', name: 'Malaria parasite (rapid)', section: 'serology', ...posNeg, price: 250, container: 'EDTA (purple)', method: 'Card test', ranges: [{ gender: 'any', text: 'Negative' }] },
  { code: 'HBSAG', name: 'HBsAg', section: 'serology', sampleType: 'serum', resultType: 'option', options: ['Non-reactive', 'Reactive'], decimals: 0, price: 300, container: 'Plain (red)', ranges: [{ gender: 'any', text: 'Non-reactive' }] },
  { code: 'CRP', name: 'C-reactive protein (CRP)', section: 'serology', sampleType: 'serum', unit: 'mg/L', price: 400, container: 'Plain (red)', ranges: [any(0, 6)] },
  // Clinical pathology (urine routine)
  { code: 'U-COLOR', name: 'Urine colour', section: 'clinical_pathology', sampleType: 'urine', resultType: 'text', container: 'Urine container', ranges: [{ gender: 'any', text: 'Pale yellow' }] },
  { code: 'U-PH', name: 'Urine pH', section: 'clinical_pathology', sampleType: 'urine', decimals: 1, container: 'Urine container', ranges: [any(4.6, 8)] },
  { code: 'U-SG', name: 'Specific gravity', section: 'clinical_pathology', sampleType: 'urine', decimals: 3, container: 'Urine container', ranges: [any(1.005, 1.03)] },
  { code: 'U-ALB', name: 'Urine albumin', section: 'clinical_pathology', sampleType: 'urine', resultType: 'option', options: ['Nil', 'Trace', '+', '++', '+++'], decimals: 0, container: 'Urine container', ranges: [{ gender: 'any', text: 'Nil' }] },
  { code: 'U-SUGAR', name: 'Urine sugar', section: 'clinical_pathology', sampleType: 'urine', resultType: 'option', options: ['Nil', 'Trace', '+', '++', '+++'], decimals: 0, container: 'Urine container', ranges: [{ gender: 'any', text: 'Nil' }] },
  { code: 'U-PUS', name: 'Pus cells', section: 'clinical_pathology', sampleType: 'urine', resultType: 'text', unit: '/hpf', container: 'Urine container', ranges: [{ gender: 'any', text: '0–5' }] },
  { code: 'U-RBC', name: 'Red blood cells', section: 'clinical_pathology', sampleType: 'urine', resultType: 'text', unit: '/hpf', container: 'Urine container', ranges: [{ gender: 'any', text: 'Nil' }] },
];

export const STARTER_PANELS: { code: string; name: string; price: number; tests: string[] }[] = [
  { code: 'CBC', name: 'Complete blood count (CBC)', price: 300, tests: ['HB', 'TLC', 'NEUT', 'LYMPH', 'EOS', 'MONO', 'BASO', 'RBC', 'PCV', 'PLT'] },
  { code: 'LFT', name: 'Liver function test (LFT)', price: 600, tests: ['TBIL', 'DBIL', 'SGOT', 'SGPT', 'ALP', 'TP', 'ALB'] },
  { code: 'KFT', name: 'Kidney function test (KFT)', price: 550, tests: ['UREA', 'CREAT', 'URIC', 'NA', 'K'] },
  { code: 'LIPID', name: 'Lipid profile', price: 500, tests: ['CHOL', 'TG', 'HDL', 'LDL'] },
  { code: 'TFT', name: 'Thyroid profile', price: 550, tests: ['FT4', 'TSH'] },
  { code: 'URINE-RE', name: 'Urine routine & microscopy', price: 150, tests: ['U-COLOR', 'U-PH', 'U-SG', 'U-ALB', 'U-SUGAR', 'U-PUS', 'U-RBC'] },
];
