// backend/src/services/database.service.ts

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { 
  AuditInput, 
  TranscriptResult, 
  ImageAnalysis, 
  EvaluationResult,
  APICosts,
  TranscriptWord
} from '../types/index.js';

interface CreateAuditParams {
  userId: string;
  auditInput: AuditInput;
  audioFilename: string;
  imageFilenames: string[];
}

interface SaveTranscriptionParams {
  auditId: string;
  transcript: TranscriptResult;
  assemblyaiResponse: any;
}

interface SaveImageAnalysisParams {
  auditId: string;
  imageAnalysis: ImageAnalysis;
  openaiResponse: any;
}

interface SaveEvaluationParams {
  auditId: string;
  evaluation: Omit<EvaluationResult, 'excelUrl'>;
  excelFilename: string;
  excelPath: string;
  openaiResponse: any;
}

interface CompleteAuditParams {
  transcription: string;
  transcriptionWords?: TranscriptWord[];
  imageAnalysis: string;
  evaluation: EvaluationResult;
  excelPath: string;
  processingTimeMs: number;
  costs: APICosts;
}

class DatabaseService {
  // Propiedad para acceder al client directamente (necesario para stats)
  get client() {
    return supabaseAdmin;
  }

  /**
   * Crear una nueva auditoría
   */
  async createAudit(params: CreateAuditParams): Promise<string> {
    try {
      const { userId, auditInput, audioFilename, imageFilenames } = params;

      const { data, error } = await supabaseAdmin
        .from('audits')
        .insert({
          user_id: userId,
          executive_name: auditInput.executiveName,
          executive_id: auditInput.executiveId,
          call_type: auditInput.callType,
          client_id: auditInput.clientId,
          call_date: auditInput.callDate,
          call_duration: auditInput.callDuration || null,
          audio_filename: audioFilename,
          audio_path: auditInput.audioPath,
          image_filenames: imageFilenames,
          image_paths: auditInput.imagePaths,
          status: 'processing'
        })
        .select('id')
        .single();

      if (error) throw error;

      logger.success('✅ Audit created in database', { auditId: data.id });
      return data.id;
    } catch (error) {
      logger.error('❌ Error creating audit in database', error);
      throw error;
    }
  }

  /**
   * Guardar transcripción
   */
  async saveTranscription(params: SaveTranscriptionParams): Promise<void> {
    try {
      const { auditId, transcript, assemblyaiResponse } = params;

      const { error } = await supabaseAdmin
        .from('transcriptions')
        .insert({
          audit_id: auditId,
          full_text: transcript.text,
          utterances: transcript.utterances,
          audio_duration: transcript.duration || null,
          assemblyai_response: assemblyaiResponse,
          word_count: transcript.utterances.length,
          confidence: assemblyaiResponse.confidence || null,
          language: 'es'
        });

      if (error) throw error;

      logger.success('✅ Transcription saved to database', { auditId });
    } catch (error) {
      logger.error('❌ Error saving transcription', error);
      throw error;
    }
  }

  /**
   * Guardar análisis de imagen
   */
  async saveImageAnalysis(params: SaveImageAnalysisParams): Promise<void> {
    try {
      const { auditId, imageAnalysis, openaiResponse } = params;

      const { error } = await supabaseAdmin
        .from('image_analyses')
        .insert({
          audit_id: auditId,
          image_path: imageAnalysis.imagePath,
          image_filename: imageAnalysis.imagePath.split('/').pop() || '',
          system_detected: imageAnalysis.system,
          extracted_data: imageAnalysis.data,
          critical_fields: imageAnalysis.data.critical_fields || null,
          findings: [],
          confidence: imageAnalysis.confidence,
          openai_response: openaiResponse
        });

      if (error) throw error;

      logger.success('✅ Image analysis saved to database', { auditId });
    } catch (error) {
      logger.error('❌ Error saving image analysis', error);
      throw error;
    }
  }

  /**
   * Guardar evaluación completa
   */
  async saveEvaluation(params: SaveEvaluationParams): Promise<void> {
    try {
      const { auditId, evaluation, excelFilename, excelPath, openaiResponse } = params;

      const { error } = await supabaseAdmin
        .from('evaluations')
        .insert({
          audit_id: auditId,
          total_score: evaluation.totalScore,
          max_possible_score: evaluation.maxPossibleScore,
          percentage: evaluation.percentage,
          detailed_scores: evaluation.detailedScores,
          observations: evaluation.observations,
          recommendations: evaluation.recommendations,
          key_moments: evaluation.keyMoments,
          openai_response: openaiResponse,
          excel_filename: excelFilename,
          excel_path: excelPath
        });

      if (error) throw error;

      logger.success('✅ Evaluation saved to database', { auditId });
    } catch (error) {
      logger.error('❌ Error saving evaluation', error);
      throw error;
    }
  }

