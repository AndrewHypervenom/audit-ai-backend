// backend/src/types/index.ts
// Tipos y interfaces para el sistema de auditorías

/**
 * Input para crear una nueva auditoría
 * Estos campos coinciden con los del formulario del frontend
 */
export interface AuditInput {
  executiveName: string;      // Nombre del ejecutivo/agente
  executiveId: string;         // ID del ejecutivo/agente
  callType: string;            // Tipo de llamada: 'INBOUND' o 'OUTBOUND'
  clientId: string;            // ID del cliente (ej: "6786724")
  callDate: string;            // Fecha de la llamada en formato ISO
  callDuration?: string | null; // Duración de la llamada (opcional)
  audioPath?: string;          // Ruta del archivo de audio
  imagePaths?: string[];       // Rutas de las imágenes
}

/**
 * Resultado de la transcripción
 */
export interface TranscriptResult {
  text: string;
  utterances: Array<{
    start: number;
    end: number;
    text: string;
    speaker: string;
  }>;
  duration?: number;
}

/**
 * Análisis de imagen
 */
export interface ImageAnalysis {
  imagePath: string;
  system: string;
  data: any;
  confidence: number;
}

/**
 * Resultado de la evaluación
 */
export interface EvaluationResult {
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  detailedScores: Array<{
    criterion: string;
    score: number;
    maxScore: number;
    observations: string;
  }>;
  observations: string;
  recommendations: string[];
  keyMoments: Array<{
    timestamp: string;
    type: string;
    description: string;
  }>;
  excelUrl?: string;
}

/**
 * Costos de APIs
 */
export interface APICosts {
  assemblyai: {
    audioDurationMinutes: number;
    totalCost: number;
  };
  openai: {
    images: {
      count: number;
      inputTokens: number;
      outputTokens: number;
      cost: number;
    };
    evaluation: {
      inputTokens: number;
      outputTokens: number;
      cost: number;
    };
    totalCost: number;
  };
  totalCost: number;
  currency: string;
}

/**
 * Estado del progreso de procesamiento
 */
export interface ProcessingProgress {
  step: 'uploading' | 'database' | 'transcription' | 'analyzing' | 'evaluating' | 'finalizing';
  status: 'processing' | 'completed' | 'error';
  message: string;
  progress?: number;
  data?: any;
}