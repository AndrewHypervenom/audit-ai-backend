// backend/src/middleware/auth.middleware.ts

import { Request, Response, NextFunction } from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

// Tipos de roles - Executive eliminado según documento v1.0
export type UserRole = 'admin' | 'supervisor' | 'analyst';

// Extender Request para incluir user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        full_name?: string;
      };
    }
  }
}

/**
 * Middleware para verificar JWT de Supabase y extraer información del usuario
 */
export const authenticateUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Obtener token del header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7); // Remover "Bearer "

    // Verificar token con Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn('❌ Invalid or expired token', { error: error?.message });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Obtener perfil del usuario con rol
    let { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('role, full_name, is_active')
      .eq('id', user.id)
      .single();

    // Si el usuario no existe en la tabla users, crearlo con rol analyst por defecto
    if (profileError && profileError.code === 'PGRST116') {
      logger.info('🔍 User profile not found, creating with default analyst role...', { 
        userId: user.id, 
        email: user.email 
      });
      
      const { data: newProfile, error: createError } = await supabaseAdmin
        .from('users')
        .insert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
          role: 'analyst', // Rol por defecto (operador principal)
          is_active: true
        })
        .select('role, full_name, is_active')
        .single();

      if (createError) {
        logger.error('❌ Error creating user profile', createError);
        return res.status(500).json({ error: 'Error creating user profile' });
      }

      profile = newProfile;
      logger.success('✅ User profile created successfully', { userId: user.id, role: 'analyst' });
    } else if (profileError) {
      logger.error('❌ Error fetching user profile', profileError);
      return res.status(500).json({ error: 'Error fetching user profile' });
    }

    // Verificar si el usuario está activo
    if (!profile?.is_active) {
      logger.warn('⚠️ Inactive user attempted to access', { userId: user.id, email: user.email });
      return res.status(403).json({ error: 'User account is inactive' });
    }

    // Actualizar last_login_at
    await supabaseAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // Agregar usuario al request
    req.user = {
      id: user.id,
      email: user.email!,
      role: (profile?.role as UserRole) || 'analyst',
      full_name: profile?.full_name || undefined
    };

    logger.info('✅ User authenticated', { 
      userId: req.user.id, 
      email: req.user.email, 
      role: req.user.role 
    });
    
    next();
  } catch (error: any) {
    logger.error('❌ Authentication error', error);
    return res.status(500).json({ error: 'Internal authentication error' });
  }
};

/**
 * Middleware para verificar que el usuario sea Admin
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.user.role !== 'admin') {
    logger.warn('⚠️ Unauthorized access attempt to admin resource', {
      userId: req.user.id,
      role: req.user.role
    });
    return res.status(403).json({ 
      error: 'Insufficient permissions',
      message: 'This action requires administrator privileges' 
    });
  }

  next();
};

/**
 * Middleware para verificar que el usuario sea Admin o Analyst
 * Según documento v1.0: Solo Admin y Analyst pueden crear/editar/eliminar auditorías
 */
export const requireAdminOrAnalyst = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (!['admin', 'analyst'].includes(req.user.role)) {
    logger.warn('⚠️ Unauthorized access attempt', {
      userId: req.user.id,
      role: req.user.role,
      requiredRoles: ['admin', 'analyst']
    });
    return res.status(403).json({ 
      error: 'Insufficient permissions',
      message: 'This action requires administrator or analyst privileges' 
    });
  }

  next();
};

/**
 * Middleware para verificar roles específicos
 * @param allowedRoles - Array de roles permitidos
 */
export const requireRoles = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('⚠️ Unauthorized access attempt', {
        userId: req.user.id,
        role: req.user.role,
        requiredRoles: allowedRoles
      });
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}` 
      });
    }

    next();
  };
};

/**
 * Middleware para verificar que el usuario puede acceder a una auditoría específica
 * Todos los roles (Admin, Analyst, Supervisor) pueden ver todas las auditorías
 */
export const canAccessAudit = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const auditId = req.params.id;

  if (!auditId) {
    return res.status(400).json({ error: 'Audit ID is required' });
  }

  try {
    // Todos los roles tienen acceso de lectura a todas las auditorías
    if (['admin', 'supervisor', 'analyst'].includes(req.user.role)) {
      return next();
    }

    // Rol desconocido
    return res.status(403).json({ error: 'Insufficient permissions' });
  } catch (error: any) {
    logger.error('❌ Error in canAccessAudit middleware', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Helper: Verificar si el usuario tiene un permiso específico
 * Permisos actualizados según documento AuditorIA v1.0
 * 
 * ADMIN: Control total
 * ANALYST: Crear/editar/eliminar auditorías, NO costos
 * SUPERVISOR: Solo lectura, SÍ costos
 */
export function hasPermission(role: UserRole, permission: string): boolean {
  const permissions: Record<UserRole, string[]> = {
    admin: ['*'], // Admin tiene todos los permisos
    analyst: [
      'audits:create',
      'audits:read',
      'audits:update',
      'audits:delete',
      'users:read',
      'reports:generate'
      // NO incluye 'costs:read'
    ],
    supervisor: [
      'audits:read',
      'users:read',
      'costs:read',
      'reports:generate:readonly'
      // NO incluye create, update, delete
    ]
  };

  const userPermissions = permissions[role] || [];
  
  // Admin tiene todos los permisos
  if (userPermissions.includes('*')) {
    return true;
  }

  return userPermissions.includes(permission);
}