  /**
   * Guardar costos de API
   */
  async saveAPICosts(auditId: string, costs: APICosts): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('api_costs')
        .insert({
          audit_id: auditId,
          assemblyai_duration_minutes: costs.assemblyai.audioDurationMinutes,
          assemblyai_cost: costs.assemblyai.totalCost,
          openai_images_count: costs.openai.images.count,
          openai_images_input_tokens: costs.openai.images.inputTokens,
          openai_images_output_tokens: costs.openai.images.outputTokens,
          openai_images_cost: costs.openai.images.cost,
          openai_evaluation_input_tokens: costs.openai.evaluation.inputTokens,
          openai_evaluation_output_tokens: costs.openai.evaluation.outputTokens,
          openai_evaluation_cost: costs.openai.evaluation.cost,
          openai_total_cost: costs.openai.totalCost,
          total_cost: costs.totalCost,
          currency: costs.currency
        });

      if (error) throw error;

      logger.success('✅ API costs saved to database', { 
        auditId, 
        totalCost: `$${costs.totalCost.toFixed(4)}` 
      });
    } catch (error) {
      logger.error('❌ Error saving API costs', error);
      throw error;
    }
  }

  /**
   * Completar auditoría con todos los datos - ✅ CORREGIDO
   */
  async completeAudit(auditId: string, params: CompleteAuditParams): Promise<void> {
    try {
      const {
        transcription,
        transcriptionWords,
        imageAnalysis,
        evaluation,
        excelPath,
        processingTimeMs,
        costs
      } = params;

      // 1. Guardar transcripción
      await supabaseAdmin.from('transcriptions').insert({
        audit_id: auditId,
        full_text: transcription,
        utterances: transcriptionWords || [],
        audio_duration: null,
        assemblyai_response: {},
        word_count: transcriptionWords?.length || 0,
        confidence: null,
        language: 'es'
      });

      // 2. Guardar análisis de imágenes (si existe)
      if (imageAnalysis && imageAnalysis !== 'No se proporcionaron imágenes para analizar') {
        await supabaseAdmin.from('image_analyses').insert({
          audit_id: auditId,
          image_path: '',
          image_filename: '',
          system_detected: 'multiple',
          extracted_data: { analysis: imageAnalysis },
          critical_fields: null,
          findings: [],
          confidence: 0,
          openai_response: {}
        });
      }

      // 3. Guardar evaluación - ✅ CORREGIDO
      await supabaseAdmin.from('evaluations').insert({
        audit_id: auditId,
        total_score: evaluation.totalScore,              // ✅ CORRECTO
        max_possible_score: evaluation.maxPossibleScore, // ✅ CORRECTO
        percentage: evaluation.percentage,               // ✅ CORRECTO
        detailed_scores: evaluation.detailedScores,      // ✅ CORRECTO
        observations: evaluation.observations || '',
        recommendations: evaluation.recommendations || [],
        key_moments: evaluation.keyMoments || [],
        openai_response: {},
        excel_filename: excelPath.split('/').pop() || '',
        excel_path: excelPath
      });

      // 4. Guardar costos
      await this.saveAPICosts(auditId, costs);

      // 5. Marcar como completada
      const { error } = await supabaseAdmin
        .from('audits')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processing_time_seconds: Math.round(processingTimeMs / 1000)
        })
        .eq('id', auditId);

      if (error) throw error;

      logger.success('✅ Audit completed successfully', { auditId });
    } catch (error) {
      logger.error('❌ Error completing audit', error);
      throw error;
    }
  }

  /**
   * Marcar auditoría como error
   */
  async markAuditError(auditId: string, errorMessage: string): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('audits')
        .update({
          status: 'error',
          error_message: errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq('id', auditId);

      if (error) throw error;

      logger.warn('⚠️ Audit marked as error', { auditId, errorMessage });
    } catch (error) {
      logger.error('❌ Error marking audit as error', error);
      throw error;
    }
  }

  /**
   * Eliminar una auditoría y todos sus datos relacionados
   */
  async deleteAudit(auditId: string, userId: string, userRole: string): Promise<void> {
    try {
      if (userRole !== 'admin' && userRole !== 'analyst') {
        throw new Error('No tienes permisos para eliminar auditorías');
      }

      const { data: audit, error: fetchError } = await supabaseAdmin
        .from('audits')
        .select('id')
        .eq('id', auditId)
        .single();

      if (fetchError || !audit) {
        throw new Error('Auditoría no encontrada');
      }

      const { error: deleteError } = await supabaseAdmin
        .from('audits')
        .delete()
        .eq('id', auditId);

      if (deleteError) throw deleteError;

      logger.success('✅ Audit deleted successfully', { auditId, userId });
    } catch (error) {
      logger.error('❌ Error deleting audit', error);
      throw error;
    }
  }

  /**
   * Obtener todas las auditorías
   */
  async getUserAudits(userId: string, userRole: string, limit = 50, offset = 0) {
    try {
      let query = supabaseAdmin
        .from('audits')
        .select('*, evaluations(*), api_costs(*)', { count: 'exact' });

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Normalizar api_costs a formato array
      const normalizedData = (data || []).map(audit => {
        if (audit.api_costs && !Array.isArray(audit.api_costs)) {
          return {
            ...audit,
            api_costs: [audit.api_costs]
          };
        }
        return audit;
      });

      return { audits: normalizedData, total: count || 0 };
    } catch (error) {
      logger.error('❌ Error fetching user audits', error);
      throw error;
    }
  }

  /**
   * Obtener una auditoría completa con todos sus datos
   */
  async getAuditById(auditId: string, userId: string, userRole: string) {
    try {
      let query = supabaseAdmin
        .from('audits')
        .select('*')
        .eq('id', auditId);

      const { data: audit, error: auditError } = await query.single();

      if (auditError) throw auditError;

      const { data: transcription } = await supabaseAdmin
        .from('transcriptions')
        .select('*')
        .eq('audit_id', auditId)
        .single();

      const { data: imageAnalyses } = await supabaseAdmin
        .from('image_analyses')
        .select('*')
        .eq('audit_id', auditId);

      const { data: evaluation } = await supabaseAdmin
        .from('evaluations')
        .select('*')
        .eq('audit_id', auditId)
        .single();

      const { data: apiCosts } = await supabaseAdmin
        .from('api_costs')
        .select('*')
        .eq('audit_id', auditId)
        .single();

      return {
        audit,
        transcription,
        imageAnalyses: imageAnalyses || [],
        evaluation,
        apiCosts
      };
    } catch (error) {
      logger.error('❌ Error fetching audit by ID', error);
      throw error;
    }
  }

  /**
   * Registrar actividad de auditoría
   */
  async logAuditActivity(
    auditId: string,
    userId: string,
    action: string,
    details?: any,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    try {
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          audit_id: auditId,
          user_id: userId,
          action,
          details: details || null,
          ip_address: ipAddress || null,
          user_agent: userAgent || null
        });

      logger.info(`📝 Audit activity logged: ${action}`, { auditId, userId });
    } catch (error) {
      logger.warn('⚠️ Failed to log audit activity', error);
    }
  }
}

