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
        cb(new Error('Solo se permiten imÃ¡genes JPEG o PNG'));
      }
    } else {
      cb(null, true);
    }
  }
});

// Middleware - CORS actualizado para mÃºltiples orÃ­genes
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

// Servir archivos estÃ¡ticos
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
      return res.status(400).json({ error: 'Email y contraseÃ±a son requeridos' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.error('Login error:', error);
      return res.status(401).json({ error: 'Credenciales invÃ¡lidas' });
    }

    res.json({
      user: data.user,
      session: data.session
    });
  } catch (error: any) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Error al iniciar sesiÃ³n' });
  }
});

app.post('/api/auth/logout', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      logger.error('Logout error:', error);
      return res.status(500).json({ error: 'Error al cerrar sesiÃ³n' });
    }

    res.json({ message: 'SesiÃ³n cerrada exitosamente' });
  } catch (error: any) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Error al cerrar sesiÃ³n' });
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
// DOWNLOAD ENDPOINT
// ============================================

app.get('/api/download/:filename', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    
    // Validar que el filename no contenga caracteres peligrosos
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      logger.warn('Attempt to access file with invalid path:', filename);
      return res.status(400).json({ error: 'Nombre de archivo inválido' });
    }

    logger.info('Download requested:', { filename, userId: req.user!.id });

    // ✅ PASO 1: Buscar primero en la base de datos
    try {
      const { data: evaluation, error } = await supabaseAdmin
        .from('evaluations')
        .select('audit_id, excel_filename, excel_data')
        .eq('excel_filename', filename)
        .single();

      if (!error && evaluation && evaluation.excel_data) {
        logger.info('Serving Excel from database:', { filename });

        // Convertir el buffer de la BD a Buffer de Node.js
        const buffer = Buffer.from(evaluation.excel_data);

        // Configurar headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length.toString());

        // Enviar el archivo desde la BD
        return res.send(buffer);
      }
    } catch (dbError) {
      logger.warn('Excel not found in database, trying filesystem:', filename);
    }

    // ✅ PASO 2: Si no está en BD, buscar en el sistema de archivos (fallback)
    const filePath = path.join(resultsDir, filename);

    if (!fs.existsSync(filePath)) {
      logger.error('File not found in database or filesystem:', filename);
      return res.status(404).json({ 
        error: 'Archivo no encontrado',
        message: 'El archivo no existe en el servidor. Puede haber sido eliminado.'
      });
    }

    logger.info('Serving Excel from filesystem:', { filename });

    // Configurar headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Enviar el archivo desde el sistema de archivos
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
    res.status(500).json({ error: 'Error al obtener auditorÃ­as' });
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
    
    if (error.message === 'Audit not found' || error.message === 'AuditorÃ­a no encontrada') {
      return res.status(404).json({ error: 'AuditorÃ­a no encontrada' });
    }
    
    if (error.message === 'Access denied' || error.message === 'Acceso denegado') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    
    res.status(500).json({ error: 'Error al obtener auditorÃ­a' });
  }
});

