// backend/src/config/supabase.ts

// ============================================
// CARGAR VARIABLES DE ENTORNO PRIMERO
// ============================================
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger.js';

class SupabaseService {
  public client: SupabaseClient;
  public serviceClient: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      logger.error('❌ Missing Supabase environment variables', {
        hasUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        hasServiceKey: !!supabaseServiceKey
      });
      throw new Error('Supabase configuration is missing');
    }

    // Cliente con RLS (para operaciones de usuario)
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false
      }
    });

    // Cliente administrativo (bypass RLS)
    this.serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    logger.success('✅ Supabase clients initialized');
  }

  /**
   * Obtener cliente con RLS
   */
  getClient(): SupabaseClient {
    return this.client;
  }

  /**
   * Obtener cliente administrativo
   */
  getServiceClient(): SupabaseClient {
    return this.serviceClient;
  }
}

// Instancia singleton
const supabaseService = new SupabaseService();

// ============================================
// EXPORTS
// ============================================
export const supabase = supabaseService.getClient();
export const supabaseAdmin = supabaseService.getServiceClient();

// ============================================
// CONFIGURACIÓN DE TIMEOUT DE SESIÓN
// ============================================
// El sistema frontend automáticamente manejará:
// - Auto-refresh de token antes de expirar (10 min antes)
// - Warning cuando queden 30 minutos
// - Logout automático al expirar
// ============================================

export const SESSION_CONFIG = {
  // 9 horas en segundos (configurar en Supabase Dashboard)
  JWT_EXPIRY_SECONDS: 9 * 60 * 60, // 32400 segundos
  
  // Auto-refresh 10 minutos antes de expirar
  REFRESH_THRESHOLD_SECONDS: 10 * 60, // 600 segundos
  
  // Verificar cada 5 minutos
  CHECK_INTERVAL_SECONDS: 5 * 60, // 300 segundos
  
  // Advertir cuando queden 30 minutos
  WARNING_THRESHOLD_SECONDS: 30 * 60, // 1800 segundos
};

export default supabaseAdmin;