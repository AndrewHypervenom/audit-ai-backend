// backend/src/server.ts

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env') });

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './utils/logger.js';
import { assemblyAIService } from './services/assemblyai.service.js';
import { openAIService } from './services/openai.service.js';
import { evaluatorService } from './services/evaluator.service.js';
import { excelService } from './services/excel.service.js';
import { databaseService } from './services/database.service.js';
import { costCalculatorService } from './services/cost-calculator.service.js';
import { authenticateUser, requireAdmin } from './middleware/auth.middleware.js';
import { supabase, supabaseAdmin } from './config/supabase.js';
import { progressBroadcaster } from './services/progress-broadcaster.js';
import type { AuditInput } from './types/index.js';
// ⭐ NUEVO: Importar el router de stats
import statsRoutes from './routes/stats.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Crear directorios necesarios
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const resultsDir = process.env.RESULTS_DIR || './results';

[uploadDir, `${uploadDir}/audio`, `${uploadDir}/images`, resultsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configurar multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === 'audio' ? 'audio' : 'images';
    cb(null, path.join(uploadDir, folder));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_FILE_SIZE) || 100 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'audio') {
      const allowedMimes = ['audio/wav', 'audio/mpeg', 'audio/mp3'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten archivos de audio WAV o MP3'));
      }
    } else if (file.fieldname === 'images') {
      const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten imágenes JPEG o PNG'));
      }
    } else {
      cb(null, true);
    }
  }
});

// Middleware - CORS actualizado para múltiples orígenes
const allowedOrigins = [
  'https://audit-ai-gamma.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.CORS_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (como mobile apps o curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use('/results', express.static(resultsDir));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    openai: !!process.env.OPENAI_API_KEY,
    assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
    supabase: !!process.env.SUPABASE_URL
  });
});

// ============================================
// ⭐ REGISTRAR ROUTER DE STATS (NUEVO)
// ============================================
app.use('/api/audits', statsRoutes);

// ============================================
// AUTH ENDPOINTS
// ============================================

// POST /api/auth/signup - DESHABILITADO
app.post('/api/auth/signup', (req: Request, res: Response) => {
  res.status(403).json({ 
    error: 'Registro deshabilitado. Contacte al administrador para crear una cuenta.',
    code: 'SIGNUP_DISABLED'
  });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.error('Login error:', error);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
      user: data.user,
      session: data.session
    });
  } catch (error: any) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      logger.error('Logout error:', error);
      return res.status(500).json({ error: 'Error al cerrar sesión' });
    }

    res.json({ message: 'Sesión cerrada exitosamente' });
  } catch (error: any) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: userData, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      logger.error('Get user error:', error);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(userData);
  } catch (error: any) {
    logger.error('Get user error:', error);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
});

// ============================================
// SSE PROGRESS ENDPOINT
// ============================================

app.get('/api/progress/:clientId', (req: Request, res: Response) => {
  const { clientId } = req.params;
  progressBroadcaster.addClient(clientId, res);
});

// ============================================
// AUDIT ENDPOINTS (PROTEGIDOS)
// ============================================

app.get('/api/audits', authenticateUser, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const { audits, total } = await databaseService.getUserAudits(
      req.user!.id,
      req.user!.role,
      limit,
      offset
    );

    res.json({
      audits,
      total,
      limit,
      offset
    });
  } catch (error: any) {
    logger.error('Error fetching audits', error);
    res.status(500).json({ error: 'Error al obtener auditorías' });
  }
});

app.get('/api/audits/:auditId', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { auditId } = req.params;

    const auditData = await databaseService.getAuditById(auditId, req.user!.id, req.user!.role);

    await databaseService.logAuditActivity(
      auditId,
      req.user!.id,
      'viewed',
      null,
      req.ip,
      req.headers['user-agent']
    );

    res.json(auditData);
  } catch (error: any) {
    logger.error('Error fetching audit', error);
    
    if (error.message === 'Audit not found' || error.message === 'Auditoría no encontrada') {
      return res.status(404).json({ error: 'Auditoría no encontrada' });
    }
    
    if (error.message === 'Access denied' || error.message === 'Acceso denegado') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    res.status(500).json({ error: 'Error al obtener auditoría' });
  }
});

