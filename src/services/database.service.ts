// backend/src/services/database.service.ts

import { supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import type { 
  AuditInput, 
  TranscriptResult, 
  ImageAnalysis, 
  EvaluationResult,
  APICosts
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

class DatabaseService {
  // Propiedad para acceder al client directamente (necesario para stats)
  get client() {
    return supabaseAdmin;
  }

  /**
   * Crear una nueva auditorÃ­a
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

      logger.success('âœ… Audit created in database', { auditId: data.id });
      return data.id;
    } catch (error) {
      logger.error('âŒ Error creating audit in database', error);
      throw error;
    }
  }

  /**
   * Guardar transcripciÃ³n
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

      logger.success('âœ… Transcription saved to database', { auditId });
    } catch (error) {
      logger.error('âŒ Error saving transcription', error);
      throw error;
    }
  }

  /**
   * Guardar anÃ¡lisis de imagen
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

      logger.success('âœ… Image analysis saved to database', { auditId });
    } catch (error) {
      logger.error('âŒ Error saving image analysis', error);
      throw error;
    }
  }

  /**
   * Guardar evaluaciÃ³n completa
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

      logger.success('âœ… Evaluation saved to database', { auditId });
    } catch (error) {
      logger.error('âŒ Error saving evaluation', error);
      throw error;
    }
  }

  /**
   * NUEVO: Guardar costos de API
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

      logger.success('âœ… API costs saved to database', { 
        auditId, 
        totalCost: `$${costs.totalCost.toFixed(4)}` 
      });
    } catch (error) {
      logger.error('âŒ Error saving API costs', error);
      throw error;
    }
  }

  /**
   * Marcar auditorÃ­a como completada
   */
  async completeAudit(auditId: string, processingTimeSeconds: number): Promise<void> {
    try {
      const { error } = await supabaseAdmin
        .from('audits')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processing_time_seconds: processingTimeSeconds
        })
        .eq('id', auditId);

      if (error) throw error;

      logger.success('âœ… Audit marked as completed', { auditId });
    } catch (error) {
      logger.error('âŒ Error completing audit', error);
      throw error;
    }
  }

  /**
   * Marcar auditorÃ­a como error
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

      logger.warn('âš ï¸ Audit marked as error', { auditId, errorMessage });
    } catch (error) {
      logger.error('âŒ Error marking audit as error', error);
      throw error;
    }
  }

  /**
   * Eliminar una auditoría y todos sus datos relacionados
   * @param auditId - ID de la auditoría a eliminar
   * @param userId - ID del usuario que intenta eliminar
   * @param userRole - Rol del usuario (solo admin y analyst pueden eliminar)
   */
  async deleteAudit(auditId: string, userId: string, userRole: string): Promise<void> {
    try {
      // Verificar permisos: solo admin y analyst pueden eliminar
      if (userRole !== 'admin' && userRole !== 'analyst') {
        throw new Error('No tienes permisos para eliminar auditorías');
      }

      // Verificar que la auditoría existe
      const { data: audit, error: fetchError } = await supabaseAdmin
        .from('audits')
        .select('id')
        .eq('id', auditId)
        .single();

      if (fetchError || !audit) {
        throw new Error('Auditoría no encontrada');
      }

      // Eliminar la auditoría (cascade eliminará registros relacionados)
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
   * Obtener todas las auditorÃ­as - CORREGIDO para manejar api_costs como objeto
   * @param userId - ID del usuario
   * @param userRole - Rol del usuario (admin, analyst, supervisor)
   * @param limit - LÃ­mite de resultados
   * @param offset - Offset para paginaciÃ³n
   */
  async getUserAudits(userId: string, userRole: string, limit = 50, offset = 0) {
    try {
      let query = supabaseAdmin
        .from('audits')
        .select('*, evaluations(*), api_costs(*)', { count: 'exact' });

      // Todos los roles (admin, analyst, supervisor) pueden ver todas las auditorÃ­as
      // No se filtra por user_id ya que no existe el rol "executive"
      // Los permisos se controlan a nivel de funcionalidad (crear, editar, eliminar)

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // CORRECCIÃ“N: Normalizar api_costs a formato array
      const normalizedData = (data || []).map(audit => {
        // Si api_costs es un objeto (relaciÃ³n 1-a-1), convertirlo a array
        if (audit.api_costs && !Array.isArray(audit.api_costs)) {
          return {
            ...audit,
            api_costs: [audit.api_costs]
          };
        }
        // Si api_costs ya es array o null, dejarlo como estÃ¡
        return audit;
      });

      return { audits: normalizedData, total: count || 0 };
    } catch (error) {
      logger.error('âŒ Error fetching user audits', error);
      throw error;
    }
  }

  /**
   * Obtener una auditorÃ­a completa con todos sus datos
   */
  async getAuditById(auditId: string, userId: string, userRole: string) {
    try {
      // Construir query base
      let query = supabaseAdmin
        .from('audits')
        .select('*')
        .eq('id', auditId);

      // Todos los roles pueden ver todas las auditorÃ­as
      // No se filtra por user_id

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
      logger.error('âŒ Error fetching audit by ID', error);
      throw error;
    }
  }

  /**
   * Registrar actividad de auditorÃ­a
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

      logger.info(`ðŸ“ Audit activity logged: ${action}`, { auditId, userId });
    } catch (error) {
      logger.warn('âš ï¸ Failed to log audit activity', error);
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
  completeAudit: (auditId: string, processingTime: number) => getDatabaseService().completeAudit(auditId, processingTime),
  deleteAudit: (auditId: string, userId: string, userRole: string) => getDatabaseService().deleteAudit(auditId, userId, userRole),
  markAuditError: (auditId: string, errorMessage: string) => getDatabaseService().markAuditError(auditId, errorMessage),
  getUserAudits: (userId: string, userRole: string, limit?: number, offset?: number) => getDatabaseService().getUserAudits(userId, userRole, limit, offset),
  getAuditById: (auditId: string, userId: string, userRole: string) => getDatabaseService().getAuditById(auditId, userId, userRole),
  logAuditActivity: (auditId: string, userId: string, action: string, details?: any, ip?: string, ua?: string) => 
    getDatabaseService().logAuditActivity(auditId, userId, action, details, ip, ua)
};

export { DatabaseService };