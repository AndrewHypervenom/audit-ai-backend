//backend/src/services/assemblyai.service.ts

import { AssemblyAI } from 'assemblyai';
import { logger } from '../utils/logger.js';
import type { TranscriptResult } from '../types/index.js';
import * as fs from 'fs';
import https from 'https';

class AssemblyAIService {
  private client: AssemblyAI;

  constructor() {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      throw new Error('ASSEMBLYAI_API_KEY is not configured');
    }
    
    this.client = new AssemblyAI({ 
      apiKey
    });
  }

  async transcribe(audioPath: string): Promise<TranscriptResult> {
    try {
      logger.info('🎤 Starting ENHANCED audio transcription', { audioPath });

      // Verificar que el archivo existe
      if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
      }

      const stats = fs.statSync(audioPath);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      logger.info('📁 Audio file info', { 
        size: `${fileSizeMB} MB`,
        path: audioPath 
      });

      // Leer archivo de audio
      const audioData = fs.readFileSync(audioPath);
      
      logger.info('☁️  Uploading audio to AssemblyAI with enhanced settings...');

      // Subir archivo con reintentos
      let uploadUrl: string;
      let retries = 3;
      
      while (retries > 0) {
        try {
          uploadUrl = await this.uploadWithTimeout(audioData);
          break;
        } catch (error: any) {
          retries--;
          if (retries === 0) throw error;
          
          logger.warn(`⚠️  Upload failed, retrying... (${retries} attempts left)`, {
            error: error.message
          });
          
          // Esperar antes de reintentar (backoff exponencial)
          await new Promise(resolve => setTimeout(resolve, 5000 * (4 - retries)));
        }
      }
      
      logger.info('✅ Audio uploaded successfully, starting ENHANCED transcription...');

      // ===============================================
      // CONFIGURACIÓN MEJORADA DE TRANSCRIPCIÓN
      // ===============================================
      const transcript = await this.client.transcripts.transcribe({
        audio: uploadUrl!,
        
        // ============ IDIOMA Y PRECISIÓN ============
        language_code: 'es', // Español
        
        // ============ MEJORAS DE CALIDAD ============
        speaker_labels: true,        // Identificar speakers (A, B, C...)
        punctuate: true,             // Agregar puntuación automática
        format_text: false,          // NO formatear - mantener texto RAW completo
        
        // ============ CAPTURAR TODO EL CONTENIDO ============
        disfluencies: false,         // NO capturar "eh", "um" para texto más limpio
        
        // ============ MODELO Y PRECISIÓN ============
        speech_model: 'best',        // Usar el mejor modelo disponible (más preciso)
        
        // ============ VOCABULARIO PERSONALIZADO ============
        word_boost: [
          // Términos bancarios comunes
          'Bradescard', 'VISA', 'Mastercard', 'American Express',
          'tarjeta', 'crédito', 'débito', 'cuenta',
          'saldo', 'movimiento', 'cargo', 'compra', 'transacción',
          'fraude', 'fraudulento', 'bloqueo', 'bloqueada', 'bloqueamos',
          'reposición', 'plástico', 'sucursal',
          'bonificación', 'aclaración', 'dictamen',
          'cliente', 'titular', 'tarjetahabiente',
          'CVV', 'NIP', 'PIN', 'OTP', 'token',
          'monto', 'importe', 'cantidad',
          'comercio', 'establecimiento', 'merchant',
          
          // Sistemas bancarios
          'Falcon', 'VCAS', 'Vision', 'VRM', 'Front', 'BI',
          'CallerID', 'Caller ID', 'ARQE', 'IBI', 'ASHI',
          'Hotlist', 'Bypass',
          
          // Términos técnicos bancarios
          'folio', 'caso', 'investigación', 'evidencia',
          'reversa', 'contracargo', 'chargeback',
          'autenticación', 'verificación', 'validación',
          'numeración completa',
          
          // Comercios comunes
          'Microsoft', 'Amazon', 'PayPal', 'Spotify', 'Netflix',
          'Uber', 'DiDi', 'Rappi',
          'Winner', 'Promex', 'Sanborns', 'Liverpool',
          'Costco', 'Walmart', 'Soriana',
          
          // Nombres propios comunes en México
          'García', 'López', 'Martínez', 'Hernández', 'González',
          'Rodríguez', 'Pérez', 'Sánchez', 'Ramírez', 'Torres',
          'Flores', 'Rivera', 'Gómez', 'Díaz', 'Cruz',
          'Morales', 'Reyes', 'Jiménez', 'Álvarez', 'Romero',
          
          // Ciudades
          'México', 'Guadalajara', 'Monterrey', 'Puebla',
          'Naucalpan', 'Ecatepec', 'Toluca',
          
          // Palabras de call center
          'monitor', 'ejecutivo', 'agente', 'operador',
          'línea', 'llamada', 'contacto',
          'registro', 'sistema', 'pantalla',
          
          // Frases comunes
          'muy buenas tardes', 'en qué puedo ayudarle',
          'un momento por favor', 'de acuerdo',
          'para su seguridad', 'por seguridad',
          'no reconozco', 'no reconoce'
        ],
        boost_param: 'high' // Alta prioridad para las palabras del vocabulario
      });

      logger.info('⏳ Transcription job created, waiting for completion...', {
        transcriptId: transcript.id,
        expectedTime: '30-120 seconds depending on audio length'
      });

      // ===============================================
      // POLLING CON MEJOR LOGGING
      // ===============================================
      let result = transcript;
      let pollCount = 0;
      const maxPolls = 240; // ~12 minutos máximo
      const startTime = Date.now();
      
      while (result.status !== 'completed' && result.status !== 'error') {
        if (pollCount >= maxPolls) {
          throw new Error('Transcription timeout: exceeded maximum wait time');
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        result = await this.client.transcripts.get(result.id);
        pollCount++;
        
        // Logging mejorado cada 9 segundos
        if (pollCount % 3 === 0) {
          const elapsed = pollCount * 3;
          const progress = Math.min(elapsed / 120 * 100, 95).toFixed(0);
          logger.info(`⏳ Transcription in progress... ${elapsed}s elapsed`, {
            status: result.status,
            progress: `${progress}%`,
            audioSize: fileSizeMB + ' MB'
          });
        }
      }

      // Verificar errores
      if (result.status === 'error') {
        logger.error('❌ Transcription failed', { error: result.error });
        throw new Error(`Transcription failed: ${result.error}`);
      }

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

      // ===============================================
      // VERIFICACIÓN DE CALIDAD
      // ===============================================
      const textLength = result.text?.length || 0;
      const wordCount = result.words?.length || 0;
      const utteranceCount = result.utterances?.length || 0;
      
      // Advertencia si el texto es muy corto
      if (textLength < 100) {
        logger.warn('⚠️  Transcription completed but text is VERY SHORT', {
          textLength,
          wordCount,
          utteranceCount,
          possibleIssue: 'Audio might be too quiet, damaged, or not contain speech'
        });
      }

      logger.success('✅ Transcription completed successfully!', {
        duration: `${result.audio_duration}s audio`,
        processingTime: `${totalTime}s`,
        words: wordCount,
        utterances: utteranceCount,
        textLength: textLength,
        confidence: result.confidence ? `${(result.confidence * 100).toFixed(1)}%` : 'N/A',
        charactersPerSecond: result.audio_duration ? (textLength / result.audio_duration).toFixed(1) : 'N/A'
      });

      // Formatear resultado
      const utterances = result.utterances?.map(u => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,  // En milisegundos
        end: u.end       // En milisegundos
      })) || [];

      // Log de muestra del contenido
      if (utterances.length > 0) {
        logger.info('📝 Transcription sample (first 3 utterances):', {
          samples: utterances.slice(0, 3).map((u, idx) => ({
            speaker: u.speaker,
            text: u.text.substring(0, 100) + (u.text.length > 100 ? '...' : ''),
            timestamp: `${(u.start / 1000).toFixed(1)}s`
          }))
        });
      } else {
        logger.warn('⚠️  No utterances found in transcription');
      }

      // Advertencia si no hay suficientes utterances
      if (utteranceCount < 5 && result.audio_duration && result.audio_duration > 60) {
        logger.warn('⚠️  Few utterances for audio length', {
          utterances: utteranceCount,
          audioDuration: `${result.audio_duration}s`,
          suggestion: 'Audio might have long silences or low speech activity'
        });
      }

      return {
        text: result.text || '',
        utterances,
        duration: result.audio_duration ?? undefined,
        words: utterances,  // Mismo contenido que utterances
        audio_duration: result.audio_duration ?? undefined
      };

    } catch (error: any) {
      logger.error('❌ Error in transcription', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Método auxiliar para subir audio con timeout personalizado
   */
  private async uploadWithTimeout(audioData: Buffer): Promise<string> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY!;
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.assemblyai.com',
        path: '/v2/upload',
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/octet-stream',
          'Content-Length': audioData.length
        },
        timeout: 300000 // 5 minutos
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              resolve(json.upload_url);
            } catch (e) {
              reject(new Error('Failed to parse upload response'));
            }
          } else {
            reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upload request timeout'));
      });

      // Enviar datos
      req.write(audioData);
      req.end();
    });
  }
}

// Exportaciones
let instance: AssemblyAIService | null = null;

export const getAssemblyAIService = () => {
  if (!instance) {
    instance = new AssemblyAIService();
  }
  return instance;
};

export const assemblyAIService = {
  transcribe: async (audioPath: string) => {
    return getAssemblyAIService().transcribe(audioPath);
  }
};

export { AssemblyAIService };