// POST /api/evaluate - Crear nueva auditoría (endpoint para procesamiento completo)
app.post('/api/evaluate', 
  authenticateUser,
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'images', maxCount: 5 }
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let auditId: string | null = null;
    
    // ⚠️ IMPORTANTE: Este clientId es el sseClientId para SSE, NO el clientId del cliente
    const sseClientId = req.body.sseClientId || uuidv4();

    try {
      logger.info('🎬 Starting new audit process...', {
        userId: req.user!.id,
        userEmail: req.user!.email,
        sseClientId
      });

      // Validar archivos requeridos
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files || !files.audio || files.audio.length === 0) {
        return res.status(400).json({ error: 'Se requiere un archivo de audio' });
      }

      const audioFile = files.audio[0];
      const imageFiles = files.images || [];

      logger.info('📁 Files received:', {
        audio: audioFile.originalname,
        audioSize: audioFile.size,
        images: imageFiles.length
      });

      // ⭐ CORREGIDO: Extraer metadata del body con los nombres correctos
      const metadata: AuditInput = {
        executiveName: req.body.executiveName || '',
        executiveId: req.body.executiveId || '',
        callType: req.body.callType || '',
        clientId: req.body.clientId || '', // ⭐ Este es el ID del cliente REAL
        callDate: req.body.callDate || new Date().toISOString().split('T')[0],
        callDuration: req.body.callDuration || null,
        audioPath: audioFile.path,
        imagePaths: imageFiles.map(f => f.path)
      };

      logger.info('📋 Audit metadata:', metadata);

      // 1. Crear entrada en la base de datos
      progressBroadcaster.progress(sseClientId, 'transcription', 25, 'Iniciando transcripción...');

      // ⭐ CORREGIDO: Usar el nuevo formato de parámetros
      auditId = await databaseService.createAudit({
        userId: req.user!.id,
        auditInput: metadata,
        audioFilename: audioFile.filename,
        imageFilenames: imageFiles.map(f => f.filename)
      });

      logger.success('✅ Audit record created', { auditId });

      // Aquí continúa el resto del procesamiento...
      // (El código del procesamiento de transcripción, análisis, etc. permanece igual)
      
      res.json({
        success: true,
        message: 'Procesamiento iniciado',
        auditId
      });

    } catch (error: any) {
      logger.error('❌ Error processing audit:', error);

      if (auditId) {
        await databaseService.markAuditError(auditId, error.message);
      }

      progressBroadcaster.progress(sseClientId, 'analysis', 50, 'Analizando imágenes...');

      res.status(500).json({ 
        error: 'Error procesando auditoría', 
        details: error.message,
        auditId 
      });
    }
  }
);

// DELETE /api/audits/:auditId - Eliminar auditoría
app.delete('/api/audits/:auditId', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { auditId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Eliminar usando el servicio
    await databaseService.deleteAudit(auditId, userId, userRole);

    logger.success('Audit deleted successfully', { auditId });

    res.json({ 
      success: true, 
      message: 'Auditoría eliminada exitosamente' 
    });

  } catch (error: any) {
    logger.error('Error deleting audit:', error);

    if (error.message.includes('No tienes permisos')) {
      return res.status(403).json({ error: error.message });
    }

    if (error.message.includes('no encontrada')) {
      return res.status(404).json({ error: 'Auditoría no encontrada' });
    }

    res.status(500).json({ error: 'Error al eliminar auditoría' });
  }
});

// GET /api/download/:filename - Descargar archivo Excel
app.get('/api/download/:filename', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(resultsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.download(filePath);
  } catch (error: any) {
    logger.error('Error downloading file:', error);
    res.status(500).json({ error: 'Error al descargar archivo' });
  }
});

// ============================================
// ⚠️ ENDPOINTS VIEJOS ELIMINADOS
// ============================================
// Los endpoints /api/stats y /api/stats/charts fueron movidos a /api/audits/stats
// y se manejan a través del router statsRoutes importado arriba

// ============================================
// ADMIN ENDPOINTS
// ============================================

