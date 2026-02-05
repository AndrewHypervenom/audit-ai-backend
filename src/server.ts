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
  'https://auditoria-kappa.vercel.app',
  process.env.CORS_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
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

// Registrar router de stats
app.use('/api/audits', statsRoutes);

// ============================================
// AUTH ENDPOINTS
// ============================================

app.post('/api/auth/signup', (req: Request, res: Response) => {
  res.status(403).json({ 
    error: 'Registro deshabilitado. Contacte al administrador para crear una cuenta.',
    code: 'SIGNUP_DISABLED'
  });
});

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
// DOWNLOAD ENDPOINT - ✅ NUEVO ENDPOINT AGREGADO
// ============================================

app.get('/api/download/:filename', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    // Validar que el filename no contenga caracteres peligrosos (path traversal)
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn('Attempt to access file with invalid path:', filename);
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    // Construir la ruta completa del archivo
    const filePath = path.join(resultsDir, filename);

    // Verificar que el archivo existe
    if (!fs.existsSync(filePath)) {
      logger.error('File not found:', filePath);
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    // Verificar que el archivo pertenece a una auditoría del usuario (opcional - para mayor seguridad)
    // Por ahora, permitimos la descarga si el usuario está autenticado
    
    logger.info('Downloading file:', { filename, userId: req.user!.id });

    // Configurar headers para la descarga
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Enviar el archivo
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      logger.error('Error reading file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al leer el archivo' });
      }
    });

  } catch (error: any) {
    logger.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al descargar el archivo' });
    }
  }
});

// ============================================
// AUDIT ENDPOINTS
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
      return res.status(403).json({ error: 'No tienes permisos para ver esta auditoría' });
    }
    
    res.status(500).json({ error: 'Error al obtener auditoría' });
  }
});

app.delete('/api/audits/:auditId', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { auditId } = req.params;

    const audit = await databaseService.getAuditById(auditId, req.user!.id, req.user!.role);

    if (audit.audit.user_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'No tienes permisos para eliminar esta auditoría' });
    }

    await databaseService.logAuditActivity(
      auditId,
      req.user!.id,
      'deleted',
      null,
      req.ip,
      req.headers['user-agent']
    );

    const { error } = await supabaseAdmin
      .from('audits')
      .delete()
      .eq('id', auditId);

    if (error) {
      logger.error('Error deleting audit', error);
      return res.status(500).json({ error: 'Error al eliminar auditoría' });
    }

    logger.success('Audit deleted', { auditId, userId: req.user!.id });
    res.json({ success: true, message: 'Auditoría eliminada exitosamente' });
  } catch (error: any) {
    logger.error('Error deleting audit', error);
    
    if (error.message === 'Audit not found' || error.message === 'Auditoría no encontrada') {
      return res.status(404).json({ error: 'Auditoría no encontrada' });
    }
    
    res.status(500).json({ error: 'Error al eliminar auditoría' });
  }
});

