export type ScannerSettings = {
  minProbability: number;
  htfStrength: number;
  structureStrength: number;
  maxAtrPct: number;
  minRiskReward: number;
};

export const SCANNER_PRESETS: Record<string, ScannerSettings> = {
  conservative: { minProbability: 82, htfStrength: 62, structureStrength: 45, maxAtrPct: 3, minRiskReward: 1.8 },
  balanced: { minProbability: 74, htfStrength: 54, structureStrength: 32, maxAtrPct: 4.5, minRiskReward: 1.5 },
  highFrequency: { minProbability: 68, htfStrength: 48, structureStrength: 24, maxAtrPct: 6, minRiskReward: 1.25 },
};

export const defaultScannerSettings = (minProbability: number): ScannerSettings => ({
  ...SCANNER_PRESETS.balanced,
  minProbability,
});