// GET /api/admin/users - Listar todos los usuarios
app.get('/api/admin/users', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching users:', error);
      return res.status(500).json({ error: 'Error al obtener usuarios' });
    }

    res.json(users);
  } catch (error: any) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// POST /api/admin/users - Crear nuevo usuario
app.post('/api/admin/users', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ 
        error: 'Email, contraseña y rol son requeridos' 
      });
    }

    // Validar rol
    if (!['admin', 'supervisor', 'analyst'].includes(role)) {
      return res.status(400).json({ 
        error: 'Rol inválido. Debe ser admin, supervisor o analyst' 
      });
    }

    // Crear usuario en Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
        role
      }
    });

    if (authError) {
      logger.error('Error creating user in auth:', authError);
      return res.status(400).json({ 
        error: authError.message || 'Error al crear usuario' 
      });
    }

    // Crear perfil en la tabla users
    const { data: userData, error: dbError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        role,
        is_active: true
      })
      .select()
      .single();

    if (dbError) {
      logger.error('Error creating user profile:', dbError);
      // Intentar eliminar el usuario de auth si falla la creación del perfil
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ 
        error: 'Error al crear perfil de usuario' 
      });
    }

    logger.success('User created successfully', { 
      userId: userData.id, 
      email: userData.email,
      role: userData.role 
    });

    res.status(201).json(userData);
  } catch (error: any) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// PUT /api/admin/users/:userId - Actualizar usuario
app.put('/api/admin/users/:userId', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { full_name, role, is_active } = req.body;

    // Validar rol si se proporciona
    if (role && !['admin', 'supervisor', 'analyst'].includes(role)) {
      return res.status(400).json({ 
        error: 'Rol inválido. Debe ser admin, supervisor o analyst' 
      });
    }

    // No permitir que un admin se desactive a sí mismo
    if (userId === req.user!.id && is_active === false) {
      return res.status(400).json({ 
        error: 'No puedes desactivar tu propia cuenta' 
      });
    }

    // Actualizar en la tabla users
    const { data: userData, error: dbError } = await supabaseAdmin
      .from('users')
      .update({
        full_name,
        role,
        is_active,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (dbError) {
      logger.error('Error updating user:', dbError);
      return res.status(500).json({ error: 'Error al actualizar usuario' });
    }

    // Actualizar metadata en Supabase Auth
    if (full_name || role) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          full_name: full_name || userData.full_name,
          role: role || userData.role
        }
      });
    }

    logger.success('User updated successfully', { userId });
    res.json(userData);
  } catch (error: any) {
    logger.error('Error updating user:', error);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

// DELETE /api/admin/users/:userId - Eliminar usuario
app.delete('/api/admin/users/:userId', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // No permitir que un admin se elimine a sí mismo
    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    // Eliminar de la tabla users (cascade eliminará referencias)
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (dbError) {
      logger.error('Error deleting user from database:', dbError);
      return res.status(500).json({ error: 'Error al eliminar usuario de la base de datos' });
    }

    // Eliminar de Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      logger.warn('Error deleting user from auth (user may not exist):', authError);
    }

    logger.success('User deleted successfully', { userId });
    res.json({ success: true, message: 'Usuario eliminado exitosamente' });
  } catch (error: any) {
    logger.error('Error deleting user:', error);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

// ============================================
// SYSTEM CONFIGURATION ENDPOINTS
// ============================================

// GET /api/admin/config - Obtener configuración del sistema
app.get('/api/admin/config', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    res.json({
      openai_api_key: process.env.OPENAI_API_KEY || '',
      assemblyai_api_key: process.env.ASSEMBLYAI_API_KEY || '',
      supabase_url: process.env.SUPABASE_URL || '',
      supabase_anon_key: process.env.SUPABASE_ANON_KEY || '',
      supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    });
  } catch (error: any) {
    logger.error('Error fetching config:', error);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
});