app.post('/api/evaluate', authenticateUser, upload.fields([
  { name: 'audio', maxCount: 1 },
  { name: 'images', maxCount: 10 }
]), async (req: Request, res: Response) => {
  const startTime = Date.now();
  let auditId: string | null = null;

  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const audioFile = files.audio?.[0];
    const imageFiles = files.images || [];
    const sseClientId = req.body.sseClientId;

    if (!audioFile) {
      return res.status(400).json({ error: 'No se proporcionó archivo de audio' });
    }

    if (imageFiles.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos una imagen' });
    }

    const auditInput: AuditInput = {
      executiveName: req.body.executiveName,
      executiveId: req.body.executiveId,
      callType: req.body.callType,
      clientId: req.body.clientId,
      callDate: req.body.callDate,
      callDuration: req.body.callDuration || null,
      audioPath: audioFile.path,
      imagePaths: imageFiles.map(f => f.path)
    };

    const audit = await databaseService.createAudit({
      user_id: req.user!.id,
      executive_name: auditInput.executiveName,
      executive_id: auditInput.executiveId,
      call_type: auditInput.callType,
      client_id: auditInput.clientId,
      call_date: auditInput.callDate,
      call_duration: auditInput.callDuration,
      status: 'processing'
    });

    auditId = audit.id;

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'transcription',
      progress: 0,
      message: 'Iniciando transcripción...',
      auditId
    });

    const transcription = await assemblyAIService.transcribeAudio(
      audioFile.path,
      (progress) => {
        progressBroadcaster.sendProgress(sseClientId, {
          stage: 'transcription',
          progress: progress * 100,
          message: `Transcribiendo audio: ${Math.round(progress * 100)}%`,
          auditId
        });
      }
    );

    await databaseService.saveTranscription(auditId, transcription);

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'vision',
      progress: 0,
      message: 'Analizando imágenes...',
      auditId
    });

    const imageAnalyses = await openAIService.analyzeImages(
      imageFiles.map(f => f.path),
      auditInput.callType,
      (current, total) => {
        const progress = (current / total) * 100;
        progressBroadcaster.sendProgress(sseClientId, {
          stage: 'vision',
          progress,
          message: `Analizando imagen ${current} de ${total}`,
          auditId
        });
      }
    );

    await databaseService.saveImageAnalyses(auditId, imageAnalyses);

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'evaluation',
      progress: 0,
      message: 'Evaluando llamada...',
      auditId
    });

    const evaluation = await evaluatorService.evaluateCall(
      auditInput,
      transcription,
      imageAnalyses,
      (progress) => {
        progressBroadcaster.sendProgress(sseClientId, {
          stage: 'evaluation',
          progress: progress * 100,
          message: `Evaluando: ${Math.round(progress * 100)}%`,
          auditId
        });
      }
    );

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'excel',
      progress: 0,
      message: 'Generando reporte Excel...',
      auditId
    });

    const excelFilename = await excelService.generateExcelReport(auditInput, evaluation);

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'excel',
      progress: 100,
      message: 'Reporte Excel generado',
      auditId
    });

    const totalCost = costCalculatorService.calculateTotalCost(
      transcription,
      imageAnalyses,
      evaluation
    );

    await databaseService.saveEvaluation(auditId, {
      ...evaluation,
      excel_filename: excelFilename
    });

    await databaseService.saveAPICosts(auditId, totalCost);

    const processingTime = Math.round((Date.now() - startTime) / 1000);

    await databaseService.updateAuditStatus(auditId, 'completed', processingTime);

    await databaseService.logAuditActivity(
      auditId,
      req.user!.id,
      'completed',
      null,
      req.ip,
      req.headers['user-agent']
    );

    progressBroadcaster.sendProgress(sseClientId, {
      stage: 'complete',
      progress: 100,
      message: 'Auditoría completada',
      auditId
    });

    res.json({
      ...evaluation,
      excelUrl: `/results/${excelFilename}`,
      auditId,
      costs: totalCost
    });

    if (fs.existsSync(audioFile.path)) fs.unlinkSync(audioFile.path);
    imageFiles.forEach(file => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });

  } catch (error: any) {
    logger.error('Evaluation error:', error);

    if (auditId) {
      await databaseService.updateAuditStatus(auditId, 'error', null, error.message);
      
      await databaseService.logAuditActivity(
        auditId,
        req.user!.id,
        'error',
        error.message,
        req.ip,
        req.headers['user-agent']
      );
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const audioFile = files.audio?.[0];
    const imageFiles = files.images || [];

    if (audioFile && fs.existsSync(audioFile.path)) {
      fs.unlinkSync(audioFile.path);
    }
    imageFiles.forEach(file => {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    });

    res.status(500).json({
      error: 'Error al procesar la evaluación',
      details: error.message
    });
  }
});

// ============================================
// USER MANAGEMENT ENDPOINTS
// ============================================

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

    res.json({ users: users || [] });
  } catch (error: any) {
    logger.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

app.post('/api/admin/users', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password || !full_name || !role) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

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
      return res.status(500).json({ error: 'Error al crear usuario en autenticación' });
    }

    const { data: userData, error: dbError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authData.user.id,
        email,
        full_name,
        role
      })
      .select()
      .single();

    if (dbError) {
      logger.error('Error creating user in database:', dbError);
      
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      
      return res.status(500).json({ error: 'Error al crear usuario en base de datos' });
    }

    logger.success('User created successfully', { userId: userData.id, email });
    res.json(userData);
  } catch (error: any) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.put('/api/admin/users/:userId', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { email, password, full_name, role } = req.body;

    if (userId === req.user!.id && role && role !== req.user!.role) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    }

    const { data: userData, error: dbError } = await supabaseAdmin
      .from('users')
      .update({
        ...(email && { email }),
        ...(full_name && { full_name }),
        ...(role && { role })
      })
      .eq('id', userId)
      .select()
      .single();

    if (dbError) {
      logger.error('Error updating user in database:', dbError);
      return res.status(500).json({ error: 'Error al actualizar usuario en base de datos' });
    }

    if (email || password || full_name || role) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        ...(email && { email }),
        ...(password && { password }),
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

app.delete('/api/admin/users/:userId', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    const { error: dbError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (dbError) {
      logger.error('Error deleting user from database:', dbError);
      return res.status(500).json({ error: 'Error al eliminar usuario de la base de datos' });
    }

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
// SYSTEM CONFIGURATION
// ============================================

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

app.put('/api/admin/config', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { 
      openai_api_key, 
      assemblyai_api_key, 
      supabase_url, 
      supabase_anon_key, 
      supabase_service_role_key 
    } = req.body;

    if (openai_api_key !== undefined) process.env.OPENAI_API_KEY = openai_api_key;
    if (assemblyai_api_key !== undefined) process.env.ASSEMBLYAI_API_KEY = assemblyai_api_key;
    if (supabase_url !== undefined) process.env.SUPABASE_URL = supabase_url;
    if (supabase_anon_key !== undefined) process.env.SUPABASE_ANON_KEY = supabase_anon_key;
    if (supabase_service_role_key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = supabase_service_role_key;

    const envPath = resolve(process.cwd(), '.env');
    let envContent = '';

    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch (error) {
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
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🚀 SERVER STARTED ON PORT ${PORT}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 CORS origins: ${allowedOrigins.join(', ')}`);
  logger.info(`🤖 OpenAI API: ${process.env.OPENAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  logger.info(`🎤 AssemblyAI API: ${process.env.ASSEMBLYAI_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  logger.info(`💾 Supabase: ${process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing'}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

export default app;