// POST /api/evaluate - Crear nueva auditorÃ­a
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

    try {
      logger.info('ðŸŽ¬ Starting new audit process...', {
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

      logger.info('ðŸ“ Files received:', {
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

      logger.info('ðŸ“‹ Audit metadata:', metadata);

      // 1. Crear entrada en la base de datos
      progressBroadcaster.progress(sseClientId, 'upload', 10, 'Archivos subidos correctamente');

      auditId = await databaseService.createAudit({
        userId: req.user!.id,
        auditInput: metadata,
        audioFilename: audioFile.filename,
        imageFilenames: imageFiles.map(f => f.filename)
      });

      logger.success('âœ… Audit record created', { auditId });

      // 2. Transcribir audio - âœ… CORREGIDO
      progressBroadcaster.progress(sseClientId, 'transcription', 25, 'Iniciando transcripciÃ³n...');
      
      const transcription = await assemblyAIService.transcribe(audioFile.path);

      logger.success('âœ… Transcription completed', { 
        duration: transcription.audio_duration,
        words: transcription.words?.length 
      });

      // 3. Analizar imÃ¡genes con OpenAI - âœ… CORREGIDO
      progressBroadcaster.progress(sseClientId, 'analysis', 50, 'Analizando imÃ¡genes...');

      const imageAnalyses = imageFiles.length > 0 
        ? await openAIService.analyzeMultipleImages(imageFiles.map(f => f.path))
        : [];

      const imageAnalysis = imageAnalyses.length > 0
        ? imageAnalyses.map(img => `${img.system}: ${JSON.stringify(img.data)}`).join('\n\n')
        : 'No se proporcionaron imÃ¡genes para analizar';

      logger.success('âœ… Image analysis completed');

      // 4. Evaluar con criterios - âœ… CORREGIDO
      progressBroadcaster.progress(sseClientId, 'evaluation', 75, 'Evaluando con IA...');

      const evaluation = await evaluatorService.evaluate(
        metadata,
        transcription,
        imageAnalyses
      );

      logger.success('âœ… Evaluation completed', {
        totalScore: evaluation.totalScore,
        maxPossibleScore: evaluation.maxPossibleScore,
        percentage: evaluation.percentage
      });

      // 5. Generar Excel - âœ… CORREGIDO
      progressBroadcaster.progress(sseClientId, 'excel', 90, 'Generando reporte Excel...');

      const excelFilename = `auditoria_${metadata.executiveId}_${Date.now()}.xlsx`;
      const excelPath = path.join(resultsDir, excelFilename);

      await excelService.generateExcelReport(metadata, evaluation);

      logger.success('âœ… Excel report generated', { filename: excelFilename });

      // 6. Calcular costos - âœ… CORREGIDO
      const costs = costCalculatorService.calculateTotalCost(
        transcription.audio_duration || 0,
        imageFiles.length,
        0,
        0,
        evaluation.usage?.inputTokens || 0,
        evaluation.usage?.outputTokens || 0
      );

      logger.info('ðŸ’° Costs calculated:', costs);

      // 7. Actualizar en base de datos
      await databaseService.completeAudit(auditId, {
        transcription: transcription.text,
        transcriptionWords: transcription.words,
        imageAnalysis: imageAnalysis,
        evaluation,
        excelPath: excelFilename,
        processingTimeMs: Date.now() - startTime,
        costs
      });

      logger.success('âœ… Audit completed successfully', {
        auditId,
        totalTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
        totalCost: `$${costs.totalCost.toFixed(4)}`
      });

      // 8. Enviar progreso final
      progressBroadcaster.progress(sseClientId, 'completed', 100, 'Â¡AuditorÃ­a completada!');

      // Registrar actividad
      await databaseService.logAuditActivity(
        auditId,
        req.user!.id,
        'created',
        null,
        req.ip,
        req.headers['user-agent']
      );

      // Responder con el ID
      res.json({
        success: true,
        auditId,
        excelUrl: `/results/${excelFilename}`,
        processingTime: Date.now() - startTime,
        costs
      });

    } catch (error: any) {
      logger.error('âŒ Error processing audit:', error);

      if (auditId) {
        await databaseService.markAuditError(auditId, error.message);
      }

      progressBroadcaster.progress(sseClientId, 'error', 0, `Error: ${error.message}`);

      res.status(500).json({ 
        error: 'Error procesando auditorÃ­a', 
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
      message: 'AuditorÃ­a eliminada exitosamente' 
    });

  } catch (error: any) {
    logger.error('Error deleting audit:', error);

    if (error.message.includes('No tienes permisos')) {
      return res.status(403).json({ error: error.message });
    }

    if (error.message.includes('no encontrada')) {
      return res.status(404).json({ error: 'AuditorÃ­a no encontrada' });
    }

    res.status(500).json({ error: 'Error al eliminar auditorÃ­a' });
  }
});

app.get('/api/download/:filename', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(resultsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    res.download(filePath, filename);
  } catch (error: any) {
    logger.error('Error downloading file:', error);
    res.status(500).json({ error: 'Error al descargar archivo' });
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
      return res.status(400).json({ error: 'Rol invÃ¡lido' });
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
      return res.status(500).json({ error: 'Error al crear usuario en autenticaciÃ³n' });
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
        return res.status(400).json({ error: 'Rol invÃ¡lido' });
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
    res.status(500).json({ error: 'Error al obtener configuraciÃ³n' });
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
    res.json({ success: true, message: 'ConfiguraciÃ³n actualizada exitosamente' });
  } catch (error: any) {
    logger.error('Error updating config:', error);
    res.status(500).json({ error: 'Error al actualizar configuraciÃ³n' });
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
            res.json({ success: true, message: 'ConexiÃ³n exitosa con OpenAI' });
          } 
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Error de conexiÃ³n';
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
            res.json({ success: true, message: 'ConexiÃ³n exitosa con AssemblyAI' });
          } else if (response.status === 401) {
            res.json({ success: false, error: 'API key invÃ¡lida' });
          } else {
            res.json({ success: true, message: 'ConexiÃ³n exitosa con AssemblyAI' });
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
            res.json({ success: true, message: 'ConexiÃ³n exitosa con Supabase' });
          }
        } catch (error: any) {
          res.json({ success: false, error: error.message });
        }
        break;

      default:
        res.status(400).json({ error: 'Servicio no vÃ¡lido' });
    }
  } catch (error: any) {
    logger.error('Error testing service:', error);
    res.status(500).json({ error: 'Error al probar conexiÃ³n' });
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