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

// ✅ Crear directorio temporal para uploads (solo temporal durante procesamiento)
const uploadDir = './tmp/uploads';

[uploadDir, `${uploadDir}/audio`, `${uploadDir}/images`].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ✅ Helper para limpiar archivos temporales
const cleanupTempFiles = (filePaths: string[]) => {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info('🗑️ Temp file cleaned up', { filePath });
      }
    } catch (error) {
      logger.warn('⚠️ Failed to cleanup temp file', { filePath, error });
    }
  }
};

// Configurar multer para archivos temporales
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

// ============================================
// MIDDLEWARE UTF-8
// ============================================

// Forzar UTF-8 en todas las respuestas
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ ELIMINADO: Ya no se sirven archivos estáticos desde results
// app.use('/results', express.static(resultsDir));

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
// ✅ DOWNLOAD ENDPOINT - AHORA LEE DESDE LA BASE DE DATOS
// ============================================

app.get('/api/download/:filename', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    // Validar que el filename no contenga caracteres peligrosos
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn('Attempt to access file with invalid path:', filename);
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    logger.info('📥 Downloading Excel from database:', { filename, userId: req.user!.id });

    // ✅ NUEVO: Buscar el Excel en la base de datos
    const excelResult = await databaseService.getExcelData(filename);

    if (!excelResult || !excelResult.excelData) {
      logger.error('Excel not found in database:', filename);
      return res.status(404).json({ error: 'Archivo no encontrado en la base de datos' });
    }

    // ✅ Convertir base64 a buffer y enviar
    const excelBuffer = Buffer.from(excelResult.excelData, 'base64');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);

    res.send(excelBuffer);

    logger.success('✅ Excel downloaded from database successfully', { filename });

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
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    res.status(500).json({ error: 'Error al obtener auditoría' });
  }
});

