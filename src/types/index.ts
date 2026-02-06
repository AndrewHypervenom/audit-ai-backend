// frontend/src/types/index.ts

// ============================================
// TIPOS DE AUDITORÍA
// ============================================

export const CALL_TYPES = ['INBOUND', 'MONITOREO'] as const;
export type CallType = typeof CALL_TYPES[number];

export interface AuditFormData {
  executiveName: string;
  executiveId: string;
  callType: string;
  clientId: string;
  callDate: string;
  callDuration?: string;
}

// ============================================
// TIPOS DE EVALUACIÓN
// ============================================

export interface EvaluationCriteria {
  id: string;
  category: string;
  name: string;
  description: string;
  maxScore: number;
  weight: number;
}

export interface DetailedScore {
  criteriaId: string;
  criteriaName: string;
  score: number;
  maxScore: number;
  observations: string;
  evidences: string[];
}

export interface EvaluationResult {
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  detailedScores: DetailedScore[];
  observations: string;
  recommendations: string[];
  keyMoments: KeyMoment[];
  excelFilename: string;
}

export interface KeyMoment {
  timestamp: string;
  type: 'positive' | 'negative' | 'neutral';
  description: string;
  criteriaId?: string;
}

// ============================================
// TIPOS DE TRANSCRIPCIÓN
// ============================================

export interface Utterance {
  speaker: 'A' | 'B';
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface TranscriptionResult {
  id: string;
  text: string;
  utterances: Utterance[];
  audioDuration: number;
  confidence: number;
  language: string;
}

// ============================================
// TIPOS DE ANÁLISIS DE IMÁGENES
// ============================================

export interface ImageAnalysisResult {
  id: string;
  systemDetected: string;
  extractedData: Record<string, any>;
  confidence: number;
  processingTime: number;
}

// ============================================
// TIPOS DE COSTOS API
// ============================================

export interface APICostsDB {
  id: string;
  audit_id: string;
  transcription_cost: number;
  image_analysis_cost: number;
  evaluation_cost: number;
  total_cost: number;
  tokens_used: {
    transcription?: number;
    imageAnalysis?: number;
    evaluation?: number;
    total?: number;
  };
  created_at: string;
}

export interface APICosts {
  transcription: {
    cost: number;
    tokens?: number;
  };
  imageAnalysis: {
    cost: number;
    tokens?: number;
  };
  evaluation: {
    cost: number;
    tokens?: number;
  };
  total: number;
}