// Exportar instancia singleton
let instance: DatabaseService | null = null;

export const getDatabaseService = () => {
  if (!instance) {
    instance = new DatabaseService();
  }
  return instance;
};

export const databaseService = {
  client: supabaseAdmin,
  createAudit: (params: CreateAuditParams) => getDatabaseService().createAudit(params),
  saveTranscription: (params: SaveTranscriptionParams) => getDatabaseService().saveTranscription(params),
  saveImageAnalysis: (params: SaveImageAnalysisParams) => getDatabaseService().saveImageAnalysis(params),
  saveEvaluation: (params: SaveEvaluationParams) => getDatabaseService().saveEvaluation(params),
  saveAPICosts: (auditId: string, costs: APICosts) => getDatabaseService().saveAPICosts(auditId, costs),
  completeAudit: (auditId: string, params: CompleteAuditParams) => getDatabaseService().completeAudit(auditId, params),
  deleteAudit: (auditId: string, userId: string, userRole: string) => getDatabaseService().deleteAudit(auditId, userId, userRole),
  markAuditError: (auditId: string, errorMessage: string) => getDatabaseService().markAuditError(auditId, errorMessage),
  getUserAudits: (userId: string, userRole: string, limit?: number, offset?: number) => getDatabaseService().getUserAudits(userId, userRole, limit, offset),
  getAuditById: (auditId: string, userId: string, userRole: string) => getDatabaseService().getAuditById(auditId, userId, userRole),
  logAuditActivity: (auditId: string, userId: string, action: string, details?: any, ip?: string, ua?: string) => 
    getDatabaseService().logAuditActivity(auditId, userId, action, details, ip, ua)
};

export { DatabaseService };