// POST /api/evaluate - Crear nueva auditoría
app.post('/api/evaluate', 
  authenticateUser,
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'images', maxCount: 15 }
  ]),
  async (req: Request, res: Response) => {
    const startTime = Date.now();
    let auditId: string | null = null;
    
    const sseClientId = req.body.sseClientId || uuidv4();

    // ✅ Recopilar rutas de archivos temporales para limpiar después
    const tempFilePaths: string[] = [];

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

      // ✅ Registrar archivos temporales para limpieza
      tempFilePaths.push(audioFile.path);
      imageFiles.forEach(f => tempFilePaths.push(f.path));

      logger.info('📁 Files received:', {
        audio: audioFile.originalname,
        audioSize: audioFile.size,
        images: imageFiles.length
      });

      const metadata: AuditInput = {
        executiveName: req.body.executiveName || '',
        executiveId: req.body.executiveId || '',
        callType: req.body.callType || '',
        clientId: req.body.clientId || '',
        callDate: req.body.callDate || new Date().toISOString().split('T')[0],
        callDuration: req.body.callDuration || null,
        audioPath: audioFile.path,
        imagePaths: imageFiles.map(f => f.path)
      };

      logger.info('📋 Audit metadata:', metadata);

      // 1. Crear entrada en la base de datos
      progressBroadcaster.progress(sseClientId, 'upload', 10, 'Archivos subidos correctamente');

      auditId = await databaseService.createAudit({
        userId: req.user!.id,
        auditInput: metadata,
        audioFilename: audioFile.filename,
        imageFilenames: imageFiles.map(f => f.filename)
      });

      logger.success('✅ Audit record created', { auditId });

      // 2. Transcribir audio
      progressBroadcaster.progress(sseClientId, 'transcription', 25, 'Iniciando transcripción...');
      
      const transcription = await assemblyAIService.transcribe(audioFile.path);

      logger.success('✅ Transcription completed', { 
        duration: transcription.audio_duration,
        words: transcription.words?.length 
      });

      // 3. Analizar imágenes con OpenAI
      progressBroadcaster.progress(sseClientId, 'analysis', 50, 'Analizando imágenes...');

      const imageAnalyses = imageFiles.length > 0 
        ? await openAIService.analyzeMultipleImages(imageFiles.map(f => f.path))
        : [];

      const imageAnalysis = imageAnalyses.length > 0
        ? imageAnalyses.map(img => `${img.system}: ${JSON.stringify(img.data)}`).join('\n\n')
        : 'No se proporcionaron imágenes para analizar';

      logger.success('✅ Image analysis completed');

      // 4. Evaluar con criterios
      progressBroadcaster.progress(sseClientId, 'evaluation', 75, 'Evaluando con IA...');

      const evaluation = await evaluatorService.evaluate(
        metadata,
        transcription,
        imageAnalyses
      );

      logger.success('✅ Evaluation completed', {
        totalScore: evaluation.totalScore,
        maxPossibleScore: evaluation.maxPossibleScore,
        percentage: evaluation.percentage
      });

      // 5. ✅ Generar Excel EN MEMORIA (ya no se guarda en disco)
      progressBroadcaster.progress(sseClientId, 'excel', 90, 'Generando reporte Excel...');

      const excelResult = await excelService.generateExcelReport(metadata, evaluation);

      logger.success('✅ Excel report generated in memory', { 
        filename: excelResult.filename,
        sizeKB: (excelResult.buffer.length / 1024).toFixed(1)
      });

      // 6. Calcular costos
      const costs = costCalculatorService.calculateTotalCost(
        transcription.audio_duration || 0,
        imageFiles.length,
        0,
        0,
        evaluation.usage?.inputTokens || 0,
        evaluation.usage?.outputTokens || 0
      );

      logger.info('💰 Costs calculated:', costs);

      // 7. ✅ Actualizar en base de datos (Excel como base64)
      const excelBase64 = excelResult.buffer.toString('base64');
      
      await databaseService.completeAudit(auditId, {
        transcription: transcription.text,
        transcriptionWords: transcription.words,
        imageAnalysis: imageAnalysis,
        evaluation,
        excelFilename: excelResult.filename,
        excelBase64: excelBase64,              // ✅ NUEVO
        processingTimeMs: Date.now() - startTime,
        costs
      });

      logger.success('✅ Audit completed successfully', {
        auditId,
        totalTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        totalCost: `$${costs.totalCost.toFixed(4)}`
      });

      // 8. Enviar progreso final
      progressBroadcaster.progress(sseClientId, 'completed', 100, '¡Auditoría completada!');

      // Registrar actividad
      await databaseService.logAuditActivity(
        auditId,
        req.user!.id,
        'created',
        null,
        req.ip,
        req.headers['user-agent']
      );

      // ✅ Limpiar archivos temporales (audio e imágenes ya no se necesitan)
      cleanupTempFiles(tempFilePaths);

      // Responder con el ID
      res.json({
        success: true,
        auditId,
        excelFilename: excelResult.filename,
        processingTime: Date.now() - startTime,
        costs
      });

    } catch (error: any) {
      logger.error('❌ Error processing audit:', error);

      if (auditId) {
        await databaseService.markAuditError(auditId, error.message);
      }

      progressBroadcaster.progress(sseClientId, 'error', 0, `Error: ${error.message}`);

      // ✅ Limpiar archivos temporales incluso en caso de error
      cleanupTempFiles(tempFilePaths);

      res.status(500).json({ 
        error: 'Error procesando auditoría', 
        details: error.message,
        auditId 
      });
    }
  }
);

app.delete('/api/audits/:auditId', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { auditId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

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

// ============================================
// ADMIN USER MANAGEMENT
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

    res.json(users);
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

    const validRoles = ['admin', 'supervisor', 'analyst'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
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
    res.status(201).json(userData);
  } catch (error: any) {
    logger.error('Error creating user:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.put('/api/admin/users/:userId', authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { email, full_name, role, password } = req.body;

    if (role) {
      const validRoles = ['admin', 'supervisor', 'analyst'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
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
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🚀 SERVER STARTED ON PORT ${PORT}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 CORS origins: ${allowedOrigins.join(', ')}`);
  logger.info(`🤖 OpenAI API: ${process.env.OPENAI_API_KEY ? '✔ Configured' : '✗ Missing'}`);
  logger.info(`🎤 AssemblyAI API: ${process.env.ASSEMBLYAI_API_KEY ? '✔ Configured' : '✗ Missing'}`);
  logger.info(`💾 Supabase: ${process.env.SUPABASE_URL ? '✔ Configured' : '✗ Missing'}`);
  logger.info(`📂 Excel storage: Database (base64)`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

export default app;