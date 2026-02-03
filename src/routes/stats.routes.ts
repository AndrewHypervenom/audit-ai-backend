// backend/src/routes/stats.routes.ts

import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth.middleware.js';
import { databaseService } from '../services/database.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/audits/stats
 * Obtener estadísticas de auditorías (para Supervisor)
 */
router.get('/stats', authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;

    logger.info(`📊 Fetching stats for user ${userId} with role ${userRole}`);

    // Query base dependiendo del rol
    let query = databaseService.client
      .from('audits')
      .select('id, status, created_at, evaluations(percentage)');

    // Filtrar por usuario si es ejecutivo
    if (userRole === 'analyst') {
      query = query.eq('user_id', userId);
    }

    const { data: audits, error } = await query;

    if (error) {
      logger.error('❌ Error fetching stats:', error);
      return res.status(500).json({ error: 'Error al obtener estadísticas', details: error.message });
    }

    logger.info(`✅ Found ${audits?.length || 0} audits`);

    // Calcular estadísticas
    const totalAudits = audits?.length || 0;
    const completedAudits = audits?.filter(a => a.status === 'completed').length || 0;
    const processingAudits = audits?.filter(a => a.status === 'processing').length || 0;
    const errorAudits = audits?.filter(a => a.status === 'error').length || 0;

    // Calcular score promedio - MANEJO SEGURO
    const completedWithScores = audits?.filter(a => {
      if (a.status !== 'completed') return false;
      if (!a.evaluations) return false;
      
      // Supabase puede devolver evaluations como array o como objeto único
      if (Array.isArray(a.evaluations)) {
        return a.evaluations.length > 0 && typeof a.evaluations[0]?.percentage === 'number';
      } else if (typeof a.evaluations === 'object') {
        return typeof (a.evaluations as any).percentage === 'number';
      }
      
      return false;
    }) || [];
    
    logger.info(`📈 Completed audits with scores: ${completedWithScores.length}`);

    let averageScore = 0;
    if (completedWithScores.length > 0) {
      const totalScore = completedWithScores.reduce((sum, a) => {
        if (Array.isArray(a.evaluations)) {
          return sum + (a.evaluations[0]?.percentage || 0);
        } else if (typeof a.evaluations === 'object') {
          return sum + ((a.evaluations as any).percentage || 0);
        }
        return sum;
      }, 0);
      
      averageScore = totalScore / completedWithScores.length;
      logger.info(`💯 Average score calculated: ${averageScore.toFixed(2)}%`);
    }

    // Contar ejecutivos únicos (solo para supervisor/admin)
    let totalExecutives = 0;
    if (userRole === 'admin' || userRole === 'supervisor') {
      const { data: users, error: usersError } = await databaseService.client
        .from('users')
        .select('id')
        .eq('role', 'executive')
        .eq('is_active', true);

      if (usersError) {
        logger.warn('⚠️ Error counting executives:', usersError);
      } else {
        totalExecutives = users?.length || 0;
        logger.info(`👥 Total executives: ${totalExecutives}`);
      }
    }

    // Auditorías este mes
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthAudits = audits?.filter(a => {
      try {
        return new Date(a.created_at) >= firstDayOfMonth;
      } catch {
        return false;
      }
    }).length || 0;

    logger.info(`📅 Audits this month: ${thisMonthAudits}`);

    // ⭐ NUEVO: Calcular costos totales
    let totalCosts = 0;
    if (userRole === 'admin' || userRole === 'supervisor') {
      const { data: costs, error: costsError } = await databaseService.client
        .from('api_costs')
        .select('total_cost');

      if (costsError) {
        logger.warn('⚠️ Error fetching costs:', costsError);
      } else {
        totalCosts = costs?.reduce((sum, c) => sum + Number(c.total_cost || 0), 0) || 0;
        logger.info(`💰 Total costs calculated: $${totalCosts.toFixed(4)}`);
      }
    }

    const response = {
      totalAudits,
      completedAudits,
      processingAudits,
      errorAudits,
      averageScore: Math.round(averageScore * 100) / 100, // Redondear a 2 decimales
      totalExecutives,
      thisMonthAudits,
      totalCosts // ⭐ AGREGADO
    };

    logger.info('✨ Stats response:', response);

    res.json(response);

  } catch (error: any) {
    logger.error('💥 Stats endpoint error:', error);
    logger.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET /api/audits/my-audits
 * Obtener auditorías personales (para Ejecutivo)
 */
router.get('/my-audits', authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    // Obtener el executive_id del usuario
    const { data: userData, error: userError } = await databaseService.client
      .from('users')
      .select('full_name, email')
      .eq('id', userId)
      .single();

    if (userError) {
      logger.error('Error fetching user data:', userError);
      return res.status(500).json({ error: 'Error al obtener datos del usuario' });
    }

    // Buscar auditorías por executive_name (usando full_name o email)
    const { data: audits, error } = await databaseService.client
      .from('audits')
      .select(`
        id,
        executive_name,
        executive_id,
        call_type,
        call_date,
        status,
        created_at,
        evaluations (
          total_score,
          max_possible_score,
          percentage
        )
      `)
      .or(`executive_name.eq.${userData.full_name},executive_id.eq.${userId}`)
      .order('call_date', { ascending: false });

    if (error) {
      logger.error('Error fetching my audits:', error);
      return res.status(500).json({ error: 'Error al obtener auditorías' });
    }

    res.json({
      audits: audits || []
    });

  } catch (error: any) {
    logger.error('My audits endpoint error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/analytics
 * Obtener análisis detallado (para Analista)
 */
router.get('/analytics', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { period = 'month' } = req.query;
    const userRole = req.user!.role;

    // Solo Admin y Analyst pueden acceder a este endpoint
    if (userRole !== 'admin' && userRole !== 'analyst') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Obtener todas las auditorías completadas con evaluaciones
    const { data: audits, error } = await databaseService.client
      .from('audits')
      .select(`
        id,
        executive_name,
        call_type,
        call_date,
        status,
        created_at,
        evaluations (
          percentage
        )
      `)
      .eq('status', 'completed')
      .order('call_date', { ascending: false });

    if (error) {
      logger.error('Error fetching analytics:', error);
      return res.status(500).json({ error: 'Error al obtener análisis' });
    }

    const completedAudits = audits || [];
    const totalAudits = completedAudits.length;
    
    const scores = completedAudits
      .filter(a => {
        if (!a.evaluations) return false;
        if (Array.isArray(a.evaluations)) {
          return a.evaluations.length > 0 && typeof a.evaluations[0]?.percentage === 'number';
        }
        return typeof (a.evaluations as any).percentage === 'number';
      })
      .map(a => {
        if (Array.isArray(a.evaluations)) {
          return a.evaluations[0].percentage;
        }
        return (a.evaluations as any).percentage;
      });

    const averageScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 0;

    // Mock data para demostración
    const monthlyTrend = [
      { month: 'Ene', count: 45, avgScore: 78.5 },
      { month: 'Feb', count: 52, avgScore: 81.2 },
      { month: 'Mar', count: 48, avgScore: 83.4 },
      { month: 'Abr', count: 55, avgScore: 82.1 },
      { month: 'May', count: Math.min(totalAudits, 45), avgScore: averageScore }
    ];

    const scoreDistribution = [
      { range: '90-100', count: scores.filter(s => s >= 90).length },
      { range: '80-89', count: scores.filter(s => s >= 80 && s < 90).length },
      { range: '70-79', count: scores.filter(s => s >= 70 && s < 80).length },
      { range: '60-69', count: scores.filter(s => s >= 60 && s < 70).length },
      { range: '<60', count: scores.filter(s => s < 60).length }
    ];

    // Top ejecutivos
    const executiveScores = new Map<string, { sum: number; count: number }>();
    completedAudits.forEach(audit => {
      let percentage = null;
      
      if (audit.evaluations) {
        if (Array.isArray(audit.evaluations) && audit.evaluations.length > 0) {
          percentage = audit.evaluations[0].percentage;
        } else if (typeof audit.evaluations === 'object') {
          percentage = (audit.evaluations as any).percentage;
        }
      }
      
      if (percentage !== null) {
        const name = audit.executive_name;
        const current = executiveScores.get(name) || { sum: 0, count: 0 };
        executiveScores.set(name, {
          sum: current.sum + percentage,
          count: current.count + 1
        });
      }
    });

    const topExecutives = Array.from(executiveScores.entries())
      .map(([name, data]) => ({
        name,
        avgScore: data.sum / data.count,
        auditsCount: data.count
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 5);

    // Obtener costos totales
    const { data: costs } = await databaseService.client
      .from('api_costs')
      .select('total_cost');

    const totalCosts = costs?.reduce((sum, c) => sum + Number(c.total_cost), 0) || 0;

    res.json({
      totalAudits,
      completedAudits: totalAudits,
      averageScore,
      totalCosts,
      monthlyTrend,
      scoreDistribution,
      topExecutives
    });

  } catch (error: any) {
    logger.error('Analytics endpoint error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;