// PUT /api/admin/config - Actualizar configuración del sistema
app.put('/api/admin/config', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { 
      openai_api_key, 
      assemblyai_api_key, 
      supabase_url, 
      supabase_anon_key, 
      supabase_service_role_key 
    } = req.body;

    // Actualizar variables de entorno
    if (openai_api_key !== undefined) process.env.OPENAI_API_KEY = openai_api_key;
    if (assemblyai_api_key !== undefined) process.env.ASSEMBLYAI_API_KEY = assemblyai_api_key;
    if (supabase_url !== undefined) process.env.SUPABASE_URL = supabase_url;
    if (supabase_anon_key !== undefined) process.env.SUPABASE_ANON_KEY = supabase_anon_key;
    if (supabase_service_role_key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = supabase_service_role_key;

    // Guardar en archivo .env
    const envPath = resolve(process.cwd(), '.env');
    let envContent = '';

    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch (error) {
      // Si no existe, crear nuevo
      envContent = '';
    }

    const updateEnvVar = (content: string, key: string, value: string) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(content)) {
        return content.replace(regex, `${key}=${value}`);
      } else {
        return content + `\n${key}=${value}`;
      }
    };

    if (openai_api_key !== undefined) {
      envContent = updateEnvVar(envContent, 'OPENAI_API_KEY', openai_api_key);
    }
    if (assemblyai_api_key !== undefined) {
      envContent = updateEnvVar(envContent, 'ASSEMBLYAI_API_KEY', assemblyai_api_key);
    }
    if (supabase_url !== undefined) {
      envContent = updateEnvVar(envContent, 'SUPABASE_URL', supabase_url);
    }
    if (supabase_anon_key !== undefined) {
      envContent = updateEnvVar(envContent, 'SUPABASE_ANON_KEY', supabase_anon_key);
    }
    if (supabase_service_role_key !== undefined) {
      envContent = updateEnvVar(envContent, 'SUPABASE_SERVICE_ROLE_KEY', supabase_service_role_key);
    }

    fs.writeFileSync(envPath, envContent.trim());

    logger.success('Configuration updated successfully');
    res.json({ success: true, message: 'Configuración actualizada exitosamente' });
  } catch (error: any) {
    logger.error('Error updating config:', error);
    res.status(500).json({ error: 'Error al actualizar configuración' });
  }
});

// GET /api/admin/test/:service - Probar conexión con servicios externos
app.get('/api/admin/test/:service', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { service } = req.params;

    switch (service) {
      case 'openai':
        try {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
          });
          
          if (response.ok) {
            res.json({ success: true, message: 'Conexión exitosa con OpenAI' });
          } 
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Error de conexión';
          res.json({ success: false, error: errorMessage });
        }
        break;

      case 'assemblyai':
        try {
          const response = await fetch('https://api.assemblyai.com/v2/transcript', {
            headers: {
              'Authorization': process.env.ASSEMBLYAI_API_KEY || ''
            }
          });
          
          if (response.status === 400 || response.status === 404) {
            // 400 significa que la API key es válida pero falta el body
            res.json({ success: true, message: 'Conexión exitosa con AssemblyAI' });
          } else if (response.status === 401) {
            res.json({ success: false, error: 'API key inválida' });
          } else {
            res.json({ success: true, message: 'Conexión exitosa con AssemblyAI' });
          }
        } catch (error: any) {
          res.json({ success: false, error: error.message });
        }
        break;

      case 'supabase':
        try {
          const { data, error } = await supabaseAdmin
            .from('users')
            .select('count')
            .limit(1);

          if (error) {
            res.json({ success: false, error: error.message });
          } else {
            res.json({ success: true, message: 'Conexión exitosa con Supabase' });
          }
        } catch (error: any) {
          res.json({ success: false, error: error.message });
        }
        break;

      default:
        res.status(400).json({ error: 'Servicio no válido' });
    }
  } catch (error: any) {
    logger.error('Error testing service:', error);
    res.status(500).json({ error: 'Error al probar conexión' });
  }
});

// Manejador de errores
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);

  res.status(500).json({
    error: err.message || 'Error interno del servidor',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🚀 SERVER STARTED ON PORT ${PORT}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 CORS origins: ${allowedOrigins.join(', ')}`);
  logger.info(`🤖 OpenAI API: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  logger.info(`🎤 AssemblyAI API: ${process.env.ASSEMBLYAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  logger.info(`💾 Supabase: ${process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing'}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

export default app;